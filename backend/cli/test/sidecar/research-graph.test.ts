import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  createResearchGraphSupervisor,
  DEFAULT_READY_TIMEOUT_MS,
  redact,
  REDACTED,
  resolveReadyTimeoutMs,
} from "../../src/sidecar/research-graph"
import type { ResearchGraphSupervisor, StartResult } from "../../src/sidecar/research-graph"

// Real black-box tests: REAL Bun.spawn subprocesses (the rg-sidecar-fixture)
// and real fetch. No mocks or copied spawn/fetch behavior.

const fixture = path.join(import.meta.dir, "../fixture/rg-sidecar-fixture.ts")

const ENV_KEYS = [
  "RESEARCH_GRAPH_API",
  "RESEARCH_GRAPH_MODE",
  "RESEARCH_GRAPH_TOKEN",
  "RESEARCH_GRAPH_DISABLE",
  "RESEARCH_GRAPH_BIN",
  "RESEARCH_GRAPH_READY_TIMEOUT_MS",
  "RESEARCH_GRAPH_LEGACY_FIXED_PORT",
  "RESEARCH_GRAPH_MANAGED_CAPABILITY",
  "FIXTURE_MODE",
  "FIXTURE_MARKER_DIR",
  "FIXTURE_EXPECTED_CAP",
  "FIXTURE_LEGACY_PORT",
  "FIXTURE_VERSION",
]

let baseline: Record<string, string | undefined> = {}
let supers: ResearchGraphSupervisor[] = []
let markers: string[] = []
let servers: Array<ReturnType<typeof Bun.serve>> = []

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const k of ENV_KEYS) out[k] = process.env[k]
  return out
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

beforeEach(() => {
  baseline = snapshotEnv()
  supers = []
  markers = []
  servers = []
  process.env.RESEARCH_GRAPH_BIN = fixture
})

afterEach(async () => {
  for (const s of supers) await s.stop().catch(() => {})
  for (const srv of servers) srv.stop(true)
  for (const dir of markers) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  restoreEnv(baseline)
})

afterAll(async () => {
  for (const s of supers) await s.stop().catch(() => {})
})

function newSup(): ResearchGraphSupervisor {
  const s = createResearchGraphSupervisor()
  supers.push(s)
  return s
}

function setMode(mode: string) {
  process.env.FIXTURE_MODE = mode
}

async function newMarkerDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rg-marker-"))
  markers.push(dir)
  process.env.FIXTURE_MARKER_DIR = dir
  return dir
}

function expectOk(res: StartResult): Extract<StartResult, { ok: true }> {
  expect(res.ok).toBe(true)
  if (!res.ok) throw new Error("expected ok result")
  return res
}

function expectFail(res: StartResult): Extract<StartResult, { ok: false }> {
  expect(res.ok).toBe(false)
  if (res.ok) throw new Error("expected failed result")
  return res
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await Bun.sleep(25)
  }
  expect(await check()).toBe(true)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Read the fixture's spawn marker (spawn-<pid> → pid) as a liveness probe. */
async function readSpawnPid(dir: string): Promise<number> {
  const files = await fs.readdir(dir)
  expect(files.length).toBe(1)
  const pid = Number(await fs.readFile(path.join(dir, files[0]), "utf8"))
  expect(Number.isInteger(pid)).toBe(true)
  return pid
}

async function waitForFile(file: string, ms: number): Promise<string> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const text = await fs.readFile(file, "utf8")
      if (text) return text
    } catch {
      // not written yet
    }
    await Bun.sleep(50)
  }
  throw new Error(`file not ready: ${file}`)
}

function serveMock(hits: Array<string | null>, body: () => Response): ReturnType<typeof Bun.serve> {
  const srv = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      hits.push(req.headers.get("authorization"))
      return body()
    },
  })
  servers.push(srv)
  return srv
}

const GOOD_HEALTH = () =>
  Response.json({ status: "ok", service: "research-graph", version: "0.3.6", protocol: 1, mode: "local", store: "sqlite", openai: false })

