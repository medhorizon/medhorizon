# 13 - Agent tool context optimization

Workstream: reduce the fixed context cost of native, plugin, and MCP tools without weakening permission checks or breaking Research Graph workflows.

**TL;DR:** MedHorizon currently initializes nearly every native tool, converts every schema, loads every connected MCP server's tools, and only then removes explicitly disabled tools. With the configured `32,768` context window, `8,192` output reserve, and `0.75` compaction threshold, proactive compaction begins at `18,432` tokens. Fixed system/tool overhead can therefore trigger compaction before useful conversation history becomes large. This plan introduces measurable context accounting, explicit tool availability profiles, pre-schema filtering, cached MCP manifests, bounded tool results, and schema reduction. The target is a fixed system-plus-tool baseline of at most `8,000` tokens for standard agents.

---

## Current state

### Context budget

The affected local model configuration currently declares:

```text
context = 32768
output  = 8192
usable  = 32768 - 8192 = 24576
automatic compaction threshold = 24576 * 0.75 = 18432
```

Observed provider usage reached approximately `33k-34k` input tokens while the visible conversation was much smaller. The provider input includes system/developer prompts, tool definitions and JSON Schema, plugin/skill injections, conversation history, and the current user message. Prompt caching can lower latency or billing, but cached tool definitions still occupy the model context window.

### Tool construction path

1. `backend/cli/src/tool/registry.ts` `all()` returns the general coding tools plus science, provenance, notebook, R kernel, artifact, learning, plugin, and custom tools. Only a few domain-specific tools are filtered by agent or provider.
2. `backend/cli/src/session/prompt.ts` `resolveTools()` initializes native tools and converts their Zod parameters to JSON Schema.
3. The same function calls `MCP.tools()` and adds every tool from every connected MCP client.
4. `backend/cli/src/session/llm.ts` `modelTools()` removes tools only after construction, based on model support, per-message `false` values, and deny permissions.
5. `backend/cli/src/mcp/index.ts` calls `listTools()` during connection, discards that manifest, and calls `listTools()` again for every `MCP.tools()` request. A `tools/list_changed` notification is already handled, but it currently publishes an event instead of invalidating a manifest cache.

### Availability and permission are conflated

Permissions currently influence both whether a tool may execute and whether its schema is sent. These are separate concerns:

- **Availability:** whether the model sees the tool definition for this agent and turn.
- **Permission:** whether a selected tool invocation is allowed, denied, or requires approval.

An availability profile must never grant permission. A permission deny must continue to remove the tool as defense in depth.

The per-message wildcard behavior is also not a real allowlist. In `session/llm.ts`, `"*": false` currently removes every tool even when an individual tool is explicitly `true`.

---

## Goals

1. Send only task-relevant tool definitions to the model.
2. Filter tools before initialization and JSON Schema conversion.
3. Avoid repeated MCP discovery when the server manifest has not changed.
4. Bound oversized tool results **without destroying factual evidence** the model needs for Research Graph, provenance, and debugging (conservative truncation + recoverable artifacts).
5. Measure context by component so regressions are visible.
6. Preserve existing permissions, plugin hooks, tool execution behavior, and Research Graph stage/graph generation.

## Non-goals

- Replacing the current harness with Pi or another agent runtime.
- Treating a larger model context window as the primary fix.
- Combining all operations into one free-form dispatcher tool; this would reduce schema size at the cost of validation, permission precision, and reliable tool selection.
- Fixing the separate synthetic-continuation ordering bug in compaction. That correctness issue should be tracked independently even if this work makes compaction less frequent.
- **LLM-generated summaries of tool results as a truncation strategy.** Summaries may drop ERROR lines and invent “all green”; truncation must stay deterministic (head/tail/field keep-lists), never model-rewritten evidence.

---

## Proposed design

### 1. Add context composition telemetry

Record the estimated serialized size and token count for:

```text
system prompts
native tool definitions
plugin tool definitions
MCP tool definitions, grouped by server
conversation messages
tool results and media
current user message
provider-reported input/cache/output usage
```

