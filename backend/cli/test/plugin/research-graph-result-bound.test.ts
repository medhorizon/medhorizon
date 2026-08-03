import { afterAll, describe, expect, test } from "bun:test"
import { randomBytes } from "crypto"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Subprocess } from "bun"
import type { ToolContext } from "@synsci/plugin"
import { atlasGraph } from "../../../../research-graph/medhorizon-plugin/tools/atlas_graph"
import { atlasStage } from "../../../../research-graph/medhorizon-plugin/tools/atlas_stage"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProvenanceQueryTool, ProvenanceRecordTool } from "../../src/tool/provenance"
import { ReadTool } from "../../src/tool/read"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncation"
import type { MessageV2 } from "../../src/session/message-v2"

const root = path.resolve(import.meta.dir, "../../../../research-graph")
const entry = path.join(root, "sidecar", "entry.py")
const py = ["py", "-3.14"]
const BUDGET = Truncate.BOUND_MAX_BYTES
const ratios = [0.9, 2, 10] as const
const processes: Subprocess[] = []
const dataDirs: string[] = []

type Discovery = { port: number; service: string; protocol: number }
type RecordValue = Record<string, unknown>

afterAll(async () => {
  await Promise.all(processes.map((proc) => stop(proc)))
  await Promise.all(dataDirs.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})))
})

function env(cap: string, data: string, config: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(RESEARCH_GRAPH_|MEDHORIZON_|OPENSCIENCE_)/.test(key)) continue
    out[key] = value
  }
  return {
    ...out,
    RESEARCH_GRAPH_MANAGED_CAPABILITY: cap,
    RESEARCH_GRAPH_DATA: data,
    MEDHORIZON_CONFIG_DIR: config,
    APP_ENV: "development",
    BACKEND_HOST: "127.0.0.1",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    OPENAI_MODEL: "",
  }
}

async function discovery(proc: Subprocess): Promise<Discovery> {
  const stream = proc.stdout
  if (typeof stream !== "object" || stream === null) throw new Error("sidecar stdout is not piped")
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const read = async () => {
    while (true) {
      const item = await reader.read()
      if (item.done) throw new Error("sidecar exited before discovery")
      buffer += decoder.decode(item.value, { stream: true })
      const end = buffer.indexOf("\n")
      if (end >= 0) return JSON.parse(buffer.slice(0, end)) as Discovery
    }
  }
  return Promise.race([
    read(),
    Bun.sleep(90_000).then(() => {
      throw new Error("sidecar discovery timed out")
    }),
  ])
}

