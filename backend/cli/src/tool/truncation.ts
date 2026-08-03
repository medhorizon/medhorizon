import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Identifier } from "../id/id"
import { PermissionNext } from "../permission/next"
import type { Agent } from "../agent/agent"
import { Scheduler } from "../scheduler"
import { Config } from "../config/config"

export namespace Truncate {
  export const MAX_LINES = 2000
  export const MAX_BYTES = 50 * 1024
  export const BOUND_MAX_LINES = 1500
  export const BOUND_MAX_BYTES = 40 * 1024
  export const DIR = path.join(Global.Path.data, "tool-output")
  export const GLOB = path.join(DIR, "*")
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const HOUR_MS = 60 * 60 * 1000
  const SEVERITY = /\b(ERROR|FATAL|Exception|Traceback)\b/
  const STRUCTURED_KEYS = new Set([
    "id",
    "stage",
    "source",
    "target",
    "from",
    "to",
    "graph_id",
    "experiment_id",
    "node_id",
    "edge_id",
    "relation",
    "part_id",
    "kind",
    "type",
    "status",
    "code",
    "error",
    "errors",
    "message",
    "severity",
    "name",
    "title",
    "label",
    "lifecycle",
    "outcome",
    "gated",
    "evidence",
    "claim",
    "issue",
    "verdict",
    "artifact_type",
    "path",
    "tool",
    "revision",
  ])

  export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

  export interface Options {
    maxLines?: number
    maxBytes?: number
    direction?: "head" | "tail"
    tool?: string
  }

  export function init() {
    Scheduler.register({
      id: "tool.truncation.cleanup",
      interval: HOUR_MS,
      run: cleanup,
      scope: "global",
    })
  }

  export async function cleanup() {
    const cutoff = Identifier.timestamp(Identifier.create("tool", false, Date.now() - RETENTION_MS))
    const glob = new Bun.Glob("tool_*")
    const entries = await Array.fromAsync(glob.scan({ cwd: DIR, onlyFiles: true })).catch(() => [] as string[])
    for (const entry of entries) {
      if (Identifier.timestamp(entry) >= cutoff) continue
      await fs.unlink(path.join(DIR, entry)).catch(() => {})
    }
  }

  function hasTaskTool(agent?: Agent.Info): boolean {
    if (!agent?.permission) return false
    const rule = PermissionNext.evaluate("task", "*", agent.permission)
    return rule.action !== "deny"
  }

  function isStructuredKeepTool(tool?: string) {
    if (!tool) return false
    if (tool === "stage") return true
    if (tool.startsWith("atlas_")) return true
    if (tool.startsWith("provenance_")) return true
    return false
  }

  function isLogTool(tool?: string) {
    return tool === "bash" || tool === "read"
  }

  function isSearchTool(tool?: string) {
    return tool === "websearch" || tool === "codesearch" || tool === "grep" || tool === "glob"
  }

  async function boundEnabled() {
    if (process.env.OPENSCIENCE_TOOL_RESULT_BOUND === "1") return true
    const cfg = await Config.get()
    return cfg.experimental?.tool_result_bound === true
  }

  export async function bound(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    if (!(await boundEnabled())) return output(text, options, agent)

    const tool = options.tool
    if (isStructuredKeepTool(tool)) {
      const kept = structuredKeep(text, tool!)
      if (kept) {
        const keptText = JSON.stringify(kept, null, 2)
        if (withinLimits(keptText, options)) return { content: keptText, truncated: false }
        return spill(text, keptText, options, agent, "structured keep-list skeleton retained inline")
      }
    }

    if (isSearchTool(tool)) {
      const search = await boundSearch(text, options, agent)
      if (search) return search
    }

    if (isLogTool(tool)) return boundLog(text, options, agent)

    return output(text, { ...options, direction: options.direction ?? "tail" }, agent)
  }

  function withinLimits(text: string, options: Options) {
    const maxLines = options.maxLines ?? BOUND_MAX_LINES
    const maxBytes = options.maxBytes ?? BOUND_MAX_BYTES
    return text.split("\n").length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes
  }

