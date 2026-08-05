import { describe, expect, test } from "bun:test"
import type { ExecuteResult, Kernel, KernelStartOptions } from "../../src/science/kernel/types"
import {
  KernelAdmission,
  KernelLifecycle,
  redactKernelResult,
  stripPngTextChunks,
} from "../../src/science/kernel/lifecycle"

class Probe implements Kernel {
  readonly id: string
  readonly language = "python" as const
  ready = true
  shutdowns = 0

  constructor(id: string) {
    this.id = id
  }

  async start(_opts?: KernelStartOptions) {}

  async execute(_code: string): Promise<ExecuteResult> {
    return { ok: true, outputs: [], stdout: "", stderr: "" }
  }

  async shutdown() {
    this.ready = false
    this.shutdowns++
  }
}

describe("KernelLifecycle", () => {
  test("reaps idle kernels with a real timer and releases the admission permit", async () => {
    const admission = new KernelAdmission(1)
    const kernels = new KernelLifecycle<Probe>({
      language: "python",
      ttlMs: 20,
      admission,
      factory: async (id) => new Probe(id),
    })

    const kernel = await kernels.get("idle")
    expect(kernels.size).toBe(1)
    await Bun.sleep(60)
    expect(kernels.size).toBe(0)
    expect(kernel.shutdowns).toBe(1)
    expect(admission.size).toBe(0)
  })

  test("serializes concurrent get calls and recreates on capability scope change", async () => {
    const admission = new KernelAdmission(2)
    const made: Probe[] = []
    const kernels = new KernelLifecycle<Probe>({
      language: "python",
      ttlMs: 1000,
      admission,
      factory: async (id) => {
        await Bun.sleep(5)
        const kernel = new Probe(id)
        made.push(kernel)
        return kernel
      },
    })

    const same = await Promise.all([kernels.get("s"), kernels.get("s")])
    expect(same[0]).toBe(same[1])
    expect(made.length).toBe(1)
    const next = await kernels.get("s", { capabilities: ["compute:modal"] })
    expect(next).not.toBe(same[0])
    expect(made.length).toBe(2)
  })

  test("queued global admission is cancellable", async () => {
    const admission = new KernelAdmission(1)
    const release = await admission.acquire()
    const controller = new AbortController()
    const pending = admission.acquire(controller.signal)
    controller.abort(new Error("cancelled"))
    await expect(pending).rejects.toThrow("cancelled")
    release()
    expect(admission.size).toBe(0)
  })
})

test("kernel textual output redaction preserves opaque PNG data", () => {
  const result: ExecuteResult = {
    ok: true,
    stdout: "token-123",
    stderr: "token-123",
    outputs: [
      { type: "result", data: { "text/plain": "token-123", "text/html": "<b>token-123</b>" } },
      { type: "display", data: { "image/png": "dG9rZW4tMTIz" } },
    ],
  }
  const redacted = redactKernelResult(result, ["token-123"])
  expect(redacted.stdout).toBe("[REDACTED]")
  expect(redacted.outputs[0]?.data?.["text/html"]).toBe("<b>[REDACTED]</b>")
  expect(redacted.outputs[1]?.data?.["image/png"]).toBe("dG9rZW4tMTIz")
})

test("PNG textual ancillary chunks are removed before rich output serialization", () => {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, "ascii")
    data.copy(out, 8)
    return out
  }
  const encoded = Buffer.concat([signature, chunk("tEXt", Buffer.from("credential\0secret")), chunk("IEND", Buffer.alloc(0))]).toString(
    "base64",
  )
  const clean = stripPngTextChunks(encoded)
  expect(clean).toBeDefined()
  expect(Buffer.from(clean!, "base64").toString("latin1")).not.toContain("secret")
})
