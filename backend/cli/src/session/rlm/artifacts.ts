/**
 * RLM Artifacts — Object-level referencing for sparse context.
 *
 * Large data (DataFrames, analysis results, raw outputs) is stored on disk
 * and passed by reference. The LLM context holds only metadata + summary,
 * with actual data accessed via lazy loading in notebook/bash execution.
 *
 * Storage layout per session (two-phase commit):
 *   `<data>/artifacts/<session>/
 *     <id>.dat               — formal payload (the ONLY visibility commit)
 *     <id>.meta.json         — versioned metadata sidecar (committed first)
 *     .<id>.payload.tmp      — staged payload (never visible, stale-swept)
 *     .<id>.meta.tmp         — staged metadata (never visible, stale-swept)
 *
 * `register()` writes a temp payload and a temp metadata sidecar, validates
 * the metadata, then renames the formal sidecar FIRST and the payload `.dat`
 * LAST. The `.dat` rename is the single point of visibility: before it, the
 * entry is either uncommitted temp files or a metadata-only orphan, neither of
 * which list/get/preview/content ever project, and which cleanup() sweeps if a
 * process dies mid-commit.
 *
 * `list()`/`get()` project catalog entries from the formal `.dat` + sidecar
 * pair. A legacy `.dat` without a sidecar falls back to `type: "unknown"` and
 * a stable summary. The absolute `path` field is storage-internal; the server
 * routes never return it to a browser.
 */

import path from "path"
import fs from "fs/promises"
import z from "zod"
import { Global } from "@/global"
import { Log } from "@/util/log"
import type { RLMState } from "./state"

export namespace RLMArtifacts {
  const log = Log.create({ service: "rlm-artifacts" })
  const ARTIFACTS_DIR = path.join(Global.Path.data, "artifacts")
  const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  // Frozen staleness budget for temp/orphan recovery. Files younger than this
  // belong to an in-flight two-phase commit and must never be deleted.
  const TEMP_STALE_MS = 10 * 60 * 1000 // 10 minutes

  const METADATA_VERSION = 1
  const TEMP_SUFFIX = ".tmp"