Provider usage remains the source of truth for total tokens. Component estimates are diagnostic because provider tokenizers and hidden wrappers differ. Logs must contain counts and tool IDs, never secrets or full prompt content.

### 2. Introduce explicit tool availability

Add a non-deprecated agent-level availability field, separate from `permission`. Proposed shape:

```jsonc
{
  "agent": {
    "research": {
      "toolset": [
        "question",
        "read",
        "glob",
        "grep",
        "skill",
        "stage",
        "webfetch",
        "websearch",
        "provenance_*",
        "atlas_*"
      ]
    }
  }
}
```

`toolset` supports exact IDs and existing wildcard matching semantics. An absent `toolset` preserves the current all-tools behavior for backward compatibility during rollout.

Per-message overrides use these rules:

```text
tools["*"] === false -> default excluded; explicitly true tools are included
otherwise             -> default included; explicitly false tools are excluded
permission deny       -> always excluded, regardless of availability
```

Selection precedence:

```text
model capability
-> agent toolset
-> per-message override
-> permission deny
-> final selected tool IDs
```

### 3. Define task-oriented profiles

Initial profiles should be explicit configuration rather than model-generated routing:

| Profile | Intended tools |
| --- | --- |
| `chat` | no tools, or `question` only when interactive input is required |
| `code` | `read`, `glob`, `grep`, `bash`, and the provider-appropriate edit/patch tool |
| `research` | search/fetch, skills, scientific and provenance tools, and `stage` |
| `graph` | `stage` plus `atlas_graph`, `atlas_stage`, and other explicitly required Atlas tools |
| `compute` | notebook, R kernel, artifact, and the minimum file tools required for results |

Primary agents may compose profiles, but each resulting tool ID is deduplicated before schema construction. Dynamic routing can be evaluated later; the first release must remain deterministic and debuggable.

### 4. Filter before schema construction

Refactor the tool path to:

```text
resolve availability policy
-> select native/plugin tool metadata by ID
-> initialize only selected tools
-> generate only selected JSON Schema
-> fetch selected MCP manifests from cache
-> convert only selected MCP definitions
-> send the final tool set to the provider
```

`ToolRegistry.tools()` should accept the selected patterns or IDs before calling each tool's `init()`. `MCP.tools()` should accept a server/tool filter and avoid converting excluded definitions.

### 5. Cache MCP manifests (🟠 high risk: capability / tool-context loss)

**Threat model:** A bad cache makes the model “think” tools exist (or look like) yesterday’s schema, or briefly see **zero** tools after a failed refresh — both erase capability context for that turn.

Store the successful `listTools()` result obtained during MCP connection. Reuse it across turns. Invalidate when:

- the existing `tools/list_changed` notification arrives;
- the client reconnects or is replaced;
- the MCP configuration changes;
- an explicit refresh is requested;
- **TTL expires** (hard ceiling, default **5 minutes**, configurable) — notification loss must not leave a zombie manifest forever.

#### Cache correctness rules

1. **Last-good retention:** A failed refresh must **not** replace a previously successful manifest with an empty set. Keep serving last-good tools while marking the server `degraded` / `refresh_failed`, and schedule reconnect. Only clear the manifest when the client is actually disconnected or config disables the server.
2. **Single-flight refresh:** Concurrent consumers share one in-flight `listTools()`. The first failure must not poison siblings into “no tools”; waiters receive last-good or the successful new manifest.
3. **Stale-schema surfacing:** If a call fails with “unknown tool” / schema mismatch, force invalidate + refresh before retry (once), and log `cache_stale_call`.
4. **Observability (required):** every path logs non-sensitive counters: `cache_hit`, `cache_miss`, `cache_invalidate` (reason), `cache_refresh_ok`, `cache_refresh_failed`. No tool argument/result bodies.
5. **Degrade path on refresh failure:** prefer **reconnect then listTools** over returning `{}`. Returning empty tool definitions for a still-configured server is a product bug unless the server is confirmed down.
6. **Filter after cache:** convert only tool IDs selected by the agent `toolset`; do not skip caching because of filtering.

