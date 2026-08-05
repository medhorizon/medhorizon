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
 * General, non-domain-gated persistent Python kernel.
 *
 * Generalizes the biology-gated kernel in `tool/biology/notebook.ts` to the
 * shared `Kernel` / `KernelManager` contract in `science/kernel/types.ts`:
 * one long-lived `python3` process per sessionID whose namespace, imports, and
 * state persist across `execute` calls, returning Jupyter-style MIME-bundle
 * outputs — including `image/png` captured from any matplotlib figures the cell
 * leaves open.
 *
 * Host requirement: `python3` (or `python`) on PATH. matplotlib is optional —
 * figures are only captured when it is importable; everything else degrades to
 * text output.
 */

// The worker runs a REPL loop over stdin. Real newlines below are real newlines
// in the emitted Python source; `\\n` sequences become escaped newlines inside
// Python string literals. Result payloads are wrapped in unambiguous markers and
// JSON-encoded (json.dumps escapes real newlines, so the end marker can never
// appear inside a payload string).
const KERNEL_SCRIPT = `
import sys, json, io, base64, traceback

_real_out = sys.stdout
_real_err = sys.stderr

ns = {"__name__": "__main__", "__builtins__": __builtins__}

# Pre-import common scientific packages (best-effort).
for pkg, alias in [("numpy", "np"), ("pandas", "pd"), ("scipy", "scipy")]:
    try:
        mod = __import__(pkg)
        ns[alias] = mod
        ns[pkg] = mod
    except ImportError:
        pass

# Configure matplotlib for headless PNG capture (best-effort).
_plt = None
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _plt = plt
    ns["plt"] = plt
    ns["matplotlib"] = matplotlib
except Exception:
    _plt = None

_exec_count = 0

_real_out.write("__OPENSCIENCE_KERNEL_READY__\\n")
_real_out.flush()

while True:
    lines = []
    got_end = False
    for line in sys.stdin:
        if line.rstrip("\\n") == "__OPENSCIENCE_CODE_END__":
            got_end = True
            break
        lines.append(line)
    if not got_end:
        break  # stdin closed (parent gone) -> exit cleanly

    code = "".join(lines)
    _exec_count += 1

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    sys.stdout = stdout_buf
    sys.stderr = stderr_buf

    ok = True
    result_repr = None
    result_html = None
    error = None
    images = []

    try:
        # Try eval first for Jupyter-style auto-display of the final expression.
        try:
            compiled = compile(code, "<cell>", "eval")
            value = eval(compiled, ns)
            if value is not None:
                try:
                    result_repr = repr(value)
                except Exception:
                    result_repr = "<unreprable object>"
                html_fn = getattr(value, "_repr_html_", None)
                if callable(html_fn):
                    try:
                        html = html_fn()
                        if isinstance(html, str):
                            result_html = html
                    except Exception:
                        pass
        except SyntaxError:
            exec(compile(code, "<cell>", "exec"), ns)
    except SystemExit:
        stderr_buf.write("SystemExit caught (kernel stays alive)\\n")
        ok = False
    except BaseException as e:
        ok = False
        error = {
            "name": type(e).__name__,
            "message": str(e),
            "traceback": traceback.format_exc().splitlines(),
        }
    finally:
        # Capture any open matplotlib figures as PNG MIME parts, then close them.
        if _plt is not None:
            try:
                for num in _plt.get_fignums():
                    fig = _plt.figure(num)
                    buf = io.BytesIO()
                    try:
                        fig.savefig(buf, format="png", bbox_inches="tight")
                        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
                    except Exception:
                        pass
                _plt.close("all")
            except Exception:
                pass
        sys.stdout = _real_out
        sys.stderr = _real_err

    payload = {
        "ok": ok,
        "stdout": stdout_buf.getvalue(),
        "stderr": stderr_buf.getvalue(),
        "result": result_repr,
        "result_html": result_html,
        "images": images,
        "error": error,
        "execution_count": _exec_count,
    }
    r = json.dumps(payload)
    _real_out.write("__OPENSCIENCE_RESULT_START__\\n" + r + "\\n__OPENSCIENCE_RESULT_END__\\n")
    _real_out.flush()
`.trim()

