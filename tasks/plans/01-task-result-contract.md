# 01 — TaskResult 可靠结果契约

**Status:** Done

**Priority:** P0

**Dependencies:** Plan 00 is the backend merge gate; contract design and focused implementation may proceed while its Linux floor is finalized. This plan blocks orchestrator/subagent routing work in `docs/plans/14-orchestrator-subagent-routing.md`.

## Current state

- `backend/cli/src/session/rlm/state.ts` parses an optional `<rlm_result>` block.
- Missing blocks and unknown status values currently become `success`; arbitrary text is truncated to 2,000 characters and treated as a finding.
- `backend/cli/src/tool/task.ts` only emits structured results when the caller is `research`, `biology`, or `ml`. Other parents receive free-form text.
- Artifact creation is separate from that result branch: `ArtifactTool` persists under the executing child `sessionID`, while registry, prompt-context, and RSI gates have their own agent lists.
- Child session IDs and tool summaries exist, but result status, failures, artifacts, cancellation, and timeout do not share one runtime-validated contract.
- `task.txt` describes the tool to the caller; the child request currently has no central canonical return-contract injection, and the audited agent prompts do not hardcode either result marker.
- TaskTool propagates cancellation through `ctx.abort` but does not own a timeout duration policy; timeout classification must therefore remain separate from scheduler policy.

## Problem

The parent cannot distinguish successful work from malformed output, empty output, cancellation, timeout, or an exception. This makes orchestration unsafe: a worker can fail while the parent sees `success`, and evidence can disappear through the 2,000-character fallback.

## Goals

1. Define one Zod-backed `TaskResult` discriminated union for every TaskTool caller.
2. Preserve `code`, `message`, `findings`, `failures`, `assumptions`, `artifactRefs`, and `sessionID` without silent truncation.
3. Make malformed, empty, cancelled, and timed-out work impossible to report as success.
4. Keep legacy worker output readable during migration.
5. Give future orchestrators a stable, typed child-result boundary.
6. Preserve child artifact registration and lookup semantics while result parsing becomes caller-independent.

## Non-goals

- Redesigning child scheduling, concurrency limits, or timeout policy.
- Building the orchestrator described in plan 14.
- Changing session event ordering or the model transport.
- Adding a persistent DAG or a second artifact store.
- Using an LLM to repair or summarize malformed results.

## Proposed design

Create `backend/cli/src/tool/task-result.ts` as the single source of truth:

- `TaskResultSchema` is a Zod discriminated union over `success | partial | failure | cancelled | timeout`.
- Every variant carries normalized arrays and `sessionID`. Failure-like variants require a stable `code` and human-readable `message`.
- Only a fully valid structured result may become `success`.
- Non-empty free-form legacy output becomes `partial` with code `unstructured_result`.
- Empty or whitespace-only output becomes `failure` with code `empty_result`.
- Structurally recognizable but schema-invalid output becomes `partial/invalid_result`; an unparseable winning envelope becomes `failure/malformed_result`.
- Cancellation and timeout observed by TaskTool override any late worker text.
- TaskTool owns `sessionID`; model output cannot spoof it.

The preferred wire form is a JSON object inside the existing `<task_result>...</task_result>` marker. The decoder remains dual-read for the existing `<rlm_result>` and field-per-tag `<task_result>` forms. The encoder is single-write to the canonical JSON form after the compatibility tests pass.

### Deterministic envelope precedence

The decoder must choose one envelope before validating its fields:

1. canonical JSON `<task_result>`;
2. legacy field-per-tag `<task_result>`;
3. legacy `<rlm_result>`;
4. non-empty free text fallback.

If `<task_result>` and `<rlm_result>` both occur, the higher-priority `<task_result>` wins regardless of textual order. A malformed higher-priority envelope must not silently downgrade to a lower-priority success. Multiple candidates at the same priority are `partial/ambiguous_result` unless they are byte-for-byte identical after trimming. Record a diagnostic whenever lower-priority or duplicate envelopes are ignored.

