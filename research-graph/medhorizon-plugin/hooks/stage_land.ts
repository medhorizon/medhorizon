import { rgFetch, ResearchGraphUnavailable } from "../atlas_bridge"

type StageNode = {
  partID?: string
  messageID?: string
  name?: string
  index?: number
  status?: string
  summary?: string
}

type AfterInput = { tool: string; sessionID: string; callID: string }
type AfterOutput = { title: string; output: string; metadata: Record<string, unknown> }

/** Auto-land Research Graph nodes when MedHorizon `stage` tool succeeds (no core edits). */
export async function onStageExecuteAfter(input: AfterInput, output: AfterOutput, directory?: string) {
  if (input.tool !== "stage") return
  if (output.metadata?.aborted) return
  const stages = output.metadata?.stages as StageNode[] | undefined
  if (!Array.isArray(stages) || stages.length === 0) return
  const current = stages[stages.length - 1]
  if (!current?.name) return

  const part = current.partID || ""
  const key = part
    ? `stage-land:${input.sessionID}:${part}`
    : `stage-land:${input.sessionID}:${current.index ?? "x"}:${current.name.toLowerCase()}`

  try {
    await rgFetch("/api/stages/land", {
      method: "POST",
      body: JSON.stringify({
        session_id: input.sessionID,
        message_id: current.messageID,
        directory: directory || undefined,
        stage: {
          name: current.name,
          index: current.index,
          part_id: current.partID,
          status: current.status,
          summary: current.summary,
          gated: false,
        },
        idempotency_key: key,
        reason: "plugin.tool.execute.after:stage",
      }),
    })
  } catch (err) {
    if (err instanceof ResearchGraphUnavailable) return
    // Swallow — never break the MedHorizon stage tool path.
  }
}

export const STAGE_SYSTEM_HINT = [
  "Research Graph stage landing (plugin protocol):",
  "When you call the MedHorizon `stage` tool to enter a research/experiment/GEPA phase,",
  "a plugin hook auto-creates a matching Research Graph node (meta.medhorizon_stage + directory).",
  "Users can open the session or branch from that node in the Research Graph UI.",
  "If landing failed, call `atlas_stage` action=land with stage name/index/part_id.",
  "Do not invent a second stage timeline — MedHorizon StagesPanel remains canonical.",
].join(" ")
