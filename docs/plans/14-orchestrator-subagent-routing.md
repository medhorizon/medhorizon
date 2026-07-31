# 14 — Orchestrator parent + narrow-toolset subagents

Workstream: move tool selection **up** to “which worker agent?” so the parent session no longer carries the full research tool schema every turn. Builds on [13 — Agent tool context optimization](13-agent-tool-context-optimization.md) (`toolset` / profiles) without replacing the MedHorizon harness with Pi.

**TL;DR:** Default `research` still exposes ~28 tool definitions (~13.5k estimated schema tokens) because the RESEARCH profile keeps science, compute, and local Research Graph (`atlas_*`) tools. Measured savings for research were only ~2.8%. Subagents such as `explore`, `literature-review`, `critique`, and `write` already have narrow toolsets, but the parent remains fat. This plan introduces an **Orchestrator mode**: a thin parent that mostly calls `task`, and workers that each ship a fixed, small tool pack. Optionally adopt a **Pi-like** coding worker (≈ four tools + short prompt) as one worker type—not as a wholesale runtime swap.

---

## Current state

### What plan 13 already shipped

- Agent-level `toolset` + `experimental.tool_profiles` (default on).
- Pre-`init` filtering in `ToolRegistry.tools(..., selected)`.
- Context telemetry for tool-definition sizes (`SessionTelemetry.measureTools`).
- Profiles in `backend/cli/src/tool/profile.ts` (RESEARCH, EXPLORE, LITERATURE, WRITE, COMPUTE_WORKFLOW, …).

### Measured gap (2026-07-31, tool schemas only, no MCP)

| Agent | Before → after (est. tokens) | Savings |
| --- | --- | --- |
| `research` | 13973 → 13575 | ~398 (2.8%) — almost full pack kept |
| `ml` / `physics` | ~14k → ~9.3–9.6k | ~31–32% — drop atlas/stage/todo |
| `write` | 13725 → 7059 | ~48.6% |
| `explore` / `critique` | unchanged | already permission-narrow |

`research.txt` alone is still ~7.5k estimated tokens (catalog prose + workflow). Skills are one meta-tool (`skill`); full SKILL.md loads on demand. Native/plugin tools still send **full JSON Schema every parent turn**.

### Existing subagent path

- `task` launches a child session with its own agent, prompt, and toolset (`backend/cli/src/tool/task.ts`).
- Workers already differ: `explore` (read/search), `literature-review`, `critique` / `reviewer`, `write`, `task`, etc.
- Nothing forces the default harness to stay thin: `research` prompt and toolset still encourage direct tool use.

### Pi (reference, not a dependency)

