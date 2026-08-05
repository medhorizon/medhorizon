import { createWriteStream } from "fs"
import { mkdir, unlink } from "fs/promises"
import { randomUUID } from "crypto"
import { spawn, type ChildProcess } from "child_process"
import path from "path"
import os from "os"
import { Shell } from "../shell/shell"
import { Truncate } from "../tool/truncation"
import { createReceipt, type ProcessReceipt } from "./types"
import { createRedactor } from "./redaction"

/**
 * The one-shot process boundary used by local tools.  It deliberately owns
 * only process mechanics: permissions are checked by the caller before `run`,
 * while this module owns deadlines, stream handling, redaction, cleanup and a
 * terminal receipt.
 */
export namespace ProcessSupervisor {
  export const DEFAULT_TIMEOUT_MS = 120_000
  export const MAX_TIMEOUT_MS = 600_000
  export const MIN_TIMEOUT_MS = 1
  export const METADATA_INTERVAL_MS = 100

  const THREAD_VARS = [
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "NUMBA_NUM_THREADS",
    "LOKY_MAX_CPU_COUNT",
  ]

  const CAPABILITY_VARS = new Set([
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "META_MODEL_API_KEY",
    "TOGETHER_API_KEY",
    "GROQ_API_KEY",
    "FIREWORKS_API_KEY",
    "XAI_API_KEY",
    "MISTRAL_API_KEY",
    "DEEPSEEK_API_KEY",
    "CEREBRAS_API_KEY",
    "TINKER_API_KEY",
    "TINKER_BASE_URL",
    "HF_TOKEN",
    "HUGGING_FACE_HUB_TOKEN",
    "WANDB_API_KEY",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "LAMBDA_API_KEY",
    "LAMBDA_LABS_API_KEY",
    "RUNPOD_API_KEY",
    "PRIME_INTELLECT_API_KEY",
    "TENSORPOOL_API_KEY",
    "VAST_API_KEY",
    "LANGSMITH_API_KEY",
    "LANGCHAIN_API_KEY",
    "PINECONE_API_KEY",
  ])

  const CAPABILITY_ENV: Record<string, string[]> = {
    "llm:anthropic": ["ANTHROPIC_API_KEY"],
    "llm:openai": ["OPENAI_API_KEY"],
    "llm:gemini": ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"],
    "llm:openrouter": ["OPENROUTER_API_KEY", "OPENROUTER_BASE_URL"],
    "llm:together": ["TOGETHER_API_KEY"],
    "llm:groq": ["GROQ_API_KEY"],
    "llm:fireworks": ["FIREWORKS_API_KEY"],
    "compute:modal": ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
    "compute:tinker": ["TINKER_API_KEY", "TINKER_BASE_URL"],
    "compute:huggingface": ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
    "compute:wandb": ["WANDB_API_KEY"],
    "compute:lambda": ["LAMBDA_API_KEY", "LAMBDA_LABS_API_KEY"],
    "compute:runpod": ["RUNPOD_API_KEY"],
    "compute:tensorpool": ["TENSORPOOL_API_KEY"],
  }

  export type Runtime = "bash" | "python" | "r" | "notebook" | "rkernel" | "shell"
  export type Mode = "ephemeral" | "persistent"
  export type Lane = "general" | "scientific" | "kernel"
  export type Status = "success" | "failure" | "cancelled" | "timeout"

  export interface SandboxInfo {
    backend?: string
    sandboxed?: boolean
    warning?: string
  }

  export interface RunInput {
    file: string
    args?: string[]
    shell?: string | boolean
    cwd: string
    env: NodeJS.ProcessEnv
    runtime: Runtime
    mode: Mode
    lane: Lane
    timeout?: number
    /** Absolute epoch-ms parent deadline. */
    deadline?: number
    /** Alias accepted for callers that name the outer deadline explicitly. */
    parentDeadline?: number
    signal?: AbortSignal
    sessionID?: string
    callID?: string
    description?: string
    secrets?: Iterable<string>
    /** Raw env values are filtered to these declared capability IDs. */
    capabilities?: Iterable<string>
    threadCap?: number
    sandbox?: SandboxInfo
    outputDir?: string
    metadata?: (input: { output: string; description?: string; receipt?: ProcessReceipt }) => void
  }

  export interface Result {
    output: string
    metadata: {
      output: string
      description?: string
      exit: number
      truncated: boolean
      outputPath?: string
      receipt: ProcessReceipt
      durationMs: number
      cleanup: "complete" | "degraded"
      sandbox?: string
      warning?: string
      failureClass?: string
      signal?: string
      [key: string]: unknown
    }
    receipt: ProcessReceipt
  }

