# 02 — Agent tool context optimization closeout

**Status:** Planned

**Priority:** P0

**Dependencies:** Tasks 1–6 in `docs/plans/13-agent-tool-context-optimization.md` are already landed. The Research Graph bounding soak additionally depends on `tasks/plans/03-research-graph-supervisor.md`.

## Current state

- Plan 13 tasks 1–6 landed context telemetry, tool availability, pre-init filtering, profiles, MCP manifest caching, and conservative tool-result bounding.
- `experimental.tool_profiles` is on by default.
- `experimental.mcp_manifest_cache` and `experimental.tool_result_bound` remain off pending soak.
- Plan 13 tasks 7–8 are open: minimize measured schema outliers and validate fixed context/compaction behavior.
- The current documented focused run had environment-related failures, and the full `backend/cli` suite did not finish in the recorded window.
- Legacy `research` still carries a large schema; plan 14, not this closeout, owns moving that parent to an orchestrator.

## Problem

The optimization mechanisms exist, but their budgets and safety claims are not yet protected by reproducible tests. Turning flags on without real MCP and Research Graph soaks risks capability loss; leaving them permanently off means plan 13 never delivers its intended runtime benefit.

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
- Making legacy `research` thin; that belongs to orchestrator plan 14.
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
- Legacy `research`: record a stable baseline and defer the parent-context reduction to plan 14 rather than weakening its tools here.

## Implementation tasks

### Task 1: Freeze a deterministic profile baseline

**Description:** Add one reusable report/test path that records tool count, serialized bytes, estimated schema tokens, prompt estimate, and total fixed overhead per shipped native agent.

**Acceptance criteria:**

- [ ] One command produces stable, sorted output for every native profile.
- [ ] Threshold assertions fail with the agent and largest contributing tool schemas named.
- [ ] The report contains no prompt body, tool arguments, credentials, or result content.
- [ ] Legacy `research` is explicitly labeled as an orchestrator-owned exception rather than silently excluded.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/telemetry.test.ts test/agent/agent-schema-budget.test.ts`
- [ ] Run the new baseline command twice and confirm byte-identical output apart from an explicit timestamp field, if present.

**Dependencies:** Plan 13 tasks 1–6.

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
- [ ] Existing valid calls remain valid and invalid calls remain rejected.
- [ ] No graph, stage, provenance, artifact, or search identity field is removed.
- [ ] Non-legacy standard profiles meet the documented schema budget or carry a named, measured exception.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/agent/agent-schema-budget.test.ts test/tool/registry.test.ts test/tool/selection.test.ts`
- [ ] Run the existing focused tests for each tool whose schema changes.

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
- [ ] A default-on/off recommendation is recorded from the soak evidence.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/mcp/manifest-cache.test.ts test/mcp/env.test.ts test/mcp/headers.test.ts`
- [ ] Run the soak with `experimental.mcp_manifest_cache=true` for repeated multi-turn tool discovery.

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
- [ ] A default-on/off recommendation is recorded from the soak evidence.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/tool/truncation-bound.test.ts test/integration/research-graph-result-bound.test.ts`
- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py`

**Dependencies:** Task 2 and `tasks/plans/03-research-graph-supervisor.md`.

**Files likely touched:**

- `backend/cli/src/tool/truncation.ts`
- `backend/cli/src/session/prompt.ts`
- `backend/cli/test/tool/truncation-bound.test.ts`
- `backend/cli/test/integration/research-graph-result-bound.test.ts`
- Research Graph test fixtures only if required

**Estimated scope:** M — 4–5 files.

### Task 5: Validate compaction and close plan 13

**Description:** Compare fresh and realistic multi-turn sessions, make independent flag decisions, update the plan status, and complete the full-suite checkpoint.

**Acceptance criteria:**

- [ ] A fresh short conversation does not compact solely due to fixed overhead.
- [ ] Multi-turn compaction preserves current message/event behavior.
- [ ] Before/after provider input, fixed overhead, compaction count, and exceptions are documented.
- [ ] Each experimental flag is enabled only if its own soak passes; otherwise it remains off with a named blocker.
- [ ] Full `backend/cli` tests finish; slow or hanging tests are identified rather than reported as passed.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/session/compaction.test.ts test/session/telemetry.test.ts test/agent/agent-schema-budget.test.ts`
- [ ] `(cwd: backend/cli) bun test`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Tasks 2–4.

**Files likely touched:**

- `backend/cli/test/session/compaction.test.ts`
- `backend/cli/src/config/config.ts`
- `docs/plans/13-agent-tool-context-optimization.md`
- Baseline/soak report under `docs/notes/` if the plan would become unwieldy

**Estimated scope:** M — 3–4 files.

## Checkpoint

- [ ] Per-profile schema and fixed-overhead budgets are reproducible.
- [ ] Schema reductions preserve validation and real tool behavior.
- [ ] MCP cache failure retains last-good capabilities.
- [ ] Result bounding preserves graph/stage/provenance evidence and retrievable spill paths.
- [ ] Fresh conversations do not compact from fixed overhead alone.
- [ ] Flag defaults and any exceptions are documented with measurements.
- [ ] Focused tests, full backend/CLI suite, and repository typecheck pass.

## Risks

| Risk                                           | Impact                                             | Mitigation                                                                                      |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Optimizing descriptions removes model guidance | More invalid tool calls                            | Edit only measured outliers; preserve semantics; run real workflow smoke tests                  |
| Cached MCP manifest becomes stale              | Tool capability disappears or execution mismatches | TTL, lifecycle invalidation, last-good, single-flight, one stale-call refresh                   |
| Bounding drops scientific evidence             | Hallucinated or incomplete conclusions             | Hard keep-lists, stable spill paths, real RG/provenance soak                                    |
| Token estimates differ by provider             | False confidence in thresholds                     | Record estimator plus provider usage; document provider-specific exceptions                     |
| Full suite still hangs on Windows              | No trustworthy checkpoint                          | Run serially, identify the exact test, and fix or document a bounded environmental prerequisite |

## Definition of done

- [ ] Plan 13 tasks 7–8 are complete or have precise, measured exceptions.
- [ ] Non-legacy standard profiles meet their budgets.
- [ ] Legacy `research` has a stable baseline and explicit plan-14 handoff.
- [ ] MCP cache and result-bound defaults are decided independently from real soak evidence.
- [ ] Research Graph end to end passes with bounding enabled.
- [ ] Full `bun test` from `backend/cli` and repository typecheck pass.
- [ ] `docs/plans/13-agent-tool-context-optimization.md` status and evidence are current.
