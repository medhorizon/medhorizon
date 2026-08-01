/**
 * RLM State — Type definitions and trace parser for the dual-loop architecture.
 *
 * The planner (ultra agents) emits <rlm_state> JSON blocks tracking research progress.
 * Executor output is decoded through the shared TaskResult contract (canonical JSON
 * <task_result>, legacy field-per-tag <task_result>, and legacy <rlm_result>).
 */

import { decode as decodeTaskResult, type TaskResult } from "@/tool/task-result"

export namespace RLMState {
  export interface ResearchState {
    hypothesis: string
    plan: Objective[]
    artifacts: ArtifactRef[]
    findings: Finding[]
    status: "planning" | "executing" | "synthesizing" | "complete"
  }

  export interface Objective {
    id: string
    description: string
    status: "pending" | "active" | "done" | "failed"
    dependencies: string[]
    result?: string
  }

  export interface ArtifactRef {
    id: string
    type: string
    summary: string
    path: string
  }

  export interface Finding {
    id: string
    claim: string
    evidence: string[]
    confidence: "high" | "medium" | "low"
  }

  export interface CompressedResult {
    status: "success" | "partial" | "failure"
    findings: string[]
    failures: string[]
    assumptions: string[]
    parameters: Record<string, unknown>
    artifactRefs: string[]
    suggestions: string[]
    code?: string
    message?: string
    sessionID?: string
  }

  function toCompressed(result: TaskResult): CompressedResult {
    const status =
      result.status === "success" || result.status === "partial" || result.status === "failure"
        ? result.status
        : "failure"
    const base: CompressedResult = {
      status,
      findings: result.findings,
      failures: result.failures,
      assumptions: result.assumptions,
      parameters: result.parameters,
      artifactRefs: result.artifactRefs,
      suggestions: result.suggestions,
      sessionID: result.sessionID,
    }
    if (result.status === "success") return base
    return {
      ...base,
      code: result.code,
      message: result.message,
    }
  }

  /**
   * Parse executor output into a CompressedResult via the shared TaskResult decoder.
   * Missing structure is never treated as success. Pass the authoritative child
   * session ID when available so model-supplied IDs cannot spoof ownership.
   */
  export function parseExecutorOutput(text: string, sessionID = ""): CompressedResult {
    const { result } = decodeTaskResult(text, sessionID)
    return toCompressed(result)
  }

  /** Parse <rlm_state> JSON from planner output. Returns null if not found. */
  export function parseResearchState(text: string): ResearchState | null {
    const match = text.match(/<rlm_state>([\s\S]*?)<\/rlm_state>/)
    if (!match) return null
    try {
      return JSON.parse(match[1].trim()) as ResearchState
    } catch {
      return null
    }
  }
}
