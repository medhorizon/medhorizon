# 03 — Research Graph sidecar supervisor

**Status:** Planned

**Priority:** P0

**Dependencies:** None. This plan is the foundation for `tasks/plans/04-research-graph-gateway.md` and the Research Graph soak in `tasks/plans/02-agent-context-closeout.md`.

## Current state

- `backend/cli/src/sidecar/research-graph.ts` probes fixed `127.0.0.1:8000` and accepts any successful HTTP response.
- Concurrent callers are guarded only by `state.child` after spawn; there is no single-flight “starting” promise.
- The child is unreferenced, but its exit promise does not clear `state.child` or record a diagnostic.
- Readiness has no bounded state transition after spawn.
- `stopResearchGraphSidecar()` sends a signal and immediately forgets the child without waiting for exit.
- `research-graph/backend/routers/graphs.py` health output lacks stable service identity, version, and protocol fields.
- `research-graph/backend/services/auth.py` accepts fixed `local-dev/dev` tokens and permits unauthenticated non-production access.
- `research-graph/sidecar/entry.py` fixes port 8000 and does not provide a machine-readable discovery handshake.

## Problem

MedHorizon cannot prove that the process on port 8000 is Research Graph, cannot reliably distinguish starting/ready/exited state, and cannot recover cleanly after a crash. Fixed ports and sentinel credentials also prevent a trustworthy same-origin gateway because the browser-facing boundary would rest on a shared, guessable capability.

## Goals

1. Supervise one Research Graph child per MedHorizon process with explicit lifecycle states.
2. Require an authenticated service/version/protocol handshake before declaring readiness.
3. Use an OS-selected loopback port and a per-process random capability token.
4. Make concurrent start, timeout, abnormal exit, restart, and stop deterministic.
5. Emit actionable diagnostics without logging the token or response bodies.
6. Preserve explicit external-sidecar and disable workflows.

## Non-goals

- Proxying browser traffic or serving the embedded UI from MedHorizon.
- Resolving session-to-graph bindings.
- Rewriting FastAPI/React or changing Research Graph storage.
- Automatically installing or updating the sidecar binary.
- Running an unbounded automatic restart loop.
- Supporting non-loopback managed-sidecar binding.

## Proposed design

Model the supervisor as:

`idle -> starting -> ready -> stopping -> idle`

`starting -> failed -> idle`

`ready -> exited -> idle`

The in-memory state owns:

- one single-flight start promise;
- the child process;
- authenticated endpoint details;
- readiness deadline;
- last exit code/reason;
- a monotonically increasing generation used to ignore stale exit callbacks.

The packaged sidecar entry binds a loopback socket with port `0`, sets its public/UI origin from the selected port, and emits one machine-readable discovery record. MedHorizon then polls authenticated `/health` until the deadline. The discovery record and health response contain `service: "research-graph"`, semantic `version`, and integer `protocol`; the capability token is passed only through the child environment and never printed.

Managed sidecar authentication accepts the exact capability from configuration. Standalone development authentication remains an explicit opt-in rather than an implicit consequence of `APP_ENV != production`.

## Compatibility and rollback

- Keep `RESEARCH_GRAPH_DISABLE=1` as the immediate safe rollback: MedHorizon runs without the sidecar and reports the feature unavailable.
- Keep explicit `RESEARCH_GRAPH_API` for an externally managed service, but adopt it only after the same identity/protocol handshake.
- Permit the fixed-port legacy binary only behind an explicitly named temporary compatibility switch; never silently fall back after a discovery failure.
- Continue supporting ordinary Supabase JWT authentication for deployed Research Graph.
- During one compatibility release, `local-dev/dev` may be accepted only when an explicit standalone-development bypass is enabled.
- A supervisor rollback must not restore “any 2xx on port 8000 is healthy.”

## Implementation tasks

### Task 1: Version the health and capability contract

**Description:** Extend Research Graph settings, health schema, health route, and auth dependency with stable identity/protocol fields and a managed capability.

**Acceptance criteria:**

- [ ] `/health` returns `status`, `service`, `version`, `protocol`, `mode`, `store`, and `openai`.
- [ ] Service and protocol values come from one source of truth, not duplicated literals.
- [ ] A managed sidecar rejects missing and incorrect capabilities.
- [ ] JWT behavior for deployed Research Graph remains intact.
- [ ] Fixed development tokens require an explicit dev-bypass setting.

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_contract.py backend/tests/test_phase1.py`

**Dependencies:** None.

**Files likely touched:**

- `research-graph/backend/config.py`
- `research-graph/backend/models/schemas.py`
- `research-graph/backend/routers/graphs.py`
- `research-graph/backend/services/auth.py`
- `research-graph/backend/tests/test_sidecar_contract.py`

**Estimated scope:** M — 5 files.

### Task 2: Add dynamic loopback discovery to the sidecar entry

**Description:** Bind an OS-selected loopback port, set origins before importing the FastAPI app, and emit a single readiness/discovery record for the parent.

**Acceptance criteria:**

- [ ] The managed child binds only `127.0.0.1` and does not require port 8000.
- [ ] Two MedHorizon instances can launch separate sidecars without a port collision.
- [ ] The record contains port, service, version, and protocol but never the capability.
- [ ] Public API/UI origins match the selected port before settings are cached.
- [ ] Malformed or missing discovery data causes a bounded startup failure.

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_entry.py`
- [ ] Launch two real entry processes concurrently and verify distinct loopback ports and valid authenticated health responses.

