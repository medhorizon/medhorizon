import z from "zod"
import { Tool } from "./tool"
import { spawn, type ChildProcess } from "child_process"
import path from "path"
import os from "os"
import { unlinkSync } from "fs"
import { Shell } from "@/shell/shell"
import { Instance } from "@/project/instance"
import { OpenScience } from "@/openscience"
import { Config } from "@/config/config"
import { Sandbox } from "@/sandbox/sandbox"
import { CapabilityPolicy, capabilityEnv, type CapabilityID } from "@/process/policy"
import { createReceipt } from "@/process/types"
import {
  KernelLifecycle,
  redactKernelResult,
  stripPngTextChunks,
} from "@/science/kernel/lifecycle"
import type {
  Kernel,
  KernelLanguage,
  KernelStartOptions,
  ExecuteOptions,
  ExecuteResult,
  KernelOutput,
} from "@/science/kernel/types"

const ExecutionInput = z.object({ skill: z.string().optional(), capabilities: z.array(z.string()).optional() })

/**
 * Persistent R kernel, following the same pattern as the Python kernel in
 * `tool/notebook.ts` and the biology kernel it generalizes.
 *
 * One long-lived `Rscript` process per sessionID evaluates cells into the global
 * environment, so objects/attached packages persist across `execute` calls.
 * stdout (print output) is captured; warnings/messages/errors are surfaced; and
 * base-graphics or ggplot2 plots left on the device are captured as `image/png`
 * where the platform's png device is available.
 *
 * Host requirement: `Rscript` on PATH (base R only — grDevices/utils are default
 * packages; no CRAN packages required). If Rscript is missing the tool degrades
 * gracefully with an install hint instead of throwing.
 */

// The driver runs a REPL over blocking stdin. Real newlines here are real
// newlines in the R source; `\\n` sequences are escaped newlines inside R string
// literals. Results are framed by section markers (no JSON dependency in base R):
// a header (OK / IMG path), then the captured stdout section, then the
// warnings/messages/error section. The PNG is passed back by file path and read +
// base64-encoded on the TS side, avoiding any base64 package requirement.
const KERNEL_SCRIPT = `
run_cell <- function(code) {
  imgfile <- tempfile(fileext = ".png")
  dev_ok <- tryCatch({
    grDevices::png(filename = imgfile, width = 900, height = 650, res = 110, type = "cairo")
    TRUE
  }, error = function(e) tryCatch({
    grDevices::png(filename = imgfile, width = 900, height = 650, res = 110)
    TRUE
  }, error = function(e2) FALSE))

  msgs <- character(0)
  add_msg <- function(x) msgs[[length(msgs) + 1L]] <<- x

  ok <- TRUE
  errmsg <- NULL

  out <- tryCatch(
    utils::capture.output(
      withCallingHandlers(
        {
          exprs <- parse(text = code)
          for (i in seq_along(exprs)) {
            wv <- withVisible(eval(exprs[[i]], envir = globalenv()))
            if (isTRUE(wv$visible)) print(wv$value)
          }
        },
        warning = function(w) { add_msg(paste0("Warning: ", conditionMessage(w))); invokeRestart("muffleWarning") },
        message = function(m) { add_msg(sub("\\n$", "", conditionMessage(m))); invokeRestart("muffleMessage") }
      )
    ),
    error = function(e) { ok <<- FALSE; errmsg <<- conditionMessage(e); character(0) }
  )

  plotted <- FALSE
  if (isTRUE(dev_ok)) {
    plotted <- tryCatch(length(grDevices::recordPlot()[[1]]) > 0L, error = function(e) FALSE)
    tryCatch(grDevices::dev.off(), error = function(e) NULL)
  }
  imgpath <- ""
  if (isTRUE(plotted) && file.exists(imgfile) && file.info(imgfile)$size > 0) {
    imgpath <- imgfile
  } else {
    try(unlink(imgfile), silent = TRUE)
  }

  msg_text <- paste(msgs, collapse = "\\n")
  if (!is.null(errmsg)) {
    if (nchar(msg_text) > 0L) msg_text <- paste0(msg_text, "\\n")
    msg_text <- paste0(msg_text, "Error: ", errmsg)
  }
  out_text <- paste(out, collapse = "\\n")

  cat("__OPENSCIENCE_R_RESULT_START__\\n")
  cat("OK:", if (ok) "1" else "0", "\\n", sep = "")
  cat("IMG:", imgpath, "\\n", sep = "")
  cat("__OPENSCIENCE_R_OUT__\\n")
  cat(out_text)
  cat("\\n__OPENSCIENCE_R_MSG__\\n")
  cat(msg_text)
  cat("\\n__OPENSCIENCE_R_END__\\n")
  flush(stdout())
}

con <- file("stdin")
open(con, blocking = TRUE)
cat("__OPENSCIENCE_KERNEL_READY__\\n")
flush(stdout())

repeat {
  lines <- character(0)
  got_end <- FALSE
  repeat {
    l <- readLines(con, n = 1L)
    if (length(l) == 0L) break
    if (identical(l, "__OPENSCIENCE_CODE_END__")) { got_end <- TRUE; break }
    lines <- c(lines, l)
  }
  if (!isTRUE(got_end)) break
  code <- paste(lines, collapse = "\\n")
  tryCatch(run_cell(code), error = function(e) {
    cat("__OPENSCIENCE_R_RESULT_START__\\nOK:0\\nIMG:\\n__OPENSCIENCE_R_OUT__\\n\\n__OPENSCIENCE_R_MSG__\\nError: ", conditionMessage(e), "\\n__OPENSCIENCE_R_END__\\n", sep = "")
    flush(stdout())
  })
}
`.trim()

