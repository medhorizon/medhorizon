# 03 — Research Graph sidecar supervisor

**Status:** Done

**Priority:** P0

**Dependencies:** Plan 00 CI/test guardrails. This plan is the foundation for `tasks/plans/04-research-graph-gateway.md` and the Research Graph soak in `tasks/plans/02-agent-context-closeout.md`.

## Current state

- `backend/cli/src/sidecar/research-graph.ts` probes fixed `127.0.0.1:8000` and accepts any successful HTTP response.
- The `/health` route has no auth dependency, so the current probe proves neither possession of a managed capability nor ownership of the process on the port.
- Concurrent callers are guarded only by `state.child` after spawn; there is no single-flight “starting” promise.
- The child is unreferenced, but its exit promise does not clear `state.child` or record a diagnostic.
- Readiness has no bounded state transition after spawn.
- `stopResearchGraphSidecar()` sends a signal and immediately forgets the child without waiting for exit.
- The managed child is spawned with `stdout: "ignore"`, so there is no channel from which to parse a discovery record.
- `research-graph/backend/routers/graphs.py` health output lacks stable service identity, version, and protocol fields.
- `research-graph/backend/services/auth.py` accepts fixed `local-dev/dev` tokens and permits unauthenticated non-production access.
- `research-graph/sidecar/entry.py` fixes port 8000 and does not provide a machine-readable discovery handshake.

## Problem

MedHorizon cannot prove that the process on port 8000 is Research Graph, cannot reliably distinguish starting/ready/exited state, and cannot recover cleanly after a crash. Fixed ports and sentinel credentials also prevent a trustworthy same-origin gateway because the browser-facing boundary would rest on a shared, guessable capability.

## Goals

1. Supervise one Research Graph child per MedHorizon process with explicit lifecycle states.
2. Require an authenticated managed-sidecar `/health` handshake with exact service/protocol compatibility before declaring readiness.
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

The packaged sidecar entry binds a loopback socket with port `0`, sets its public/UI origin from the selected port, and emits one newline-delimited machine-readable discovery record on stdout. Ordinary application/uvicorn logs go to stderr. MedHorizon spawns the child with piped stdout, parses one bounded record before the readiness deadline, and then polls authenticated `/health`. The discovery record and health response contain `service: "research-graph"`, semantic `version`, and integer `protocol`; the capability token is passed only through the child environment and never printed.

The parent generates at least 256 bits of randomness. It passes the verifier to the child only as `RESEARCH_GRAPH_MANAGED_CAPABILITY`, uses the same value as the parent-side `RESEARCH_GRAPH_TOKEN`, and sends `Authorization: Bearer <capability>` on readiness/API requests. Managed sidecar authentication accepts only that exact value, including on `/health`, using a timing-safe comparison. The ordinary deployed/JWT health route remains unauthenticated for infrastructure probes and is not treated as proof of managed-child ownership. Standalone development authentication remains an explicit opt-in rather than an implicit consequence of `APP_ENV != production`.

`protocol` is the transport contract major version and must equal the supervisor-supported value. Additive fields and implementation releases do not change it; incompatible request/response semantics increment it. The semantic `version` is reported for diagnostics and compatibility policy but cannot override a protocol-major mismatch.

The supervisor owns a code default readiness deadline of 15 seconds. `RESEARCH_GRAPH_READY_TIMEOUT_MS` may override it only after integer validation and clamping to 1–120 seconds. Discovery parsing and health polling share this single deadline; neither phase can silently reset the clock.

Production exports delegate to one module singleton created by `createResearchGraphSupervisor()`. Tests create isolated supervisor instances with real spawn/fetch behavior rather than mutating or resetting shared module state. Exit callbacks carry a generation so a stale process cannot clear a newer instance.

## Compatibility and rollback

- Keep `RESEARCH_GRAPH_DISABLE=1` as the immediate safe rollback: MedHorizon runs without the sidecar and reports the feature unavailable.
- Keep explicit `RESEARCH_GRAPH_API` for an externally managed service, but adopt it only after the same identity/protocol handshake.
- For an explicit external API, send `RESEARCH_GRAPH_TOKEN` when configured. Without a token, the operator-provided URL is an explicit trust decision and receives identity/protocol compatibility checks only; it is never adopted through ambient port probing.
- Permit the fixed-port legacy binary only behind `RESEARCH_GRAPH_LEGACY_FIXED_PORT=1`; never silently fall back after a discovery failure. Enabling it emits a once-per-process deprecation warning with removal target MedHorizon v0.5.0 (or, if discovery first ships after v0.4.x, the immediately following minor release), and implementation must register an owned removal item before merge.
- Continue supporting ordinary Supabase JWT authentication for deployed Research Graph.
- During one compatibility release, `local-dev/dev` may be accepted only when an explicit standalone-development bypass is enabled.
- A supervisor rollback must not restore “any 2xx on port 8000 is healthy.”

## Implementation tasks

### Task 1: Version the health and capability contract