  export function resolveTimeout(requested?: number, deadline?: number): number {
    const configured = Number(process.env["OPENSCIENCE_PROCESS_DEFAULT_TIMEOUT_MS"])
    const fallback = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS
    const base = requested ?? fallback
    if (!Number.isFinite(base) || base <= 0) throw new Error("Process timeout must be a positive number")
    const remaining = deadline === undefined ? MAX_TIMEOUT_MS : Math.max(MIN_TIMEOUT_MS, deadline - Date.now())
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, base, remaining))
  }

  export function scientificEnv(env: NodeJS.ProcessEnv, cap?: number): Record<string, string> {
    const value = cap ?? Math.min(4, Math.max(1, os.cpus().length))
    if (!Number.isInteger(value) || value < 1 || value > 64) {
      throw new Error("Scientific thread cap must be an integer between 1 and 64")
    }
    return {
      ...normalizeEnv(env),
      ...Object.fromEntries(THREAD_VARS.map((key) => [key, String(value)])),
    }
  }

  /** Stable capability-to-env mapping; unknown IDs never receive env values. */
  export function capabilityEnv(capabilities: Iterable<string> = []): Set<string> {
    const result = new Set<string>()
    for (const capability of new Set(capabilities)) {
      for (const key of CAPABILITY_ENV[capability] ?? []) result.add(key)
    }
    return result
  }

  export function isScientificCommand(command: string): boolean {
    return /(?:^|[\s;&|])(?:env\s+)?(?:python(?:\d+(?:\.\d+)?)?|pypy(?:\d+(?:\.\d+)?)?|rscript|R)(?=\s|$)/.test(
      command,
    )
  }

  function normalizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  }

  function scopedEnv(env: NodeJS.ProcessEnv, capabilities: Iterable<string>): Record<string, string> {
    const allowed = capabilityEnv(capabilities)
    return Object.fromEntries(
      Object.entries(normalizeEnv(env)).filter(([key]) => !CAPABILITY_VARS.has(key) || allowed.has(key)),
    )
  }

  function preview() {
    const state = {
      parts: [] as string[],
      bytes: 0,
      lines: 0,
      totalBytes: 0,
      totalLines: 0,
      stopped: false,
    }

    const add = (text: string) => {
      if (!text) return
      state.totalBytes += Buffer.byteLength(text, "utf8")
      state.totalLines += [...text].filter((char) => char === "\n").length
      if (state.stopped) return

      const chars: string[] = []
      for (const char of text) {
        const size = Buffer.byteLength(char, "utf8")
        if (state.bytes + size > Truncate.MAX_BYTES || state.lines + (char === "\n" ? 1 : 0) > Truncate.MAX_LINES) {
          state.stopped = true
          break
        }
        chars.push(char)
        state.bytes += size
        if (char === "\n") state.lines++
      }
      if (chars.length) state.parts.push(chars.join(""))
    }

    return {
      add,
      text: () => state.parts.join(""),
      totalBytes: () => state.totalBytes,
      totalLines: () => state.totalLines,
      truncated: () => state.totalBytes > Truncate.MAX_BYTES || state.totalLines > Truncate.MAX_LINES,
    }
  }

  function terminal(input: {
    status: Status
    sessionID: string
    callID: string
    runtime: Runtime
    mode: Mode
    lane: Lane
    queuedAt: number
    startedAt: number
    endedAt: number
    exitCode?: number
    signal?: string
    failureClass?: string
    sandbox?: SandboxInfo
    output: { inlineBytes: number; totalBytes: number; truncated: boolean; spilled: boolean; ref?: string }
  }): ProcessReceipt {
    const sandbox = input.sandbox?.sandboxed
      ? "enforced"
      : input.sandbox?.warning
        ? "degraded"
        : "unavailable"
    return createReceipt({
      callID: input.callID,
      sessionID: input.sessionID,
      runtime: input.runtime,
      mode: input.mode,
      lane: input.lane,
      status: input.status,
      queuedAt: input.queuedAt,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      waitMs: Math.max(0, input.startedAt - input.queuedAt),
      runMs: Math.max(0, input.endedAt - input.startedAt),
      ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.failureClass ? { failureClass: input.failureClass } : {}),
      sandbox,
      backend: input.sandbox?.backend,
      output: input.output,
    })
  }

  function spawnProcess(input: RunInput, env: Record<string, string>): ChildProcess {
    const options = {
      cwd: input.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
      ...(input.shell === undefined ? {} : { shell: input.shell }),
    }
    return input.args ? spawn(input.file, input.args, options) : spawn(input.file, options)
  }

  function outputMessage(previewText: string, outputPath: string | undefined, truncated: boolean, note: string[]) {
    if (!truncated) return [previewText, ...note].filter(Boolean).join("\n\n")
    const hint = outputPath
      ? `The tool call succeeded but the output was truncated. Full output saved to: ${outputPath}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`
      : "The tool call succeeded but the output was truncated. Use Read with offset/limit to view omitted sections."
    return [previewText, "...content truncated...", hint, ...note].filter(Boolean).join("\n\n")
  }

  async function finishStream(stream: ReturnType<typeof createWriteStream>) {
    await new Promise<void>((resolve) => stream.end(() => resolve()))
  }

  export async function run(input: RunInput): Promise<Result> {
    const queuedAt = Date.now()
    const sessionID = input.sessionID ?? ""
    const callID = input.callID ?? ""
    const deadline = input.parentDeadline ?? input.deadline
    const expired = deadline !== undefined && deadline <= queuedAt
    const aborted = input.signal?.aborted === true
    const timeout = resolveTimeout(input.timeout, deadline)

    if (expired || aborted) {
      const status: Status = aborted ? "cancelled" : "timeout"
      const now = Date.now()
      const receipt = terminal({
        status,
        sessionID,
        callID,
        runtime: input.runtime,
        mode: input.mode,
        lane: input.lane,
        queuedAt,
        startedAt: now,
        endedAt: now,
        failureClass: status,
        sandbox: input.sandbox,
        output: { inlineBytes: 0, totalBytes: 0, truncated: false, spilled: false },
      })
      return {
        output: status === "cancelled" ? "User aborted the command" : "Process deadline expired before spawn",
        metadata: {
          output: "",
          description: input.description,
          exit: -1,
          truncated: false,
          receipt,
          durationMs: 0,
          cleanup: process.platform === "win32" ? "degraded" : "complete",
          ...(input.sandbox?.warning ? { warning: input.sandbox.warning } : {}),
          failureClass: status,
        },
        receipt,
      }
    }

    const capabilities = input.capabilities ?? []
    const env =
      input.lane === "scientific"
        ? scientificEnv(scopedEnv(input.env, capabilities), input.threadCap)
        : scopedEnv(input.env, capabilities)
    // Validate the registry before touching the filesystem. Oversized secrets
    // fail closed instead of leaving an unredacted spill behind.
    const redactor = createRedactor(input.secrets ?? [])
    const outputDir = input.outputDir ?? Truncate.DIR
    const outputRef = `spill_${randomUUID()}`
    const outputPath = path.join(outputDir, outputRef)
    await mkdir(outputDir, { recursive: true })
    const stream = createWriteStream(outputPath, { encoding: "utf8" })
    const shown = preview()
    const decoder = { stdout: new TextDecoder(), stderr: new TextDecoder() }
    const notes: string[] = []
    const state = {
      ended: false,
      timedOut: false,
      aborted: false,
      failure: undefined as Error | undefined,
      code: undefined as number | undefined,
      signal: undefined as string | undefined,
      kill: undefined as Promise<void> | undefined,
      metadataTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      metadataAt: 0,
    }

    const update = (force = false) => {
      if (!input.metadata) return
      const now = Date.now()
      if (!force && now - state.metadataAt < METADATA_INTERVAL_MS) {
        if (!state.metadataTimer) {
          state.metadataTimer = setTimeout(() => {
            state.metadataTimer = undefined
            update(true)
          }, METADATA_INTERVAL_MS - (now - state.metadataAt))
          state.metadataTimer.unref?.()
        }
        return
      }
      state.metadataAt = now
      input.metadata({ output: shown.text(), description: input.description })
    }

    const consume = (text: string, source?: NodeJS.ReadableStream) => {
      const redacted = redactor.push(text)
      if (!redacted) return
      stream.write(redacted)
      shown.add(redacted)
      update()
      if (source && stream.writableNeedDrain) {
        source.pause()
        stream.once("drain", () => source.resume())
      }
    }

    let proc: ChildProcess
    try {
      proc = spawnProcess(input, env)
    } catch (error) {
      state.failure = error instanceof Error ? error : new Error(String(error))
      state.code = -1
      state.ended = true
      await finishStream(stream)
      await unlink(outputPath).catch(() => {})
      const now = Date.now()
      const receipt = terminal({
        status: "failure",
        sessionID,
        callID,
        runtime: input.runtime,
        mode: input.mode,
        lane: input.lane,
        queuedAt,
        startedAt: now,
        endedAt: now,
        exitCode: -1,
        failureClass: "spawn",
        sandbox: input.sandbox,
        output: { inlineBytes: 0, totalBytes: 0, truncated: false, spilled: false },
      })
      return {
        output: `Failed to spawn process: ${state.failure.message}`,
        metadata: {
          output: "",
          description: input.description,
          exit: -1,
          truncated: false,
          receipt,
          durationMs: 0,
          cleanup: process.platform === "win32" ? "degraded" : "complete",
          failureClass: "spawn",
        },
        receipt,
      }
    }

    const startedAt = Date.now()
    const kill = () => {
      if (!state.kill) state.kill = Shell.killTree(proc, { exited: () => state.ended, detached: process.platform !== "win32" })
      return state.kill
    }
    const abortHandler = () => {
      if (state.ended) return
      state.aborted = true
      void kill()
    }
    input.signal?.addEventListener("abort", abortHandler, { once: true })
    const timer = setTimeout(() => {
      if (state.ended) return
      state.timedOut = true
      void kill()
    }, timeout)
    timer.unref?.()

    const onStdout = (chunk: Buffer) => consume(decoder.stdout.decode(chunk, { stream: true }), proc.stdout ?? undefined)
    const onStderr = (chunk: Buffer) => consume(decoder.stderr.decode(chunk, { stream: true }), proc.stderr ?? undefined)
    proc.stdout?.on("data", onStdout)
    proc.stderr?.on("data", onStderr)

    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      proc.once("error", (error) => {
        state.failure = error instanceof Error ? error : new Error(String(error))
        done()
      })
      proc.once("close", (code, signal) => {
        state.code = code === null ? undefined : code
        state.signal = signal ?? undefined
        done()
      })
    })

    state.ended = true
    clearTimeout(timer)
    if (state.metadataTimer) clearTimeout(state.metadataTimer)
    input.signal?.removeEventListener("abort", abortHandler)
    await state.kill
    consume(decoder.stdout.decode(), proc.stdout ?? undefined)
    consume(decoder.stderr.decode(), proc.stderr ?? undefined)
    const tail = redactor.flush()
    if (tail) {
      stream.write(tail)
      shown.add(tail)
    }
    await finishStream(stream)
    const endedAt = Date.now()

    const status: Status = state.timedOut ? "timeout" : state.aborted ? "cancelled" : state.failure || state.code !== 0 ? "failure" : "success"
    if (state.timedOut) notes.push(`Process terminated after exceeding timeout ${timeout} ms`)
    if (state.aborted) notes.push("User aborted the command")
    if (input.sandbox?.warning) notes.push(input.sandbox.warning)
    const truncated = shown.truncated()
    const keep = truncated
    if (!keep) await unlink(outputPath).catch(() => {})
    const output = outputMessage(shown.text(), keep ? outputPath : undefined, truncated, notes)
    update(true)
    const receipt = terminal({
      status,
      sessionID,
      callID,
      runtime: input.runtime,
      mode: input.mode,
      lane: input.lane,
      queuedAt,
      startedAt,
      endedAt,
      ...(state.code === undefined ? {} : { exitCode: state.code }),
      ...(state.signal ? { signal: state.signal } : {}),
      failureClass: status === "success" ? undefined : state.timedOut ? "timeout" : state.aborted ? "cancelled" : "exit",
      sandbox: input.sandbox,
      output: {
        inlineBytes: Buffer.byteLength(shown.text(), "utf8"),
        totalBytes: shown.totalBytes(),
        truncated,
        spilled: keep,
        ...(keep ? { ref: outputRef } : {}),
      },
    })
    const metadata = {
      output: shown.text(),
      description: input.description,
      exit: state.code ?? -1,
      truncated,
      ...(keep ? { outputPath } : {}),
      receipt,
      durationMs: Math.max(0, endedAt - startedAt),
      cleanup: process.platform === "win32" ? ("degraded" as const) : ("complete" as const),
      ...(input.sandbox?.backend ? { sandbox: input.sandbox.backend } : {}),
      ...(input.sandbox?.warning ? { warning: input.sandbox.warning } : {}),
      ...(state.failure ? { failureClass: "spawn" } : status === "success" ? {} : { failureClass: receipt.failureClass }),
      ...(state.signal ? { signal: state.signal } : {}),
    }
    return { output, metadata, receipt }
  }
}