const READY = "__OPENSCIENCE_KERNEL_READY__"
const START = "__OPENSCIENCE_RESULT_START__\n"
const END = "\n__OPENSCIENCE_RESULT_END__"

interface RawPayload {
  ok: boolean
  stdout: string
  stderr: string
  result: string | null
  result_html: string | null
  images: string[]
  error: { name: string; message: string; traceback?: string[] } | null
  execution_count: number
}

async function findPython(override?: string): Promise<string> {
  const candidates = override ? [override] : ["python3", "python"]
  for (const bin of candidates) {
    try {
      const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" })
      await proc.exited
      if (proc.exitCode === 0) return bin
    } catch {}
  }
  throw new Error("Python not found. Install Python 3.10+ (python3) to use the notebook tool.")
}

function payloadToResult(p: RawPayload): ExecuteResult {
  const outputs: KernelOutput[] = []
  if (p.stdout) outputs.push({ type: "stream", name: "stdout", data: { "text/plain": p.stdout } })
  if (p.stderr) outputs.push({ type: "stream", name: "stderr", data: { "text/plain": p.stderr } })
  for (const b64 of p.images ?? []) {
    const clean = stripPngTextChunks(b64)
    if (clean) outputs.push({ type: "display", data: { "image/png": clean } })
  }
  if (p.result !== null && p.result !== undefined) {
    const data: Record<string, string> = { "text/plain": p.result }
    if (p.result_html) data["text/html"] = p.result_html
    outputs.push({ type: "result", data })
  }
  if (p.error) {
    outputs.push({
      type: "error",
      error: { name: p.error.name, message: p.error.message, traceback: p.error.traceback },
    })
  }
  return {
    ok: p.ok,
    outputs,
    stdout: p.stdout ?? "",
    stderr: p.stderr ?? "",
    executionCount: p.execution_count,
  }
}

class PythonKernel implements Kernel {
  readonly id: string
  readonly language: KernelLanguage = "python"
  proc?: ChildProcess
  scriptPath?: string
  lastUsed = Date.now()
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
    const scriptPath = path.join(os.tmpdir(), `openscience-pykernel-${this.id.slice(0, 8)}-${Date.now()}.py`)
    await Bun.write(scriptPath, KERNEL_SCRIPT)
    this.scriptPath = scriptPath

