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
4. Keep large tool results outside the rolling conversation and return compact references.
5. Measure context by component so regressions are visible.
6. Preserve existing permissions, plugin hooks, tool execution behavior, and Research Graph stage/graph generation.

## Non-goals

- Replacing the current harness with Pi or another agent runtime.
- Treating a larger model context window as the primary fix.
- Combining all operations into one free-form dispatcher tool; this would reduce schema size at the cost of validation, permission precision, and reliable tool selection.
- Fixing the separate synthetic-continuation ordering bug in compaction. That correctness issue should be tracked independently even if this work makes compaction less frequent.

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

### 5. Cache MCP manifests

Store the successful `listTools()` result obtained during MCP connection. Reuse it across turns and invalidate only when:

- the existing `tools/list_changed` notification arrives;
- the client reconnects or is replaced;
- the MCP configuration changes;
- an explicit refresh is requested.

After invalidation, the next consumer refreshes the manifest once. Concurrent requests share the same in-flight refresh. A failed refresh retains no stale executable client binding and exposes the existing failed status.

### 6. Bound tool-result context

Apply per-tool output budgets before results enter subsequent model steps or persisted message history:

- Search, logs, tables, and database-style results are paginated.
- Large text/JSON is stored as an artifact and represented by a summary plus path or resource ID.
- Binary data and images use attachments/references instead of inline Base64 wherever the provider path allows it.
- Truncation states that content was truncated and provides a deterministic retrieval path.
- Structured results retain the fields required by downstream tool calls and Research Graph provenance.

Audit the current MCP wrapper because it returns both truncated `output` and original structured `content`; verify what the AI SDK sends back to the model during the same tool loop.

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

- [ ] Every model request reports component estimates and provider total usage.
- [ ] Tool counts and serialized schema sizes are grouped by native/plugin/MCP source.
- [ ] Logs do not include prompt bodies, tool arguments, credentials, or result content.

**Verification:** focused telemetry tests plus one local request per profile.

**Likely files:** `session/llm.ts`, `session/prompt.ts`, `session/telemetry.ts`, adjacent tests.

### Task 2: Implement availability policy and allowlist semantics

**Description:** Add `agent.toolset`, implement deterministic wildcard matching, and correct per-message `"*": false` behavior without changing permission authorization.

**Acceptance criteria:**

- [ ] `"*": false` plus `read: true` exposes only `read`.
- [ ] Explicit `false` removes a tool from a default-inclusive set.
- [ ] A permission deny removes a tool even when its availability is true.
- [ ] Existing agents without `toolset` retain current behavior.

**Verification:** `bun test test/session/llm.test.ts test/config/config.test.ts` from `backend/cli`.

**Likely files:** `config/config.ts`, `session/llm.ts`, `agent/agent.ts`, corresponding tests.

### Task 3: Filter native and plugin tools before initialization

**Description:** Pass the resolved selection into `ToolRegistry` before tool initialization and Schema generation.

**Acceptance criteria:**

- [ ] Excluded tools do not execute `init()` and do not generate JSON Schema.
- [ ] Provider-specific edit/patch selection still works.
- [ ] Plugin hooks still wrap every selected tool exactly once.

**Verification:** registry and prompt integration tests with real tool definitions; no mocks of selection logic.

**Likely files:** `tool/registry.ts`, `session/prompt.ts`, adjacent tests.

### Task 4: Cache and filter MCP tools

**Description:** Retain connection-time manifests, invalidate them from existing lifecycle events, and convert only tools selected for the current agent.

**Acceptance criteria:**

- [ ] Repeated turns do not call `listTools()` when the manifest is unchanged.
- [ ] `tools/list_changed` causes one refresh before the next use.
- [ ] Disconnected or disabled servers contribute no tool definitions.
- [ ] An Atlas-only profile sends only matching `atlas_*` tools.

**Verification:** MCP integration tests using the actual SDK test server implementation where available.

**Likely files:** `mcp/index.ts`, `session/prompt.ts`, MCP tests.

### Checkpoint: Tool selection path

- [ ] `bun test` passes from `backend/cli`.
- [ ] Empty-session provider input is materially lower for every restricted profile.
- [ ] Tool permissions and approval prompts are unchanged.

### Task 5: Add initial agent profiles

**Description:** Configure the shipped agents with the minimum deterministic toolsets required for their documented workflows.

**Acceptance criteria:**

- [ ] Ordinary chat does not receive scientific, compute, or graph schemas.
- [ ] Research retains search, scientific, provenance, skill, and stage workflows.
- [ ] Research Graph can still call `stage` and the required `atlas_*` tools.
- [ ] Compute agents retain notebook/R/artifact capabilities without unrelated graph tools.

**Verification:** agent configuration tests and end-to-end smoke tests for one representative workflow per profile.

**Likely files:** `agent/agent.ts`, agent configuration/prompt files, agent tests.

### Task 6: Bound tool results

**Description:** Apply output budgets, artifact references, and pagination to large tool responses, including same-loop MCP results.

**Acceptance criteria:**

- [ ] Oversized results do not re-enter later model requests in full.
- [ ] Truncated results remain retrievable by a stable path or resource ID.
- [ ] Structured fields required by provenance and Atlas workflows remain intact.

**Verification:** truncation tests using actual tool-result conversion and persistence paths.

**Likely files:** `tool/truncation.ts`, `session/prompt.ts`, `session/message-v2.ts`, tool-specific result adapters, tests.

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

1. Land telemetry without behavior changes.
2. Land selection and MCP cache behind an experimental configuration flag.
3. Enable restricted profiles for internal/default agents while preserving an all-tools compatibility profile.
4. Compare failed tool-selection rates, token usage, latency, and compaction frequency.
5. Make profile-based selection the default after Research Graph and compute workflows pass.
6. Remove the compatibility flag only after legacy configurations have a documented migration path.

Fallback behavior for an unavailable tool must be explicit: report that the current profile does not expose it and allow one controlled profile expansion on the next model turn. Do not silently restore the entire tool registry.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Required tool omitted from a profile | Agent cannot complete a valid workflow | Deterministic profiles, integration tests, and one bounded profile expansion |
| Availability bypasses permission | Security regression | Permission is evaluated after availability and can only remove/deny |
| MCP manifest becomes stale | Wrong or missing remote tools | Invalidate on notification, reconnect, config change, and explicit refresh |
| Provider token estimate differs | Misleading budgets | Compare component estimates with provider-reported total usage |
| Schema reduction changes semantics | Invalid or ambiguous tool calls | Preserve validation and add schema/tool-call regression tests |
| Tool results lose required evidence | Research/provenance regression | Store full artifacts and keep stable references plus essential structured fields |
| Larger context masks the regression | Repeated overhead returns unnoticed | Keep per-profile schema budgets and CI assertions independent of model window |
| Compaction still masks a real user request | Incorrect conversation behavior | Track and fix synthetic-continuation ordering separately |

---

## Definition of done

- [ ] Context composition is measurable without logging sensitive content.
- [ ] Agent and per-message allowlists work with backward-compatible defaults.
- [ ] Excluded tools are filtered before initialization and Schema conversion.
- [ ] MCP manifests are cached and correctly invalidated.
- [ ] Tool results are bounded and recoverable through references.
- [ ] Standard fixed context and tool-schema budgets are met.
- [ ] Permissions, plugin hooks, provider-specific tool behavior, and Research Graph workflows have no regression.
- [ ] `bun test` passes from `backend/cli`.

---

## Status

Plan drafted - implementation not started.
