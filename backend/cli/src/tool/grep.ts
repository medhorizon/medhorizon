import z from "zod"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000
const MAX_MATCHES = 100
const MAX_BYTES = 50 * 1024
const MAX_STDERR_BYTES = 16 * 1024

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    const rgPath = await Ripgrep.filepath()
    const args = [
      "-nH",
      "--hidden",
      "--follow",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      params.pattern,
    ]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.abort,
    })

    const state = {
      pending: "",
      bytes: 0,
      matches: [] as Array<{ path: string; modTime: number; lineNum: number; lineText: string }>,
      truncated: false,
      aborted: false,
      killed: false,
      error: undefined as unknown,
    }
    const maxPending = MAX_LINE_LENGTH + 4096
    const decoder = new TextDecoder()
    const stderr = readBounded(proc.stderr, MAX_STDERR_BYTES).catch(() => "")
    const kill = () => {
      if (state.killed) return
      state.killed = true
      proc.kill()
    }
    const abort = () => {
      state.aborted = true
      kill()
    }
    const onAbort = () => abort()
    ctx.abort.addEventListener("abort", onAbort, { once: true })
    if (ctx.abort.aborted) abort()

    const processLine = async (value: string) => {
      if (state.killed) return

      const line = value.endsWith("\r") ? value.slice(0, -1) : value
      const first = line.indexOf("|")
      const second = first < 0 ? -1 : line.indexOf("|", first + 1)
      if (first <= 0 || second <= first + 1) return

      const filePath = line.slice(0, first)
      const lineNum = Number.parseInt(line.slice(first + 1, second), 10)
      if (!Number.isFinite(lineNum)) return
      const lineText = line.slice(second + 1)
      const stats = await Bun.file(filePath).stat().catch(() => null)
      if (!stats || state.killed) return

      state.matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
      if (state.matches.length >= MAX_MATCHES) {
        state.truncated = true
        kill()
      }
    }

    const feed = async (value: string) => {
      if (state.killed) return

      const combined = state.pending + value
      let start = 0
      while (!state.killed) {
        const end = combined.indexOf("\n", start)
        if (end < 0) break
        await processLine(combined.slice(start, end))
        start = end + 1
      }
      if (state.killed) return

      const pending = combined.slice(start)
      state.pending = pending.length > maxPending ? pending.slice(0, maxPending) : pending
    }

    const reader = proc.stdout.getReader()
    try {
      while (!state.killed && !state.aborted) {
        const chunk = await reader.read()
        if (chunk.done) {
          await feed(decoder.decode())
          if (!state.killed && state.pending) await processLine(state.pending)
          break
        }

        const remaining = MAX_BYTES - state.bytes
        if (remaining <= 0) {
          state.truncated = true
          kill()
          break
        }

        const value = chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value
        state.bytes += value.byteLength
        await feed(decoder.decode(value, { stream: true }))
        if (chunk.value.byteLength > remaining || state.bytes >= MAX_BYTES) {
          state.truncated = true
          kill()
        }
      }
    } catch (error) {
      state.error = error
      kill()
    } finally {
      if (state.killed) await reader.cancel().catch(() => {})
      reader.releaseLock()
      ctx.abort.removeEventListener("abort", onAbort)
    }

    const exitCode = await proc.exited
    const errorOutput = await stderr

    if (state.aborted || ctx.abort.aborted) {
      throw ctx.abort.reason ?? new DOMException("The operation was aborted", "AbortError")
    }
    if (state.error) throw state.error

    // Exit codes: 0 = matches found, 1 = no matches, 2 = errors (but may still have matches).
    // A deliberate budget kill has a platform-specific non-zero exit code and is not a command failure.
    if (!state.truncated && exitCode === 2 && state.matches.length === 0) {
      throw new Error(`ripgrep failed: ${errorOutput || `exit code ${exitCode}`}`)
    }
    if (!state.truncated && exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
      throw new Error(`ripgrep failed: ${errorOutput || `exit code ${exitCode}`}`)
    }

    const hasErrors = !state.truncated && exitCode === 2

    state.matches.sort((a, b) => b.modTime - a.modTime)

    const truncated = state.truncated
    const finalMatches = state.matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    if (hasErrors) {
      outputLines.push("")
      outputLines.push("(Some paths were inaccessible and skipped)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
      output: outputLines.join("\n"),
    }
  },
})

async function readBounded(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const state = { output: "", bytes: 0 }

  try {
    while (state.bytes < max) {
      const chunk = await reader.read()
      if (chunk.done) break

      const value = chunk.value.byteLength > max - state.bytes ? chunk.value.slice(0, max - state.bytes) : chunk.value
      state.bytes += value.byteLength
      state.output += decoder.decode(value, { stream: state.bytes < max })
      if (value.byteLength < chunk.value.byteLength) {
        await reader.cancel().catch(() => {})
        break
      }
    }
    if (state.bytes < max) state.output += decoder.decode()
  } finally {
    reader.releaseLock()
  }

  return state.output
}
