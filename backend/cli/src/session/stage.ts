import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { Snapshot } from "../snapshot"
import { MessageV2 } from "./message-v2"
import { Session } from "."
import { Log } from "../util/log"
import { fn } from "../util/fn"
import { Storage } from "../storage/storage"
import { SessionPrompt } from "./prompt"

export namespace SessionStage {
  const log = Log.create({ service: "session.stage" })


  export const Node = z
    .object({
      partID: z.string(),
      messageID: z.string(),
      name: z.string(),
      index: z.number(),
      status: z.enum(["running", "completed"]),
      snapshot: z.string().optional(),
      summary: z.string().optional(),
      diff: z
        .object({
          additions: z.number(),
          deletions: z.number(),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        completed: z.number().optional(),
      }),
    })
    .meta({ ref: "StageNode" })
  export type Node = z.infer<typeof Node>

  export const Event = {
    Updated: BusEvent.define(
      "session.stage.updated",
      z.object({
        sessionID: z.string(),
        stages: Node.array(),
      }),
    ),
  }

  /**
   * Derive the stage graph from a message stream. The stage parts ARE the state:
   * Session.fork rewrites part ids onto the new session, so anything hanging off a
   * part is inherited by a fork for free, while a separate index keyed by sessionID
   * would not be — which is why this is derived on read instead of persisted.
   */
  async function deriveStages(msgs: MessageV2.WithParts[]): Promise<Node[]> {
    const found: { part: MessageV2.StagePart; messageID: string }[] = []
    for (const msg of msgs) {
      for (const part of msg.parts) {
        if (part.type === "stage") found.push({ part, messageID: msg.info.id })
      }
    }
    // Parts are append-only, so completion is derived rather than written back onto
    // the earlier part: every stage but the last is finished by definition.
    const nodes: Node[] = found.map(({ part, messageID }, i) => ({
      partID: part.id,
      messageID,
      name: part.name,
      index: part.index,
      status: i === found.length - 1 ? part.status : ("completed" as const),
      snapshot: part.snapshot,
      summary: part.summary,
      time: part.time,
    }))

    // Compute diff for each stage: compare its snapshot with the next stage's snapshot
    for (let i = 0; i < nodes.length - 1; i++) {
      const current = nodes[i]
      const next = nodes[i + 1]
      if (current.snapshot && next.snapshot) {
        try {
          const diff = await Snapshot.diffFull(current.snapshot, next.snapshot)
          const additions = diff.reduce((sum, d) => sum + d.additions, 0)
          const deletions = diff.reduce((sum, d) => sum + d.deletions, 0)
          current.diff = { additions, deletions }
        } catch {
          // Snapshot might be gone; leave diff undefined
        }
      }
    }

    return nodes
  }

  export const list = fn(Identifier.schema("session"), async (sessionID): Promise<Node[]> => {
    return await deriveStages(await Session.messages({ sessionID }))
  })

  export async function enter(input: { sessionID: string; messageID: string; name: string; summary?: string }) {
    const existing = await list(input.sessionID)
    const snapshot = await Snapshot.track()
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: input.messageID,
      sessionID: input.sessionID,
      type: "stage",
      name: input.name,
      index: existing.length + 1,
      status: "running",
      snapshot,
      summary: input.summary,
      time: { created: Date.now() },
    })
    const stages = await list(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, stages })
    log.info("entered", { sessionID: input.sessionID, name: input.name, index: existing.length + 1 })
    return stages
  }

  export const JumpInput = z.object({
    sessionID: Identifier.schema("session"),
    partID: Identifier.schema("part").describe("Stage part to jump to"),
    restoreFiles: z
      .boolean()
      .optional()
      .describe("Restore the worktree to the stage's snapshot. The worktree is shared per directory."),
  })
  export type JumpInput = z.infer<typeof JumpInput>

  // Built on demand rather than at module scope: session/index.ts imports prompt.ts,
  // which pulls in the tool registry and therefore this module, so `Session.Info` is
  // still undefined while this file is first evaluated. Every other use of Session
  // here sits inside a function body and is unaffected.
  export const Result = () =>
    z
      .object({
        session: Session.Info,
        stage: Node,
        safetySnapshot: z.string().optional().describe("Worktree state captured before the restore; use it to recover"),
        restored: z.boolean(),
      })
      .meta({ ref: "StageJumpResult" })
  export type Result = z.infer<ReturnType<typeof Result>>

  export const jump = fn(JumpInput, async (input): Promise<Result> => {
    SessionPrompt.assertNotBusy(input.sessionID)
    const msgs = await Session.messages({ sessionID: input.sessionID })
    const stages = await deriveStages(msgs)
    const stage = stages.find((s) => s.partID === input.partID)
    // Storage.NotFoundError is what the server maps to a 404 (server.ts onError),
    // and it is the schema the route declares for that status.
    if (!stage) throw new Storage.NotFoundError({ message: `stage ${input.partID} not found in ${input.sessionID}` })

    // Undo the file changes recorded from the anchor onward, the same way
    // SessionRevert does. Snapshot.revert walks each patch's file list and deletes
    // whatever the patch's tree does not contain, so files created after this stage
    // disappear. Snapshot.restore alone would not: it is read-tree +
    // checkout-index, which writes the tree's files but leaves extras in place.
    const patches: Snapshot.Patch[] = []
    for (const msg of msgs) {
      if (msg.info.id < stage.messageID) continue
      for (const part of msg.parts) {
        if (part.type === "patch") patches.push(part)
      }
    }

    // fork stops at `msg.info.id >= messageID`, so the anchor message is itself
    // excluded and history through the PREVIOUS stage is copied verbatim. That is
    // exactly "restart from this stage carrying the earlier stages' memory".
    const session = await Session.fork({
      sessionID: input.sessionID,
      messageID: stage.messageID,
    })

    // Reverting rewrites the worktree, which is shared per directory. Capture the
    // current state first and hand the hash back so the operation is recoverable
    // via Snapshot.restore(safetySnapshot).
    let safetySnapshot: string | undefined
    let restored = false
    if (input.restoreFiles !== false && patches.length > 0) {
      safetySnapshot = await Snapshot.track()
      await Snapshot.revert(patches)
      restored = true
    }
    log.info("jumped", {
      from: input.sessionID,
      to: session.id,
      stage: stage.name,
      index: stage.index,
      restored,
      safetySnapshot,
    })
    return { session, stage, safetySnapshot, restored }
  })
}
