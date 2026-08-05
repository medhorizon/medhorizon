import { createRedactor } from "@/process/redaction"
import type { ExecuteResult, Kernel, KernelManager, KernelStartOptions } from "./types"

/** Default idle lifetime for persistent interpreters. */
export const DEFAULT_KERNEL_TTL_MS = 30 * 60 * 1000
/** Hard process-wide admission cap shared by Python and R kernels. */
export const DEFAULT_KERNEL_GLOBAL_CAP = 2

type Release = () => void

interface Waiter {
  resolve: (release: Release) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

/**
 * A small, cancellable admission semaphore. It deliberately lives outside
 * Plan 10's task scheduler: kernel capacity is an interpreter-process bound,
 * not a child-agent permit.
 */
export class KernelAdmission {
  readonly cap: number
  private active = 0
  private queue: Waiter[] = []

  constructor(cap = DEFAULT_KERNEL_GLOBAL_CAP) {
    if (!Number.isInteger(cap) || cap < 1) throw new Error("Kernel global cap must be a positive integer")
    this.cap = cap
  }

  get size() {
    return this.active
  }

  get pending() {
    return this.queue.length
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Kernel admission aborted"))
    if (this.active < this.cap) {
      this.active++
      return Promise.resolve(this.release())
    }

    return new Promise<Release>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal }
      const abort = () => {
        const index = this.queue.indexOf(waiter)
        if (index >= 0) this.queue.splice(index, 1)
        reject(signal?.reason ?? new Error("Kernel admission aborted"))
      }
      waiter.onAbort = abort
      signal?.addEventListener("abort", abort, { once: true })
      this.queue.push(waiter)
    })
  }

  private release(): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active = Math.max(0, this.active - 1)
      this.pump()
    }
  }

  private pump() {
    while (this.active < this.cap && this.queue.length) {
      const waiter = this.queue.shift()!
      waiter.signal?.removeEventListener("abort", waiter.onAbort!)
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new Error("Kernel admission aborted"))
        continue
      }
      this.active++
      waiter.resolve(this.release())
    }
  }
}

interface Entry<K extends Kernel> {
  key: string
  kernel?: K
  release: Release
  timer?: ReturnType<typeof setTimeout>
  last: number
}

type Factory<K extends Kernel> = (sessionID: string, opts?: KernelStartOptions) => Promise<K>

const managers = new Set<KernelLifecycle<Kernel>>()

/** Release every runtime owned by a deleted session. */
export async function releaseSessionKernels(sessionID: string): Promise<void> {
  await Promise.all([...managers].map((manager) => manager.release(sessionID)))
}

/** Shut down all persistent runtimes during process teardown. */
export async function shutdownKernelManagers(): Promise<void> {
  await Promise.all([...managers].map((manager) => manager.shutdownAll()))
}

function optionsKey(opts?: KernelStartOptions): string {
  const capabilities = [...new Set(opts?.capabilities ?? [])].sort()
  const skill = opts?.skill ?? ""
  return JSON.stringify({ skill, capabilities })
}

function chain<K>(map: Map<string, Promise<void>>, id: string, fn: () => Promise<K>): Promise<K> {
  const prior = map.get(id) ?? Promise.resolve()
  let done!: () => void
  const current = new Promise<void>((resolve) => (done = resolve))
  map.set(id, current)
  return prior
    .then(fn)
    .finally(() => {
      done()
      if (map.get(id) === current) map.delete(id)
    })
}

function busy(kernel: Kernel): boolean {
  return (kernel as Kernel & { busy?: boolean }).busy === true
}

/**
 * Owns persistent kernels and enforces lifecycle invariants common to all
 * language backends: per-session serialization, a process-wide cap, real idle
 * timers, and release on failure. The factory remains responsible for the
 * interpreter-specific handshake and kill-tree implementation.
 */
export class KernelLifecycle<K extends Kernel> implements KernelManager {
  readonly language: K["language"]
  readonly ttlMs: number
  readonly admission: KernelAdmission
  private readonly factory: Factory<K>
  private readonly kernels = new Map<string, Entry<K>>()
  private readonly locks = new Map<string, Promise<void>>()

  constructor(input: {
    language: K["language"]
    factory: Factory<K>
    ttlMs?: number
    admission?: KernelAdmission
  }) {
    this.language = input.language
    this.factory = input.factory
    const configured = Number(process.env.OPENSCIENCE_KERNEL_TTL_MS)
    const ttl = input.ttlMs ?? (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_KERNEL_TTL_MS)
    this.ttlMs = Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_KERNEL_TTL_MS
    this.admission = input.admission ?? sharedAdmission
    managers.add(this as unknown as KernelLifecycle<Kernel>)
  }

  get size() {
    return this.kernels.size
  }

  /** Test/diagnostic snapshot without exposing kernel objects or arguments. */
  snapshot() {
    return [...this.kernels.entries()].map(([sessionID, entry]) => ({
      sessionID,
      key: entry.key,
      ready: entry.kernel?.ready === true,
      busy: entry.kernel ? busy(entry.kernel) : false,
      lastUsed: entry.last,
    }))
  }

