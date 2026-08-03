// Real subprocess fixture for test/sidecar/research-graph.test.ts.
// Emulates the Research Graph sidecar's discovery record + authenticated /health
// contract WITHOUT the Python sidecar. Behavior is selected via FIXTURE_MODE.
// The supervisor spawns this via `bun <this-file>` (RESEARCH_GRAPH_BIN points at
// it), which is why it uses only Bun runtime APIs.
//
// Discovery wire contract (matches research-graph/sidecar/entry.py):
//   {"port":<int>,"protocol":1,"service":"research-graph","version":"0.3.6"}
// Sorted keys, compact, exactly one line on stdout.

const mode = process.env.FIXTURE_MODE ?? "modern"
const cap = process.env.RESEARCH_GRAPH_MANAGED_CAPABILITY ?? ""
const version = process.env.FIXTURE_VERSION ?? "0.3.6"
const markerDir = process.env.FIXTURE_MARKER_DIR
const expectedCap = mode === "wrong-cap" ? (process.env.FIXTURE_EXPECTED_CAP ?? "expected-cap") : cap
const legacyPort = Number(process.env.FIXTURE_LEGACY_PORT ?? "8000")

if (markerDir) {
  await Bun.write(`${markerDir}/spawn-${process.pid}`, String(process.pid))
}

const DISCOVERY_SERVICE = "research-graph"
const DISCOVERY_PROTOCOL = 1

function healthBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "ok",
    service: DISCOVERY_SERVICE,
    version,
    protocol: DISCOVERY_PROTOCOL,
    mode: "local",
    store: "sqlite",
    openai: false,
    ...overrides,
  })
}

function emitDiscovery(port: number, overrides: Record<string, unknown> = {}): void {
  const record = {
    port,
    protocol: overrides.protocol ?? DISCOVERY_PROTOCOL,
    service: overrides.service ?? DISCOVERY_SERVICE,
    version,
  }
  console.log(JSON.stringify(record))
}

function authorized(req: Request): boolean {
  return req.headers.get("authorization") === `Bearer ${expectedCap}`
}

function handler(health: string) {
  return async (req: Request): Promise<Response> => {
    if (!authorized(req)) {
      return Response.json({ detail: "capability required" }, { status: 401 })
    }
    const url = new URL(req.url)
    if (url.pathname === "/health") {
      if (mode === "health-5xx") return new Response("server error", { status: 500 })
      return new Response(health, { headers: { "content-type": "application/json" } })
    }
    if (url.pathname === "/__exit") {
      setTimeout(() => process.exit(0), 10)
      return Response.json({ ok: true })
    }
    if (url.pathname === "/__crash") {
      setTimeout(() => process.exit(1), 10)
      return Response.json({ ok: true })
    }
    return Response.json({ detail: "not found" }, { status: 404 })
  }
}

function healthForMode(m: string): string {
  if (m === "wrong-service") return healthBody({ service: "evil-service" })
  if (m === "protocol-mismatch-health") return healthBody({ protocol: 99 })
  return healthBody()
}

if (mode === "legacy") {
  // Old fixed-port binary: binds 8000, emits NO discovery line (stdout stays
  // open, so the parent's discovery phase times out), and serves the strict
  // handshake so the legacy fallback can adopt it.
  let server: ReturnType<typeof Bun.serve> | undefined
  for (let attempt = 0; attempt < 20 && !server; attempt++) {
    try {
      server = Bun.serve({ hostname: "127.0.0.1", port: legacyPort, fetch: handler(healthForMode("modern")) })
    } catch {
      await Bun.sleep(100)
    }
  }
  if (!server) {
    console.error(`fixture: cannot bind legacy port ${legacyPort}`)
    process.exit(1)
  }
} else if (mode === "exit-immediately") {
  process.exit(7)
} else if (mode === "die-after-discovery") {
  // Emits a valid discovery record for a CLOSED loopback port, then exits after
  // a short delay before the parent can reach ready - the parent must report
  // child_exited (not a discovery error).
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x") })
  const port = server.port!
  server.stop(true)
  emitDiscovery(port)
  setTimeout(() => process.exit(5), 150)
} else if (mode === "refuse-health") {
  // Emits a valid discovery record for a never-listening port and stays alive,
  // so the parent's health polls keep hitting connection_refused until the
  // readiness deadline preserves that specific probe cause.
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x") })
  const port = server.port!
  server.stop(true)
  emitDiscovery(port)
  await Bun.sleep(60000)
} else if (mode === "exit-during-health") {
  // Emits discovery, accepts connections but never serves a healthy /health,
  // then dies during the health-poll phase so the parent reports child_exited.
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("nope", { status: 404 }) })
  emitDiscovery(server.port!)
  setTimeout(() => process.exit(3), 300)
} else {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler(healthForMode(mode)) })
  const port = server.port!
  switch (mode) {
    case "wrong-service":
    case "protocol-mismatch-health":
      emitDiscovery(port)
      break
    case "protocol-mismatch-discovery":
      emitDiscovery(port, { protocol: 99 })
      break
    case "malformed":
      console.log("this is not valid json")
      break
    case "extra-records":
      emitDiscovery(port)
      console.log(JSON.stringify({ port, protocol: DISCOVERY_PROTOCOL, service: DISCOVERY_SERVICE, version }))
      break
    case "health-5xx":
      emitDiscovery(port)
      break
    case "no-discovery":
      break
    default:
      emitDiscovery(port)
      break
  }
}