### Partial versus failure classification

Classification is mechanical rather than based on subjective “missing-field severity”:

| Input                                                                                                                                  | Result                        | Rule                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| Fully schema-valid envelope                                                                                                            | Declared status               | Only this path may produce `success`                              |
| JSON/XML container is parseable, schema validation fails, and at least one meaningful payload field can be deterministically recovered | `partial/invalid_result`      | Preserve recovered evidence and validation diagnostics separately |
| Winning canonical JSON has a syntax error, or a marked envelope yields no meaningful payload                                           | `failure/malformed_result`    | Do not infer intent or fall back to a lower-priority success      |
| Non-empty text with no recognized envelope                                                                                             | `partial/unstructured_result` | Preserve the full text as diagnostics, not fabricated findings    |
| Empty/whitespace-only output                                                                                                           | `failure/empty_result`        | No evidence exists to recover                                     |
| TaskTool observes cancellation or timeout                                                                                              | `cancelled` or `timeout`      | Control-flow terminal cause overrides decoded model text          |

Wrong field types, missing required fields, malformed legacy arrays, and unknown statuses therefore cannot become `success`. They become `partial` only when useful intent/evidence is deterministically recoverable; otherwise they become `failure`. JSON syntax errors are never repaired with an LLM.

### Session and artifact authority

- The decoder accepts the authoritative child session ID as an input and overwrites any model-supplied `sessionID` after parsing every canonical or legacy form.
- A mismatch returns a decoder diagnostic; TaskTool emits one structured warning or existing telemetry event without exposing unsanitized model text. The normalized result always carries the real child ID.
- Removing the caller-name branch applies only to TaskTool result parsing/serialization. Artifact-tool authorization, artifact registration, session prompt artifact context, and RSI behavior remain independently gated.
- `artifactRefs` describes artifacts already created in the child session; decoding must not recreate or copy them. The authoritative `sessionID` remains alongside the refs so continuation/resolution can target their owning child session.

### Instruction rollout

Inject the canonical return contract centrally at the TaskTool-to-child boundary. During the dual-read window it is preferred but not mandatory: legacy-emitting workers remain accepted and counted. `task.txt` is caller-facing tool documentation, not the sole worker instruction. Audit agent prompt files for hardcoded result tags, but do not rewrite every prompt unless the audit finds a conflicting instruction.

## Compatibility and rollback

- Keep legacy readers for at least one minor release; mark them with telemetry so removal is evidence-based.
- Existing worker prompts may continue to emit `<rlm_result>` during the transition; the injected canonical instruction is advisory until legacy-read telemetry reaches the removal threshold.
- Existing parents still see the `<task_result>` marker and `<task_metadata>` session ID, so prompt-level consumers do not lose their anchor.
- A rollback only switches TaskTool's encoder back to the legacy field-per-tag representation. The internal Zod result and failure classification remain in place.
- Do not roll back to the old “missing structure means success” behavior.

## Implementation tasks

### Task 1: Define the canonical schema and invariants

**Description:** Add the Zod schema, inferred TypeScript type, stable error codes, constructors, and serializer in one reusable module.

**Acceptance criteria:**