Roll out behind `experimental.mcp_manifest_cache` (default off until soak). TTL and last-good behavior are acceptance blockers, not polish.

### 6. Bound tool-result context (🔴 critical risk: factual evidence loss)

**Threat model:** Truncation / pagination / artifact-swap runs **before** evidence enters the model. Defective policies cause “eyes open, facts missing”: omitted citations, lost ERROR lines, broken artifact pointers → hallucination and incomplete Research Graph nodes.

**Principle: conservative, deterministic truncation.** Prefer spending hundreds of extra tokens to keep complete structured evidence over aggressive cuts. **Never** use an LLM to “summarize” tool output for context savings.

Extend existing `tool/truncation.ts` (line/byte spill to `tool-output/`) rather than inventing a parallel pipeline.

#### Required behaviors

- **Deterministic budgets:** head/tail by lines/bytes; optional per-tool overrides. No semantic rewrite.
- **Search / list pagination:** if only the first page is inlined, the model-visible payload must include (a) total hit count when known, (b) stable identifiers for **every** omitted hit or an explicit `next_page` / fetch token, and (c) a clear `truncated: true` marker. Prefer “IDs + titles for all hits, abstracts only for top N” over silently dropping hits 4–10.
- **Logs:** prefer **tail** retention (recent lines) and always keep lines matching severity patterns (`ERROR`, `FATAL`, `Exception`, `Traceback`) even when over budget (severity-priority window). Do not collapse logs to “service healthy”.
- **Artifact spill:** oversized text/JSON is stored as a file/artifact; the model receives a short deterministic stub: byte/line counts, truncation reason, and a **session-stable absolute or workspace-relative path** that `read` (or an existing artifact tool) can open in later turns. Paths must survive compaction prune of the full body.
- **Binary / images:** attachments/references instead of inline Base64 when the provider path allows it (unchanged intent).
- **Structured keep-lists (hard no-truncate zones):** for `stage`, `atlas_*` (especially `atlas_graph` / `atlas_stage`), and provenance tools, **never** strip node IDs, edge endpoints, graph/experiment IDs, stage indices, or `meta.medhorizon_stage` fields. If the payload is large, spill narrative/markdown blobs only; keep the structured graph/stage skeleton fully inline.
- **MCP same-loop audit:** verify whether the AI SDK forwards truncated `output` vs full structured `content`; the model must not see a truncated string while a full unreferenced blob is discarded.

#### Failure modes to test explicitly

| Failure | Required outcome |
| --- | --- |
| Search returns 10 hits, budget fits 3 full rows | Model still sees all 10 IDs/titles + how to fetch the rest |
| Log contains one ERROR amid noise | ERROR line retained after truncation |
| Artifact path after spill | Subsequent `read` succeeds; stub mentions truncated=true |
| `atlas_graph` create/get large graph | All node/edge IDs remain inline |
| Truncator bug | Prefer pass-through full result over wrong summary |

Gate behind `experimental.tool_result_bound` (default off). Research Graph e2e (stage land + graph create) is a merge blocker for enabling the flag.

### 7. Reduce the largest schemas

Only after telemetry identifies the largest definitions:

- shorten descriptions to invocation conditions and essential semantics;
- remove repeated examples and duplicated property prose;
- simplify unnecessary nested unions and oversized enums;
- retain strict argument validation and tool-specific permissions;
- add schema-size regression assertions for the largest profiles.

### 8. Calibrate compaction after fixed overhead falls

Do not raise `context`, lower the output reserve, or increase the compaction threshold until the actual provider/model limit is verified. After tool optimization, use provider-reported usage to confirm the remaining headroom and then adjust compaction configuration if needed. Prompt caching is a performance optimization, not a context optimization.

---

## Implementation tasks

### Task 1: Establish the baseline

