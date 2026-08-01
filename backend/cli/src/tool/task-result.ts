/**
 * TaskResult — canonical Zod contract for TaskTool child outcomes.
 *
 * Strict-success rule: only a fully schema-valid envelope may become `success`.
 * Partial vs failure is mechanical (parseability + recoverable evidence), never
 * based on guessed severity. See tasks/plans/01-task-result-contract.md.
 */

import z from "zod"
import { Log } from "@/util/log"

const log = Log.create({ service: "task-result" })

export const TaskResultCode = {
  unstructured_result: "unstructured_result",
  empty_result: "empty_result",
  invalid_result: "invalid_result",
  malformed_result: "malformed_result",
  ambiguous_result: "ambiguous_result",
  cancelled: "cancelled",
  timeout: "timeout",
  execution_error: "execution_error",
} as const

export type TaskResultCode = (typeof TaskResultCode)[keyof typeof TaskResultCode]

const Arrays = {
  findings: z.array(z.string()),
  failures: z.array(z.string()),
  assumptions: z.array(z.string()),
  artifactRefs: z.array(z.string()),
  suggestions: z.array(z.string()),
}

const Base = z.object({
  findings: Arrays.findings,
  failures: Arrays.failures,
  assumptions: Arrays.assumptions,
  artifactRefs: Arrays.artifactRefs,
  suggestions: Arrays.suggestions,
  parameters: z.record(z.string(), z.unknown()),
  sessionID: z.string(),
})

const FailureLike = Base.extend({
  code: z.string().min(1),
  message: z.string().min(1),
})

/**
 * Discriminated union over terminal child statuses.
 *
 * - success: only from a fully schema-valid envelope declaring success
 * - partial: recoverable evidence with a stable code (unstructured / invalid / ambiguous)
 * - failure: empty, malformed, or declared failure
 * - cancelled / timeout: control-flow terminals owned by TaskTool
 */
export const TaskResultSchema = z
  .discriminatedUnion("status", [
    Base.extend({
      status: z.literal("success"),
    }).describe("Fully schema-valid success envelope only; never inferred from free text"),
    FailureLike.extend({
      status: z.literal("partial"),
    }).describe(
      "Parseable-but-invalid with recoverable evidence, unstructured prose, or same-priority ambiguity",
    ),
    FailureLike.extend({
      status: z.literal("failure"),
    }).describe("Empty output, unrecoverable malformed envelope, or declared failure"),
    FailureLike.extend({
      status: z.literal("cancelled"),
    }).describe("TaskTool observed cancellation; overrides late worker text"),
    FailureLike.extend({
      status: z.literal("timeout"),
    }).describe("TaskTool observed timeout; overrides late worker text"),
  ])
  .describe(
    "TaskResult contract. Strict-success: only a fully valid envelope may be success. " +
      "partial vs failure uses the parseability + recoverable-evidence matrix.",
  )

export type TaskResult = z.infer<typeof TaskResultSchema>

export type DecodeDiagnostic = {
  kind: "session_id_mismatch" | "ignored_envelope" | "duplicate_envelope" | "legacy_format"
  /** Sanitized machine-readable detail — never raw model prose. */
  detail: string
}

export type DecodeOutput = {
  result: TaskResult
  diagnostics: DecodeDiagnostic[]
}

type Format = "canonical_json" | "legacy_tags" | "rlm_result"

type Envelope = {
  format: Format
  priority: number
  raw: string
  body: string
}

type Draft = {
  status?: string
  code?: string
  message?: string
  findings?: string[]
  failures?: string[]
  assumptions?: string[]
  artifactRefs?: string[]
  suggestions?: string[]
  parameters?: Record<string, unknown>
  sessionID?: string
  recoverable: boolean
  parseError?: string
}

const PRIORITY: Record<Format, number> = {
  canonical_json: 3,
  legacy_tags: 2,
  rlm_result: 1,
}