**Dependencies:** Task 1.

**Files likely touched:**

- `research-graph/sidecar/entry.py`
- `research-graph/backend/config.py`
- `research-graph/backend/tests/test_sidecar_entry.py`

**Estimated scope:** M — 3 files.

### Task 3: Implement the supervisor state machine

**Description:** Replace the nullable-child check with single-flight start, discovery parsing, authenticated readiness, exit cleanup, bounded stop, and safe restart.

**Acceptance criteria:**

- [ ] Concurrent starts return the same in-flight result and create exactly one child.
- [ ] Readiness requires matching service/protocol identity and capability.
- [ ] A wrong service returning 2xx fails with a stable `identity_mismatch` diagnostic.
- [ ] Startup timeout terminates and reaps the child, clears state, and permits retry.
- [ ] Abnormal exit clears ready state and records exit code/reason.
- [ ] Stop is idempotent, waits for graceful exit, then performs one bounded escalation if required.
- [ ] `serve` and `web` await orderly shutdown without orphaning the managed child.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/sidecar/research-graph.test.ts`
- [ ] `(cwd: backend/cli) bun run typecheck`

**Dependencies:** Tasks 1–2.

**Files likely touched:**

- `backend/cli/src/sidecar/research-graph.ts`
- `backend/cli/src/cli/cmd/serve.ts`
- `backend/cli/src/cli/cmd/web.ts`
- `backend/cli/test/sidecar/research-graph.test.ts`

**Estimated scope:** M — 4 files.

### Task 4: Add black-box lifecycle and diagnostics coverage

**Description:** Exercise the actual spawn/HTTP implementation using a real fixture process and the real Python sidecar; do not replace `Bun.spawn` or `fetch` with behavior-copying mocks.

**Acceptance criteria:**

- [ ] Tests cover concurrent start, wrong-service collision, readiness timeout, clean exit, crash, restart, and repeated stop.
- [ ] A parent shutdown leaves no fixture or Research Graph child alive.
- [ ] Diagnostics include lifecycle state, endpoint, elapsed time, and exit reason.
- [ ] Logs and thrown errors never include the capability token.
- [ ] Explicit external API and disable modes have characterization tests.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/sidecar/research-graph.test.ts`
- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_contract.py backend/tests/test_sidecar_entry.py`
- [ ] `(cwd: backend/cli) bun test`

**Dependencies:** Task 3.

**Files likely touched:**

- `backend/cli/test/sidecar/research-graph.test.ts`
- `backend/cli/test/fixture/research-graph-sidecar.ts`
- `backend/cli/src/sidecar/research-graph.ts`
- Research Graph sidecar test fixtures

**Estimated scope:** M — 3–4 files.

## Checkpoint

- [ ] Concurrent startup creates one managed child.
- [ ] Only the expected authenticated service/protocol reaches ready state.
- [ ] Port selection is dynamic and loopback-only.
- [ ] Timeout, crash, stop, and restart leave supervisor state correct and no orphan process.
- [ ] External and disabled modes remain explicit and tested.
- [ ] Focused Python/Bun tests, full backend/CLI suite, and typecheck pass.

## Risks

| Risk                                            | Impact                                 | Mitigation                                                                          |
| ----------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Cross-platform process semantics differ         | Orphans or flaky stop tests on Windows | Test real child processes on Windows and POSIX; use bounded graceful/escalated stop |
| Discovery is emitted before service readiness   | Parent routes traffic too early        | Treat discovery as endpoint discovery only; require authenticated health polling    |
| Legacy packaged binary lacks discovery          | Upgrade appears broken                 | Explicit, time-limited legacy switch and clear incompatible-binary diagnostic       |
| Capability leaks through logs/environment dumps | Local privilege boundary weakens       | Never print it; redact named keys; test diagnostics                                 |
| Dynamic origin is cached too early              | UI/API URLs point to port 8000         | Bind socket and set environment before importing the app/settings                   |

## Definition of done

- [ ] Supervisor lifecycle is explicit, single-flight, and restartable.
- [ ] Health identity and auth contracts are versioned and tested.
- [ ] Managed sidecars use dynamic loopback ports and random capabilities.
- [ ] Wrong services and incompatible protocols fail closed.
- [ ] Crash and shutdown leave no stale state or orphan child.
- [ ] Compatibility and rollback switches are documented and tested.
- [ ] Full `bun test` from `backend/cli`, Research Graph focused pytest, and typecheck pass.