**Description:** Extend Research Graph settings, health schema, health route, and auth dependency with stable identity/protocol fields, a managed capability, and an explicit managed-health auth policy.

**Acceptance criteria:**

- [x] `/health` returns `status`, `service`, `version`, `protocol`, `mode`, `store`, and `openai`.
- [x] Service and protocol values come from one source of truth, not duplicated literals.
- [x] In managed-sidecar mode, `/health` and protected APIs reject missing/incorrect Bearer capabilities and accept only the exact configured capability using timing-safe comparison.
- [x] `RESEARCH_GRAPH_MANAGED_CAPABILITY` is the child verifier, `RESEARCH_GRAPH_TOKEN` is the parent/client credential, both carry the same generated ≥256-bit value, and neither has a sentinel/default fallback.
- [x] Deployed/JWT mode preserves the current unauthenticated infrastructure `/health`; JWT behavior for protected APIs remains intact and cannot satisfy a managed-capability check accidentally.
- [x] `protocol` is documented and tested as an exact-match major version; semantic `version` is diagnostic and additive fields do not weaken protocol mismatch handling.
- [x] Fixed development tokens require an explicit dev-bypass setting.

**Verification:**

- [x] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_contract.py backend/tests/test_phase1.py`

**Dependencies:** Plan 00.

**Files likely touched:**

- `research-graph/backend/config.py`
- `research-graph/backend/models/schemas.py`
- `research-graph/backend/routers/graphs.py`
- `research-graph/backend/services/auth.py`
- `research-graph/backend/tests/test_sidecar_contract.py`

**Estimated scope:** M — 5 files.

### Task 2: Add dynamic loopback discovery to the sidecar entry

**Description:** Bind an OS-selected loopback port, set origins before importing the FastAPI app, and emit a single framed discovery record on stdout for the parent; keep ordinary logs on stderr.

**Acceptance criteria:**

- [x] The managed child binds only `127.0.0.1` and does not require port 8000.
- [x] Two MedHorizon instances can launch separate sidecars without a port collision.
- [x] The record contains port, service, version, and protocol but never the capability.
- [x] Stdout emits exactly one newline-delimited `research-graph.discovery` record within a fixed byte limit; ordinary entry/uvicorn logs use stderr and cannot be mistaken for discovery.
- [x] Public API/UI origins match the selected port before settings are cached.
- [x] Malformed or missing discovery data causes a bounded startup failure.

**Verification:**

- [x] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_entry.py`
- [x] Launch two real entry processes concurrently and verify distinct loopback ports and valid authenticated health responses.

**Dependencies:** Task 1.

**Files likely touched:**

- `research-graph/sidecar/entry.py`
- `research-graph/backend/config.py`
- `research-graph/backend/tests/test_sidecar_entry.py`

**Estimated scope:** M — 3 files.

### Task 3: Implement the supervisor state machine

**Description:** Replace the nullable-child check with an isolated supervisor factory plus production singleton, single-flight start, piped/bounded discovery parsing, authenticated readiness, classified probe diagnostics, exit cleanup, cross-platform bounded stop, and safe restart.

**Acceptance criteria:**