const stats = {
  canonical: 0,
  legacyTags: 0,
  legacyRlm: 0,
  unstructured: 0,
}

/** Preferred worker return-contract instruction injected at the TaskTool→child boundary. */
export const TASK_RESULT_INSTRUCTION = [
  "<task_return_contract>",
  "Preferred final message: emit exactly one canonical JSON object inside a <task_result> block.",
  "Do not omit the block when work finishes. Dual-read still accepts legacy <rlm_result> and field-per-tag <task_result> during migration.",
  "Schema keys: status (success|partial|failure), code, message, findings, failures, assumptions, artifactRefs, suggestions, parameters.",
  "Only a fully valid structured result may use status=success. Never silently skip failures, cancellations, or missing evidence.",
  "Example:",
  '<task_result>{"status":"success","findings":["..."],"failures":[],"assumptions":[],"artifactRefs":[],"suggestions":[],"parameters":{}}</task_result>',
  "</task_return_contract>",
].join("\n")

export function emptyArrays() {
  return {
    findings: [] as string[],
    failures: [] as string[],
    assumptions: [] as string[],
    artifactRefs: [] as string[],
    suggestions: [] as string[],
    parameters: {} as Record<string, unknown>,
  }
}

function normalizeArrays(input?: {
  findings?: string[]
  failures?: string[]
  assumptions?: string[]
  artifactRefs?: string[]
  suggestions?: string[]
  parameters?: Record<string, unknown>
}) {
  return {
    findings: input?.findings ?? [],
    failures: input?.failures ?? [],
    assumptions: input?.assumptions ?? [],
    artifactRefs: input?.artifactRefs ?? [],
    suggestions: input?.suggestions ?? [],
    parameters: input?.parameters ?? {},
  }
}

export function success(
  sessionID: string,
  fields?: {
    findings?: string[]
    failures?: string[]
    assumptions?: string[]
    artifactRefs?: string[]
    suggestions?: string[]
    parameters?: Record<string, unknown>
  },
): TaskResult {
  return TaskResultSchema.parse({
    status: "success",
    sessionID,
    ...normalizeArrays(fields),
  })
}

export function partial(
  sessionID: string,
  code: string,
  message: string,
  fields?: {
    findings?: string[]
    failures?: string[]
    assumptions?: string[]
    artifactRefs?: string[]
    suggestions?: string[]
    parameters?: Record<string, unknown>
  },
): TaskResult {
  return TaskResultSchema.parse({
    status: "partial",
    code,
    message,
    sessionID,
    ...normalizeArrays(fields),
  })
}

export function failure(
  sessionID: string,
  code: string,
  message: string,
  fields?: {
    findings?: string[]
    failures?: string[]
    assumptions?: string[]
    artifactRefs?: string[]
    suggestions?: string[]
    parameters?: Record<string, unknown>
  },
): TaskResult {
  return TaskResultSchema.parse({
    status: "failure",
    code,
    message,
    sessionID,
    ...normalizeArrays(fields),
  })
}

export function cancelled(
  sessionID: string,
  message = "Task was cancelled",
  fields?: {
    findings?: string[]
    failures?: string[]
    assumptions?: string[]
    artifactRefs?: string[]
    suggestions?: string[]
    parameters?: Record<string, unknown>
  },
): TaskResult {
  return TaskResultSchema.parse({
    status: "cancelled",
    code: TaskResultCode.cancelled,
    message,
    sessionID,
    ...normalizeArrays(fields),
  })
}

export function timeout(
  sessionID: string,
  message = "Task timed out",
  fields?: {
    findings?: string[]
    failures?: string[]
    assumptions?: string[]
    artifactRefs?: string[]
    suggestions?: string[]
    parameters?: Record<string, unknown>
  },
): TaskResult {
  return TaskResultSchema.parse({
    status: "timeout",
    code: TaskResultCode.timeout,
    message,
    sessionID,
    ...normalizeArrays(fields),
  })
}