async function health(port: number, cap: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${cap}` },
        signal: AbortSignal.timeout(2_000),
      })
      if (res.ok) return
    } catch {}
    await Bun.sleep(200)
  }
  throw new Error(`sidecar health timed out on ${port}`)
}

async function start() {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "rg-bound-"))
  const config = await fs.mkdtemp(path.join(os.tmpdir(), "rg-bound-config-"))
  dataDirs.push(data, config)
  const cap = randomBytes(32).toString("base64url")
  const proc = Bun.spawn([...py, entry], {
    cwd: root,
    env: env(cap, path.join(data, "data"), config),
    stdout: "pipe",
    stderr: "pipe",
  })
  processes.push(proc)
  const info = await discovery(proc)
  expect(info.service).toBe("research-graph")
  expect(info.protocol).toBe(1)
  await health(info.port, cap)
  return { proc, port: info.port, cap }
}

async function stop(proc: Subprocess) {
  if (process.platform === "win32") {
    try {
      await Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], { stdout: "ignore", stderr: "ignore" }).exited
    } catch {}
  } else {
    try {
      proc.kill("SIGTERM")
    } catch {}
  }
  try {
    await proc.exited
  } catch {}
}

function pluginCtx(sessionID: string, messageID: string): ToolContext {
  return {
    sessionID,
    messageID,
    agent: "research",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  }
}

function localCtx(sessionID: string, messageID: string): Tool.Context {
  return {
    sessionID,
    messageID,
    agent: "research",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
  }
}

function record(text: string): RecordValue {
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object result")
  return value as RecordValue
}

function sizeText(size: number) {
  const prefix = "noise-line\n"
  const count = Math.max(0, size - Buffer.byteLength(prefix))
  return prefix + "x".repeat(count)
}

async function pruneSpill(filepath: string) {
  return Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const session = await Session.create({ title: "Plan 02 bounding prune" })
      try {
        const first = await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "research",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        })
        const assistant: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: session.id,
          mode: "default",
          agent: "research",
          path: { cwd: process.cwd(), root: process.cwd() },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test",
          providerID: "test",
          parentID: first.id,
          time: { created: Date.now() },
          finish: "stop",
        }
        await Session.updateMessage(assistant)
        const output = "y".repeat(50_000)
        for (const index of [0, 1, 2, 3, 4]) {
          await Session.updatePart({
            id: Identifier.ascending("part"),
            sessionID: session.id,
            messageID: assistant.id,
            type: "tool",
            callID: `plan02-prune-${index}`,
            tool: "bash",
            state: {
              status: "completed",
              input: { filePath: filepath },
              output,
              title: "large evidence",
              metadata: {},
              time: { start: 0, end: 1 },
            },
          })
        }
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "research",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "assistant",
          sessionID: session.id,
          mode: "default",
          agent: "research",
          path: { cwd: process.cwd(), root: process.cwd() },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "test",
          providerID: "test",
          parentID: first.id,
          time: { created: Date.now() },
          finish: "stop",
        } satisfies MessageV2.Assistant)
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          role: "user",
          sessionID: session.id,
          agent: "research",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        })
        const reclaimed = await SessionCompaction.prune({ sessionID: session.id })
        expect(reclaimed).toBeGreaterThan(SessionCompaction.PRUNE_MINIMUM)
        expect(await Bun.file(filepath).text()).toContain("ERROR")
        return reclaimed
      } finally {
        await Session.remove(session.id)
      }
    },
  })
}

describe("Research Graph result bounding", () => {
  test("preserves stage/graph/provenance evidence across the payload matrix and prune", async () => {
    const priorApi = process.env.RESEARCH_GRAPH_API
    const priorToken = process.env.RESEARCH_GRAPH_TOKEN
    const priorMode = process.env.RESEARCH_GRAPH_MODE
    const priorBound = process.env.OPENSCIENCE_TOOL_RESULT_BOUND
    const sidecar = await start()
    process.env.RESEARCH_GRAPH_API = `http://127.0.0.1:${sidecar.port}`
    process.env.RESEARCH_GRAPH_TOKEN = sidecar.cap
    process.env.RESEARCH_GRAPH_MODE = "local"
    process.env.OPENSCIENCE_TOOL_RESULT_BOUND = "1"
    const spills: string[] = []
    try {
      for (const ratio of ratios) {
        const sessionID = `plan02-bound-${String(ratio).replace(".", "_")}`
        const messageID = Identifier.ascending("message")
        const plugin = pluginCtx(sessionID, messageID)
        const stage = record(
          await atlasStage.execute(
            {
              action: "land",
              stage_name: "Evidence",
              stage_index: 0,
              part_id: `${sessionID}-stage`,
              stage_status: "running",
              summary: "retain stage identity",
              create_graph_title: `Plan 02 ${ratio}x graph`,
              idempotency_key: `${sessionID}:stage`,
            },
            plugin,
          ),
        )
        const graphID = String(stage.graph_id)
        const stageID = String(stage.id)
        expect(graphID).toBeTruthy()
        expect(stageID).toBeTruthy()

        const body = JSON.stringify({
          status: "error",
          error: { code: "RG_BOUND_ERROR", message: "structured error evidence" },
          evidence: sizeText(Math.floor(BUDGET * ratio)),
        })
        const created = record(
          await atlasGraph.execute(
            {
              action: "create",
              graph_id: graphID,
              kind: "evidence",
              title: `Evidence ${ratio}x`,
              content: body,
              idempotency_key: `${sessionID}:node`,
            },
            plugin,
          ),
        )
        const nodeID = String(created.id)
        const updated = record(
          await atlasGraph.execute(
            {
              action: "update",
              node_id: nodeID,
              title: `Updated evidence ${ratio}x`,
              content: body,
              idempotency_key: `${sessionID}:update`,
            },
            plugin,
          ),
        )
        expect(String(updated.id)).toBe(nodeID)
        const edge = record(
          await atlasGraph.execute(
            {
              action: "edge",
              graph_id: graphID,
              source_id: stageID,
              target_id: nodeID,
              relation: "supports",
              idempotency_key: `${sessionID}:edge`,
            },
            plugin,
          ),
        )
        const edgeID = String(edge.id)
        expect(edgeID).toBeTruthy()

        const stageBound = await Truncate.bound(JSON.stringify(stage), { tool: "atlas_stage", maxBytes: BUDGET })
        expect(stageBound.content).toContain(stageID)
        expect(stageBound.content).toContain(graphID)

        const treeText = await atlasGraph.execute({ action: "tree", graph_id: graphID }, plugin)
        const tree = record(treeText)
        const nodes = Array.isArray(tree.nodes) ? tree.nodes : []
        const edges = Array.isArray(tree.edges) ? tree.edges : []
        expect(nodes.some((item) => record(JSON.stringify(item)).id === nodeID)).toBe(true)
        expect(edges.some((item) => record(JSON.stringify(item)).id === edgeID)).toBe(true)
        const treeBound = await Truncate.bound(treeText, { tool: "atlas_graph", maxBytes: BUDGET })
        expect(treeBound.content).toContain(graphID)
        expect(treeBound.content).toContain(nodeID)
        expect(treeBound.content).toContain(edgeID)
        expect(treeBound.content).toContain("supports")

        const errorBound = await Truncate.bound(
          JSON.stringify({
            graph_id: graphID,
            node_id: nodeID,
            edge_id: edgeID,
            status: "error",
            error: { code: "RG_BOUND_ERROR" },
            payload: body,
          }),
          { tool: "atlas_graph", maxBytes: BUDGET },
        )
        expect(errorBound.content).toContain("RG_BOUND_ERROR")
        expect(errorBound.content).toContain('"status": "error"')

        const log = `ERROR: graph ${graphID}\nFATAL: evidence boundary\nTraceback: retained\n${sizeText(Math.floor(BUDGET * ratio))}`
        const logBound = await Truncate.bound(log, { tool: "bash", maxBytes: BUDGET })
        expect(logBound.content).toContain("ERROR: graph")
        expect(logBound.content).toContain("FATAL: evidence boundary")
        expect(logBound.content).toContain("Traceback: retained")
        if (ratio > 1) {
          if (!logBound.truncated) throw new Error(`expected spill at ${ratio}x`)
          expect(await Bun.file(logBound.outputPath).text()).toBe(log)
          spills.push(logBound.outputPath)
        } else {
          expect(logBound.truncated).toBe(false)
        }

        const runInit = await ProvenanceRecordTool.init()
        const run = await runInit.execute(
          {
            kind: "run",
            label: `Research Graph ${ratio}x`,
            tool: "atlas_graph",
            meta: { graph_id: graphID, stage_id: stageID },
          },
          localCtx(sessionID, messageID),
        )
        const runID = String(run.metadata.id)
        const artifact = await runInit.execute(
          {
            kind: "artifact",
            label: `bounded evidence ${ratio}x`,
            artifact_type: "graph",
            path: logBound.truncated ? logBound.outputPath : "inline",
            meta: { graph_id: graphID, node_id: nodeID, edge_id: edgeID },
            derived_from: runID,
          },
          localCtx(sessionID, messageID),
        )
        const artifactID = String(artifact.metadata.id)
        const queryInit = await ProvenanceQueryTool.init()
        const lineage = await queryInit.execute(
          { id: artifactID },
          localCtx(sessionID, Identifier.ascending("message")),
        )
        expect(lineage.output).toContain(artifactID)
        expect(lineage.output).toContain(runID)
        expect(lineage.output).toContain("derived-from")

        const listed = JSON.parse(await atlasStage.execute({ action: "list" }, plugin)) as unknown
        expect(JSON.stringify(listed)).toContain(stageID)
      }

      const first = spills[0]
      if (!first) throw new Error("payload matrix did not produce a spill")
      const readInit = await ReadTool.init()
      const read = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          readInit.execute(
            { filePath: first, offset: 0, limit: 4 },
            { ...localCtx("plan02-later-turn", Identifier.ascending("message")), extra: { bypassCwdCheck: true } },
          ),
      })
      expect(read.output).toContain("ERROR")
      expect(await pruneSpill(first)).toBeGreaterThan(SessionCompaction.PRUNE_MINIMUM)
      const afterPrune = await Instance.provide({
        directory: process.cwd(),
        fn: () =>
          readInit.execute(
            { filePath: first, offset: 0, limit: 4 },
            { ...localCtx("plan02-after-prune", Identifier.ascending("message")), extra: { bypassCwdCheck: true } },
          ),
      })
      expect(afterPrune.output).toContain("ERROR")
      expect(await Bun.file(first).text()).toContain("Traceback")
    } finally {
      if (priorApi === undefined) delete process.env.RESEARCH_GRAPH_API
      else process.env.RESEARCH_GRAPH_API = priorApi
      if (priorToken === undefined) delete process.env.RESEARCH_GRAPH_TOKEN
      else process.env.RESEARCH_GRAPH_TOKEN = priorToken
      if (priorMode === undefined) delete process.env.RESEARCH_GRAPH_MODE
      else process.env.RESEARCH_GRAPH_MODE = priorMode
      if (priorBound === undefined) delete process.env.OPENSCIENCE_TOOL_RESULT_BOUND
      else process.env.OPENSCIENCE_TOOL_RESULT_BOUND = priorBound
      await stop(sidecar.proc)
    }
  }, 240_000)
})