[Pi](https://pi.dev/) is a minimal coding harness: typically `read` / `write` / `edit` / `bash` plus a short system prompt; everything else is opt-in. Plan 13 **non-goal**: replace MedHorizon’s session loop with Pi. This plan only borrows the **shape** (tiny tool surface + short prompt) for a **coding worker**, still running inside MedHorizon’s `task` / permission / session machinery.

---

## What's broken / missing

1. **Parent context stays fat** — routing to subagents does not help if `research` still attaches ~28 schemas each turn.
2. **No first-class “route then execute” protocol** — models may call bash/atlas themselves instead of delegating.
3. **Role cards for the router are incomplete** — the parent needs a short catalog of workers (capabilities + when to use), not full tool schemas.
4. **Worker gaps** — no dedicated “exec/compute” or “graph” worker; biology-heavy and RG work still tends to stay on fat `research` / `biology`.
5. **Return path unbounded** — child dumps can re-bloat the parent unless summaries + artifact refs are required.

---

## Goals

1. Parent (orchestrator) fixed tool overhead small enough that short conversations do not compact solely due to tool schemas (target: on the order of a few tools, not ~28).
2. Deterministic mapping: each worker agent ↔ fixed `toolset` (no mega-dispatcher tool).
3. Clear multi-hop loop: route → worker → summarize → route or answer.
4. Preserve permissions, plugin hooks, and Research Graph workflows when the **graph/biology workers** run.
5. Optional Pi-like coding worker for edit/bash-heavy steps.
6. Measurable: telemetry compares orchestrator-parent vs legacy RESEARCH parent.

## Non-goals

- Replacing MedHorizon with the Pi runtime or Pi TUI.
- One free-form “call any tool by name” dispatcher (validation/permission/selection regress).
- Dynamic LLM-authored toolset lists as the v1 mechanism (v1 = pick named agents only).
- Mandatory reviewer gate (see [11](11-reviewer-agent.md)); may compose later.
- Finishing plan 13 tasks 4 (MCP cache) and 6 (result bounding) — tracked there; orchestrator benefits from them but does not block on them.

---

## Proposed design

### Mental model

```text
User task
    │
    ▼
┌─────────────────────────────────────┐
│ Step A — Orchestrator turn            │
│ Short prompt + tiny toolset           │
│ Tools: task, question?, todowrite?    │
│ (+ maybe read-only peek)              │
│ Output: which worker + brief          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step B — Worker subagent              │
│ Role prompt + narrow toolset only     │
│ skill() may load SKILL.md on demand   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step C — Orchestrator resume          │
│ Ingest <task_result> / artifacts      │
│ Route again or final answer           │
└─────────────────────────────────────┘
```

Tool choice for the parent becomes **role choice**. Schema cost moves into the child session.

### 1. Orchestrator agent (or research mode)

**Option A (preferred for rollout):** new primary agent `orchestrator` (or `research` mode flag `experimental.orchestrator: true`) so legacy fat `research` remains available.

**Option B:** replace default `research` toolset with the thin pack and rewrite `research.txt` — larger behavior change; gate behind config until smoke-tested.

**Orchestrator toolset (v1):**

```text
task
question          # structured clarify (optional but recommended)
todoread / todowrite
invalid
# optional: read only — if included, prompt must forbid using it to bypass workers
```

**Orchestrator prompt:** role catalog, delegation rules, “do not bash / do not atlas_* yourself”, how to write worker briefs, how to consume summaries.

### 2. Worker catalog (role cards for the router)

Ship as prompt table + existing/new agents. Schemas stay on the worker side.

| Worker | Purpose | Tool pack (illustrative) |
| --- | --- | --- |
| `explore` | Codebase / filesystem reconnaissance | EXPLORE |
| `literature-review` | Papers / web evidence | LITERATURE |
| `write` | Manuscript / notes editing | WRITE |
| `critique` / `reviewer` | Methodology / claim review | CRITIQUE / REVIEWER |
| `pi-code` *(new or alias)* | Pi-like coding: edit + shell | CODE (± glob/grep); **short** prompt |
| `compute-exec` *(new or reuse ml/physics)* | Notebook / R / analysis scripts | COMPUTE_WORKFLOW without atlas |
| `graph` *(new)* | Local Research Graph | GRAPH (`stage`, `atlas_*`, minimal read) |
| `biology` | Bio DB + research pack | BIOLOGY — use when orchestrator delegates domain work |

Parent prompt lists **when to pick whom**, not each tool’s JSON Schema.

### 3. Delegation contract

Worker brief (from orchestrator → `task`) must include:

- Goal and constraints
- Relevant paths / graph ids / prior artifact ids
- Definition of done

Worker return (already partially via `<task_result>`) must emphasize:

- Short outcome summary
- Paths / artifact ids / provenance ids
- Explicit failures (no silent skip)

Prompt-level first; tighten with structured result fields later if needed.

### 4. Pi-compatible worker (shape only)

- Agent `pi-code` (name TBD) with CODE toolset and &lt;~1–2k token system/workflow prompt.
- Still MedHorizon `task` child session, permissions, and telemetry.
- Do **not** embed Pi’s CLI as the default path; optional later escape hatch: shell-out to `pi` for package ecosystem experiments (out of v1 scope).

### 5. Rollout

1. Config flag `experimental.orchestrator` (or new agent hidden until ready).
2. Thin toolset + orchestrator prompt; keep fat `research` as fallback.
3. Add missing workers (`graph`, `pi-code`, `compute-exec`) as needed.
4. Compare telemetry: parent tool tokens, compaction frequency, failed-delegation rate.
5. Optionally make orchestrator the default for small-context local models only.

### 6. Relationship to plan 13

| Plan 13 | This plan |
| --- | --- |
| Profiles shrink each agent’s tools | Orchestrator makes the **default parent** use the smallest profile |
| research∋atlas kept workflow working | atlas moves to **graph** (or biology) worker; parent does not need atlas schemas |
| Avoid mega-dispatcher | Route by **named agent**, not by free-form tool list |
| Telemetry | Reuse to prove parent schema drop |

---

## Implementation tasks

### Task 1: Spec orchestrator prompt + role catalog

**Acceptance:** Draft prompt (new file or gated section) with worker table, delegation/return rules, and “no direct heavy tools” policy. Owner-readable in this plan’s appendix or `src/agent/prompt/orchestrator.txt`.

### Task 2: Wire thin toolset behind flag

**Acceptance:** `experimental.orchestrator` (or equivalent) selects ORCHESTRATOR toolset for the primary agent; `false` preserves current RESEARCH. Tests: selected IDs ⊆ `{task, question, todo*, invalid, …}`.

### Task 3: Fill worker gaps

**Acceptance:** At least `graph` and `pi-code` (or documented reuse of existing agents) registered with toolsets + short prompts; invocable via `task`.

### Task 4: Delegation smoke tests

**Acceptance:** Scripted or integration checks: orchestrator session tool count/tokens ≪ fat research; one literature + one coding delegation completes; Research Graph land still works when `graph` worker runs.

### Task 5: Telemetry report

**Acceptance:** Document before/after parent `measureTools` totals and one multi-hop session’s provider input pattern in plan Progress or `docs/notes/`.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Orchestrator bypasses workers (if tools left fat) | No savings | Keep parent toolset strictly thin |
| Wrong worker chosen | Wasted turns | Clear role cards; allow one re-route; `question` for ambiguity |
| Child result re-bloats parent | Context returns | Require summary + artifact refs; plan 13 task 6 helps |
| RG / stage forgotten | Graphs empty | Dedicated `graph` worker + orchestrator checklist for multi-phase work |
| Extra latency from hops | Slower UX | Parallel `task` where safe; don’t over-split trivial asks |
| Users prefer fat research | Confusion | Flag + keep legacy agent; document when to use which |

---

## Open decisions (owner)

1. New `orchestrator` agent vs flag on `research`?
2. Make orchestrator default for local small-context models only, or for all?
3. Must biology stay a primary, or only a worker under orchestrator?
4. Is `read` allowed on the parent for light peeking, or does that encourage bypass?

---

## Definition of done

- [ ] Orchestrator path exists behind config (or as a named agent).
- [ ] Parent tool schema cost materially below fat RESEARCH (telemetry).
- [ ] Workers cover literature, coding (Pi-like), compute, and local graph at minimum.
- [ ] Prompt forbids parent from doing worker jobs when orchestrator mode is on.
- [ ] Research Graph and permission behavior verified on worker path.
- [ ] Plan 13 non-goals respected (no Pi runtime swap, no mega-dispatcher).
- [ ] Focused `bun test` for toolset/agent wiring passes.

---

## Status

Plan drafted — 2026-07-31. Implementation not started. Depends on plan 13 profiles/`task` machinery already on `release/v0.3.11+`.