describe("research-graph supervisor lifecycle (real spawn + fetch)", () => {
  test("managed happy path reaches ready with an authenticated endpoint", async () => {
    setMode("modern")
    const sup = newSup()
    const res = expectOk(await sup.start())
    expect(res.mode).toBe("managed")
    expect(res.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(res.endpoint.api).toBe(res.endpoint.origin)
    expect(res.endpoint.token.length).toBeGreaterThanOrEqual(43) // >= 256 bits, base64url
    expect(res.endpoint.service).toBe("research-graph")
    expect(res.endpoint.protocol).toBe(1)
    expect(sup.snapshot().state).toBe("ready")
    // plugin routing env is set to the authenticated managed endpoint
    expect(process.env.RESEARCH_GRAPH_API).toBe(res.endpoint.origin)
    expect(process.env.RESEARCH_GRAPH_TOKEN).toBe(res.endpoint.token)
    // the capability is accepted by the child
    const ok = await fetch(`${res.endpoint.origin}/health`, {
      headers: { Authorization: `Bearer ${res.endpoint.token}` },
    })
    expect(ok.status).toBe(200)
    // diagnostics never carry the capability
    const snap = sup.snapshot()
    const texts = [snap.lastProbe?.message, ...snap.warnings.map((w) => w.message)].filter(Boolean)
    for (const t of texts) expect(t).not.toContain(res.endpoint.token)
  })

  test("current exposes a fresh live endpoint without spawning and clears it after exit", async () => {
    setMode("modern")
    const markerDir = await newMarkerDir()
    const sup = newSup()
    expect(sup.snapshot().state).toBe("idle")
    expect(sup.current()).toBeNull()
    const res = expectOk(await sup.start())
    const first = sup.current()
    expect(first?.generation).toBe(1)
    expect(first?.mode).toBe("managed")
    expect(first?.endpoint.token).toBe(res.endpoint.token)
    expect(first?.endpoint.origin).toBe(res.endpoint.origin)
    expect(first).not.toBe(sup.current())
    expect(sup.snapshot().endpoint?.token).toBe(REDACTED)
    await fetch(`${res.endpoint.origin}/__exit`, {
      headers: { Authorization: `Bearer ${res.endpoint.token}` },
    })
    await waitFor(() => sup.snapshot().state === "exited")
    expect(sup.current()).toBeNull()
    expect(await fs.readdir(markerDir)).toHaveLength(1)
  })

  test("concurrent start() calls return the same in-flight result and spawn one child", async () => {
    setMode("modern")
    const markerDir = await newMarkerDir()
    const sup = newSup()
    const [a, b] = await Promise.all([sup.start(), sup.start()])
    expect(a === b).toBe(true)
    const okA = expectOk(a)
    expectOk(b)
    const files = await fs.readdir(markerDir)
    expect(files.length).toBe(1)
    // starting an already-ready supervisor is idempotent
    const again = expectOk(await sup.start())
    expect(again.endpoint.origin).toBe(okA.endpoint.origin)
  })

  test("a capability the child rejects yields capability_rejected", async () => {
    setMode("wrong-cap")
    process.env.FIXTURE_EXPECTED_CAP = "some-other-capability"
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("capability_rejected")
    expect(sup.snapshot().state).toBe("failed")
  })

  test("a wrong service returning 2xx yields identity_mismatch", async () => {
    setMode("wrong-service")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("identity_mismatch")
  })

  test("protocol mismatch in the discovery record yields protocol_mismatch", async () => {
    setMode("protocol-mismatch-discovery")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("protocol_mismatch")
  })

  test("protocol mismatch in the health response yields protocol_mismatch", async () => {
    setMode("protocol-mismatch-health")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("protocol_mismatch")
  })

  test("readiness timeout yields discovery_timeout, reaps the child, and permits restart", async () => {
    setMode("no-discovery")
    const markerDir = await newMarkerDir()
    process.env.RESEARCH_GRAPH_READY_TIMEOUT_MS = "1000" // clamps to the 1000ms floor
    const sup = newSup()
    const t0 = Date.now()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("discovery_timeout")
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    expect(sup.snapshot().state).toBe("failed")
    expect(res.diagnostic.state).toBe("failed")
    expect(res.diagnostic.elapsedMs).toBeGreaterThanOrEqual(900)
    // orphan scan: the timed-out child is reaped
    const pid = await readSpawnPid(markerDir)
    await waitFor(() => !isAlive(pid))
    // restart after a timed-out start works
    setMode("modern")
    const ok = expectOk(await sup.start())
    expect(ok.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  test("a malformed discovery line yields malformed_discovery", async () => {
    setMode("malformed")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("malformed_discovery")
  })

  test("stdout EOF before a discovery record yields discovery_eof and records the exit code", async () => {
    setMode("exit-immediately")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("discovery_eof")
    expect(sup.snapshot().lastExit?.code).toBe(7)
    expect(sup.snapshot().state).toBe("failed")
  })

  test("a child exiting during the health poll yields child_exited", async () => {
    setMode("exit-during-health")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("child_exited")
    expect(sup.snapshot().lastExit?.code).toBe(3)
  })

  test("a clean exit clears ready state and records exit code 0", async () => {
    setMode("modern")
    const sup = newSup()
    const res = expectOk(await sup.start())
    await fetch(`${res.endpoint.origin}/__exit`, {
      headers: { Authorization: `Bearer ${res.endpoint.token}` },
    })
    await waitFor(() => sup.snapshot().state === "exited")
    const snap = sup.snapshot()
    expect(snap.endpoint).toBeNull()
    expect(snap.lastExit?.code).toBe(0)
  })

  test("an abnormal exit clears ready state, records the exit code, and allows restart", async () => {
    setMode("modern")
    const markerDir = await newMarkerDir()
    const sup = newSup()
    const res = expectOk(await sup.start())
    const pid = await readSpawnPid(markerDir)
    await fetch(`${res.endpoint.origin}/__crash`, {
      headers: { Authorization: `Bearer ${res.endpoint.token}` },
    })
    await waitFor(() => sup.snapshot().state === "exited")
    const snap = sup.snapshot()
    expect(snap.endpoint).toBeNull()
    expect(snap.lastExit?.code).toBe(1)
    expect(snap.lastProbe?.code).toBe("child_exited")
    // orphan scan: the crashed child is gone
    await waitFor(() => !isAlive(pid))
    // restart after a crash works
    const ok = expectOk(await sup.start())
    expect(ok.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  test("restart after a failed start is permitted", async () => {
    setMode("malformed")
    const sup = newSup()
    const fail = expectFail(await sup.start())
    expect(fail.diagnostic.code).toBe("malformed_discovery")
    setMode("modern")
    const ok = expectOk(await sup.start())
    expect(sup.snapshot().state).toBe("ready")
    expect(ok.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  test("stop() is idempotent, works on idle supervisors, and permits restart", async () => {
    setMode("modern")
    const sup = newSup()
    await sup.stop() // stop on idle is a no-op
    expect(sup.snapshot().state).toBe("idle")
    const res = expectOk(await sup.start())
    await sup.stop()
    await sup.stop() // repeated stop is idempotent
    expect(sup.snapshot().state).toBe("idle")
    expect(sup.snapshot().endpoint).toBeNull()
    const ok = expectOk(await sup.start())
    expect(ok.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  test("stop() terminates the managed child and waits for confirmed exit (Windows path)", async () => {
    setMode("modern")
    const markerDir = await newMarkerDir()
    const sup = newSup()
    const res = expectOk(await sup.start())
    const pid = await readSpawnPid(markerDir)
    await sup.stop()
    expect(sup.snapshot().state).toBe("idle")
    expect(sup.snapshot().endpoint).toBeNull()
    // orphan scan: the child PID is no longer alive (parent-shutdown path:
    // serve/web await the same stopResearchGraphSidecar() stop flow)
    await waitFor(() => !isAlive(pid))
    // confirmed exit: the endpoint no longer accepts connections
    await waitFor(async () => {
      try {
        await fetch(`${res.endpoint.origin}/health`, { signal: AbortSignal.timeout(200) })
        return false
      } catch {
        return true
      }
    })
  })

  test("extra stdout records are recorded as a warning diagnostic", async () => {
    setMode("extra-records")
    const sup = newSup()
    const res = expectOk(await sup.start())
    await waitFor(() => sup.snapshot().warnings.some((w) => w.code === "extra_discovery_record"))
    expect(res.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  test("discovery followed by an immediate child exit yields child_exited with context", async () => {
    setMode("die-after-discovery")
    const markerDir = await newMarkerDir()
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("child_exited")
    expect(res.diagnostic.lastExit?.code).toBe(5)
    expect(res.diagnostic.state).toBe("failed")
    expect(res.diagnostic.elapsedMs).toBeDefined()
    expect(res.diagnostic.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(sup.snapshot().lastExit?.code).toBe(5)
    expect(sup.snapshot().state).toBe("failed")
    // orphan scan: the child exited before health and is gone
    const pid = await readSpawnPid(markerDir)
    await waitFor(() => !isAlive(pid))
  })

  test("a never-listening discovery port yields connection_refused at the deadline", async () => {
    setMode("refuse-health")
    process.env.RESEARCH_GRAPH_READY_TIMEOUT_MS = "1000"
    const sup = newSup()
    const t0 = Date.now()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("connection_refused")
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    // the deadline preserves the specific probe cause, with context attached
    expect(res.diagnostic.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(res.diagnostic.elapsedMs).toBeGreaterThanOrEqual(900)
    expect(res.diagnostic.state).toBe("failed")
    expect(sup.snapshot().lastProbe?.code).toBe("connection_refused")
  })

  test("a health endpoint that keeps returning 5xx yields health_check_failed at the deadline", async () => {
    setMode("health-5xx")
    process.env.RESEARCH_GRAPH_READY_TIMEOUT_MS = "1000"
    const sup = newSup()
    const t0 = Date.now()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("health_check_failed")
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    expect(res.diagnostic.state).toBe("failed")
    expect(sup.snapshot().lastProbe?.code).toBe("health_check_failed")
    expect(sup.snapshot().state).toBe("failed")
  })

  test("each supervisor instance is isolated: no inherited child, generation, timer, or last diagnostic", async () => {
    setMode("modern")
    const a = newSup()
    expectOk(await a.start())
    await a.stop()
    // A fresh instance must not inherit any state from `a` or any earlier case.
    setMode("modern")
    const markerDir = await newMarkerDir()
    const b = newSup()
    const fresh = b.snapshot()
    expect(fresh.state).toBe("idle")
    expect(fresh.generation).toBe(0)
    expect(fresh.endpoint).toBeNull()
    expect(fresh.lastExit).toBeNull()
    expect(fresh.lastProbe).toBeNull()
    expect(fresh.warnings).toEqual([])
    // ...and it spawns exactly one fresh child (no module-global reuse)
    const readyB = expectOk(await b.start())
    expect(readyB.endpoint.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const files = await fs.readdir(markerDir)
    expect(files.length).toBe(1)
    await b.stop()
    // repeated isolation: a third instance is equally clean
    const c = newSup()
    expect(c.snapshot().generation).toBe(0)
    expect(c.snapshot().lastProbe).toBeNull()
    expect(c.snapshot().lastExit).toBeNull()
  })
})

describe("external API adoption (no managed child)", () => {
  test("an explicit external API is adopted after the handshake, using its token", async () => {
    const hits: Array<string | null> = []
    const srv = serveMock(hits, GOOD_HEALTH)
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    process.env.RESEARCH_GRAPH_TOKEN = "ext-token-123"
    const sup = newSup()
    const res = expectOk(await sup.start())
    expect(res.mode).toBe("external")
    expect(res.endpoint.origin).toBe(`http://127.0.0.1:${srv.port}`)
    expect(res.endpoint.token).toBe("ext-token-123")
    expect(sup.snapshot().state).toBe("ready")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h === "Bearer ext-token-123")).toBe(true)
  })

  test("an external API without a token is adopted on identity/protocol alone", async () => {
    const hits: Array<string | null> = []
    const srv = serveMock(hits, GOOD_HEALTH)
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    delete process.env.RESEARCH_GRAPH_TOKEN
    const sup = newSup()
    const res = expectOk(await sup.start())
    expect(res.endpoint.token).toBe("")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h === null)).toBe(true)
  })

  test("external mode never spawns a managed child", async () => {
    const markerDir = await newMarkerDir()
    const srv = serveMock([], GOOD_HEALTH)
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    const sup = newSup()
    expectOk(await sup.start())
    const files = await fs.readdir(markerDir)
    expect(files.length).toBe(0)
  })

  test("external API with the wrong service fails with identity_mismatch", async () => {
    const srv = serveMock([], () => Response.json({ status: "ok", service: "evil", protocol: 1 }))
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("identity_mismatch")
  })

  test("external API rejecting the token fails with capability_rejected", async () => {
    const srv = serveMock([], () => Response.json({ detail: "nope" }, { status: 401 }))
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    process.env.RESEARCH_GRAPH_TOKEN = "wrong"
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("capability_rejected")
  })
})

describe("compatibility and rollback switches", () => {
  test("RESEARCH_GRAPH_DISABLE=1 returns disabled and spawns nothing", async () => {
    const markerDir = await newMarkerDir()
    process.env.RESEARCH_GRAPH_DISABLE = "1"
    setMode("modern")
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("disabled")
    const files = await fs.readdir(markerDir)
    expect(files.length).toBe(0)
  })

  test("RESEARCH_GRAPH_LEGACY_FIXED_PORT is required for the legacy fallback", async () => {
    // A discovery-less fixed-port fixture times out WITHOUT the switch - the
    // legacy fallback is never enabled implicitly by a discovery failure.
    setMode("legacy")
    process.env.RESEARCH_GRAPH_READY_TIMEOUT_MS = "1000"
    const noFlag = newSup()
    const failRes = expectFail(await noFlag.start())
    expect(failRes.diagnostic.code).toBe("discovery_timeout")
  })

  test("RESEARCH_GRAPH_LEGACY_FIXED_PORT=1 adopts the fixed-port binary via the strict handshake", async () => {
    setMode("legacy")
    process.env.RESEARCH_GRAPH_READY_TIMEOUT_MS = "1000"
    process.env.RESEARCH_GRAPH_LEGACY_FIXED_PORT = "1"
    const sup = newSup()
    const res = expectOk(await sup.start())
    expect(res.endpoint.origin).toBe("http://127.0.0.1:8000")
    expect(sup.snapshot().state).toBe("ready")
    expect(sup.snapshot().warnings.some((w) => w.code === "legacy_fallback")).toBe(true)
  })

  test("RESEARCH_GRAPH_READY_TIMEOUT_MS is validated and clamped", () => {
    expect(resolveReadyTimeoutMs(undefined)).toBe(DEFAULT_READY_TIMEOUT_MS)
    expect(resolveReadyTimeoutMs("")).toBe(DEFAULT_READY_TIMEOUT_MS)
    expect(resolveReadyTimeoutMs("abc")).toBe(DEFAULT_READY_TIMEOUT_MS)
    expect(resolveReadyTimeoutMs("12.5")).toBe(DEFAULT_READY_TIMEOUT_MS)
    expect(resolveReadyTimeoutMs("0")).toBe(1000)
    expect(resolveReadyTimeoutMs("1")).toBe(1000)
    expect(resolveReadyTimeoutMs("999")).toBe(1000)
    expect(resolveReadyTimeoutMs("15000")).toBe(15000)
    expect(resolveReadyTimeoutMs("120000")).toBe(120000)
    expect(resolveReadyTimeoutMs("120001")).toBe(120000)
  })
})

describe("diagnostics never leak the capability (redaction sweep)", () => {
  test("serialized snapshot metadata never contains the managed capability", async () => {
    setMode("modern")
    const sup = newSup()
    const res = expectOk(await sup.start())
    const cap = res.endpoint.token
    const snap = sup.snapshot()
    // the diagnostics surface redacts the live token
    expect(snap.endpoint?.token).toBe(REDACTED)
    const json = JSON.stringify(snap)
    expect(json).not.toContain(cap)
    expect(json).not.toMatch(/Authorization:\s*Bearer/)
  })

  test("external mode with a distinctive token leaks nothing into diagnostics", async () => {
    const distinctive = "TESTTOKEN_LEAK_DETECTOR_9f8e7d6c"
    const srv = serveMock([], () => Response.json({ detail: "nope" }, { status: 401 }))
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${srv.port}`
    process.env.RESEARCH_GRAPH_TOKEN = distinctive
    const sup = newSup()
    const res = expectFail(await sup.start())
    expect(res.diagnostic.code).toBe("capability_rejected")
    const snap = sup.snapshot()
    const texts = [res.diagnostic.message, snap.lastProbe?.message ?? "", ...snap.warnings.map((w) => w.message)]
    for (const t of texts) {
      expect(t).not.toContain(distinctive)
      expect(t).not.toMatch(/Authorization:\s*Bearer/)
    }
    expect(JSON.stringify(snap)).not.toContain(distinctive)
    expect(JSON.stringify(snap)).not.toMatch(/Authorization:\s*Bearer/)
  })

  test("a managed crash's captured diagnostics carry no capability in message or serialization", async () => {
    setMode("modern")
    const sup = newSup()
    const res = expectOk(await sup.start())
    const cap = res.endpoint.token
    await fetch(`${res.endpoint.origin}/__crash`, { headers: { Authorization: `Bearer ${cap}` } })
    await waitFor(() => sup.snapshot().state === "exited")
    const snap = sup.snapshot()
    const texts = [snap.lastProbe?.message ?? "", ...snap.warnings.map((w) => w.message)]
    for (const t of texts) {
      expect(t).not.toContain(cap)
      expect(t).not.toMatch(/Authorization:\s*Bearer/)
    }
    expect(snap.lastProbe?.code).toBe("child_exited")
    expect(JSON.stringify(snap)).not.toContain(cap)
    expect(JSON.stringify(snap)).not.toMatch(/Authorization:\s*Bearer/)
  })

  test("redact() scrubs capability values and Authorization headers from error messages and stacks", () => {
    const secret = "TESTCAP_REDACTION_a1b2c3d4"
    const leaky = `connect to ${secret} failed: Authorization: Bearer ${secret}`
    const err = new Error(leaky)
    err.stack = `Error: ${leaky}\n    at #pollHealth (research-graph.ts:555:11)`
    const scrubbedMessage = redact(err.message, [secret])
    expect(scrubbedMessage).not.toContain(secret)
    expect(scrubbedMessage).not.toMatch(/Authorization:\s*Bearer/)
    const scrubbedStack = redact(err.stack ?? "", [secret])
    expect(scrubbedStack).not.toContain(secret)
    expect(scrubbedStack).not.toMatch(/Authorization:\s*Bearer/)
  })

  test("redact() scrubs capability env values out of serialized env dumps", () => {
    const cap = "TESTCAP_ENVDUMP_5e6f7a8b"
    const dump = JSON.stringify({
      RESEARCH_GRAPH_MANAGED_CAPABILITY: cap,
      RESEARCH_GRAPH_TOKEN: cap,
      endpoint: { token: cap },
    })
    expect(redact(dump, [cap])).not.toContain(cap)
  })

  test("supervisor UI output never contains the capability", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rg-ui-"))
    const capPath = path.join(tmp, "cap.txt")
    const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "../fixture/rg-ui-capture.ts")], {
      env: { ...process.env, RG_UI_CAP_PATH: capPath },
      stdout: "pipe",
      stderr: "pipe",
    })
    const code = await Promise.race([proc.exited, Bun.sleep(30000).then(() => null)])
    expect(code).toBe(0)
    const cap = await waitForFile(capPath, 5000)
    const stderr = await new Response(proc.stderr).text()
    const stdout = await new Response(proc.stdout).text()
    expect(cap.length).toBeGreaterThanOrEqual(43) // >= 256 bits, base64url
    expect(stderr).not.toContain(cap)
    expect(stdout).not.toContain(cap)
    expect(stderr).not.toMatch(/Authorization:\s*Bearer/)
    expect(stdout).not.toMatch(/Authorization:\s*Bearer/)
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }, 45000)
})