  function structuredKeep(text: string, tool: string): unknown | undefined {
    const data = (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    })()
    if (data === undefined) return undefined
    return skeleton(data, tool)
  }

  function skeleton(value: unknown, tool: string): unknown {
    if (Array.isArray(value)) return value.map((item) => skeleton(item, tool))
    if (!value || typeof value !== "object") return value

    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}

    for (const [key, val] of Object.entries(obj)) {
      if (key === "meta" && val && typeof val === "object") {
        const meta = val as Record<string, unknown>
        if (meta.medhorizon_stage !== undefined) out.meta = { medhorizon_stage: meta.medhorizon_stage }
        continue
      }

      if (key === "nodes" || key === "edges") {
        out[key] = Array.isArray(val) ? val.map((item) => skeleton(item, tool)) : val
        continue
      }

      const keep = STRUCTURED_KEYS.has(key) || key.endsWith("_id")

      if (!keep) continue

      if (key === "nodes" || key === "edges") {
        out[key] = val
        continue
      }

      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        out[key] = skeleton(val, tool)
        continue
      }

      out[key] = val
    }

    return out
  }

  type SearchHit = { id: string; title: string }

  function extractSearchHits(text: string): SearchHit[] {
    const parsed = (() => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    })()

    if (parsed !== undefined) {
      const list = searchList(parsed)
      if (list.length) {
        return list.map((item, index) => ({
          id: String(item.id ?? item.url ?? item.uri ?? index + 1),
          title: String(item.title ?? item.name ?? item.id ?? ""),
        }))
      }
    }

    const hits: SearchHit[] = []
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(\d+)\.\s*(?:\[(.+?)\])?\s*(.+)$/)
      if (!match) continue
      hits.push({ id: match[2] ?? match[1], title: match[3].trim() })
    }
    return hits
  }

  function searchList(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value))
      return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
    if (!value || typeof value !== "object") return []
    const obj = value as Record<string, unknown>
    for (const key of ["results", "hits", "items", "data"]) {
      const list = obj[key]
      if (Array.isArray(list))
        return list.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
    }
    return []
  }

  async function boundSearch(text: string, options: Options, agent?: Agent.Info): Promise<Result | undefined> {
    const hits = extractSearchHits(text)
    if (!hits.length) return undefined

    const maxBytes = options.maxBytes ?? BOUND_MAX_BYTES
    if (Buffer.byteLength(text, "utf-8") <= maxBytes) return { content: text, truncated: false }

    const index = hits.map((hit, index) => `${index + 1}. [${hit.id}] ${hit.title}`).join("\n")
    const stub = [
      "truncated: true",
      `total: ${hits.length}`,
      "hits (all ids/titles):",
      index,
      hits.length > 0 ? `next_page: { "offset": ${Math.min(3, hits.length)} }` : "",
    ]
      .filter(Boolean)
      .join("\n")

    return spill(text, stub, options, agent, "search results; all hit ids/titles retained")
  }

  async function boundLog(text: string, options: Options, agent?: Agent.Info): Promise<Result> {
    const lines = text.split("\n")
    const maxLines = options.maxLines ?? BOUND_MAX_LINES
    const maxBytes = options.maxBytes ?? BOUND_MAX_BYTES
    const overBudget = lines.length > maxLines || Buffer.byteLength(text, "utf-8") > maxBytes
    if (!overBudget) return { content: text, truncated: false }

    const severity = lines.filter((line) => SEVERITY.test(line))

    const tail: string[] = []
    let bytes = 0
    for (let index = lines.length - 1; index >= 0 && tail.length < maxLines; index--) {
      const line = lines[index]
      const size = Buffer.byteLength(line, "utf-8") + (tail.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes && !SEVERITY.test(line)) break
      tail.unshift(line)
      bytes += size
    }

    const kept = new Set([...severity, ...tail])
    const ordered = lines.filter((line) => kept.has(line))
    const joined = ordered.join("\n")

    return spill(text, joined, options, agent, "log tail + severity lines retained")
  }

  async function spill(
    full: string,
    preview: string,
    options: Options,
    agent: Agent.Info | undefined,
    reason: string,
  ): Promise<Result> {
    const id = Identifier.ascending("tool")
    const filepath = path.join(DIR, id)
    await Bun.write(Bun.file(filepath), full)

    const hint = hasTaskTool(agent)
      ? `Full output saved to: ${filepath}\ntruncated: true\nreason: ${reason}\nUse Read with offset/limit or Grep; delegate large files to the Task tool.`
      : `Full output saved to: ${filepath}\ntruncated: true\nreason: ${reason}\nUse Read with offset/limit or Grep to retrieve omitted content.`

    const message = `${preview}\n\n...content truncated...\n\n${hint}`
    return { content: message, truncated: true, outputPath: filepath }
  }

  export async function output(text: string, options: Options = {}, agent?: Agent.Info): Promise<Result> {
    const maxLines = options.maxLines ?? MAX_LINES
    const maxBytes = options.maxBytes ?? MAX_BYTES
    const direction = options.direction ?? "head"
    const lines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf-8")

    if (lines.length <= maxLines && totalBytes <= maxBytes) {
      return { content: text, truncated: false }
    }

    const out: string[] = []
    let i = 0
    let bytes = 0
    let hitBytes = false

    if (direction === "head") {
      for (i = 0; i < lines.length && i < maxLines; i++) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.push(lines[i])
        bytes += size
      }
    } else {
      for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
        const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
        if (bytes + size > maxBytes) {
          hitBytes = true
          break
        }
        out.unshift(lines[i])
        bytes += size
      }
    }

    const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
    const unit = hitBytes ? "bytes" : "lines"
    const preview = out.join("\n")

    const id = Identifier.ascending("tool")
    const filepath = path.join(DIR, id)
    await Bun.write(Bun.file(filepath), text)

    const hint = hasTaskTool(agent)
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
      : `The tool call succeeded but the output was truncated. Full output saved to: ${filepath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
    const message =
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`

    return { content: message, truncated: true, outputPath: filepath }
  }
}
