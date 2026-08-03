import { realpath } from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"

/**
 * ProjectFile — the single canonical project-path resolver shared by every file
 * I/O operation (read / write / inspect / preview / raw download).
 *
 * Containment rules
 * -----------------
 * Every relative, absolute, and URI-encoded input is resolved against the
 * live `Instance.directory` and must satisfy all of:
 *   - lexical containment (`..` traversal rejected),
 *   - realpath containment (a symlink that resolves outside the project is
 *     rejected even when the lexical path looked contained),
 *   - same-drive on Windows (cross-drive paths rejected),
 *   - an existing regular file for `requireFile` (directories rejected).
 *
 * A resolution is NOT an authorization ticket. Each operation re-resolves
 * freshly through `resolve`/`requireFile` immediately before doing its own I/O,
 * which closes the TOCTOU window between an inspect and a later read/download.
 */
export namespace ProjectFile {
  export class NotContained extends Error {
    constructor() {
      super("Access denied: path escapes project directory")
      this.name = "ProjectFileNotContained"
    }
  }

  export class CrossDrive extends Error {
    constructor() {
      super("Access denied: cross-drive path")
      this.name = "ProjectFileCrossDrive"
    }
  }

  export class NotFound extends Error {
    constructor() {
      super("file not found")
      this.name = "ProjectFileNotFound"
    }
  }

  export class IsDirectory extends Error {
    constructor() {
      super("path is a directory")
      this.name = "ProjectFileIsDirectory"
    }
  }

  export type Kind = "file" | "file-or-new"

  export type Resolved = {
    /** Input exactly as received (URI-decoded once). */
    requested: string
    /** Project-relative path with forward slashes. */
    projectPath: string
    /** Canonical absolute path (realpath when the target exists). */
    absolute: string
  }

  /** Decode a URI-encoded input exactly once (Hono already decodes query
   * params; this covers direct callers). A literal `%` in a filename survives
   * because an invalid escape sequence is left untouched. */
  function decode(input: string): string {
    if (!input.includes("%")) return input
    try {
      return decodeURIComponent(input)
    } catch {
      return input
    }
  }

  function sameDrive(a: string, b: string): boolean {
    if (process.platform !== "win32") return true
    return path.parse(a).root.toLowerCase() === path.parse(b).root.toLowerCase()
  }

  /** Canonicalize a project path. `kind: "file-or-new"` tolerates a missing
   * target (writes); `kind: "file"` (the default) requires the target to exist. */
  export async function resolve(input: { path: string; kind?: Kind }): Promise<Resolved> {
    const kind = input.kind ?? "file"
    const requested = decode(input.path)
    if (requested.includes("\0")) throw new NotContained()

    const root = Instance.directory
    const joined = Filesystem.resolvePath(root, requested)

    // Lexical containment first — rejects `..` traversal cheaply.
    if (!Instance.containsPath(joined)) throw new NotContained()
    if (!sameDrive(root, joined)) throw new CrossDrive()

    let absolute: string
    try {
      absolute = await realpath(joined)
    } catch {
      if (kind !== "file-or-new") throw new NotFound()
      // The target may be created by a write. Canonicalize the nearest existing
      // parent; if even the parent is missing, fall back to the (already
      // containment-checked) lexical path to preserve the legacy read/write
      // behaviour for not-yet-existing trees.
      const parent = await realpath(path.dirname(joined)).catch(() => undefined)
      absolute = parent ? path.join(parent, path.basename(joined)) : joined
    }

    // Re-verify against the canonical path: a symlink may resolve outside the
    // project even though the lexical path was contained.
    if (!Instance.containsPath(absolute)) throw new NotContained()
    if (!sameDrive(root, absolute)) throw new CrossDrive()

    return {
      requested,
      projectPath: path.relative(root, absolute).split(path.sep).join("/"),
      absolute,
    }
  }

  /** Resolve an existing regular file and reject directory targets. */
  export async function requireFile(input: { path: string }): Promise<Resolved & { size: number }> {
    const resolved = await resolve({ ...input, kind: "file" })
    const stat = await Bun.file(resolved.absolute).stat().catch(() => undefined)
    if (!stat) throw new NotFound()
    if (stat.isDirectory()) throw new IsDirectory()
    return { ...resolved, size: stat.size }
  }
}