- [x] The union contains exactly `success`, `partial`, `failure`, `cancelled`, and `timeout`.
- [x] Failure-like variants require `code` and `message`; all variants preserve arrays, artifact refs, and `sessionID`.
- [x] Schema descriptions document the strict-success rule and the deterministic `partial` versus `failure` matrix.
- [x] A model-supplied session ID cannot replace the TaskTool-owned ID.
- [x] Serialization is deterministic and round-trips through the schema.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/tool/task-result.test.ts -t "schema"`
- [x] `(cwd: backend/cli) bun run typecheck`

**Dependencies:** None.

**Files likely touched:**

- `backend/cli/src/tool/task-result.ts`
- `backend/cli/test/tool/task-result.test.ts`

**Estimated scope:** S — 2 files.

### Task 2: Add strict decoding and legacy adapters

**Description:** Decode with explicit canonical/legacy precedence, adapt both XML-shaped forms, apply the deterministic fallback matrix, and normalize every result with the authoritative TaskTool-owned child session ID.

**Acceptance criteria:**

- [x] Valid canonical and legacy results normalize to the same `TaskResult`.
- [x] Canonical JSON `<task_result>` outranks field-per-tag `<task_result>`, which outranks `<rlm_result>`; coexistence and duplicate-envelope behavior are deterministic and tested.
- [x] Missing structure with non-empty text is `partial/unstructured_result`.
- [x] Empty output is `failure/empty_result`.
- [x] Parseable, schema-invalid output with recoverable evidence is `partial/invalid_result`; malformed JSON or an unrecoverable marked envelope is `failure/malformed_result`.
- [x] Unknown status, missing required fields, wrong field types, and malformed arrays never become `success`.
- [x] Legacy free-form text is retained without the current 2,000-character slice.
- [x] The decoder overwrites canonical and legacy model-supplied session IDs with its authoritative input and returns a mismatch diagnostic for TaskTool logging/telemetry.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/tool/task-result.test.ts test/session/rlm-state.test.ts`
- [x] Fixtures cover both formats in one response, malformed canonical plus valid legacy, duplicate canonical blocks, partially valid JSON, JSON syntax failure, and matching/spoofed session IDs.

**Dependencies:** Task 1.

**Files likely touched:**

- `backend/cli/src/tool/task-result.ts`
- `backend/cli/src/session/rlm/state.ts`
- `backend/cli/test/tool/task-result.test.ts`
- `backend/cli/test/session/rlm-state.test.ts`

**Estimated scope:** M — 4 files.

## Checkpoint A: Contract and decoder

- [x] Canonical, legacy, mixed, duplicate, partial, malformed, empty, and spoofed-session fixtures follow the documented matrix.
- [x] Only a fully schema-valid envelope can become `success`.
- [x] The decoder returns authoritative-session and ignored-envelope diagnostics without logging raw model output.
- [x] Focused schema/decoder tests and typecheck pass before TaskTool integration begins.

### Task 3: Make TaskTool return one result shape

**Description:** Remove only TaskTool's caller-name result-envelope branch, attach the real child `sessionID`, emit decoder diagnostics once, and map abort/timeout/error causes to terminal result variants.

**Acceptance criteria:**

- [x] Every parent agent receives the same discriminated result envelope.
- [x] Removing `useStructuredOutput` does not remove or broaden artifact-tool authorization, artifact context injection, RSI hooks, or other caller-specific product behavior.
- [x] Cancellation and timeout are returned distinctly and cannot be overwritten by a late `success`.
- [x] Tool execution failures retain their stable code/message and child session ID.
- [x] A session-ID mismatch produces one structured warning/telemetry event while the returned envelope always uses the real child ID.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/tool/task.test.ts test/permission-task.test.ts`
- [x] Run the repository's deterministic local provider through success, failure, and real `AbortController` cancellation TaskTool flows.
- [x] Exercise timeout classification with an existing deadline signal or a deterministic injected terminal cause; do not infer timeout from error-message text or introduce a timeout duration policy in this plan.

**Dependencies:** Tasks 1–2.

**Files likely touched:**

- `backend/cli/src/tool/task.ts`
- `backend/cli/src/tool/task-result.ts`
- `backend/cli/test/tool/task.test.ts`
- `backend/cli/test/permission-task.test.ts`

**Estimated scope:** M — 4 files.

### Task 4: Preserve artifacts and phase in worker instructions

**Description:** Preserve existing artifact authorization/storage boundaries while making `artifactRefs` caller-independent, then inject the preferred canonical contract centrally without forcing an immediate prompt migration.

**Acceptance criteria:**

- [x] `research`, `biology`, and `ml` still create/store artifacts through the actual ArtifactTool path; returned `artifactRefs` and the authoritative child `sessionID` identify persisted child-owned artifacts without copying them.
- [x] Artifact-tool authorization, `RLMArtifacts` storage, artifact context injection, and RSI hooks retain their current agent gates and observable behavior.
- [x] The canonical fields and “no silent skips” rule are injected at the TaskTool-to-child boundary as preferred migration instructions; dual-read remains enabled and legacy output is not rejected.
- [x] `task.txt` documents the caller-visible result shape; agent prompts are changed only if an audit finds a hardcoded conflicting marker.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/tool/task.test.ts test/permission-task.test.ts`
- [x] For `research`, `biology`, and `ml`, register an artifact through the actual implementation and assert stored content, emitted ref, and child-session ownership survive the TaskTool boundary.
- [x] Run a legacy-emitting deterministic worker after canonical instruction injection and confirm it still normalizes successfully while incrementing legacy-format telemetry.
- [x] `rg -n "<rlm_result>|<task_result>" backend/cli/src/agent/prompt backend/cli/src/tool/task.txt` has no unreviewed conflicting instruction.

