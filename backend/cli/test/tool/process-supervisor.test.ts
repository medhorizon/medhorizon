import { describe, expect, test } from "bun:test"
import { ProcessSupervisor } from "../../src/process/supervisor"

const root = process.cwd()

describe("ProcessSupervisor", () => {
  test("uses a non-zero default and clamps requested timeouts", () => {
    expect(ProcessSupervisor.resolveTimeout()).toBe(ProcessSupervisor.DEFAULT_TIMEOUT_MS)
    expect(ProcessSupervisor.resolveTimeout(1)).toBe(ProcessSupervisor.MIN_TIMEOUT_MS)
    expect(ProcessSupervisor.resolveTimeout(Number.MAX_SAFE_INTEGER)).toBe(ProcessSupervisor.MAX_TIMEOUT_MS)
    expect(() => ProcessSupervisor.resolveTimeout(0)).toThrow()
  })

  test("redacts a secret split across real stdout chunks", async () => {
    const secret = "supervisor-secret-123"
    const command = process.platform === "win32" ? "powershell" : `printf 'supervisor-' ; sleep 0.01 ; printf 'secret-123\\n'`
    const result = await ProcessSupervisor.run({
      file: command,
      args: process.platform === "win32" ? ["-NoProfile", "-Command", `Write-Output '${secret}'`] : undefined,
      shell: process.platform === "win32" ? false : "/bin/sh",
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      runtime: "bash",
      mode: "ephemeral",
      lane: "general",
      sessionID: "test-session",
      callID: "test-call",
      secrets: [secret],
    })

    expect(result.receipt.status).toBe("success")
    expect(result.output).not.toContain(secret)
    expect(result.output).toContain("[REDACTED]")
  })

  test("records timeout as terminal and does not reopen it", async () => {
    if (process.platform === "win32") return
    const result = await ProcessSupervisor.run({
      file: "sleep 2",
      shell: "/bin/sh",
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      runtime: "bash",
      mode: "ephemeral",
      lane: "general",
      sessionID: "test-session",
      callID: "timeout-call",
      timeout: 50,
    })
    expect(result.receipt.status).toBe("timeout")
    expect(result.receipt.status).not.toBe("success")
  })
})
