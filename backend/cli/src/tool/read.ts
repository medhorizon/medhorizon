import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { assertExternalDirectory } from "./external-directory"
import { InstructionPrompt } from "../session/instruction"
import { readImageDimensions } from "../util/image"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024
// Anthropic's API caps base64-embedded PDFs/images at ~32 MB. Reject bigger
// files up front instead of OOMing while encoding.
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024
// Anthropic rejects images with any dimension > 2000px when a request contains
// multiple images. Reject at attach time so a single oversized figure cannot
// poison the entire session's history (which would fail every follow-up turn).
const MAX_IMAGE_DIMENSION = 2000

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      const dirEntries = fs.readdirSync(dir)
      const suggestions = dirEntries
        .filter(
          (entry) =>
            entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
        )
        .map((entry) => path.join(dir, entry))
        .slice(0, 3)

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    // Exclude SVG (XML-based) and vnd.fastbidsheet (.fbs extension, commonly FlatBuffers schema files)
    const isImage =
      file.type.startsWith("image/") && file.type !== "image/svg+xml" && file.type !== "image/vnd.fastbidsheet"
    const isPdf = file.type === "application/pdf"
    if (isImage || isPdf) {
      const kind = isImage ? "Image" : "PDF"
      const attachStat = await file.stat()
      if (attachStat.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `${kind} too large to attach (${attachStat.size} bytes > ${MAX_ATTACHMENT_BYTES}). ` +
            `Anthropic's API caps base64 attachments at ~32 MB. ` +
            (isPdf
              ? "Use the liteparse skill to extract text via the `lit` CLI instead " +
                "(install with `npm i -g @llamaindex/liteparse` if missing)."
              : "Crop or downscale the image."),
        )
      }
      const mime = file.type
      const fileBytes = await file.bytes()
      if (isImage) {
        const dims = readImageDimensions(fileBytes)
        if (dims && Math.max(dims.width, dims.height) > MAX_IMAGE_DIMENSION) {
          throw new Error(
            `Image too large to attach (${dims.width}x${dims.height}). ` +
              `Anthropic's API rejects any image dimension > ${MAX_IMAGE_DIMENSION}px in multi-image requests, ` +
              `which would poison the entire session. Downscale first, e.g.:\n` +
              `  magick "${filepath}" -resize ${MAX_IMAGE_DIMENSION - 200}x${MAX_IMAGE_DIMENSION - 200}\\> "${filepath}"`,
          )
        }
      }
      const msg = `${kind} read successfully`
      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
          ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
        },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime,
            url: `data:${mime};base64,${Buffer.from(fileBytes).toString("base64")}`,
          },
        ],
      }
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const limit = Math.max(0, Math.floor(params.limit ?? DEFAULT_READ_LIMIT))
    const offset = Math.max(0, Math.floor(params.offset ?? 0))
    const scanned = await scanText(file, offset, limit)
    const raw = scanned.raw
    const truncatedByBytes = scanned.truncatedByBytes

    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })
    const preview = raw.slice(0, 20).join("\n")

    let output = "<file>\n"
    output += content.join("\n")

    const totalLines = scanned.totalLines
    const lastReadLine = offset + raw.length
    const hasMoreLines = scanned.hasMoreLines
    const truncated = hasMoreLines || truncatedByBytes

    if (truncatedByBytes) {
      output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</file>"

    // just warms the lsp client
    LSP.touchFile(filepath, false)
    FileTime.read(ctx.sessionID, filepath)

    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
    }

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
        ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
      },
    }
  },
})

async function scanText(file: Bun.BunFile, offset: number, limit: number) {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  const state = {
    pending: "",
    line: 0,
    totalLines: 0,
    raw: [] as string[],
    bytes: 0,
    truncatedByBytes: false,
    hasMoreLines: false,
    stop: false,
  }
  const maxPending = MAX_LINE_LENGTH + 1

  const process = (value: string) => {
    if (state.stop) return

    const line = value.endsWith("\r") ? value.slice(0, -1) : value
    const index = state.line
    state.line += 1
    state.totalLines = state.line

    if (index < offset) return
    if (index >= offset + limit) {
      state.hasMoreLines = true
      state.stop = true
      return
    }

    const content = line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
    const size = Buffer.byteLength(content, "utf-8") + (state.raw.length > 0 ? 1 : 0)
    if (state.bytes + size > MAX_BYTES) {
      state.truncatedByBytes = true
      state.stop = true
      return
    }

    state.raw.push(content)
    state.bytes += size
  }

  const feed = (value: string) => {
    if (state.stop) return

    const combined = state.pending + value
    let start = 0
    while (!state.stop) {
      if (state.line >= offset + limit && start < combined.length) {
        state.hasMoreLines = true
        state.stop = true
        return
      }
      const end = combined.indexOf("\n", start)
      if (end < 0) break
      process(combined.slice(start, end))
      start = end + 1
    }

    if (state.stop) return
    const pending = combined.slice(start)
    state.pending = pending.length > maxPending ? pending.slice(0, maxPending) : pending
  }

  try {
    while (!state.stop) {
      const chunk = await reader.read()
      if (chunk.done) {
        feed(decoder.decode())
        if (!state.stop) process(state.pending)
        break
      }
      feed(decoder.decode(chunk.value, { stream: true }))
    }
  } finally {
    if (state.stop) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  return state
}

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  switch (ext) {
    case ".zip":
    case ".tar":
    case ".gz":
    case ".exe":
    case ".dll":
    case ".so":
    case ".class":
    case ".jar":
    case ".war":
    case ".7z":
    case ".doc":
    case ".docx":
    case ".xls":
    case ".xlsx":
    case ".ppt":
    case ".pptx":
    case ".odt":
    case ".ods":
    case ".odp":
    case ".bin":
    case ".dat":
    case ".obj":
    case ".o":
    case ".a":
    case ".lib":
    case ".wasm":
    case ".pyc":
    case ".pyo":
      return true
    default:
      break
  }

  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  // Only read the header, not the whole file — a 2 GB binary would OOM otherwise.
  const bufferSize = Math.min(4096, fileSize)
  const head = file.slice(0, bufferSize)
  const buffer = await head.arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer)

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}