**Description:** Add non-sensitive context composition telemetry and capture baseline requests for `chat`, `code`, `research`, `graph`, and `compute` profiles.

**Acceptance criteria:**

- [x] Every model request reports component estimates and provider total usage.
- [x] Tool counts and serialized schema sizes are grouped by native/plugin/MCP source.
- [x] Logs do not include prompt bodies, tool arguments, credentials, or result content.

**Verification:** focused telemetry tests plus one local request per profile.

**Likely files:** `session/llm.ts`, `session/prompt.ts`, `session/telemetry.ts`, adjacent tests.

### Task 2: Implement availability policy and allowlist semantics

**Description:** Add `agent.toolset`, implement deterministic wildcard matching, and correct per-message `"*": false` behavior without changing permission authorization.

**Acceptance criteria:**

- [x] `"*": false` plus `read: true` exposes only `read`.
- [x] Explicit `false` removes a tool from a default-inclusive set.
- [x] A permission deny removes a tool even when its availability is true.
- [x] Existing agents without `toolset` retain current behavior.

**Verification:** `bun test test/session/llm.test.ts test/config/config.test.ts` from `backend/cli`.

**Likely files:** `config/config.ts`, `session/llm.ts`, `agent/agent.ts`, corresponding tests.

### Task 3: Filter native and plugin tools before initialization

**Description:** Pass the resolved selection into `ToolRegistry` before tool initialization and Schema generation.

**Acceptance criteria:**

- [x] Excluded tools do not execute `init()` and do not generate JSON Schema.
- [x] Provider-specific edit/patch selection still works.
- [x] Plugin hooks still wrap every selected tool exactly once.

**Verification:** registry and prompt integration tests with real tool definitions; no mocks of selection logic.

**Likely files:** `tool/registry.ts`, `session/prompt.ts`, adjacent tests.

### Task 4: Cache and filter MCP tools 🟠

**Description:** Retain connection-time manifests with TTL + last-good semantics, invalidate from lifecycle events, log cache outcomes, and convert only tools selected for the current agent. **Must not** turn refresh failures into empty toolsets.

> **Deferred** — skipped in the first landing of tasks 1–3/5; redesign below is required before implementation.

**Acceptance criteria:**

- [x] Repeated turns do not call `listTools()` on cache hit when the manifest is within TTL and not invalidated.
- [x] `tools/list_changed`, reconnect, config change, explicit refresh, and **TTL expiry** each invalidate before next use.
- [x] Concurrent refresh is single-flight; a failed refresh keeps **last-good** tools and logs `cache_refresh_failed` (then reconnect), never silently serves `{}` for a configured live server.
- [x] Logs emit `cache_hit` / `cache_miss` / `cache_invalidate` / `cache_refresh_ok` / `cache_refresh_failed` without secrets or bodies.
- [x] Unknown-tool / schema-mismatch execution forces one invalidate+refresh before surfacing failure (`cache_stale_call`).
- [x] Disconnected or disabled servers contribute no tool definitions.
- [x] An Atlas-only / toolset-filtered profile still converts only matching MCP IDs from the cached manifest.
- [x] Feature flag `experimental.mcp_manifest_cache` defaults off until soak.

**Verification:** MCP integration tests (SDK test server): hit path, TTL expiry, failed refresh retains last-good, list_changed invalidation, concurrent callers.

**Likely files:** `mcp/index.ts`, `mcp/manifest-cache.ts`, `session/prompt.ts`, config experimental flag, MCP tests.

### Checkpoint: Tool selection path

- [x] `bun test` passes from `backend/cli` (focused plan-13 suites; full suite has known Windows env timeouts).
- [ ] Empty-session provider input is materially lower for every restricted profile.
- [ ] Tool permissions and approval prompts are unchanged.

### Task 5: Add initial agent profiles

**Description:** Configure the shipped agents with the minimum deterministic toolsets required for their documented workflows.

**Acceptance criteria:**