const READY = "__OPENSCIENCE_KERNEL_READY__"
const START = "__OPENSCIENCE_R_RESULT_START__\n"
const END = "\n__OPENSCIENCE_R_END__"

export interface RVersion {
  binary: string
  version: string
}

const versions = new Map<string, Promise<RVersion | null>>()

/** Discover Rscript once per binary/version key; tool calls reuse this result. */
export async function findRscript(override?: string): Promise<RVersion | null> {
  const key = override ?? "Rscript"
  const cached = versions.get(key)
  if (cached) return cached
  const value = (async () => {
    try {
      const proc = Bun.spawn([key, "--version"], { stdout: "pipe", stderr: "pipe" })
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      await proc.exited
      if (proc.exitCode !== 0) return null
      const version = `${out}\n${err}`.match(/R scripting front-end version\s+([\w.+-]+)/i)?.[1] ?? "unknown"
      return { binary: key, version }
    } catch {
      return null
    }
  })()
  versions.set(key, value)
  return value
}

export function clearRscriptVersionCache() {
  versions.clear()
}

interface RawResult {
  ok: boolean
  stdout: string
  messages: string
  imgPath: string
}

function parseFrame(block: string): RawResult {
  const outMarker = "__OPENSCIENCE_R_OUT__\n"
  const msgMarker = "\n__OPENSCIENCE_R_MSG__\n"
  const outIdx = block.indexOf(outMarker)
  const header = outIdx === -1 ? block : block.slice(0, outIdx)
  const rest = outIdx === -1 ? "" : block.slice(outIdx + outMarker.length)
  const msgIdx = rest.indexOf(msgMarker)
  const stdout = msgIdx === -1 ? rest : rest.slice(0, msgIdx)
  const messages = msgIdx === -1 ? "" : rest.slice(msgIdx + msgMarker.length)
  const ok = /OK:1/.test(header)
  const imgMatch = header.match(/IMG:(.*)/)
  const imgPath = imgMatch?.[1]?.trim() ?? ""
  return { ok, stdout, messages, imgPath }
}

async function frameToResult(raw: RawResult): Promise<ExecuteResult> {
  const outputs: KernelOutput[] = []
  if (raw.stdout) outputs.push({ type: "stream", name: "stdout", data: { "text/plain": raw.stdout } })
  if (raw.imgPath) {
    try {
      const bytes = await Bun.file(raw.imgPath).arrayBuffer()
      const b64 = Buffer.from(bytes).toString("base64")
      const clean = stripPngTextChunks(b64)
      if (clean) outputs.push({ type: "display", data: { "image/png": clean } })
    } catch {}
    try {
      unlinkSync(raw.imgPath)
    } catch {}
  }
  if (raw.ok && raw.messages) {
    outputs.push({ type: "stream", name: "stderr", data: { "text/plain": raw.messages } })
  }
  if (!raw.ok) {
    outputs.push({ type: "error", error: { name: "RError", message: raw.messages || "R evaluation error" } })
  }
  return {
    ok: raw.ok,
    outputs,
    stdout: raw.stdout,
    stderr: raw.messages,
  }
}

