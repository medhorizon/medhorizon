import { afterAll, describe, expect, test } from "bun:test"
import { randomBytes } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Subprocess } from "bun"

// Real Python sidecar integration. Spawns research-graph/sidecar/entry.py via
// `py -3.14` (NOT through the supervisor, which spawns packaged binaries),
// reads its single discovery line from stdout, authenticates /health with the
// managed capability, then terminates the whole tree and asserts nothing
// survives (orphan scan). `py` on Windows is a launcher that spawns a separate
// python.exe running the server, so the tree must be killed with taskkill /T
// while the launcher is alive; uvicorn itself runs in-process (one python
// process), so killing the tree reaps everything.

const rgRoot = path.resolve(import.meta.dir, "../../../../research-graph")
const entry = path.join(rgRoot, "sidecar", "entry.py")
const py = ["py", "-3.14"]
const PY_STARTUP_MS = 90000
const HEALTH_WAIT_MS = 60000

let dataDirs: string[] = []

afterAll(async () => {
  for (const dir of dataDirs) await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** Clean environment for the child: no Research Graph / MedHorizon knobs leak. */
function isolatedEnv(data: string, cap: string, config: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(RESEARCH_GRAPH_|MEDHORIZON_|OPENSCIENCE_)/.test(k)) continue
    if (v !== undefined) env[k] = v
  }
  env.RESEARCH_GRAPH_MANAGED_CAPABILITY = cap
  env.RESEARCH_GRAPH_DATA = data
  env.MEDHORIZON_CONFIG_DIR = config
  env.APP_ENV = "development"
  env.BACKEND_HOST = "127.0.0.1"
  env.OPENAI_API_KEY = ""
  env.OPENAI_BASE_URL = ""
  env.OPENAI_MODEL = ""
  return env
}

async function readDiscovery(proc: Subprocess): Promise<{ port: number; service: string; protocol: number }> {
  const stream = proc.stdout
  if (typeof stream !== "object" || stream === null) throw new Error("managed child has no piped stdout")
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  const deadline = Date.now() + PY_STARTUP_MS
  while (Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const nl = buf.indexOf("\n")
    if (nl >= 0) return JSON.parse(buf.slice(0, nl)) as { port: number; service: string; protocol: number }
  }
  throw new Error("no discovery line within 90s")
}

async function waitHealth(port: number, cap: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + HEALTH_WAIT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${cap}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.status === 200) return (await res.json()) as Record<string, unknown>
    } catch {
      // not accepting connections yet
    }
    await Bun.sleep(300)
  }
  throw new Error(`/health on 127.0.0.1:${port} never returned 200`)
}

async function killTree(proc: Subprocess): Promise<void> {
  if (process.platform === "win32") {
    // py.exe spawns a separate python.exe that runs the server; taskkill /T
    // must run while the launcher is alive so the whole tree dies together.
    try {
      await Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], { stdout: "ignore", stderr: "ignore" }).exited
    } catch {
      // already gone
    }
    try {
      proc.kill()
    } catch {
      // already gone
    }
    return
  }
  try {
    proc.kill("SIGTERM")
  } catch {
    // already gone
  }
  try {
    proc.kill("SIGKILL")
  } catch {
    // already gone
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForClosed(port: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })
      if (res.status !== 200) return
    } catch {
      return
    }
    await Bun.sleep(100)
  }
  throw new Error(`port ${port} still accepts connections after tree kill`)
}

/** Windows-only scan for orphaned python.exe processes running our entry.py. */
async function orphanPythons(): Promise<string[]> {
  if (process.platform !== "win32") return []
  try {
    const wm = Bun.spawnSync(["wmic", "process", "get", "processid,commandline"], { stdout: "pipe", stderr: "pipe" })
    const out = new TextDecoder().decode(wm.stdout)
    return out.split("\n").filter((l) => l.includes("python.exe") && l.includes("entry.py"))
  } catch {
    return []
  }
}

async function waitForOrphansGone(ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if ((await orphanPythons()).length === 0) return
    await Bun.sleep(300)
  }
  expect(await orphanPythons()).toHaveLength(0)
}

describe("real Python sidecar integration (entry.py via py -3.14)", () => {
  test(
    "discovery + authenticated /health + clean tree termination",
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rg-real-"))
      dataDirs.push(tmp)
      const noConfig = await fs.mkdtemp(path.join(os.tmpdir(), "rg-noconfig-"))
      dataDirs.push(noConfig)
      const cap = randomBytes(32).toString("base64url") // >= 256-bit managed capability
      const env = isolatedEnv(path.join(tmp, "data"), cap, noConfig)
      const proc = Bun.spawn([...py, entry], { cwd: rgRoot, env, stdout: "pipe", stderr: "pipe" })
      let port = 0
      try {
        const discovery = await readDiscovery(proc)
        port = discovery.port
        expect(discovery.service).toBe("research-graph")
        expect(discovery.protocol).toBe(1)
        expect(port).toBeGreaterThan(0)
        expect(port).toBeLessThanOrEqual(65535)
        expect(cap).not.toBeUndefined()
        const body = await waitHealth(port, cap)
        expect(body.status).toBe("ok")
        expect(body.service).toBe("research-graph")
        expect(body.version).toBeTruthy()
        expect(body.protocol).toBe(1)
        expect(body.mode).toBe("local")
        // the wrong capability is rejected
        const bad = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { Authorization: "Bearer wrong-capability" },
        })
        expect(bad.status).toBe(401)
      } finally {
        await killTree(proc)
        await proc.exited
      }
      // orphan scan: the launcher PID is gone, the port is closed, and no
      // python.exe still runs our entry.py
      expect(isAlive(proc.pid)).toBe(false)
      await waitForClosed(port, 5000)
      await waitForOrphansGone(10000)
    },
    180000,
  )
})