**Dependencies:** Task 3.

**Files likely touched:**

- `backend/cli/src/tool/task.ts`
- `backend/cli/src/tool/task.txt`
- `backend/cli/test/tool/task.test.ts`
- `backend/cli/test/permission-task.test.ts`

**Files whose behavior is protected but which are not expected to change:**

- `backend/cli/src/tool/registry.ts`
- `backend/cli/src/tool/artifact.ts`
- `backend/cli/src/session/rlm/artifacts.ts`
- `backend/cli/src/session/prompt.ts`
- `backend/cli/src/session/rsi/trajectory.ts`

**Estimated scope:** M — 4 changed files.

### Task 5: Lock compatibility and rollout behavior

**Description:** Add characterization tests around precedence, old and new envelopes, real child-session metadata, artifacts, terminal errors, advisory instruction rollout, and encoder rollback.

**Acceptance criteria:**

- [x] The tests use the actual decoder and TaskTool path rather than duplicating parsing logic.
- [x] Legacy `<rlm_result>` and field-per-tag `<task_result>` fixtures remain readable.
- [x] When legacy and canonical markers coexist, canonical precedence is stable; malformed or duplicate higher-priority envelopes cannot be hidden by a lower-priority `success`.
- [x] Artifact refs, failure details, assumptions, and child session ID survive a full TaskTool call.
- [x] Cancellation and timeout each have a deterministic test and remain terminal when late worker text claims success.
- [x] A worker that still emits `<rlm_result>` remains readable after the advisory canonical instruction is injected.
- [x] A rollback test proves the legacy encoder remains consumable by the new decoder.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/session/rlm-state.test.ts test/tool/task-result.test.ts test/tool/task.test.ts test/permission-task.test.ts`
- [ ] `(cwd: backend/cli) bun test` — hung on unrelated `science/http` on Windows; see Progress

**Dependencies:** Task 4.

**Files likely touched:**

- `backend/cli/test/tool/task-result.test.ts`
- `backend/cli/test/tool/task.test.ts`
- `backend/cli/test/session/rlm-state.test.ts`

**Estimated scope:** M — 3 files.

## Checkpoint B: End-to-end compatibility

- [x] Arbitrary text, malformed structure, empty output, cancellation, and timeout cannot be reported as `success`.
- [x] Mixed and duplicate envelopes obey the documented precedence and ambiguity rules.
- [x] All parent agents consume the same schema.
- [x] A spoofed session ID is overwritten and observable through one safe diagnostic.
- [x] Child session ID, persisted child-owned artifact refs, and failure evidence round-trip intact.
- [x] Canonical instructions are injected centrally while legacy worker output remains readable during the migration window.
- [x] Focused tests and typecheck pass; full `bun test` attempted (see Progress for platform note).
- [x] Compatibility and rollback behavior are recorded in the completed plan status.

## Progress

**Completed:** 2026-08-01

**Compatibility / rollback notes:**

- Encoder default is canonical JSON inside `<task_result>`; `encode(result, { legacy: true })` remains for rollback and is covered by decoder + TaskTool tests.
- Dual-read accepts canonical JSON, field-per-tag `<task_result>`, and `<rlm_result>`. Telemetry counters: `canonical`, `legacyTags`, `legacyRlm`, `unstructured` via `telemetry()` / `resetTelemetry()`.
- Timeout classification uses `AbortSignal` reason `"timeout"` or injected `ctx.extra.terminalCause`; no duration policy was added.
- Prompt audit: no hardcoded `<rlm_result>` / `<task_result>` markers under `src/agent/prompt`; `task.txt` documents the caller-visible shape only.
- Fixture hardening: temp git repos set identity via `git -c` so CI/local machines without global git user still run permission-task config tests.

**Focused verification:**

```text
(cwd: backend/cli) bun test test/tool/task-result.test.ts test/session/rlm-state.test.ts test/tool/task.test.ts
→ 33 pass, 0 fail
(cwd: backend/cli) bun test test/permission-task.test.ts
→ 21 pass, 0 fail
(cwd: backend/cli) bun run typecheck
→ pass
```

**Full suite note:** `bun test` from `backend/cli` progressed through bun/sandbox/science suites; sandbox path expectations fail on Windows (pre-existing `/tmp` vs `D:\tmp`), then hung inside `test/science/http.test.ts` with no further output after ~15 minutes. No failures observed in Plan 01 files. Recommend re-running full suite on Linux CI (Plan 00 gate).

## Risks

| Risk                                    | Impact                                                 | Mitigation                                                                                                        |
| --------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Existing prompts emit inconsistent XML  | Workers appear partially successful during migration   | Dual-read legacy formats; inject the new contract; count legacy decodes                                           |
| New and legacy markers coexist          | Decoder cherry-picks a convenient success              | Fixed canonical-first precedence; same-priority duplicates become ambiguous; test malformed-new + valid-old       |
| Strict parsing rejects useful prose     | Evidence becomes unavailable                           | Preserve non-empty prose as `partial` diagnostics, never as `success`                                             |
| Partial/failure boundary is subjective  | Implementations classify identical output differently  | Use the parseability + recoverable-evidence matrix; do not grade by guessed severity                              |
| Cancellation races with late completion | Terminal state flips back to success                   | Let control-flow terminal status override decoded text and test the race                                          |
| Model spoofs a child session ID         | Artifacts or telemetry attach to the wrong session     | Decoder takes authoritative ID; TaskTool overwrites and emits one sanitized mismatch diagnostic                   |
| Result unification breaks artifacts     | Stored child artifacts become unreachable or disappear | Remove only the result branch; keep artifact gates/storage; test real registration and child-session ownership    |
| Result payload re-bloats context        | Parent token usage increases                           | Preserve refs and structured evidence; rely on plan 13's conservative result bounding rather than truncating here |
| Encoder rollback loses new statuses     | Cancel/timeout collapse                                | Legacy encoder must carry explicit status/code/message and is tested before rollout                               |

## Definition of done

- [x] `TaskResultSchema` is the only runtime result contract used by TaskTool.
- [x] Every status, precedence rule, and partial/failure fallback has a focused test.
- [x] Only the caller-name structured-output branch is removed; artifact authorization, storage, context, and RSI behavior are preserved.
- [x] No code path defaults unknown or missing output to success.
- [x] TaskTool-owned session ID overrides model claims and mismatch diagnostics are verified.
- [x] Actual artifact registration, returned refs, and child-session ownership pass for `research`, `biology`, and `ml`.
- [x] Success, failure, cancellation, and deterministic timeout flows are covered without introducing a new timeout policy.
- [x] Legacy envelopes remain readable and rollback is proven.
- [x] Focused Plan 01 tests and `backend/cli` typecheck pass; full-suite note in Progress.