class RKernel implements Kernel {
  readonly id: string
  readonly language: KernelLanguage = "r"
  proc?: ChildProcess
  scriptPath?: string
  lastUsed = Date.now()
  version = "unknown"
  sandbox?: { backend?: string; sandboxed?: boolean; warning?: string }
  private stderrTail = ""
  private starting?: Promise<void>
  private queue = Promise.resolve()
  private active = 0

  constructor(id: string) {
    this.id = id
  }

  get ready(): boolean {
    return !!this.proc && !this.proc.killed && this.proc.exitCode === null
  }

  get busy(): boolean {
    return this.active > 0
  }

  async start(opts?: KernelStartOptions): Promise<void> {
    if (this.ready) return
    if (this.starting) return this.starting
    this.starting = this.boot(opts)
      .catch(async (error) => {
        if (this.proc) {
          await Shell.killTree(this.proc, {
            exited: () => this.proc?.exitCode !== null,
            detached: process.platform !== "win32",
          }).catch(() => {})
          this.proc = undefined
        }
        this.cleanupScript()
        throw error
      })
      .finally(() => {
        this.starting = undefined
      })
    return this.starting
  }

  private async boot(opts?: KernelStartOptions): Promise<void> {
    if (this.ready) return
    const found = await findRscript(opts?.binary)
    if (!found) {
      throw new Error(
        "Rscript not found. Install R (https://www.r-project.org) so `Rscript` is on PATH to use the R kernel.",
      )
    }
    const bin = found.binary
    this.version = found.version

    const scriptPath = path.join(os.tmpdir(), `openscience-rkernel-${this.id.slice(0, 8)}-${Date.now()}.R`)
    await Bun.write(scriptPath, KERNEL_SCRIPT)
    this.scriptPath = scriptPath

    // Confine the kernel to the workspace when the execution sandbox is on: the R
    // kernel runs arbitrary agent-authored code — the same threat model as the
    // bash tool — so it must respect the same boundary.
    const sandboxed = Sandbox.wrapArgv({
      file: bin,
      args: ["--vanilla", scriptPath],
      workspace: [Instance.directory, Instance.worktree],
      extraWritable: [scriptPath],
      options: await Config.trustedSandbox(),
    })
    this.sandbox = {
      backend: sandboxed.backend,
      sandboxed: sandboxed.sandboxed,
      warning: sandboxed.warning,
    }
    await OpenScience.refreshByokSecrets().catch(() => {})
    const base = await OpenScience.subprocessEnv(process.env)
    const allowed = capabilityEnv((opts?.capabilities ?? []) as CapabilityID[])
    const env = OpenScience.scopedSubprocessEnv({ ...base, ...process.env, ...(opts?.env ?? {}) }, allowed)
    const proc = spawn(sandboxed.file, sandboxed.args, {
      cwd: opts?.cwd ?? Instance.directory,
      env: { ...OpenScience.pythonThreadCapEnv(env), ...env },
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group so killing the kernel reaps its worker children (#102).
      detached: process.platform !== "win32",
    })
    this.proc = proc

    proc.stderr?.on("data", (d: Buffer) => {
      this.stderrTail += d.toString()
      if (this.stderrTail.length > 10_000) this.stderrTail = this.stderrTail.slice(-5000)
    })

    try {
      await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        void Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" })
        reject(new Error(`R kernel startup timed out. stderr: ${this.stderrTail}`))
      }, 20_000)
      let buf = ""
      const onAbort = () => {
        clearTimeout(timer)
        void Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" }).catch(() => {})
        reject(new Error("R kernel startup aborted"))
      }
      const onData = (d: Buffer) => {
        buf += d.toString()
        if (buf.includes(READY)) {
          clearTimeout(timer)
          proc.stdout?.off("data", onData)
          opts?.signal?.removeEventListener("abort", onAbort)
          resolve()
        }
      }
      proc.stdout?.on("data", onData)
      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      if (opts?.signal?.aborted) onAbort()
      proc.once("error", (err) => {
        clearTimeout(timer)
        opts?.signal?.removeEventListener("abort", onAbort)
        reject(err)
      })
      proc.once("exit", (code) => {
        clearTimeout(timer)
        opts?.signal?.removeEventListener("abort", onAbort)
        reject(new Error(`R kernel exited during startup (code ${code}). stderr: ${this.stderrTail}`))
      })
      })
    } catch (error) {
      await Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" }).catch(() => {})
      this.proc = undefined
      this.cleanupScript()
      throw error
    }
  }

  async execute(code: string, opts?: ExecuteOptions): Promise<ExecuteResult> {
    const run = this.queue.then(() => this.cell(code, opts))
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async cell(code: string, opts?: ExecuteOptions): Promise<ExecuteResult> {
    if (opts?.signal?.aborted) throw new Error("Execution aborted")
    if (!this.ready) await this.start({ signal: opts?.signal })
    const proc = this.proc!
    this.lastUsed = Date.now()
    this.active++
    const timeout = Math.min(Math.max(opts?.timeout ?? 120_000, 5_000), 600_000)

    try {
      const raw = await new Promise<RawResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        void Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" })
          .catch(() => {})
          .finally(() => reject(new Error(`Cell execution timed out after ${Math.round(timeout / 1000)}s`)))
      }, timeout)

      const onAbort = () => {
        cleanup()
        void Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" })
          .catch(() => {})
          .finally(() => reject(new Error("Execution aborted")))
      }

      let buffer = ""
      const onData = (d: Buffer) => {
        buffer += d.toString()
        const s = buffer.indexOf(START)
        const e = buffer.indexOf(END)
        if (s !== -1 && e !== -1 && e > s) {
          cleanup()
          resolve(parseFrame(buffer.slice(s + START.length, e)))
        }
      }
      const onExit = (code: number | null) => {
        cleanup()
        reject(new Error(`R kernel died during execution (exit code ${code}). stderr: ${this.stderrTail}`))
      }
      function cleanup() {
        clearTimeout(timer)
        proc.stdout?.off("data", onData)
        proc.off("exit", onExit)
        opts?.signal?.removeEventListener("abort", onAbort)
      }

      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      if (opts?.signal?.aborted) {
        onAbort()
        return
      }
      proc.stdout?.on("data", onData)
      proc.once("exit", onExit)
      proc.stdin?.write(code + "\n__OPENSCIENCE_CODE_END__\n")
      })
      this.lastUsed = Date.now()
      return redactKernelResult(await frameToResult(raw), opts?.secrets ?? [])
    } finally {
      this.active--
      this.lastUsed = Date.now()
    }
  }

  async shutdown(): Promise<void> {
    const proc = this.proc
    if (proc) {
      await Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" })
      this.proc = undefined
    }
    this.cleanupScript()
  }

  /** Synchronous group kill for process-exit handlers (async shutdown can't run there). */
  killSync(): void {
    if (this.proc) Shell.killTreeSync(this.proc, { detached: process.platform !== "win32" })
    this.proc = undefined
    this.cleanupScript()
  }

  private cleanupScript(): void {
    if (this.scriptPath) {
      try {
        unlinkSync(this.scriptPath)
      } catch {}
      this.scriptPath = undefined
    }
  }
}