- [x] Ordinary chat does not receive scientific, compute, or graph schemas.
- [x] Research retains search, scientific, provenance, skill, and stage workflows.
- [x] Research Graph can still call `stage` and the required `atlas_*` tools.
- [x] Compute agents retain notebook/R/artifact capabilities without unrelated graph tools.

**Verification:** agent configuration tests and end-to-end smoke tests for one representative workflow per profile.

**Likely files:** `agent/agent.ts`, agent configuration/prompt files, agent tests.

### Task 6: Bound tool results 🔴

**Description:** Apply **conservative, deterministic** output budgets, artifact spill, and pagination to large tool responses (including same-loop MCP). Highest-risk task: defects delete facts the model never sees.

> **Deferred** — skipped in the first landing; implement only after Task 4 soak starts or in parallel behind a separate flag, with RG keep-list tests mandatory.

**Acceptance criteria:**

- [x] Oversized plain-text/log results can be spilled so the full body does not re-enter later model requests, while a stub + path remains.
- [x] Truncation is deterministic (no LLM summarization). Prefer retaining more tokens over aggressive cuts.
- [x] Truncated/spilled results remain retrievable via a **stable, model-usable path** (`read` / artifact) across later turns and after compaction prune of the full body.
- [x] Search/list truncation never drops hit identity without replacement metadata (all IDs/titles or explicit next-page token + total count).
- [x] Log truncation retains severity-matching lines (`ERROR` / `FATAL` / `Exception` / `Traceback`) even under budget pressure.
- [x] **Hard keep-list:** `stage`, `atlas_graph`, `atlas_stage`, other `atlas_*` graph payloads, and provenance structured IDs/edges are never stripped; only bulky narrative may spill.
- [x] MCP path audited so the model does not receive truncated `output` while discarding unrecovered structured `content`.
- [x] Feature flag `experimental.tool_result_bound` defaults off; enabling requires Research Graph stage+graph e2e green.

**Verification:** unit tests for keep-lists / severity retention / search pagination stubs; integration tests that `read` opens spilled paths; RG smoke for `atlas_graph` + `stage` land with large payloads.

**Likely files:** `tool/truncation.ts`, `session/prompt.ts`, tests.

### Task 7: Minimize measured schema outliers

**Description:** Reduce only the schemas identified by Task 1, preserving names, required fields, validation, and behavior.

**Acceptance criteria:**

- [ ] Standard profile schema totals meet their budgets.
- [ ] Existing valid tool calls remain valid.
- [ ] Invalid inputs remain rejected.

**Verification:** schema snapshots/size assertions and existing tool tests.

### Task 8: Validate context and compaction behavior

**Description:** Compare provider input usage before and after the work, then validate automatic compaction under realistic multi-turn sessions.

**Acceptance criteria:**

- [ ] Standard agents have fixed system-plus-tool overhead at or below `8,000` tokens on the configured tokenizer, or a documented provider-specific exception.
- [ ] Tool schemas remain below `5,000` tokens for each standard profile.
- [ ] A fresh short conversation does not compact solely because of fixed tool overhead.
- [ ] Research Graph stage and Atlas graph generation pass end to end.
- [ ] Full `bun test` passes from `backend/cli`.

**Verification:** baseline comparison report, session compaction tests, and Research Graph integration smoke test.

---

## Rollout

1. Land telemetry without behavior changes. ✅
2. Land tool selection / profiles behind `experimental.tool_profiles` (compat off restores all-tools). ✅
3. Compare failed tool-selection rates, token usage, latency, and compaction frequency on research vs ml/write.
4. **Task 4:** land MCP manifest cache behind `experimental.mcp_manifest_cache` (default off). Soak with TTL + last-good + cache metrics. Do not default-on until `cache_refresh_failed` never coincides with empty toolsets in logs.
5. **Task 6:** land result bounding behind `experimental.tool_result_bound` (default off). Enable only after keep-list + artifact `read` + RG e2e pass. Treat as higher review bar than Task 4.
6. Make profile-based selection the long-term default after Research Graph and compute workflows pass.
7. Remove compatibility flags only after legacy configurations have a documented migration path.

