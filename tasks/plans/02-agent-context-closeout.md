# 02 — Agent tool context optimization closeout

**Status:** Planned

**Priority:** P0

**Dependencies:** Tasks 1–6 in `docs/plans/13-agent-tool-context-optimization.md` are already landed. The Research Graph bounding soak additionally depends on `tasks/plans/03-research-graph-supervisor.md`.

## Current state

- Tasks 1–6 in `docs/plans/13-agent-tool-context-optimization.md` landed context telemetry, tool availability, pre-init filtering, profiles, MCP manifest caching, and conservative tool-result bounding.
- `experimental.tool_profiles` is on by default.
- `experimental.mcp_manifest_cache` and `experimental.tool_result_bound` remain off pending soak.
- Tasks 7–8 in `docs/plans/13-agent-tool-context-optimization.md` are open: minimize measured schema outliers and validate fixed context/compaction behavior.
- The current documented focused run had environment-related failures, and the full `backend/cli` suite did not finish in the recorded window.
- Legacy `research` still carries a large schema; `tasks/plans/09-orchestrator-mvp.md`, not this closeout, owns moving that parent to an orchestrator.

## Problem

The optimization mechanisms exist, but their budgets and safety claims are not yet protected by reproducible tests. Turning flags on without real MCP and Research Graph soaks risks capability loss; leaving them permanently off means `docs/plans/13-agent-tool-context-optimization.md` never delivers its intended runtime benefit.

## Goals

1. Make per-profile context and schema baselines reproducible and regression-tested.
2. Reduce only measured schema outliers without changing accepted tool calls.
3. Soak MCP manifest caching against a real SDK test server.
4. Soak result bounding through a real Research Graph stage/graph/provenance flow.
5. Validate compaction behavior and record an evidence-backed default decision for both flags.

## Non-goals

- Shrinking schemas that are not measured outliers.
- Removing required fields or weakening runtime validation to hit a token target.
- Aggressive or LLM-generated tool-result summaries.
- Making legacy `research` thin; that belongs to `tasks/plans/09-orchestrator-mvp.md`.
- Redesigning MCP transport, plugin hooks, or compaction.
- Hiding environmental test failures behind retries or larger blanket timeouts.

## Proposed design

Use a measure-first closeout:

1. Produce a deterministic profile report from the existing `SessionTelemetry.measureTools` path.
2. Turn the report into threshold assertions with a documented exception for legacy `research`.
3. Edit only the largest schemas named by the report, preserving tool IDs, required inputs, and validation.
4. Exercise both experimental flags through actual protocol implementations and failure paths.
5. Compare fresh-session and multi-turn provider input before/after, then decide each default independently.

The target remains:

- Non-legacy standard profiles: fixed system-plus-tool overhead at or below 8,000 estimated tokens.
- Tool schemas: at or below 5,000 estimated tokens per standard profile.
- Legacy `research`: mark the row `baseline_only=true` and `editable=false`, then defer parent-context reduction to `tasks/plans/09-orchestrator-mvp.md`. A shared tool may change only when it is a measured outlier for at least one non-legacy profile; the `research` total alone can never justify an edit.

### Estimator calibration rule

`SessionTelemetry` currently uses `Token.estimate()` (`characters / 4`), so an 8,000-token local estimate is not automatically an 8,000-token provider payload. The baseline report must therefore record `estimatorID/version`, serialized bytes, local estimate, provider/model ID, provider-reported or vendor-tokenizer input count, absolute error, and relative error for the same fixed payload.

- Calibrate at least two provider/model tokenizer families; target three when credentials and official tokenizers are available. At least one calibration must use provider-reported usage from a real minimal request. A second family may use its official tokenizer only when a real request is unavailable, and must be labeled `source=tokenizer` rather than presented as provider usage.
- One calibrated family must be the repository/default deployment used for the compaction check. Record the exact model/version because tokenizer changes invalidate the calibration.
- Derive a conservative correction factor as `max(1.0, 1.10 * max(actual / estimate))`. Apply that factor to budget assertions; provider overestimation must not be used to loosen the 8,000/5,000 targets.
- If a provider-specific corrected budget fails, recalibrate the estimator or record a named provider/model exception. Do not average errors across providers until an underestimating model appears to pass.

### Environmental blocker fuse

The full suite remains the default closeout gate. A non-Plan-02 environment failure may be recorded as a bounded exception only when all of the following are true:

1. The same failure or hang reproduces on the unchanged baseline/default branch or is already owned by Plan 00.
2. It is outside files and behavior changed by Plan 02, and does not cover MCP cache, result bounding, schema selection, telemetry, or compaction.
3. Every new/changed/focused Plan 02 test passes, repository typecheck passes, and all unaffected suite shards finish.
4. A tracked issue records the exact command, commit, OS/runtime, bounded timeout, logs, owner, expiry/recheck date, and a link from this plan's Progress.
5. No experimental flag may become default-on while the exempted failure could conceal a regression in that flag's path.

This fuse may allow Plan 02 to close with a named external blocker, but it never waives Plan 00's merge/release gate and must not turn an unknown hang into a pass.

## Implementation tasks

### Task 1: Freeze a deterministic profile baseline

**Description:** Extend the existing `openscience debug agent <name>` command with an additive `openscience debug agent --all --context-report` mode. The aggregate mode records tool count, serialized bytes, estimated schema tokens, prompt estimate, corrected provider-equivalent estimate, and total fixed overhead for every shipped native agent; the existing single-agent output remains compatible.

**Acceptance criteria:**

- [ ] `openscience debug agent --all --context-report` produces stable, sorted output for every native profile; `openscience debug agent <name>` retains its existing behavior.
- [ ] Threshold assertions fail with the agent and largest contributing tool schemas named.
- [ ] The report contains no prompt body, tool arguments, credentials, or result content.
- [ ] Legacy `research` is explicitly labeled `baseline_only=true`, `editable=false`, `budget_enforced=false`, and `owner=tasks/plans/09-orchestrator-mvp.md` rather than silently excluded.
- [ ] The machine-readable report emits an `edit_allowlist` containing only schemas that are measured outliers for at least one non-legacy profile; research-only schemas are never listed.
- [ ] The same fixed minimal payload is calibrated against at least two provider/model tokenizer families (target three), including at least one real provider-reported input count and the repository/default deployment.
- [ ] The report records estimator identity/version, model/version, measurement source, actual count, absolute/relative error, and the conservative correction factor; corrected thresholds never become looser than the raw 8,000/5,000 budgets.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/telemetry.test.ts test/agent/agent-schema-budget.test.ts`
- [ ] Run the new baseline command twice and confirm byte-identical output apart from an explicit timestamp field, if present.
- [ ] Run the provider calibration lane twice with the same model versions and confirm reported error/correction fields are stable within a documented tolerance.

**Dependencies:** Tasks 1–6 in `docs/plans/13-agent-tool-context-optimization.md`.

**Files likely touched:**

- `backend/cli/src/session/telemetry.ts`
- `backend/cli/src/cli/cmd/debug/agent.ts`
- `backend/cli/test/session/telemetry.test.ts`
- `backend/cli/test/agent/agent-schema-budget.test.ts`
- `docs/plans/13-agent-tool-context-optimization.md`

**Estimated scope:** M — 5 files.

### Task 2: Minimize only measured schema outliers

**Description:** Simplify descriptions and schema shape only for tools identified by Task 1, without changing names, required fields, defaults, validation, or execution behavior.

**Acceptance criteria:**

- [ ] Every edited schema appears in the before-report's outlier list.
- [ ] Every edited shared tool is an outlier for at least one non-legacy profile; no edit is justified only by the legacy `research` total.
- [ ] `research` prompt/profile/research-only schemas are absent from the edit allowlist, and the report keeps `research.editable=false` before and after the task.
- [ ] Existing valid calls remain valid and invalid calls remain rejected.
- [ ] No graph, stage, provenance, artifact, or search identity field is removed.
- [ ] Non-legacy standard profiles meet the documented schema budget or carry a named, measured exception.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/agent/agent-schema-budget.test.ts test/tool/registry.test.ts test/tool/selection.test.ts`
- [ ] Run the existing focused tests for each tool whose schema changes.
- [ ] Diff the Task 1 machine-readable edit allowlist against changed schema files; fail if a research-only or non-outlier schema changed.

**Dependencies:** Task 1.

**Files likely touched:**

- Only measured outliers under `backend/cli/src/tool/` or `backend/cli/src/science/`
- Matching focused tests under `backend/cli/test/tool/` or `backend/cli/test/science/`
- `backend/cli/test/agent/agent-schema-budget.test.ts`

**Estimated scope:** M — no more than 5 hand-edited files per outlier batch.

### Task 3: Soak MCP manifest caching with a real server

**Description:** Extend the SDK test-server integration to cover TTL, last-good, list-changed, reconnect, concurrent refresh, and stale-call recovery without replacing the implementation with mocks.

**Acceptance criteria:**

