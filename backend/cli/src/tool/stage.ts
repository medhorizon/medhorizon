import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./stage.txt"
import { SessionStage } from "../session/stage"
import { Question } from "../question"

const GATE_APPROVE = "Continue"
const GATE_ABORT = "Stop here"

export const StageTool = Tool.define<
  z.ZodObject<{
    name: z.ZodString
    summary: z.ZodOptional<z.ZodString>
    gate: z.ZodOptional<z.ZodBoolean>
  }>,
  { aborted?: boolean; stages?: SessionStage.Node[] }
>("stage", {
  description: DESCRIPTION,
  parameters: z.object({
    name: z.string().describe("Short name of the stage being entered"),
    summary: z.string().optional().describe("What the previous stage concluded"),
    gate: z
      .boolean()
      .optional()
      .describe("Pause and wait for human approval before entering this stage (default: false)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "stage",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    if (params.gate) {
      try {
        const answers = await Question.ask({
          sessionID: ctx.sessionID,
          questions: [
            {
              question: `Ready to enter stage "${params.name}"?`,
              header: "Stage gate",
              options: [
                { label: GATE_APPROVE, description: "Proceed to this stage" },
                { label: GATE_ABORT, description: "Stop execution here" },
              ],
              multiple: false,
            },
          ],
          tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
        })

        const reply = answers[0]?.[0]
        if (reply !== GATE_APPROVE) {
          return {
            title: `Stage gate: stopped`,
            metadata: { aborted: true },
            output: `User chose not to enter stage "${params.name}". Execution stopped.`,
          }
        }
      } catch (err) {
        if (err instanceof Question.RejectedError) {
          return {
            title: `Stage gate: dismissed`,
            metadata: { aborted: true },
            output: `User dismissed the gate for stage "${params.name}". Execution stopped.`,
          }
        }
        throw err
      }
    }

    const stages = await SessionStage.enter({
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      name: params.name,
      summary: params.summary,
    })
    const current = stages.at(-1)!
    return {
      title: `Stage ${current.index}: ${current.name}`,
      metadata: {
        aborted: false,
        stages,
      },
      output: [
        `Entered stage ${current.index} "${current.name}".`,
        params.gate ? "User approved entry." : "",
        "",
        ...stages.map((s) => `${s.index}. ${s.name} [${s.status}]`),
      ]
        .filter(Boolean)
        .join("\n"),
    }
  },
})