/** Deterministic canonical JSON serialization (stable key order). */
export function serialize(result: TaskResult): string {
  const parsed = TaskResultSchema.parse(result)
  const payload: Record<string, unknown> = {
    status: parsed.status,
    findings: parsed.findings,
    failures: parsed.failures,
    assumptions: parsed.assumptions,
    artifactRefs: parsed.artifactRefs,
    suggestions: parsed.suggestions,
    parameters: parsed.parameters,
    sessionID: parsed.sessionID,
  }
  if (parsed.status !== "success") {
    payload.code = parsed.code
    payload.message = parsed.message
  }
  return JSON.stringify(payload)
}

/** Encode as the wire form parents consume. */
export function encode(result: TaskResult, opts?: { legacy?: boolean }): string {
  const parsed = TaskResultSchema.parse(result)
  const body = opts?.legacy ? encodeLegacyBody(parsed) : serialize(parsed)
  return [
    "<task_result>",
    body,
    "</task_result>",
    "",
    "<task_metadata>",
    `session_id: ${parsed.sessionID}`,
    "</task_metadata>",
  ].join("\n")
}

function encodeLegacyBody(result: TaskResult): string {
  const lines = [
    `<status>${result.status}</status>`,
    `<findings>${JSON.stringify(result.findings)}</findings>`,
    `<failures>${JSON.stringify(result.failures)}</failures>`,
    `<assumptions>${JSON.stringify(result.assumptions)}</assumptions>`,
    `<parameters>${JSON.stringify(result.parameters)}</parameters>`,
    `<artifact_refs>${JSON.stringify(result.artifactRefs)}</artifact_refs>`,
    `<suggestions>${JSON.stringify(result.suggestions)}</suggestions>`,
  ]
  if (result.status !== "success") {
    lines.splice(1, 0, `<code>${result.code}</code>`, `<message>${escapeXml(result.message)}</message>`)
  }
  return lines.join("\n")
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function telemetry() {
  return { ...stats }
}

export function resetTelemetry() {
  stats.canonical = 0
  stats.legacyTags = 0
  stats.legacyRlm = 0
  stats.unstructured = 0
}

function collectEnvelopes(text: string): Envelope[] {
  const found: Envelope[] = []
  const taskRe = /<task_result>([\s\S]*?)<\/task_result>/gi
  for (const match of text.matchAll(taskRe)) {
    const body = match[1] ?? ""
    const trimmed = body.trim()
    const format: Format = looksLikeJsonObject(trimmed) ? "canonical_json" : "legacy_tags"
    found.push({
      format,
      priority: PRIORITY[format],
      raw: match[0],
      body: trimmed,
    })
  }
  const rlmRe = /<rlm_result>([\s\S]*?)<\/rlm_result>/gi
  for (const match of text.matchAll(rlmRe)) {
    found.push({
      format: "rlm_result",
      priority: PRIORITY.rlm_result,
      raw: match[0],
      body: (match[1] ?? "").trim(),
    })
  }
  return found
}

function looksLikeJsonObject(body: string) {
  return body.startsWith("{") && body.endsWith("}")
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String)
      return [String(parsed)]
    } catch {
      return [trimmed]
    }
  }
  return [String(raw)]
}

function parseParameters(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))
  return match?.[1]?.trim() ?? ""
}