- [ ] Cache hit avoids `listTools()` while the manifest is valid.
- [ ] TTL expiry, lifecycle changes, and explicit refresh invalidate before use.
- [ ] Failed refresh retains last-good tools and emits `cache_refresh_failed`.
- [ ] Concurrent refresh is single-flight.
- [ ] Unknown-tool/schema-mismatch forces exactly one invalidate-and-refresh attempt.
- [ ] Each soak run performs at least 20 consecutive discovery turns and includes 2 server restarts, 2 TTL expiries, 2 `tools/list_changed` invalidations, 1 injected refresh failure, 1 stale-schema/unknown-tool recovery, and a burst of at least 5 concurrent discovery requests.
- [ ] The minimum scenario runs three times consecutively (at least 60 discovery turns total) with zero empty-toolset regressions, duplicate refreshes, or unbounded reconnect loops.
- [ ] A default-on/off recommendation is recorded from the soak evidence.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/mcp/manifest-cache.test.ts test/mcp/env.test.ts test/mcp/headers.test.ts`
- [ ] Run the minimum-strength soak above with `experimental.mcp_manifest_cache=true` against the real SDK test server and record turn/event counts, cache hit/miss/refresh metrics, reconnect count, and final toolset size for all three runs.

**Dependencies:** Task 1.

**Files likely touched:**

- `backend/cli/src/mcp/manifest-cache.ts`
- `backend/cli/src/mcp/index.ts`
- `backend/cli/src/config/config.ts`
- `backend/cli/test/mcp/manifest-cache.test.ts`
- MCP test-server fixture files

**Estimated scope:** M — 4–5 files.

### Task 4: Soak result bounding through Research Graph

**Description:** Run conservative bounding through real `atlas_graph`、`atlas_stage`（当前均为 Research Graph 兼容工具名）、provenance、large log 和 artifact-retrieval 路径；不得因 Plan 15 关闭 Atlas 产品面而删掉这些真实消费者。

**Acceptance criteria:**

- [ ] Graph/stage/provenance IDs, edges, and structured error fields survive bounding.
- [ ] Search identity and ERROR/FATAL/Exception/Traceback lines survive budget pressure.
- [ ] Spilled content remains readable by its stable artifact/path after a later turn and compaction prune.
- [ ] Same-loop MCP `content` and `output` remain consistent.
- [ ] Run at least 3 independent full `stage -> graph create/update -> provenance -> later-turn retrieval` sequences with payloads near `0.9x`, `2x`, and `10x` the configured result budget.
- [ ] Across the three sequences, include at least one structured error, one severity-heavy log, one same-loop MCP result, and one spill read after a later turn plus compaction prune.
- [ ] All 3 sequences preserve required IDs/edges/error fields, yield readable stable spill refs, and produce zero missing-evidence or content/output divergence events.
- [ ] A default-on/off recommendation is recorded from the soak evidence.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/tool/truncation-bound.test.ts test/plugin/research-graph-result-bound.test.ts`
- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py`
- [ ] Record the three sequence IDs, payload/budget ratios, compaction events, spill refs, retained identity fields, and retrieval outcomes.

**Dependencies:** Task 2 and `tasks/plans/03-research-graph-supervisor.md`.

**Files likely touched:**

- `backend/cli/src/tool/truncation.ts`
- `backend/cli/src/session/prompt.ts`
- `backend/cli/test/tool/truncation-bound.test.ts`
- `backend/cli/test/plugin/research-graph-result-bound.test.ts`
- Research Graph test fixtures only if required

**Estimated scope:** M — 4–5 files.

### Task 5: Validate compaction and close the source context plan

**Description:** Compare fresh and realistic multi-turn sessions, make independent flag decisions, close Tasks 7–8 in `docs/plans/13-agent-tool-context-optimization.md`, and complete the full-suite checkpoint or the strictly bounded environmental-blocker fuse.

**Acceptance criteria:**

- [ ] “Fresh short conversation” is fixed as a new session with the repository default model/tool-profile configuration, no user/project MCP or plugin additions, no loaded skill, no debug tool injection, no images/attachments/tool calls, and exactly 2 complete text turns (2 minimal user messages + 2 assistant text responses).
- [ ] Run that scenario with the actual default agent resolution (`research`) as a baseline-only observation and with every budget-enforced non-legacy standard profile as a gate; passive telemetry may observe the run but must not add provider-visible tools or prompt text.
- [ ] No budget-enforced non-legacy profile compacts solely due to fixed overhead. If default legacy `research` does, record a named Plan 09 blocker without editing `research` under Task 2.
- [ ] Multi-turn compaction preserves current message/event behavior.
- [ ] Before/after provider input, corrected provider-equivalent estimate, fixed overhead, compaction count, estimator error, and exceptions are documented.
- [ ] Each experimental flag is enabled only if its own soak passes; otherwise it remains off with a named blocker.
- [ ] Full `backend/cli` tests pass, or every remaining failure satisfies all five environmental-blocker fuse conditions; an intersecting or unknown hang still blocks closeout.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/compaction.test.ts test/session/telemetry.test.ts test/agent/agent-schema-budget.test.ts`
- [ ] `(cwd: backend/cli) bun test`
- [ ] `(cwd: repository root) bun run typecheck`
- [ ] When the fuse is used, rerun the exact failing command on the unchanged baseline/default branch and link the issue plus evidence from this plan's Progress.

