// Spawned by test/sidecar/research-graph.test.ts to capture the supervisor's
// REAL UI output (UI.println writes to this process's stderr) without
// intercepting the test process's own stderr. Runs the real supervisor against
// the real fixture to ready, writes the active capability to RG_UI_CAP_PATH (a
// side channel - never stdout/stderr), then stops and exits. The parent asserts
// this process's stdout/stderr never contain that capability.

import path from "path"
import { createResearchGraphSupervisor } from "../../src/sidecar/research-graph"

process.env.RESEARCH_GRAPH_BIN = path.join(import.meta.dir, "rg-sidecar-fixture.ts")
process.env.FIXTURE_MODE = "modern"
// Never inherit a stale routing env from the parent test process.
delete process.env.RESEARCH_GRAPH_API
delete process.env.RESEARCH_GRAPH_TOKEN

const capPath = process.env.RG_UI_CAP_PATH
const sup = createResearchGraphSupervisor()
const res = await sup.start()
if (!res.ok) {
  console.error(`ui-capture: start failed with ${res.diagnostic.code}`)
  process.exit(2)
}
if (capPath) await Bun.write(capPath, res.endpoint.token)
await sup.stop()