Fallback behavior for an unavailable tool must be explicit: report that the current profile does not expose it and allow one controlled profile expansion on the next model turn. Do not silently restore the entire tool registry.

Task 4 / Task 6 must not ship “fail open into silence” (empty tools or empty evidence). Prefer last-good / pass-through full result.

---

## Risks and mitigations

| Risk | Severity | Impact | Mitigation |
| --- | --- | --- | --- |
| Required tool omitted from a profile | Medium | Agent cannot complete a valid workflow | Deterministic profiles, integration tests, bounded profile expansion |
| Availability bypasses permission | High | Security regression | Permission after availability; deny always removes |
| **MCP cache stale after missed `list_changed`** | 🟠 High | Model calls obsolete schemas; tool data missing that turn | TTL hard cap; invalidate on notify/reconnect/config; stale-call forced refresh |
| **MCP refresh failure clears tools** | 🟠 High | Entire server toolset disappears; “I can’t do that” | Last-good retention; reconnect degrade; never replace good cache with `{}` on refresh error; `cache_refresh_failed` metrics |
| Provider token estimate differs | Low | Misleading budgets | Compare estimates with provider-reported usage |
| Schema reduction changes semantics | Medium | Invalid or ambiguous tool calls | Preserve validation; schema/tool-call regression tests |
| **Tool result truncation drops citations / ERROR / graph IDs** | 🔴 Critical | Hallucination, incomplete graphs, blind debugging | Conservative budgets; no LLM summaries; search ID keep-all; severity retention; hard keep-list for `stage`/`atlas_*`/provenance |
| **Artifact path unreadable later** | 🔴 Critical | Model knows “something existed” but cannot fetch facts | Stable path + `read`/artifact contract tests across turns and compaction |
| Larger context masks the regression | Medium | Overhead returns unnoticed | Per-profile schema budgets + CI assertions |
| Compaction still masks a real user request | Medium | Incorrect conversation behavior | Track synthetic-continuation ordering separately |

---

## Definition of done

- [ ] Context composition is measurable without logging sensitive content.
- [ ] Agent and per-message allowlists work with backward-compatible defaults.
- [ ] Excluded tools are filtered before initialization and Schema conversion.
- [ ] MCP manifests are cached with TTL + last-good semantics and never empty-out a live server on refresh failure.
- [ ] Tool results are bounded conservatively; graph/stage/provenance keep-lists hold; spilled artifacts remain `read`-able.
- [ ] Standard fixed context and tool-schema budgets are met.
- [ ] Permissions, plugin hooks, provider-specific tool behavior, and Research Graph workflows have no regression.
- [ ] `bun test` passes from `backend/cli`.

---

## Status

**In progress** (2026-07-31). Tasks **1–6 landed** (4/6 behind experimental flags, default off). Tasks **7–8** remain.

### Progress (2026-07-31)

| Task | Status | Notes |
| --- | --- | --- |
| 1 — Context telemetry | **done** | `SessionTelemetry.recordContext` + `recordUsage`; tool groups by native/plugin/MCP; wired in `LLM.stream` and `processor` |
| 2 — Availability policy | **done** | `agent.toolset`, `ToolSelection`, `"*": false` allowlist fix in `LLM.modelTools` |
| 3 — Pre-init filtering | **done** | `ToolRegistry.tools(..., selected)` skips `init()`/schema for excluded IDs; MCP filtered post-fetch |
| 4 — MCP cache | **done** | `mcp/manifest-cache.ts`; TTL (default 5m), last-good, single-flight, cache metrics; flag `experimental.mcp_manifest_cache` (default off) |
| 5 — Agent profiles | **done** | `tool/profile.ts` profiles; native agents configured; `research` includes `atlas_*` + `stage` |
| 6 — Tool-result bounding | **done** | `Truncate.bound`; keep-lists, search index, log severity, artifact spill; MCP content sync; flag `experimental.tool_result_bound` (default off) |