    const bin = await findPython(opts?.binary)
    // Confine the kernel to the workspace when the execution sandbox is on: the
    // notebook runs arbitrary agent-authored code — the same threat model as the
    // bash tool — so it must not be able to escape the boundary bash respects.
    const sandboxed = Sandbox.wrapArgv({
      file: bin,
      args: ["-u", scriptPath],
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
    const scoped = OpenScience.scopedSubprocessEnv({ ...base, ...process.env }, allowed)
    const requested = OpenScience.scopedSubprocessEnv({ ...scoped, ...(opts?.env ?? {}) }, allowed)
    const proc = spawn(sandboxed.file, sandboxed.args, {
      cwd: opts?.cwd ?? Instance.directory,
      env: {
        ...OpenScience.pythonThreadCapEnv(requested),
        ...requested,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group so killing the kernel reaps its children too — a scanpy
      // run forks joblib/BLAS workers that would otherwise be orphaned and keep
      // thrashing swap after an abort (#102).
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
        reject(new Error(`Python kernel startup timed out. stderr: ${this.stderrTail}`))
      }, 15_000)
      let buf = ""
      const onAbort = () => {
        clearTimeout(timer)
        void Shell.killTree(proc, { exited: () => proc.exitCode !== null, detached: process.platform !== "win32" }).catch(() => {})
        reject(new Error("Python kernel startup aborted"))
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
        reject(new Error(`Python kernel exited during startup (code ${code}). stderr: ${this.stderrTail}`))
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
      const payload = await new Promise<RawPayload>((resolve, reject) => {
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
          const json = buffer.slice(s + START.length, e)
          try {
            resolve(JSON.parse(json) as RawPayload)
          } catch {
            resolve({
              ok: false,
              stdout: "",
              stderr: `Kernel response parse error: ${json.slice(0, 500)}`,
              result: null,
              result_html: null,
              images: [],
              error: null,
              execution_count: -1,
            })
          }
        }
      }
      const onExit = (code: number | null) => {
        cleanup()
        reject(new Error(`Python kernel died during execution (exit code ${code}). stderr: ${this.stderrTail}`))
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
      return redactKernelResult(payloadToResult(payload), opts?.secrets ?? [])
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

/** Process-wide singleton manager with real idle timers and shared admission. */
export const pythonKernels = new KernelLifecycle<PythonKernel>({
  language: "python",
  factory: async (sessionID, opts) => {
    const kernel = new PythonKernel(sessionID)
    await kernel.start(opts)
    return kernel
  },
})

let exitHooked = false
function hookExit() {
  if (exitHooked) return
  exitHooked = true
  const cleanup = () => pythonKernels.shutdownAllSync()
  process.on("exit", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("SIGINT", cleanup)
}
hookExit()

function clip(s: string, max = 30_000): string {
  return s.length > max ? s.slice(0, max) + "\n\n... (truncated)" : s
}

export const NotebookTool = Tool.define("notebook", async (initCtx) => {
  const grants = initCtx?.agent?.subprocessCapabilities ?? {}
  return {
  description: [
    "Execute Python code in a persistent kernel. Variables, imports, and state persist across calls.",
    "Use instead of `bash python` for analysis — no need to re-import or re-load data between cells.",
    "numpy (np), pandas (pd), scipy, and matplotlib (plt) are pre-imported. Expression results auto-display like Jupyter.",
    "matplotlib figures are captured as opaque inline PNG images. Text redaction strips PNG ancillary text chunks but cannot redact pixels; do not put credentials in plot titles or labels.",
  ].join("\n"),
  parameters: z.object({
    code: z.string().describe("Python code to execute in the persistent kernel"),
    timeout: z.number().default(120_000).describe("Execution timeout in ms (default: 120s, max: 600s)"),
    execution: ExecutionInput.optional(),
  }),
  async execute(params, ctx) {
    const input = params as { code: string; timeout: number; execution?: { skill?: string; capabilities?: string[] } }
    // Executes arbitrary code — same permission gate as bash.
    await ctx.ask({
      permission: "bash",
      patterns: ["python (notebook)"],
      always: ["python*"],
      metadata: {},
    })

    const capability = CapabilityPolicy.resolve({
      sessionID: ctx.sessionID,
      turnID: ctx.messageID,
      agent: ctx.agent,
      grants,
      execution: input.execution,
    })
    await OpenScience.refreshByokSecrets().catch(() => {})
    const queuedAt = Date.now()
    const kernel = await pythonKernels.get(ctx.sessionID, {
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
    if (result.stderr) parts.push(result.ok ? `[stderr]\n${result.stderr}` : `[stderr]\n${result.stderr}`)
    const resultOut = result.outputs.find((o) => o.type === "result")
    if (resultOut?.data?.["text/plain"]) parts.push(resultOut.data["text/plain"])
    const errOut = result.outputs.find((o) => o.type === "error")
    if (errOut?.error) {
      const tb = errOut.error.traceback?.join("\n") ?? `${errOut.error.name}: ${errOut.error.message}`
      parts.push(`[ERROR]\n${tb}`)
    }
    if (images.length) parts.push(`[figure] captured ${images.length} inline image(s)`)
    if (!parts.length) parts.push("(no output)")
    const output = clip(parts.join("\n"))
    const endedAt = Date.now()
    const receipt = createReceipt({
      runtime: "notebook",
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

    ctx.metadata({
      metadata: { output, ok: result.ok, receipt, ...(kernel.sandbox?.warning ? { warning: kernel.sandbox.warning } : {}) },
    })

    return {
      title: result.ok ? "Python cell" : "Python cell (error)",
      output,
      metadata: {
        ok: result.ok,
        output,
        executionCount: result.executionCount,
        hasImages: images.length,
        sandbox: (kernel as PythonKernel).sandbox,
        ...(kernel.sandbox?.warning ? { warning: kernel.sandbox.warning } : {}),
        receipt,
        ...(images.length ? { artifact: { kind: "image", data: { images: dataUrls } } } : {}),
      },
    }
  },
  }
})