**Dependencies:** Tasks 2–4 and the Plan 00 baseline needed to classify any environmental exception.

**Files likely touched:**

- `backend/cli/test/session/compaction.test.ts`
- `backend/cli/src/config/config.ts`
- `docs/plans/13-agent-tool-context-optimization.md`
- Baseline/soak report under `docs/notes/` if the plan would become unwieldy

**Estimated scope:** M — 3–4 files.

## Checkpoint

- [ ] Per-profile schema and fixed-overhead budgets are reproducible, estimator-versioned, and corrected by measured provider/tokenizer error from at least two families.
- [ ] Legacy `research` remains baseline-only/non-editable and points to `tasks/plans/09-orchestrator-mvp.md`; shared-tool edits are justified by non-legacy outliers.
- [ ] Schema reductions preserve validation and real tool behavior.
- [ ] The three-run/60-turn MCP soak retains last-good capabilities through the required restart, TTL, notification, failure, stale-schema, and concurrency events.
- [ ] Three complete Research Graph sequences at `0.9x`/`2x`/`10x` budget preserve graph/stage/provenance evidence and retrievable spill paths.
- [ ] The exact two-turn short-conversation matrix does not compact any budget-enforced profile from fixed overhead alone; default `research` is reported separately.
- [ ] Flag defaults and any exceptions are documented with measurements.
- [ ] Focused tests and repository typecheck pass; the full backend/CLI suite passes or only contains a fully documented, non-intersecting exception allowed by the environmental-blocker fuse.

## Risks

| Risk                                             | Impact                                             | Mitigation                                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Optimizing descriptions removes model guidance   | More invalid tool calls                            | Edit only measured outliers; preserve semantics; run real workflow smoke tests                                                             |
| Cached MCP manifest becomes stale                | Tool capability disappears or execution mismatches | TTL, lifecycle invalidation, last-good, single-flight, one stale-call refresh                                                              |
| Bounding drops scientific evidence               | Hallucinated or incomplete conclusions             | Hard keep-lists, stable spill paths, real RG/provenance soak                                                                               |
| Token estimates differ by provider/model         | False confidence in thresholds                     | Calibrate at least two families, version model/estimator, apply worst underestimation + 10% headroom, and document named exceptions        |
| Legacy `research` is optimized opportunistically | Plan 02 crosses into orchestrator scope            | Mark it baseline-only/non-editable; require every shared-tool edit to be justified by a non-legacy outlier and hand parent work to Plan 09 |
| A nominal soak misses lifecycle failures         | Unsafe flags become default-on                     | Require three MCP runs/60 turns with explicit invalidation events and three complete RG sequences across a payload matrix                  |
| Full suite still hangs on Windows                | No trustworthy checkpoint                          | Use the five-condition environmental fuse only for baseline-reproducible, non-intersecting issues; Plan 00 remains the merge/release gate  |

## Definition of done

- [ ] Tasks 7–8 in `docs/plans/13-agent-tool-context-optimization.md` are complete or have precise, measured exceptions.
- [ ] Non-legacy standard profiles meet their budgets.
- [ ] Legacy `research` has a stable baseline, remains non-editable in this plan, and has an explicit `tasks/plans/09-orchestrator-mvp.md` handoff.
- [ ] Provider/model calibration covers at least two tokenizer families and budget assertions use the conservative correction factor.
- [ ] MCP and Research Graph soaks meet their minimum event/sequence counts; a single happy-path run is not sufficient.
- [ ] MCP cache and result-bound defaults are decided independently from real soak evidence.
- [ ] Research Graph end to end passes with bounding enabled.
- [ ] Full `bun test` from `backend/cli` and repository typecheck pass, or the only full-suite exception satisfies the environmental-blocker fuse without intersecting Plan 02 behavior.
- [ ] `docs/plans/13-agent-tool-context-optimization.md` status and evidence are current.
