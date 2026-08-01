import { afterEach, describe, expect, test, mock } from "bun:test"

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => {
      const at = pkg.lastIndexOf("@")
      return at > 0 ? pkg.substring(0, at) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))
const mockPlugin = () => ({})
mock.module("openscience-copilot-auth", () => ({ default: mockPlugin }))
mock.module("openscience-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/openscience-gitlab-auth", () => ({ default: mockPlugin }))

import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { TaskTool } from "../../src/tool/task"
import { ArtifactTool } from "../../src/tool/artifact"
import { RLMArtifacts } from "../../src/session/rlm/artifacts"
import { decode, encode, failure, resetTelemetry, telemetry, TaskResultCode } from "../../src/tool/task-result"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "../../src/tool/tool"

type Reply = string | (() => string)

const servers: Array<ReturnType<typeof Bun.serve>> = []

afterEach(() => {
  for (const server of servers) server.stop(true)
  servers.length = 0
  resetTelemetry()
})

function sseCompletion(content: string) {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 1,
      model: "task-test",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
  const body = chunk({ role: "assistant", content }) + chunk({}, "stop") + "data: [DONE]\n\n"
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}

function localServer(reply: Reply) {
  const seen: string[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [{ id: "task-test", object: "model" }] })
      }
      if (req.method === "POST") {
        const body = (await req.text().catch(() => "")) as string
        seen.push(body)
        const content = typeof reply === "function" ? reply() : reply
        return sseCompletion(content)
      }
      return new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/v1`, seen }
}

async function writeConfig(dir: string, baseURL: string) {
  await Bun.write(
    path.join(dir, "openscience.json"),
    JSON.stringify({
      $schema: "https://syntheticsciences.ai/config.json",
      model: "tasklocal/task-test",
      provider: {
        tasklocal: {
          name: "Task Local",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            "task-test": {
              name: "Task Test",
              tool_call: false,
              limit: { context: 8000, output: 2000 },
            },
          },
          options: {
            baseURL,
            apiKey: "local-test-key",
          },
        },
      },
      permission: {
        "*": "allow",
        task: { "*": "allow" },
      },
    }),
  )
}

async function parentAssistant(agent = "research") {
  const session = await Session.create({})
  const user = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "user",
    sessionID: session.id,
    agent,
    model: { providerID: "tasklocal", modelID: "task-test" },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: user.id,
    sessionID: session.id,
    type: "text",
    text: "parent prompt",
  })
  const assistant = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    sessionID: session.id,
    parentID: user.id,
    mode: agent,
    agent,
    path: { cwd: Instance.directory, root: Instance.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "task-test",
    providerID: "tasklocal",
    time: { created: Date.now() },
  })
  return { session, assistant }
}

function ctx(input: {
  sessionID: string
  messageID: string
  agent: string
  abort?: AbortSignal
  extra?: Record<string, unknown>
}): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
    abort: input.abort ?? new AbortController().signal,
    messages: [],
    extra: { bypassAgentCheck: true, ...input.extra },
    metadata() {},
    async ask() {},
  }
}

const successBody = (findings: string[], artifactRefs: string[] = []) =>
  `<task_result>${JSON.stringify({
    status: "success",
    findings,
    failures: [],
    assumptions: [],
    artifactRefs,
    suggestions: [],
    parameters: {},
  })}</task_result>`

describe("tool.task TaskResult contract", () => {
  test("every parent agent receives the same discriminated result envelope", async () => {
    const srv = localServer(successBody(["ok"]))
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const parent of ["research", "biology", "explore"]) {
          const { session, assistant } = await parentAssistant(parent)
          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              description: "Same shape",
              prompt: "Return a structured success result",
              subagent_type: "explore",
            },
            ctx({ sessionID: session.id, messageID: assistant.id, agent: parent }),
          )
          expect(result.output).toContain("<task_result>")
          expect(result.output).toContain("<task_metadata>")
          const parsed = decode(result.output, result.metadata.sessionId as string).result
          expect(parsed.status).toBe("success")
          expect(parsed.sessionID).toBe(result.metadata.sessionId)
          expect(result.metadata.taskResult).toMatchObject({ status: "success", findings: ["ok"] })
        }
      },
    })
  })

  test("failure envelope retains stable code/message and child session ID", async () => {
    const srv = localServer(
      `<task_result>${JSON.stringify({
        status: "failure",
        code: "worker_failed",
        message: "compute exploded",
        findings: [],
        failures: ["oom"],
        assumptions: [],
        artifactRefs: [],
        suggestions: [],
        parameters: {},
      })}</task_result>`,
    )
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Fail case",
            prompt: "fail please",
            subagent_type: "explore",
          },
          ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
        )
        const parsed = result.metadata.taskResult as { status: string; code: string; message: string; sessionID: string }
        expect(parsed.status).toBe("failure")
        expect(parsed.code).toBe("worker_failed")
        expect(parsed.message).toBe("compute exploded")
        expect(parsed.sessionID).toBe(result.metadata.sessionId)
        expect(parsed.sessionID).toMatch(/^ses/)
      },
    })
  })

  test("AbortController cancellation is terminal and overrides late success text", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const srv = localServer(() => {
      // Unblock after abort is signaled from the test.
      release()
      return successBody(["should-not-win"])
    })
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const controller = new AbortController()
        const pending = tool.execute(
          {
            description: "Cancel race",
            prompt: "slow worker",
            subagent_type: "explore",
          },
          ctx({
            sessionID: session.id,
            messageID: assistant.id,
            agent: "research",
            abort: controller.signal,
          }),
        )
        // Abort immediately; worker text claiming success must not win.
        controller.abort()
        await gate.catch(() => {})
        const result = await pending
        const parsed = result.metadata.taskResult as { status: string; code: string }
        expect(parsed.status).toBe("cancelled")
        expect(parsed.code).toBe(TaskResultCode.cancelled)
      },
    })
  })

  test("injected timeout terminal cause is distinct from cancellation", async () => {
    const srv = localServer(successBody(["late-success"]))
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Timeout case",
            prompt: "would succeed",
            subagent_type: "explore",
          },
          ctx({
            sessionID: session.id,
            messageID: assistant.id,
            agent: "research",
            extra: { terminalCause: "timeout" },
          }),
        )
        const parsed = result.metadata.taskResult as { status: string; code: string }
        expect(parsed.status).toBe("timeout")
        expect(parsed.code).toBe(TaskResultCode.timeout)
      },
    })
  })

  test("session ID mismatch produces sanitized diagnostic while returning real child ID", async () => {
    const srv = localServer(
      `<task_result>${JSON.stringify({
        status: "success",
        findings: ["x"],
        failures: [],
        assumptions: [],
        artifactRefs: [],
        suggestions: [],
        parameters: {},
        sessionID: "ses_spoofed_model",
      })}</task_result>`,
    )
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Spoof guard",
            prompt: "spoof session",
            subagent_type: "explore",
          },
          ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
        )
        const parsed = result.metadata.taskResult as { sessionID: string; status: string }
        expect(parsed.status).toBe("success")
        expect(parsed.sessionID).toBe(result.metadata.sessionId)
        expect(parsed.sessionID).not.toBe("ses_spoofed_model")
      },
    })
  })

  test("artifact registration for research/biology/ml survives TaskTool boundary", async () => {
    for (const child of ["research", "biology", "ml"]) {
      resetTelemetry()
      let artifactID = ""
      const srv = localServer(() =>
        successBody(["artifact-ok"], artifactID ? [artifactID] : []),
      )
      await using tmp = await tmpdir({
        init: (dir) => writeConfig(dir, srv.url),
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { session, assistant } = await parentAssistant("research")
          // Pre-create child session, register a real artifact, then continue it.
          const childSession = await Session.create({
            parentID: session.id,
            title: `artifact child ${child}`,
          })
          const artifactTool = await ArtifactTool.init({
            agent: { name: child } as never,
          })
          const registered = await artifactTool.execute(
            {
              action: "register",
              type: "analysis",
              content: `payload-for-${child}`,
              summary: `${child} artifact`,
            },
            {
              sessionID: childSession.id,
              messageID: assistant.id,
              agent: child,
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
            },
          )
          artifactID = registered.metadata.id as string
          expect(artifactID).toBeTruthy()

          const stored = await RLMArtifacts.resolve(childSession.id, artifactID)
          expect(stored).toBe(`payload-for-${child}`)

          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              description: "Artifact roundtrip",
              prompt: "return artifact ref",
              subagent_type: child,
              session_id: childSession.id,
            },
            ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
          )

          const parsed = result.metadata.taskResult as {
            status: string
            artifactRefs: string[]
            sessionID: string
          }
          expect(parsed.status).toBe("success")
          expect(parsed.sessionID).toBe(childSession.id)
          expect(parsed.artifactRefs).toContain(artifactID)
          const again = await RLMArtifacts.resolve(parsed.sessionID, artifactID)
          expect(again).toBe(`payload-for-${child}`)
        },
      })
    }
  })

  test("legacy rlm_result worker remains readable after canonical instruction injection", async () => {
    const srv = localServer(
      `<rlm_result><status>success</status><findings>["legacy-worker"]</findings><failures>[]</failures><assumptions>[]</assumptions><parameters>{}</parameters><artifact_refs>[]</artifact_refs><suggestions>[]</suggestions></rlm_result>`,
    )
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Legacy worker",
            prompt: "emit rlm_result",
            subagent_type: "explore",
          },
          ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
        )
        // Canonical instruction was injected into the child request body.
        expect(srv.seen.some((body) => body.includes("task_return_contract"))).toBe(true)
        const parsed = result.metadata.taskResult as { status: string; findings: string[] }
        expect(parsed.status).toBe("success")
        expect(parsed.findings).toEqual(["legacy-worker"])
        expect(telemetry().legacyRlm).toBeGreaterThanOrEqual(1)
      },
    })
  })

  test("legacy encoder rollback remains consumable end-to-end", async () => {
    const original = failure("ses_rollback", TaskResultCode.execution_error, "rolled", {
      findings: ["keep"],
      artifactRefs: ["art-r"],
    })
    const wire = encode(original, { legacy: true })
    const srv = localServer(wire)
    await using tmp = await tmpdir({
      init: (dir) => writeConfig(dir, srv.url),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { session, assistant } = await parentAssistant("research")
        const tool = await TaskTool.init()
        const result = await tool.execute(
          {
            description: "Rollback encode",
            prompt: "legacy tags",
            subagent_type: "explore",
          },
          ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
        )
        const parsed = result.metadata.taskResult as {
          status: string
          code: string
          findings: string[]
          artifactRefs: string[]
        }
        expect(parsed.status).toBe("failure")
        expect(parsed.code).toBe(TaskResultCode.execution_error)
        expect(parsed.findings).toEqual(["keep"])
        expect(parsed.artifactRefs).toEqual(["art-r"])
      },
    })
  })

  test("unstructured and empty worker outputs never become success", async () => {
    for (const [reply, status, code] of [
      ["free form answer with no envelope", "partial", TaskResultCode.unstructured_result],
      ["   ", "failure", TaskResultCode.empty_result],
    ] as const) {
      const srv = localServer(reply)
      await using tmp = await tmpdir({
        init: (dir) => writeConfig(dir, srv.url),
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { session, assistant } = await parentAssistant("research")
          const tool = await TaskTool.init()
          const result = await tool.execute(
            {
              description: "No success",
              prompt: "reply freely",
              subagent_type: "explore",
            },
            ctx({ sessionID: session.id, messageID: assistant.id, agent: "research" }),
          )
          const parsed = result.metadata.taskResult as { status: string; code?: string }
          expect(parsed.status).toBe(status)
          expect(parsed.code).toBe(code)
          expect(parsed.status).not.toBe("success")
        },
      })
    }
  })
})