/** Process-wide singleton manager sharing the Python global admission cap. */
export const rKernels = new KernelLifecycle<RKernel>({
  language: "r",
  factory: async (sessionID, opts) => {
    const kernel = new RKernel(sessionID)
    await kernel.start(opts)
    return kernel
  },
})

let exitHooked = false
function hookExit() {
  if (exitHooked) return
  exitHooked = true
  const cleanup = () => rKernels.shutdownAllSync()
  process.on("exit", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("SIGINT", cleanup)
}
hookExit()

function clip(s: string, max = 30_000): string {
  return s.length > max ? s.slice(0, max) + "\n\n... (truncated)" : s
}

export const RKernelTool = Tool.define("rkernel", async (initCtx) => {
  const grants = initCtx?.agent?.subprocessCapabilities ?? {}
  return {
  description: [
    "Execute R code in a persistent kernel. Objects, attached packages, and state persist across calls.",
    "Use instead of `bash Rscript` for analysis — no need to re-source data or reload packages between cells.",
    "Print output is captured; base-graphics and ggplot2 plots are captured as opaque inline PNG images where the platform supports it. Text redaction strips PNG ancillary text chunks but cannot redact pixels; do not put credentials in plot titles or labels.",
    "Requires Rscript on PATH; if R is not installed the tool reports a clear install hint.",
  ].join("\n"),
  parameters: z.object({
    code: z.string().describe("R code to execute in the persistent kernel"),
    timeout: z.number().default(120_000).describe("Execution timeout in ms (default: 120s, max: 600s)"),
    execution: ExecutionInput.optional(),
  }),
  async execute(params, ctx) {
    const input = params as { code: string; timeout: number; execution?: { skill?: string; capabilities?: string[] } }
    // Executes arbitrary code — same permission gate as bash.
    await ctx.ask({
      permission: "bash",
      patterns: ["R (rkernel)"],
      always: ["Rscript*"],
      metadata: {},
    })

    const capability = CapabilityPolicy.resolve({
      sessionID: ctx.sessionID,
      turnID: ctx.messageID,
      agent: ctx.agent,
      grants,
      execution: input.execution,
    })

    // Degrade gracefully when R is not installed.
    const found = await findRscript()
    if (!found) {
      const msg =
        "Rscript not found. Install R from https://www.r-project.org (or `brew install r`) so `Rscript` is on PATH."
      ctx.metadata({ metadata: { output: msg, ok: false } })
      return { title: "R kernel unavailable", output: msg, metadata: { ok: false, available: false, output: msg } }
    }

    await OpenScience.refreshByokSecrets().catch(() => {})
    const queuedAt = Date.now()
    const kernel = await rKernels.get(ctx.sessionID, {
      binary: found.binary,
      capabilities: capability.capabilities,
      skill: input.execution?.skill,
      signal: ctx.abort,
    })
    const startedAt = Date.now()
    const result = await kernel.execute(input.code, {
      timeout: input.timeout,
      signal: ctx.abort,
      secrets: OpenScience.subprocessSecrets(),
    })

    const images = result.outputs.filter((o) => o.type === "display" && o.data?.["image/png"])
    const dataUrls = images.map((o) => `data:image/png;base64,${o.data!["image/png"]}`)

    const parts: string[] = []
    if (result.stdout) parts.push(result.stdout)
    if (result.stderr) parts.push(`${result.ok ? "[messages]" : "[ERROR]"}\n${result.stderr}`)
    if (images.length) parts.push(`[figure] captured ${images.length} inline image(s)`)
    if (!parts.length) parts.push("(no output)")
    const output = clip(parts.join("\n"))
    const endedAt = Date.now()
    const receipt = createReceipt({
      runtime: "rkernel",
      mode: "persistent",
      lane: "kernel",
      status: result.ok ? "success" : "failure",
      sessionID: ctx.sessionID,
      callID: ctx.callID ?? "",
      queuedAt,
      startedAt,
      endedAt,
      waitMs: Math.max(0, startedAt - queuedAt),
      runMs: Math.max(0, endedAt - startedAt),
      sandbox: kernel.sandbox?.sandboxed ? "enforced" : kernel.sandbox?.warning ? "degraded" : "unavailable",
      backend: kernel.sandbox?.backend,
      output: {
        inlineBytes: Buffer.byteLength(output, "utf8"),
        totalBytes: Buffer.byteLength(output, "utf8"),
        truncated: false,
        spilled: false,
      },
    })

    ctx.metadata({ metadata: { output, ok: result.ok, receipt, ...(kernel.sandbox?.warning ? { warning: kernel.sandbox.warning } : {}) } })

    return {
      title: result.ok ? "R cell" : "R cell (error)",
      output,
      metadata: {
        ok: result.ok,
        available: true,
        output,
        hasImages: images.length,
        version: (kernel as RKernel).version,
        sandbox: (kernel as RKernel).sandbox,
        ...(kernel.sandbox?.warning ? { warning: kernel.sandbox.warning } : {}),
        receipt,
        ...(images.length ? { artifact: { kind: "image", data: { images: dataUrls } } } : {}),
      },
    }
  },
  }
})