function draftFromTags(body: string): Draft {
  const status = extractTag(body, "status")
  const code = extractTag(body, "code")
  const message = extractTag(body, "message")
  const findings = parseStringArray(extractTag(body, "findings"))
  const failures = parseStringArray(extractTag(body, "failures"))
  const assumptions = parseStringArray(extractTag(body, "assumptions"))
  const artifactRefs = parseStringArray(extractTag(body, "artifact_refs") || extractTag(body, "artifactRefs"))
  const suggestions = parseStringArray(extractTag(body, "suggestions"))
  const parameters = parseParameters(extractTag(body, "parameters"))
  const sessionID = extractTag(body, "sessionID") || extractTag(body, "session_id") || undefined

  const recoverable = Boolean(
    status ||
      code ||
      message ||
      (findings && findings.length) ||
      (failures && failures.length) ||
      (assumptions && assumptions.length) ||
      (artifactRefs && artifactRefs.length) ||
      (suggestions && suggestions.length) ||
      (parameters && Object.keys(parameters).length),
  )

  return {
    status: status || undefined,
    code: code || undefined,
    message: message || undefined,
    findings,
    failures,
    assumptions,
    artifactRefs,
    suggestions,
    parameters,
    sessionID,
    recoverable,
  }
}

function draftFromJson(body: string): Draft {
  try {
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { recoverable: false, parseError: "json_not_object" }
    }
    const obj = parsed as Record<string, unknown>
    const findings = parseStringArray(obj.findings)
    const failures = parseStringArray(obj.failures)
    const assumptions = parseStringArray(obj.assumptions)
    const artifactRefs = parseStringArray(obj.artifactRefs ?? obj.artifact_refs)
    const suggestions = parseStringArray(obj.suggestions)
    const parameters = parseParameters(obj.parameters)
    const status = typeof obj.status === "string" ? obj.status : undefined
    const code = typeof obj.code === "string" ? obj.code : undefined
    const message = typeof obj.message === "string" ? obj.message : undefined
    const sessionID =
      typeof obj.sessionID === "string" ? obj.sessionID : typeof obj.session_id === "string" ? obj.session_id : undefined

    // Wrong field types for arrays → treat as schema-invalid but still mark recoverable if any field present
    const arrayOk = (key: string, value: unknown) => value === undefined || Array.isArray(value) || typeof value === "string"
    const typesOk =
      arrayOk("findings", obj.findings) &&
      arrayOk("failures", obj.failures) &&
      arrayOk("assumptions", obj.assumptions) &&
      arrayOk("artifactRefs", obj.artifactRefs ?? obj.artifact_refs) &&
      arrayOk("suggestions", obj.suggestions) &&
      (obj.parameters === undefined ||
        (typeof obj.parameters === "object" && obj.parameters !== null) ||
        typeof obj.parameters === "string")

    const recoverable = Boolean(
      status ||
        code ||
        message ||
        (findings && findings.length) ||
        (failures && failures.length) ||
        (assumptions && assumptions.length) ||
        (artifactRefs && artifactRefs.length) ||
        (suggestions && suggestions.length) ||
        (parameters && Object.keys(parameters).length),
    )

    return {
      status,
      code,
      message,
      findings: typesOk ? findings : findings,
      failures: typesOk ? failures : failures,
      assumptions,
      artifactRefs,
      suggestions,
      parameters: typesOk ? parameters : parameters,
      sessionID,
      recoverable,
      parseError: typesOk ? undefined : "wrong_field_types",
    }
  } catch {
    return { recoverable: false, parseError: "json_syntax_error" }
  }
}

function draftFromEnvelope(envelope: Envelope): Draft {
  if (envelope.format === "canonical_json") return draftFromJson(envelope.body)
  return draftFromTags(envelope.body)
}

const VALID_STATUS = new Set(["success", "partial", "failure", "cancelled", "timeout"])

