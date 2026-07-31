import type { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { PermissionNext } from "../permission/next"
import { Wildcard } from "../util/wildcard"

export namespace ToolSelection {
  export type Input = {
    ids: string[]
    toolset?: readonly string[]
    message?: Record<string, boolean>
    permission: PermissionNext.Ruleset
  }

  export function matches(id: string, patterns: readonly string[]) {
    return patterns.some((pattern) => Wildcard.match(id, pattern))
  }

  export function fromToolset(ids: string[], toolset?: readonly string[]) {
    if (!toolset?.length) return new Set(ids)
    return new Set(ids.filter((id) => matches(id, toolset)))
  }

  export function applyMessage(ids: Iterable<string>, message?: Record<string, boolean>) {
    const defaultExclude = message?.["*"] === false
    const result = new Set<string>()
    for (const id of ids) {
      const override = message?.[id]
      if (defaultExclude) {
        if (override === true) result.add(id)
        continue
      }
      if (override !== false) result.add(id)
    }
    return result
  }

  export function selected(input: Input) {
    const available = fromToolset(input.ids, input.toolset)
    const allowed = applyMessage(available, input.message)
    for (const id of PermissionNext.disabled([...allowed], input.permission)) allowed.delete(id)
    return allowed
  }

  export async function effectiveToolset(agent: Agent.Info) {
    const cfg = await Config.get()
    if (cfg.experimental?.tool_profiles === false) return undefined
    return agent.toolset
  }
}
