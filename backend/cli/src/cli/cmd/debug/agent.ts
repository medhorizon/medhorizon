import { EOL } from "os"
import { basename } from "path"
import { Agent } from "../../../agent/agent"
import { Provider } from "../../../provider/provider"
import { Session } from "../../../session"
import type { MessageV2 } from "../../../session/message-v2"
import { Identifier } from "../../../id/id"
import { ToolRegistry } from "../../../tool/registry"
import { ToolSelection } from "../../../tool/selection"
import { Instance } from "../../../project/instance"
import { PermissionNext } from "../../../permission/next"
import { iife } from "../../../util/iife"
import { Token } from "../../../util/token"
import { SessionTelemetry } from "../../../session/telemetry"
import { SystemPrompt } from "../../../session/system"
import { ProviderTransform } from "../../../provider/transform"
import { buildProfileReport, type CalibrationInput } from "../../../session/context-report"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"
import z from "zod"

export const AgentCommand = cmd({
  command: "agent [name]",
  describe: "show agent configuration details",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        description: "Agent name",
      })
      .option("all", {
        type: "boolean",
        default: false,
        description: "Include every shipped native agent",
      })
      .option("context-report", {
        type: "boolean",
        default: false,
        description: "Emit a non-sensitive context and schema report (requires --all)",
      })
      .option("calibration", {
        type: "string",
        description: "Calibration samples as a JSON array with family, model, source, estimate, and actual",
      })
      .option("tool", {
        type: "string",
        description: "Tool id to execute",
      })
      .option("params", {
        type: "string",
        description: "Tool params as JSON or a JS object literal",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      const agentName = args.name as string | undefined
      const all = args.all === true
      const contextReport = args["context-report"] === true
      if (all || contextReport) {
        if (!all || !contextReport) {
          process.stderr.write("Use --all together with --context-report to emit the aggregate report" + EOL)
          process.exit(1)
        }
        const calibration = parseCalibration(args.calibration as string | undefined)
        const report = await buildContextReport(calibration)
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      if (!agentName) {
        process.stderr.write("Agent name is required unless --all --context-report is used" + EOL)
        process.exit(1)
      }
      const agent = await Agent.get(agentName)
      if (!agent) {
        process.stderr.write(
          `Agent ${agentName} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
        )
        process.exit(1)
      }
      const availableTools = await getAvailableTools(agent)
      const resolvedTools = await resolveTools(agent, availableTools)
      const toolID = args.tool as string | undefined
      if (toolID) {
        const tool = availableTools.find((item) => item.id === toolID)
        if (!tool) {
          process.stderr.write(`Tool ${toolID} not found for agent ${agentName}` + EOL)
          process.exit(1)
        }
        if (resolvedTools[toolID] === false) {
          process.stderr.write(`Tool ${toolID} is disabled for agent ${agentName}` + EOL)
          process.exit(1)
        }
        const params = parseToolParams(args.params as string | undefined)
        const ctx = await createToolContext(agent)
        const result = await tool.execute(params, ctx)
        process.stdout.write(JSON.stringify({ tool: toolID, input: params, result }, null, 2) + EOL)
        return
      }

      const output = {
        ...agent,
        tools: resolvedTools,
      }
      process.stdout.write(JSON.stringify(output, null, 2) + EOL)
    })
  },
})

async function getAvailableTools(agent: Agent.Info) {
  const model = agent.model ?? (await Provider.defaultModel())
  return getAvailableToolsForModel(agent, modelRef(model))
}

async function getAvailableToolsForModel(agent: Agent.Info, model: { providerID: string; modelID: string }) {
  const toolset = await ToolSelection.effectiveToolset(agent)
  const permission = agent.permission
  const selected = ToolSelection.selected({
    ids: await ToolRegistry.ids(model, agent),
    toolset,
    permission,
  })
  return ToolRegistry.tools(model, agent, selected)
}

async function buildContextReport(calibration: readonly CalibrationInput[]) {
  const agents = (await Agent.list())
    .filter((agent) => agent.native === true)
    .sort((a, b) => a.name.localeCompare(b.name))
  const defaultModel = await Provider.defaultModel()
  const fallbackRef = modelRef(defaultModel)
  const fallback = await Provider.getModel(fallbackRef.providerID, fallbackRef.modelID)
  const profiles = await Promise.all(
    agents.map(async (agent) => {
      const model = agent.model ? await Provider.getModel(agent.model.providerID, agent.model.modelID) : fallback
      const tools = await getAvailableToolsForModel(agent, { providerID: model.providerID, modelID: model.id })
      const definitions = tools.map((tool) => ({
        id: tool.id,
        description: tool.description,
        schema: ProviderTransform.schema(model, z.toJSONSchema(tool.parameters)),
      }))
      const schemas = SessionTelemetry.measureSchemas(definitions)
      const system = [
        ...(agent.prompt ? [agent.prompt] : SystemPrompt.provider(model)),
        ...(await SystemPrompt.planModeInstructions()),
        ...SystemPrompt.slashSkillDirective(),
      ].join("\n")
      return buildProfileReport({
        agent: agent.name,
        model: { providerID: model.providerID, modelID: model.id },
        prompt: {
          bytes: Buffer.byteLength(system),
          tokens: Token.estimate(system),
        },
        schemas,
        calibration,
      })
    }),
  )
  const nonLegacyIds = new Set(
    profiles
      .filter((profile) => !profile.baseline_only)
      .flatMap((profile) => profile.schemas.items.map((item) => item.id)),
  )
  const editAllowlist = profiles
    .filter((profile) => !profile.baseline_only)
    .flatMap((profile) => profile.outlier_ids)
    .filter((id, index, ids) => nonLegacyIds.has(id) && ids.indexOf(id) === index)
    .sort()
  const calibrationComplete =
    new Set(calibration.map((sample) => sample.family)).size >= 2 &&
    calibration.some((sample) => sample.source === "provider")

  return {
    report_version: 1,
    generated_at: new Date().toISOString(),
    command: "openscience debug agent --all --context-report",
    budgets: {
      fixed_overhead_tokens: 8_000,
      schema_tokens: 5_000,
    },
    estimator: {
      id: "characters/4",
      version: "1",
      correction_factor: SessionTelemetry.correctionFactor(calibration),
    },
    calibration,
    calibration_status: calibrationComplete ? "complete" : "incomplete",
    profiles,
    edit_allowlist: calibrationComplete ? editAllowlist : [],
  }
}

function modelRef(model: { providerID: string; modelID?: string; id?: string }) {
  const id = model.modelID ?? model.id
  if (!id) throw new Error(`Model ${model.providerID} has no id`)
  return { providerID: model.providerID, modelID: id }
}

async function resolveTools(agent: Agent.Info, availableTools: Awaited<ReturnType<typeof getAvailableTools>>) {
  const disabled = PermissionNext.disabled(
    availableTools.map((tool) => tool.id),
    agent.permission,
  )
  const resolved: Record<string, boolean> = {}
  for (const tool of availableTools) {
    resolved[tool.id] = !disabled.has(tool.id)
  }
  return resolved
}

function parseToolParams(input?: string) {
  if (!input) return {}
  const trimmed = input.trim()
  if (trimmed.length === 0) return {}

  const parsed = iife(() => {
    try {
      return JSON.parse(trimmed)
    } catch (jsonError) {
      try {
        return new Function(`return (${trimmed})`)()
      } catch (evalError) {
        throw new Error(
          `Failed to parse --params. Use JSON or a JS object literal. JSON error: ${jsonError}. Eval error: ${evalError}.`,
        )
      }
    }
  })

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool params must be an object.")
  }
  return parsed as Record<string, unknown>
}

function parseCalibration(input?: string): CalibrationInput[] {
  if (!input) return []
  const parsed = iife(() => {
    try {
      return JSON.parse(input)
    } catch (error) {
      throw new Error(`Failed to parse --calibration JSON: ${error}`)
    }
  })
  return z
    .array(
      z.object({
        family: z.string().min(1),
        model: z.string().min(1),
        source: z.enum(["provider", "tokenizer"]),
        estimate: z.number().positive(),
        actual: z.number().positive(),
      }),
    )
    .parse(parsed)
}

async function createToolContext(agent: Agent.Info) {
  const session = await Session.create({ title: `Debug tool run (${agent.name})` })
  const messageID = Identifier.ascending("message")
  const model = agent.model ?? (await Provider.defaultModel())
  const now = Date.now()
  const message: MessageV2.Assistant = {
    id: messageID,
    sessionID: session.id,
    role: "assistant",
    time: {
      created: now,
    },
    parentID: messageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "debug",
    agent: agent.name,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  }
  await Session.updateMessage(message)

  const ruleset = PermissionNext.merge(agent.permission, session.permission ?? [])

  return {
    sessionID: session.id,
    messageID,
    callID: Identifier.ascending("part"),
    agent: agent.name,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    async ask(req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) {
      for (const pattern of req.patterns) {
        const rule = PermissionNext.evaluate(req.permission, pattern, ruleset)
        if (rule.action === "deny") {
          throw new PermissionNext.DeniedError(ruleset)
        }
      }
    },
  }
}