**Files touched (plan 13 scope):**

- `backend/cli/src/session/telemetry.ts` — composition + tool-definition stats, `measureTools`, bus events
- `backend/cli/src/session/llm.ts` — telemetry hook, `"*": false` via `ToolSelection.applyMessage`
- `backend/cli/src/session/prompt.ts` — selection before init, origins for telemetry
- `backend/cli/src/session/processor.ts` — `recordUsage` on finish-step
- `backend/cli/src/session/message-v2.ts` — extended `Composition` (toolArgs, toolResults, user)
- `backend/cli/src/tool/selection.ts` — **new** availability + wildcard matching
- `backend/cli/src/tool/profile.ts` — **new** deterministic profiles
- `backend/cli/src/tool/registry.ts` — `selected` filter before `init()`
- `backend/cli/src/agent/agent.ts` — shipped agent `toolset` values
- `backend/cli/src/config/config.ts` — `agent.toolset`, `experimental.tool_profiles`
- `backend/cli/src/cli/cmd/debug/agent.ts` — respects toolset selection
- Tests: `test/session/telemetry.test.ts`, `test/session/llm.test.ts`, `test/tool/selection.test.ts`, `test/tool/registry.test.ts`, `test/agent/agent.test.ts`

**Profile table (native agents, `experimental.tool_profiles` default on):**

| Agent | Profile | Key tools |
| --- | --- | --- |
| `research`, `biology` | `RESEARCH` / `BIOLOGY` | read/edit/bash, skill, stage, web*, science_*, provenance_*, notebook, rkernel, artifact, **atlas_*** |
| `physics`, `ml` | `COMPUTE_WORKFLOW` | compute + science/provenance; **no atlas_*** |
| `plan` | `PLAN` | read/glob/grep, question, planwrite, plan_enter/exit |
| `task` | `TASK` | code + task + web* |
| `explore` | `EXPLORE` | read/glob/grep/bash/list + web* |
| `literature-review` | `LITERATURE` | read + web* + skill |
| `critique`, `reviewer` | `CRITIQUE` / `REVIEWER` | read-only + skill (reviewer + bash) |
| `physics-critique` | `PHYSICS_CRITIQUE` | read + bash |
| `write` | `WRITE` | read/edit + provenance + artifact; no graph/compute |
| `compaction`, `title` | `NONE` | no tools |

**Tests (`backend/cli`, focused):**

```bash
bun test test/session/telemetry.test.ts test/session/llm.test.ts test/tool/selection.test.ts test/tool/registry.test.ts test/agent/agent.test.ts
```

- **66 pass / 4 fail** on 2026-07-31 Windows run — failures are environmental (5s timeouts on first `Agent.list()` calls, plan-agent path permission on Windows, preload temp cleanup `EBUSY`); all plan-13 selection/telemetry/registry tests pass.
- `test/config/config.test.ts` not required for this slice; has unrelated env timeouts on this host.

- `backend/cli/src/mcp/manifest-cache.ts` — **new** MCP manifest cache (TTL, last-good, single-flight)
- `backend/cli/src/mcp/index.ts` — cache integration, stale-call refresh, lifecycle invalidation
- `backend/cli/src/tool/truncation.ts` — `Truncate.bound` conservative deterministic bounding
- `backend/cli/src/session/prompt.ts` — MCP bound truncation + content/output sync
- `backend/cli/src/config/config.ts` — `experimental.mcp_manifest_cache`, `mcp_manifest_cache_ttl_ms`, `experimental.tool_result_bound`
- Tests: `test/mcp/manifest-cache.test.ts`, `test/tool/truncation-bound.test.ts`

**Remaining gaps:**

- Task 7/8: schema outlier minimization and measured token baselines not done.
- Full Research Graph e2e with `experimental.tool_result_bound: true` recommended before default-on.
- MCP cache soak with `experimental.mcp_manifest_cache: true` before default-on.