function materialize(draft: Draft, sessionID: string, diagnostics: DecodeDiagnostic[]): TaskResult {
  const claimed = draft.sessionID
  if (claimed && claimed !== sessionID) {
    diagnostics.push({
      kind: "session_id_mismatch",
      detail: "model_session_id_overwritten",
    })
  }

  const fields = {
    findings: draft.findings ?? [],
    failures: draft.failures ?? [],
    assumptions: draft.assumptions ?? [],
    artifactRefs: draft.artifactRefs ?? [],
    suggestions: draft.suggestions ?? [],
    parameters: draft.parameters ?? {},
  }

  if (draft.parseError === "json_syntax_error") {
    return failure(sessionID, TaskResultCode.malformed_result, "Marked result envelope could not be parsed", fields)
  }

  if (!draft.recoverable) {
    return failure(sessionID, TaskResultCode.malformed_result, "Marked result envelope yielded no recoverable payload", fields)
  }

  if (draft.parseError === "wrong_field_types" || draft.parseError === "json_not_object") {
    return partial(sessionID, TaskResultCode.invalid_result, "Result envelope failed schema validation", {
      ...fields,
      failures: [...fields.failures, draft.parseError],
    })
  }

  const status = draft.status
  if (!status || !VALID_STATUS.has(status)) {
    return partial(sessionID, TaskResultCode.invalid_result, "Result envelope has unknown or missing status", {
      ...fields,
      failures: fields.failures.length ? fields.failures : ["unknown_or_missing_status"],
    })
  }

  if (status === "success") {
    // Success requires pristine field types — reject coerced/recovered shapes.
    const pristine =
      Array.isArray(draft.findings) &&
      Array.isArray(draft.failures) &&
      Array.isArray(draft.assumptions) &&
      Array.isArray(draft.artifactRefs) &&
      Array.isArray(draft.suggestions) &&
      draft.parameters !== undefined &&
      typeof draft.parameters === "object"
    if (!pristine) {
      return partial(sessionID, TaskResultCode.invalid_result, "Success envelope missing required fields or has wrong types", fields)
    }
    const candidate = {
      status: "success" as const,
      sessionID,
      ...fields,
    }
    const checked = TaskResultSchema.safeParse(candidate)
    if (checked.success) return checked.data
    return partial(sessionID, TaskResultCode.invalid_result, "Success envelope failed schema validation", fields)
  }

  const code = draft.code?.trim()
  const message = draft.message?.trim()
  if (!code || !message) {
    return partial(sessionID, TaskResultCode.invalid_result, "Failure-like envelope missing required code or message", {
      ...fields,
      failures: [...fields.failures, "missing_code_or_message"],
    })
  }

  const candidate = {
    status,
    code,
    message,
    sessionID,
    ...fields,
  }
  const checked = TaskResultSchema.safeParse(candidate)
  if (checked.success) return checked.data
  return partial(sessionID, TaskResultCode.invalid_result, "Result envelope failed schema validation", {
    ...fields,
    failures: [...fields.failures, "schema_validation_failed"],
  })
}

function recordFormat(format: Format) {
  if (format === "canonical_json") {
    stats.canonical += 1
    return
  }
  if (format === "legacy_tags") {
    stats.legacyTags += 1
    return
  }
  stats.legacyRlm += 1
}

/**
 * Decode worker text into a TaskResult using deterministic envelope precedence:
 * 1. canonical JSON <task_result>
 * 2. legacy field-per-tag <task_result>
 * 3. legacy <rlm_result>
 * 4. non-empty free text → partial/unstructured_result
 * 5. empty → failure/empty_result
 *
 * `sessionID` is authoritative; any model-supplied session ID is overwritten.
 */
