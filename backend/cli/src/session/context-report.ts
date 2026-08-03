import { SessionTelemetry } from "./telemetry"

export const ESTIMATOR_ID = "characters/4"
export const ESTIMATOR_VERSION = "1"
export const SYSTEM_TOOL_BUDGET = 8_000
export const SCHEMA_BUDGET = 5_000
export const OUTLIER_MIN_TOKENS = 500

export type CalibrationInput = {
  family: string
  model: string
  source: "provider" | "tokenizer"
  estimate: number
  actual: number
}

export type ContextReportInput = {
  agent: string
  model: { providerID: string; modelID: string }
  prompt: { bytes: number; tokens: number }
  schemas: SessionTelemetry.SchemaMeasurements
  calibration: readonly CalibrationInput[]
}

export function buildProfileReport(input: ContextReportInput) {
  const correctionFactor = SessionTelemetry.correctionFactor(input.calibration)
  const fixedTokens = input.prompt.tokens + input.schemas.tokens
  const outlierIds = input.schemas.items.filter((item) => item.tokens >= OUTLIER_MIN_TOKENS).map((item) => item.id)
  const calibrationComplete =
    new Set(input.calibration.map((sample) => sample.family)).size >= 2 &&
    input.calibration.some((sample) => sample.source === "provider")

  return {
    agent: input.agent,
    model: input.model,
    estimator: {
      id: ESTIMATOR_ID,
      version: ESTIMATOR_VERSION,
    },
    prompt: input.prompt,
    schemas: {
      ...input.schemas,
      budget_tokens: SCHEMA_BUDGET,
      within_budget: input.schemas.tokens * correctionFactor <= SCHEMA_BUDGET,
    },
    fixed_overhead: {
      estimated_tokens: fixedTokens,
      corrected_tokens: Math.ceil(fixedTokens * correctionFactor),
      budget_tokens: SYSTEM_TOOL_BUDGET,
      correction_factor: correctionFactor,
      within_budget: fixedTokens * correctionFactor <= SYSTEM_TOOL_BUDGET,
    },
    calibration: input.calibration.map((sample) => ({
      family: sample.family,
      model: sample.model,
      source: sample.source,
      estimate: sample.estimate,
      actual: sample.actual,
      absolute_error: Math.abs(sample.actual - sample.estimate),
      relative_error: sample.estimate > 0 ? Math.abs(sample.actual - sample.estimate) / sample.estimate : undefined,
    })),
    calibration_status: calibrationComplete ? "complete" : "incomplete",
    outlier_ids: outlierIds,
    baseline_only: input.agent === "research",
    editable: input.agent !== "research",
    budget_enforced: input.agent !== "research",
    owner: input.agent === "research" ? "tasks/plans/09-orchestrator-mvp.md" : undefined,
  }
}
