import { describe, expect, test } from "bun:test"
import { jsonSchema, tool } from "ai"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { SessionTelemetry } from "../../src/session/telemetry"
import { createReceipt } from "../../src/process/types"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const emptyTools = {
  native: { count: 0, bytes: 0, tokens: 0, ids: [] as string[] },
  plugin: { count: 0, bytes: 0, tokens: 0, ids: [] as string[] },
  mcp: { count: 0, bytes: 0, tokens: 0, ids: [] as string[], servers: [] as [] },
  total: { count: 0, bytes: 0, tokens: 0 },
}

describe("session.telemetry.recordContext", () => {
  test("publishes a session.context event with composition and tool groups", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: unknown[] = []
        Bus.subscribe(SessionTelemetry.Event.Context, (e) => seen.push(e.properties))
        await SessionTelemetry.recordContext({
          sessionID: "ses_ctx",
          composition: {
            system: 1,
            text: 2,
            reasoning: 3,
            tool: 4,
            skills: 5,
            image: 6,
            images: 1,
            total: 21,
            toolArgs: 7,
            toolResults: 8,
            user: 9,
          },
        })
        expect(seen).toEqual([
          {
            sessionID: "ses_ctx",
            tokens: {
              system: 1,
              text: 2,
              reasoning: 3,
              tool: 4,
              skills: 5,
              image: 6,
              toolArgs: 7,
              toolResults: 8,
              user: 9,
            },
            images: 1,
            total: 21,
            tools: emptyTools,
            estimate: 21,
          },
        ])
      },
    })
  })

  test("measureTools groups native, plugin, and MCP definitions by origin", () => {
    const sample = tool({
      description: "Read a file",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } } }),
      execute: async () => ({ output: "", title: "", metadata: {} }),
    })
    const stats = SessionTelemetry.measureTools(
      { read: sample, atlas_graph: sample, plugin_tool: sample },
      {
        read: { source: "native" },
        atlas_graph: { source: "mcp", server: "atlas" },
        plugin_tool: { source: "plugin" },
      },
    )
    expect(stats.native.ids).toEqual(["read"])
    expect(stats.plugin.ids).toEqual(["plugin_tool"])
    expect(stats.mcp.ids).toEqual(["atlas_graph"])
    expect(stats.mcp.servers).toEqual([
      expect.objectContaining({ server: "atlas", count: 1, ids: ["atlas_graph"] }),
    ])
    expect(stats.total.count).toBe(3)
  })
})

describe("session.telemetry.recordUsage", () => {
  test("publishes provider-reported token usage", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: unknown[] = []
        Bus.subscribe(SessionTelemetry.Event.Usage, (e) => seen.push(e.properties))
        await SessionTelemetry.recordUsage({
          sessionID: "ses_u",
          tokens: {
            input: 1000,
            output: 200,
            reasoning: 50,
            cache: { read: 300, write: 0 },
          },
        })
        expect(seen).toEqual([
          {
            sessionID: "ses_u",
            tokens: {
              input: 1000,
              output: 200,
              reasoning: 50,
              cache: { read: 300, write: 0 },
            },
          },
        ])
      },
    })
  })
})

describe("session.telemetry.recordCompaction", () => {
  test("publishes a session.compaction event tagged with trigger + mechanism + reclaimed", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: unknown[] = []
        Bus.subscribe(SessionTelemetry.Event.Compaction, (e) => seen.push(e.properties))
        await SessionTelemetry.recordCompaction({
          sessionID: "ses_c",
          trigger: "proactive",
          mechanism: "prune",
          before: 152_000,
          reclaimed: 31_000,
        })
        expect(seen).toEqual([
          {
            sessionID: "ses_c",
            trigger: "proactive",
            mechanism: "prune",
            before: 152_000,
            after: 121_000,
            reclaimed: 31_000,
          },
        ])
      },
    })
  })

  test("passes an explicit `after` through unchanged (LLM summary path)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: unknown[] = []
        Bus.subscribe(SessionTelemetry.Event.Compaction, (e) => seen.push(e.properties))
        await SessionTelemetry.recordCompaction({
          sessionID: "ses_s",
          trigger: "overflow",
          mechanism: "summary",
          before: 180_000,
          after: 4_000,
          reclaimed: 176_000,
        })
        expect(seen[0]).toMatchObject({ trigger: "overflow", mechanism: "summary", before: 180_000, after: 4_000 })
      },
    })
  })
})

describe("session.telemetry.recordProcess", () => {
  test("publishes receipt metrics without command, env, or output content", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seen: unknown[] = []
        Bus.subscribe(SessionTelemetry.Event.Process, (e) => seen.push(e.properties))
        const receipt = createReceipt({
          callID: "call_process",
          sessionID: "ses_process",
          runtime: "python",
          mode: "ephemeral",
          lane: "scientific",
          status: "success",
          queuedAt: 100,
          startedAt: 110,
          endedAt: 140,
          waitMs: 10,
          runMs: 30,
          sandbox: "unavailable",
          output: { inlineBytes: 12, totalBytes: 12, truncated: false, spilled: false },
        })
        await SessionTelemetry.recordProcess(receipt)

        expect(seen).toEqual([
          {
            sessionID: "ses_process",
            callID: "call_process",
            receiptID: receipt.receiptID,
            runtime: "python",
            mode: "ephemeral",
            lane: "scientific",
            status: "success",
            waitMs: 10,
            runMs: 30,
            sandbox: "unavailable",
            output: { inlineBytes: 12, totalBytes: 12, truncated: false, spilled: false },
          },
        ])
        expect(JSON.stringify(seen)).not.toMatch(/command|args|env|secret|output content/i)
      },
    })
  })
})