export function decode(text: string, sessionID: string): DecodeOutput {
  const diagnostics: DecodeDiagnostic[] = []
  const trimmed = text.trim()
  const envelopes = collectEnvelopes(text)

  if (envelopes.length === 0) {
    if (!trimmed) {
      return {
        result: failure(sessionID, TaskResultCode.empty_result, "Worker returned empty output"),
        diagnostics,
      }
    }
    stats.unstructured += 1
    // Retain full prose under findings as recoverable evidence. Status/code mark it unstructured.
    return {
      result: partial(sessionID, TaskResultCode.unstructured_result, "Worker returned unstructured text", {
        ...emptyArrays(),
        findings: [text],
      }),
      diagnostics,
    }
  }

  const maxPriority = Math.max(...envelopes.map((e) => e.priority))
  const top = envelopes.filter((e) => e.priority === maxPriority)
  const ignored = envelopes.filter((e) => e.priority < maxPriority)
  for (const env of ignored) {
    diagnostics.push({
      kind: "ignored_envelope",
      detail: `ignored_${env.format}_priority_${env.priority}`,
    })
  }

  if (top.length > 1) {
    const bodies = top.map((e) => e.body)
    const identical = bodies.every((b) => b === bodies[0])
    if (!identical) {
      diagnostics.push({
        kind: "duplicate_envelope",
        detail: `ambiguous_${top[0].format}_count_${top.length}`,
      })
      // Still try to recover evidence from the first envelope for parent visibility
      const draft = draftFromEnvelope(top[0])
      recordFormat(top[0].format)
      const recovered = materialize(draft, sessionID, diagnostics)
      return {
        result: partial(sessionID, TaskResultCode.ambiguous_result, "Multiple conflicting result envelopes at the same priority", {
          findings: recovered.findings,
          failures: recovered.failures,
          assumptions: recovered.assumptions,
          artifactRefs: recovered.artifactRefs,
          suggestions: recovered.suggestions,
          parameters: recovered.parameters,
        }),
        diagnostics,
      }
    }
    diagnostics.push({
      kind: "duplicate_envelope",
      detail: `identical_${top[0].format}_count_${top.length}`,
    })
  }

  const winner = top[0]
  recordFormat(winner.format)
  if (winner.format !== "canonical_json") {
    diagnostics.push({
      kind: "legacy_format",
      detail: winner.format,
    })
  }

  const draft = draftFromEnvelope(winner)
  // Canonical JSON syntax errors must not fall through to lower-priority success
  if (winner.format === "canonical_json" && draft.parseError === "json_syntax_error") {
    return {
      result: failure(sessionID, TaskResultCode.malformed_result, "Canonical task_result JSON has a syntax error", emptyArrays()),
      diagnostics,
    }
  }

  return {
    result: materialize(draft, sessionID, diagnostics),
    diagnostics,
  }
}

export type TerminalCause = "cancelled" | "timeout"

/** Classify an AbortSignal reason without inferring from free-form error text. */
export function terminalCause(abort: AbortSignal, injected?: TerminalCause): TerminalCause | undefined {
  if (injected) return injected
  if (!abort.aborted) return undefined
  const reason = abort.reason
  if (reason === "timeout") return "timeout"
  if (typeof reason === "object" && reason !== null && "code" in reason && (reason as { code: unknown }).code === "timeout") {
    return "timeout"
  }
  return "cancelled"
}

/** Apply a control-flow terminal, overriding any decoded worker text. */
export function applyTerminal(cause: TerminalCause, sessionID: string, decoded?: TaskResult): TaskResult {
  const fields = decoded
    ? {
        findings: decoded.findings,
        failures: decoded.failures,
        assumptions: decoded.assumptions,
        artifactRefs: decoded.artifactRefs,
        suggestions: decoded.suggestions,
        parameters: decoded.parameters,
      }
    : emptyArrays()
  if (cause === "timeout") return timeout(sessionID, "Task timed out", fields)
  return cancelled(sessionID, "Task was cancelled", fields)
}

/** Emit one structured warning per decode diagnostic without raw model text. */
export function emitDiagnostics(diagnostics: DecodeDiagnostic[], sessionID: string) {
  for (const item of diagnostics) {
    if (item.kind === "session_id_mismatch") {
      log.warn("task result session id mismatch", { sessionID, detail: item.detail })
      continue
    }
    if (item.kind === "ignored_envelope" || item.kind === "duplicate_envelope") {
      log.info("task result envelope diagnostic", { sessionID, kind: item.kind, detail: item.detail })
      continue
    }
    if (item.kind === "legacy_format") {
      log.info("task result legacy format", { sessionID, detail: item.detail })
    }
  }
}