  const MetadataSchema = z.object({
    version: z.literal(METADATA_VERSION),
    id: z.string(),
    type: z.string(),
    summary: z.string(),
    size: z.number().int().nonnegative(),
    createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), {
      message: "createdAt must be an ISO-8601 date string",
    }),
  })

  interface Metadata {
    version: 1
    id: string
    type: string
    summary: string
    size: number
    createdAt: number // epoch ms
  }

  /** A catalog entry. `path` is storage-internal; routes must not return it. */
  export interface ArtifactCatalogEntry extends RLMState.ArtifactRef {
    size: number
    createdAt: number // epoch ms
  }

  function artifactID(): string {
    return `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  /** Conservative guard against path-traversal segments in ids/session ids. */
  function isSafeSegment(value: string): boolean {
    return (
      value.length > 0 &&
      value.length <= 256 &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("..") &&
      !value.includes("\0")
    )
  }

  function sessionDir(sessionId: string): string {
    return path.join(ARTIFACTS_DIR, sessionId)
  }

  function payloadPath(dir: string, id: string): string {
    return path.join(dir, `${id}.dat`)
  }

  function sidecarPath(dir: string, id: string): string {
    return path.join(dir, `${id}.meta.json`)
  }

  function parseMetadata(input: unknown, expectedId: string): Metadata | "corrupt" {
    const parsed = MetadataSchema.safeParse(input)
    if (!parsed.success) return "corrupt"
    if (parsed.data.id !== expectedId) return "corrupt"
    return {
      version: parsed.data.version,
      id: parsed.data.id,
      type: parsed.data.type,
      summary: parsed.data.summary,
      size: parsed.data.size,
      createdAt: Date.parse(parsed.data.createdAt),
    }
  }

  /** Read the sidecar for a formal payload: metadata, null (legacy) or "corrupt". */
  async function readMetadata(dir: string, id: string): Promise<Metadata | "corrupt" | null> {
    const text = await Bun.file(sidecarPath(dir, id)).text().catch(() => null)
    if (text === null) return null
    try {
      return parseMetadata(JSON.parse(text), id)
    } catch {
      return "corrupt"
    }
  }

  /** Register an artifact — writes content to disk, returns a reference. */
  export async function register(
    sessionId: string,
    type: string,
    content: string,
    summary?: string,
  ): Promise<RLMState.ArtifactRef> {
    if (!isSafeSegment(sessionId)) {
      throw new Error("invalid session id")
    }
    const id = artifactID()
    const dir = sessionDir(sessionId)
    await fs.mkdir(dir, { recursive: true })

    const metadata = {
      version: METADATA_VERSION,
      id,
      type,
      summary: summary ?? `${type} artifact (${content.length} bytes)`,
      size: content.length,
      createdAt: new Date().toISOString(),
    }

    const tempPayload = path.join(dir, `.${id}.payload${TEMP_SUFFIX}`)
    const tempSidecar = path.join(dir, `.${id}.meta${TEMP_SUFFIX}`)
    const payload = payloadPath(dir, id)
    const sidecar = sidecarPath(dir, id)

    // Phase 1: stage both temp files in the same directory, fully validating
    // the metadata before any rename makes it visible.
    await Bun.write(tempPayload, content)
    await Bun.write(tempSidecar, JSON.stringify(metadata))
    if (parseMetadata(metadata, id) === "corrupt") {
      await fs.rm(tempPayload, { force: true }).catch(() => {})
      await fs.rm(tempSidecar, { force: true }).catch(() => {})
      throw new Error("artifact metadata failed validation")
    }

    // Phase 2: commit the sidecar first, then the payload LAST. The `.dat`
    // rename is the single visibility commit — between the two renames the
    // sidecar is a metadata-only orphan that list/get/preview/content ignore
    // and cleanup() sweeps if the process dies mid-commit.
    let sidecarCommitted = false
    try {
      await fs.rename(tempSidecar, sidecar)
      sidecarCommitted = true
      await fs.rename(tempPayload, payload)
    } catch (error) {
      await fs.rm(tempPayload, { force: true }).catch(() => {})
      await fs.rm(tempSidecar, { force: true }).catch(() => {})
      if (sidecarCommitted) await fs.rm(sidecar, { force: true }).catch(() => {})
      throw error
    }

    log.info("artifact registered", { sessionId, id, type, size: content.length })
    return {
      id,
      type,
      summary: metadata.summary,
      path: payload,
    }
  }

  /** Resolve an artifact — reads full content from disk (lazy loading). */
  export async function resolve(sessionId: string, id: string): Promise<string | null> {
    if (!isSafeSegment(sessionId) || !isSafeSegment(id)) {
      log.warn("artifact resolve rejected unsafe segment", { sessionId, id })
      return null
    }
    const filePath = path.join(ARTIFACTS_DIR, sessionId, `${id}.dat`)
    try {
      return await Bun.file(filePath).text()
    } catch {
      log.warn("artifact not found", { sessionId, id })
      return null
    }
  }

  /** List all artifacts for a session, newest-first. */
  export async function list(sessionId: string): Promise<ArtifactCatalogEntry[]> {
    if (!isSafeSegment(sessionId)) return []
    const dir = sessionDir(sessionId)
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      return []
    }

    const entries: ArtifactCatalogEntry[] = []
    for (const name of names) {
      // Only formal `.dat` payloads are listable. Temp files and metadata-only
      // orphans (a sidecar with no `.dat`) are never projected.
      if (!name.endsWith(".dat")) continue
      const id = name.slice(0, -".dat".length)
      const payload = path.join(dir, name)
      const meta = await readMetadata(dir, id)
      if (meta === "corrupt") {
        // A formal entry with a corrupt sidecar is hidden as incomplete, never
        // downgraded to the legacy shape.
        log.warn("artifact metadata corrupt; hiding incomplete entry", { sessionId, id })
        continue
      }
      if (meta) {
        entries.push({
          id,
          type: meta.type,
          summary: meta.summary,
          size: meta.size,
          createdAt: meta.createdAt,
          path: payload,
        })
        continue
      }
      const stat = await fs.stat(payload).catch(() => null)
      entries.push({
        id,
        type: "unknown",
        summary: `Artifact ${name}`,
        size: stat?.size ?? 0,
        createdAt: stat?.mtimeMs ?? 0,
        path: payload,
      })
    }

    // Stable newest-first ordering: created time desc, then id desc.
    entries.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    return entries
  }

  /** Get one catalog entry (with its storage-internal path) or null. */
  export async function get(sessionId: string, id: string): Promise<ArtifactCatalogEntry | null> {
    if (!isSafeSegment(sessionId) || !isSafeSegment(id)) return null
    const dir = sessionDir(sessionId)
    const payload = payloadPath(dir, id)
    const stat = await fs.stat(payload).catch(() => null)
    if (!stat?.isFile()) return null
    const meta = await readMetadata(dir, id)
    if (meta === "corrupt") {
      log.warn("artifact metadata corrupt; hiding incomplete entry", { sessionId, id })
      return null
    }
    if (meta) {
      return { id, type: meta.type, summary: meta.summary, size: meta.size, createdAt: meta.createdAt, path: payload }
    }
    return { id, type: "unknown", summary: `Artifact ${id}.dat`, size: stat.size, createdAt: stat.mtimeMs, path: payload }
  }

  /** Does the session have an artifact directory on disk? */
  export async function sessionExists(sessionId: string): Promise<boolean> {
    if (!isSafeSegment(sessionId)) return false
    const stat = await fs.stat(sessionDir(sessionId)).catch(() => null)
    return stat?.isDirectory() ?? false
  }

  /** Is `filePath` inside this session's artifact directory? */
  export function isWithin(sessionId: string, filePath: string): boolean {
    if (!isSafeSegment(sessionId)) return false
    const root = path.resolve(sessionDir(sessionId))
    const target = path.resolve(filePath)
    return target === root || target.startsWith(root + path.sep)
  }

  /** Bounded preview read: never loads more than `cap` bytes of the payload. */
  export async function readPreview(
    sessionId: string,
    id: string,
    cap: number,
  ): Promise<{ entry: ArtifactCatalogEntry; content: string; totalBytes: number; truncated: boolean } | null> {
    const entry = await get(sessionId, id)
    if (!entry) return null
    const stat = await fs.stat(entry.path).catch(() => null)
    if (!stat) return null
    const content = await Bun.file(entry.path).slice(0, cap).text().catch(() => null)
    if (content === null) return null
    return { entry, content, totalBytes: stat.size, truncated: stat.size > cap }
  }

  /** Cleanup artifacts older than TTL + recover stale temp/orphan files. Called on startup. */
  export async function cleanup(): Promise<void> {
    try {
      const exists = await fs.stat(ARTIFACTS_DIR).catch(() => null)
      if (!exists) return

      const sessions = await fs.readdir(ARTIFACTS_DIR)
      const now = Date.now()
      let cleaned = 0

      for (const session of sessions) {
        const dir = path.join(ARTIFACTS_DIR, session)
        const stat = await fs.stat(dir).catch(() => null)
        if (!stat?.isDirectory()) continue

        // 7-day TTL: expire the entire session artifact store.
        if (now - stat.mtimeMs > TTL_MS) {
          await fs.rm(dir, { recursive: true })
          cleaned++
          continue
        }

        // Recovery: sweep stale temps and metadata-only orphans left by an
        // interrupted two-phase commit. Only files older than TEMP_STALE_MS are
        // touched, so a concurrent register's active temps are never deleted.
        const names = await fs.readdir(dir).catch(() => [] as string[])
        const committed = new Set(names.filter((n) => n.endsWith(".dat")).map((n) => n.slice(0, -4)))
        for (const name of names) {
          const filePath = path.join(dir, name)
          const fileStat = await fs.stat(filePath).catch(() => null)
          if (!fileStat?.isFile()) continue
          if (now - fileStat.mtimeMs <= TEMP_STALE_MS) continue

          if (name.endsWith(TEMP_SUFFIX)) {
            await fs.rm(filePath, { force: true }).catch(() => {})
            cleaned++
            continue
          }
          if (name.endsWith(".meta.json")) {
            const id = name.slice(0, -".meta.json".length)
            if (!committed.has(id)) {
              await fs.rm(filePath, { force: true }).catch(() => {})
              cleaned++
            }
          }
        }
      }

      if (cleaned > 0) {
        log.info("cleaned old artifacts", { count: cleaned })
      }
    } catch (e) {
      log.warn("artifact cleanup error", { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