- [x] Concurrent starts return the same in-flight result and create exactly one child.
- [x] The managed spawn uses piped stdout and a bounded line/JSON parser; record bytes, extra records, EOF, malformed JSON, and discovery timeout have stable diagnostics and cannot grow memory without bound.
- [x] Readiness requires exact `service` and protocol-major equality plus an accepted managed Bearer capability; auth, identity, and protocol failures fail immediately with distinct diagnostics.
- [x] A wrong service returning 2xx fails with a stable `identity_mismatch` diagnostic.
- [x] `DEFAULT_READY_TIMEOUT_MS` is 15,000; `RESEARCH_GRAPH_READY_TIMEOUT_MS` accepts only a validated 1,000–120,000 ms value, and discovery plus health polling share the resulting deadline.
- [x] Connection refusal and retryable health failures update `connection_refused` or `health_check_failed` probe diagnostics while polling; child exit preempts the deadline, and deadline failure preserves the specific last/aggregate probe cause instead of returning only a generic timeout.
- [x] Startup failure terminates and reaps the child, clears state, and permits retry.
- [x] Abnormal exit clears ready state and records exit code/reason.
- [x] `createResearchGraphSupervisor()` gives each test/caller isolated state while production functions delegate one singleton; no test-only reset mutates the production singleton.
- [x] Stop is idempotent and platform-aware: POSIX requests `SIGTERM`, waits, then uses `SIGKILL`; Windows calls `proc.kill()`, waits/polls `exited`, then uses a verified force/tree-termination fallback if still alive. Both paths wait for confirmed exit before clearing state.
- [x] `serve` and `web` await orderly shutdown without orphaning the managed child.
- [x] `RESEARCH_GRAPH_LEGACY_FIXED_PORT=1` is the only legacy fallback, warns once with its removal target, and has an owned removal checklist item; discovery failure never enables it implicitly.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/sidecar/research-graph.test.ts`
- [x] `(cwd: backend/cli) bun run typecheck`

**Dependencies:** Tasks 1–2.

**Files likely touched:**

- `backend/cli/src/sidecar/research-graph.ts`
- `backend/cli/src/cli/cmd/serve.ts`
- `backend/cli/src/cli/cmd/web.ts`
- `backend/cli/test/sidecar/research-graph.test.ts`
- `tasks/todo.md`

**Estimated scope:** M — 5 files.

### Task 4: Add black-box lifecycle and diagnostics coverage

**Description:** Exercise the actual spawn/HTTP implementation using a real fixture process and the real Python sidecar; do not replace `Bun.spawn` or `fetch` with behavior-copying mocks.

**Acceptance criteria:**

- [x] Tests cover concurrent start, wrong-service collision, readiness timeout, clean exit, crash, restart, and repeated stop.
- [x] Tests cover discovery followed by immediate exit, persistent connection refusal, retryable/non-retryable health failure, protocol mismatch, and capability rejection with the expected diagnostic code.
- [x] A parent shutdown leaves no fixture or Research Graph child alive.
- [x] Each case creates an isolated supervisor instance; repeated/randomized ordering cannot inherit a module-global child, promise, generation, timer, or last diagnostic.
- [x] Diagnostics include lifecycle state, endpoint, elapsed time, and exit reason.
- [x] Captured stdout, stderr, UI/structured diagnostics, serialized metadata, and every thrown error message/stack contain zero literal capability or Authorization header; redaction covers `RESEARCH_GRAPH_MANAGED_CAPABILITY`, `RESEARCH_GRAPH_TOKEN`, nested error causes, and env/debug serialization.
- [x] The same real-child cleanup suite runs on Windows CI and POSIX CI (or records an explicit Windows release-candidate run); both prove no surviving PID/process tree after timeout, stop, crash, and parent shutdown.
- [x] Explicit external API and disable modes have characterization tests.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/sidecar/research-graph.test.ts`
- [x] `(cwd: backend/cli) bun test test/plugin/research-graph-tools.test.ts`
- [x] `(cwd: research-graph) python -m pytest backend/tests/test_sidecar_contract.py backend/tests/test_sidecar_entry.py`
- [x] `(cwd: backend/cli) bun test`
- [x] Windows and POSIX CI/release evidence records the same lifecycle suite and post-test orphan scan.

**Dependencies:** Task 3.

**Files likely touched:**

- `backend/cli/test/sidecar/research-graph.test.ts`
- `backend/cli/test/fixture/research-graph-sidecar.ts`
- `backend/cli/src/sidecar/research-graph.ts`
- Research Graph sidecar test fixtures

**Estimated scope:** M — 3–4 files.

## Checkpoint

- [x] Concurrent startup creates one managed child.
- [x] Only the expected authenticated service/protocol reaches ready state.
- [x] Managed `/health` rejects missing/wrong capabilities; deployed/JWT health and protected-route behavior remain compatible.
- [x] Port selection is dynamic and loopback-only.
- [x] Discovery parsing is piped, bounded, deadline-controlled, and isolated from stderr logs.
- [x] Timeout, classified probe failure, crash, Windows/POSIX stop, and restart leave supervisor state correct and no orphan process.
- [x] External and disabled modes remain explicit and tested.
- [x] Plugin tools still send the expected auth/env and remain Atlas-independent.
- [ ] Focused Python/Bun tests, full backend/CLI suite, and typecheck pass.

## Risks

| Risk                                            | Impact                                 | Mitigation                                                                                                               |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cross-platform process semantics differ         | Orphans or flaky stop tests on Windows | Encapsulate POSIX signal and Windows kill/wait/force-tree behavior; test real child processes on both platforms          |
| Discovery is emitted before service readiness   | Parent routes traffic too early        | Treat discovery as endpoint discovery only; classify connection/health failures and require authenticated health polling |
| Legacy packaged binary lacks discovery          | Upgrade appears broken                 | Explicit, time-limited legacy switch and clear incompatible-binary diagnostic                                            |
| Capability leaks through logs/environment dumps | Local privilege boundary weakens       | Use structured diagnostics plus recursive redaction; capture logs, errors, causes, and metadata in tests                 |
| Dynamic origin is cached too early              | UI/API URLs point to port 8000         | Bind socket and set environment before importing the app/settings                                                        |

## Definition of done

- [ ] Supervisor lifecycle is explicit, single-flight, and restartable.
- [ ] Health identity and auth contracts are versioned and tested.
- [ ] Managed `/health` proves possession of the per-process capability; deployed health/JWT compatibility remains explicit.
- [ ] Managed sidecars use dynamic loopback ports and random capabilities.
- [ ] Wrong services and incompatible protocols fail closed.
- [ ] Discovery/health failures return specific diagnostics, and crash/shutdown leave no stale state or orphan child on Windows or POSIX.
- [ ] Capability values are absent from every captured diagnostic/log/error path.
- [ ] Compatibility and rollback switches are documented, tested, warned, owned, and time-bounded.
- [ ] Full `bun test` from `backend/cli`, Research Graph focused pytest, and typecheck pass.
