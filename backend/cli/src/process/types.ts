import { randomBytes } from "crypto"
import z from "zod"

export const terminal = z.enum(["success", "failure", "cancelled", "timeout"])
export const runtime = z.enum(["bash", "python", "r", "notebook", "rkernel", "shell"])
export const mode = z.enum(["ephemeral", "persistent"])
export const lane = z.enum(["general", "scientific", "kernel"])
export const sandbox = z.enum(["requested", "enforced", "degraded", "unavailable"])

/**
 * Additive execution contract shared by process-backed tools.  The policy is
 * deliberately data-only: callers resolve permissions and capabilities before
 * handing it to a supervisor, and no command/argument text is retained here.
 */
export const ExecutionPolicy = z.object({
  runtime,
  mode,
  lane,
  timeoutMs: z.number().int().positive(),
  deadlineMs: z.number().int().positive(),
  sandbox: z.enum(["off", "best-effort", "strict"]),
  env: z.object({
    allow: z.array(z.string()),
    capabilities: z.array(z.string()),
  }),
})

export type ExecutionPolicy = z.infer<typeof ExecutionPolicy>

export const ProcessReceipt = z.object({
  receiptID: z.string().regex(/^[0-9a-f]{32}$/),
  callID: z.string(),
  sessionID: z.string(),
  runtime,
  mode,
  lane,
  status: terminal,
  queuedAt: z.number().nonnegative(),
  startedAt: z.number().nonnegative(),
  endedAt: z.number().nonnegative(),
  waitMs: z.number().nonnegative(),
  runMs: z.number().nonnegative(),
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
  failureClass: z.string().optional(),
  sandbox,
  backend: z.string().optional(),
  output: z.object({
    inlineBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    spilled: z.boolean(),
    ref: z.string().optional(),
  }),
})

export type ProcessReceipt = z.infer<typeof ProcessReceipt>
export type ProcessReceiptInput = Omit<ProcessReceipt, "receiptID">

function id() {
  return randomBytes(16).toString("hex")
}

export function createReceipt(input: ProcessReceiptInput): ProcessReceipt {
  return ProcessReceipt.parse({ receiptID: id(), ...input })
}

/**
 * Terminal receipts are write-once. A late child exit may add diagnostics at a
 * higher layer, but it cannot replace cancelled/timeout/failure with success.
 */
export function reduceTerminal(current: ProcessReceipt | undefined, next: ProcessReceipt): ProcessReceipt {
  return current ?? next
}