  get(sessionID: string, opts?: KernelStartOptions): Promise<K> {
    return chain(this.locks, sessionID, async () => {
      const key = optionsKey(opts)
      const existing = this.kernels.get(sessionID)
      if (existing?.kernel?.ready && existing.key === key) {
        existing.last = Date.now()
        this.schedule(sessionID, existing)
        return existing.kernel
      }

      if (existing) await this.releaseEntry(sessionID, existing)
      const release = await this.admission.acquire(opts?.signal)
      const entry: Entry<K> = { key, release, last: Date.now() }
      this.kernels.set(sessionID, entry)
      try {
        const kernel = await this.factory(sessionID, opts)
        entry.kernel = kernel
        if (!kernel.ready) throw new Error(`${this.language} kernel did not reach ready state`)
        entry.last = Date.now()
        this.schedule(sessionID, entry)
        return kernel
      } catch (error) {
        this.kernels.delete(sessionID)
        await entry.kernel?.shutdown().catch(() => {})
        entry.release()
        throw error
      }
    })
  }

  release(sessionID: string): Promise<void> {
    return chain(this.locks, sessionID, async () => {
      const entry = this.kernels.get(sessionID)
      if (!entry) return
      await this.releaseEntry(sessionID, entry)
    })
  }

  async shutdownAll(): Promise<void> {
    const ids = [...this.kernels.keys()]
    await Promise.all(ids.map((id) => this.release(id)))
  }

  /** Synchronous process-exit cleanup for interpreter implementations that expose killSync(). */
  shutdownAllSync(): void {
    for (const [id, entry] of this.kernels) {
      if (entry.timer) clearTimeout(entry.timer)
      const kernel = entry.kernel as (K & { killSync?: () => void }) | undefined
      kernel?.killSync?.()
      entry.release()
      this.kernels.delete(id)
    }
  }

  private schedule(sessionID: string, entry: Entry<K>) {
    if (entry.timer) clearTimeout(entry.timer)
    const timer = setTimeout(() => {
      entry.timer = undefined
      const current = this.kernels.get(sessionID)
      if (current !== entry) return
      const used = (entry.kernel as (K & { lastUsed?: number }) | undefined)?.lastUsed
      if (used !== undefined) entry.last = Math.max(entry.last, used)
      const remaining = this.ttlMs - (Date.now() - entry.last)
      if (remaining > 0 || (entry.kernel && busy(entry.kernel))) {
        this.schedule(sessionID, entry)
        return
      }
      void this.release(sessionID)
    }, Math.max(1, this.ttlMs - (Date.now() - entry.last)))
    timer.unref?.()
    entry.timer = timer
  }

  private async releaseEntry(sessionID: string, entry: Entry<K>): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer)
    if (this.kernels.get(sessionID) === entry) this.kernels.delete(sessionID)
    try {
      await entry.kernel?.shutdown()
    } finally {
      entry.release()
    }
  }
}

const configuredCap = Number(process.env.OPENSCIENCE_KERNEL_GLOBAL_CAP)
const sharedAdmission = new KernelAdmission(
  Number.isInteger(configuredCap) && configuredCap > 0 ? configuredCap : DEFAULT_KERNEL_GLOBAL_CAP,
)

/** Redact all textual MIME/stream/error fields while preserving opaque PNG data. */
export function redactKernelResult(result: ExecuteResult, secrets: Iterable<string>): ExecuteResult {
  const values = [...new Set(secrets)].filter(Boolean)
  if (!values.length) return result
  const redact = (value: string) => {
    const matcher = createRedactor(values)
    return matcher.push(value) + matcher.flush()
  }
  return {
    ...result,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
    outputs: result.outputs.map((output) => ({
      ...output,
      data: output.data
        ? Object.fromEntries(
            Object.entries(output.data).map(([mime, value]) => [mime, mime === "image/png" ? value : redact(value)]),
          )
        : undefined,
      error: output.error
        ? { ...output.error, message: redact(output.error.message), traceback: output.error.traceback?.map(redact) }
        : undefined,
    })),
  }
}

/** Remove PNG tEXt/zTXt/iTXt chunks; pixel and binary data remain opaque. */
export function stripPngTextChunks(base64: string): string | undefined {
  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, "base64")
  } catch {
    return undefined
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) return undefined
  const chunks: Buffer[] = [bytes.subarray(0, signature.length)]
  let offset = signature.length
  let ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return undefined
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    if (type !== "tEXt" && type !== "zTXt" && type !== "iTXt") chunks.push(bytes.subarray(offset, end))
    offset = end
    if (type === "IEND") {
      ended = true
      break
    }
  }
  if (offset > bytes.length || !ended) return undefined
  return Buffer.concat(chunks).toString("base64")
}

/** Shared admission is intentionally observable for bounded-cap tests. */
export function kernelAdmission(): KernelAdmission {
  return sharedAdmission
}
