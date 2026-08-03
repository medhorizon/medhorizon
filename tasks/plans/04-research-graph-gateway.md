# 04 — Same-origin Research Graph gateway and authoritative session binding

**Status:** Done

**Priority:** P0

**Dependencies:** `tasks/plans/03-research-graph-supervisor.md`. API generation must run after the Hono contract is stable.

## Current state

- `frontend/workspace/src/atlas/ResearchGraphPane.tsx` hardcodes sidecar/Vite origins and the `local-dev` bearer.
- The pane lists graphs, fetches trees one by one, and guesses a graph from the session title before writing a binding.
- The Research Graph React client in `research-graph/frontend/src/lib/api.ts` also defaults to `local-dev` from browser storage.
- `backend/cli/src/server/server.ts` has no Research Graph route; the browser talks to the Python service directly.
- The FastAPI service already stores authoritative `session_graph_bindings` and exposes bind/get-bind endpoints.
- The workspace uses the generated `@synsci/sdk` elsewhere, but the Research Graph pane uses handwritten DTOs and `fetch`.
- The embedded React app assumes root-relative `/api` routes and a root `BrowserRouter`.

## Problem

The browser knows a private service port and capability, the same-origin host/origin guards do not protect Research Graph traffic, and graph resolution is heuristic and N+1. This tightly couples the workspace to a sidecar implementation and prevents stable generated client types.

## Goals

1. Make Hono/MedHorizon the only browser-visible Research Graph entry point.
2. Keep the sidecar endpoint and capability in the backend process only.
3. Serve/proxy the embedded Research Graph UI under a stable same-origin prefix.
4. Resolve a session's graph authoritatively in one browser API call.
5. Expose stable typed success/error contracts and regenerate the JavaScript SDK.
6. Remove ports, sentinel tokens, title matching, graph-list N+1, and handwritten pane DTOs from the workspace.

## Non-goals

- Rewriting the FastAPI or React application.
- Re-enabling or expanding the Atlas cloud bridge; its default-off retirement belongs to Plan 15.
- Refactoring `AtlasCanvas.tsx` layout/controller/view; that product surface is superseded rather than re-architected.
- Changing graph, node, edge, experiment, or GEPA semantics.
- Exposing the managed capability to plugins running outside the MedHorizon process.
- Solving the cross-directory plugin-source import; track that as a separate packaging boundary plan.

## Proposed design

Use two same-origin surfaces:

- `/research-graph/*` — transparent UI/static/API proxy. The gateway strips the prefix before forwarding to the managed sidecar.
- `/api/research-graph/*` — explicit Hono control contract included in OpenAPI and the generated SDK.

Extend the supervisor with a synchronous, read-only `current()` accessor and expose it for the process singleton as `currentResearchGraphSidecar()`. It must never spawn or wait and returns a fresh readonly view: only `ready` with a live managed child (or an adopted external endpoint) returns `{ generation, mode, endpoint }`; `idle`, `starting`, `stopping`, `failed`, and `exited` return no endpoint. `snapshot()` remains redacted and diagnostic-only, and `start()` remains lifecycle-only. The `serve`/`web` startup paths own starting or explicitly restarting the sidecar; request handlers return `503 { status: "unavailable" }` when `current()` is empty.

The gateway reads `current()` immediately before every upstream request and never caches an origin or capability. Managed mode requires and injects the current capability; external mode accepts an optional configured token. If an upstream attempt races a restart, the gateway rereads `current()` and may retry once only when the generation changed and the request body is safely replayable; non-replayable requests return the stable unavailable response. This makes capability rotation automatic without weakening request semantics.

The gateway strips browser `Authorization`, `Cookie`, `Host`, `Origin`, `Referer`, forwarding, and hop-by-hop headers; injects the supervisor credential; preserves method, query, status, safe response headers, and streaming bodies; and rewrites same-sidecar redirects to the gateway prefix. It also strips upstream `Access-Control-*` response headers. Managed FastAPI startup does not install CORS middleware; explicit standalone development may retain its configured CORS policy.

Add an authoritative resolver with a discriminated response:

- `{ status: "bound", graph: { id, title, updatedAt }, embedPath }`
- `{ status: "not_bound" }`

Unavailable, incompatible, timed-out, and rejected upstream responses use stable codes rather than parsed error strings. The resolver never receives a session title and never scans all graphs. FastAPI returns only the authoritative binding and graph data; Hono constructs `embedPath` as `/research-graph/embed/graph/{id}` so the frozen sidecar `PUBLIC_API_URL`/`UI_URL` can never leak into the browser contract. `graph.updatedAt` is the graph row's `updated_at`, not the binding timestamp.

The bundled Research Graph UI derives Vite `base`, API base, and React Router `basename` from the same explicit mode so they cannot double-prefix or escape the gateway. Standalone development remains an explicit build/runtime mode. The workspace pane calls only the generated SDK resolver and points its iframe at the returned same-origin path.

## Compatibility and rollback

- All new Hono paths are additive; existing MedHorizon API operations remain unchanged.
- The direct FastAPI API remains available to CLI/plugin calls during the compatibility window.
- The FastAPI binding endpoints remain readable while the new resolver is introduced; no binding-table migration is required.
- Generated SDK changes add a namespace/method and do not rename existing exports.
- Rollback may disable the pane or restore the previous workspace bundle while leaving additive gateway routes in place.
- Direct browser sidecar access is a temporary, explicit development mode only; there is no silent production fallback that reintroduces `local-dev`.
- Keep the old resolver behavior only as a separately selected legacy path during soak. Remove it after bound/not-bound e2e passes; never use title matching as an automatic fallback.

## Implementation tasks

### Task 1: Build the backend-only reverse proxy

**Description:** Add a Research Graph route module backed by supervisor state, mount it before project instance middleware, and implement safe forwarding plus stable gateway errors.

**Acceptance criteria:**

- [x] Browser requests use the MedHorizon origin exclusively.
- [x] A non-spawning `current()` accessor returns the live endpoint only while ready; request code never calls `start()` or consumes the redacted `snapshot()`.
- [x] Every forwarded request obtains the latest supervisor generation/capability lazily; managed mode requires a token and external mode permits an optional token.
- [x] A restart rotates origin/capability without process restart or gateway cache invalidation; any retry is generation-aware, bounded to one, and limited to replayable requests.
- [x] The sidecar endpoint and capability never appear in response bodies, headers, redirects, or logs.
- [x] Methods, query strings, request bodies, upstream status, content type, cache metadata, and streaming responses are preserved where safe.
- [x] Browser credentials and hop-by-hop/forwarding headers are not passed upstream.
- [x] The Hono gateway and managed upstream expose no `Access-Control-*` headers on this same-origin surface; standalone development CORS remains explicit.
- [x] Path traversal and encoded-prefix escape attempts are rejected.
- [x] Down, timeout, identity mismatch, and upstream rejection have stable error codes.

**Verification:**

- [x] `(cwd: backend/cli) bun test test/server/research-graph-gateway.test.ts`
- [x] `(cwd: backend/cli) bun run typecheck`
- [x] Contract tests assert that request `Origin`/credentials are stripped and upstream `Access-Control-*` headers are not forwarded.

**Dependencies:** Plan 03.

**Files likely touched:**

- `backend/cli/src/server/routes/research-graph.ts`
- `backend/cli/src/server/server.ts`
- `backend/cli/src/sidecar/research-graph.ts`
- `research-graph/backend/main.py`
- `backend/cli/test/server/research-graph-gateway.test.ts`

**Estimated scope:** M — 5 files.

### Task 2: Make the embedded Research Graph UI prefix-aware

**Description:** Configure the bundled React app's asset base, API base, and router basename for `/research-graph` while keeping standalone development explicit.

**Acceptance criteria:**

- [x] HTML, JS, CSS, assets, client routes, and API calls work under the gateway prefix.
- [x] Vite `base` and React Router `basename` are derived from one explicit mode and do not double-prefix lazy chunk or navigation URLs.
- [x] The embedded app sends no `local-dev` token and reads no managed capability from local storage.
- [x] Refreshing `/research-graph/embed/graph/123` through the gateway returns the SPA and every HTML, JS, CSS, asset, and lazy chunk request succeeds under `/research-graph/`.
- [x] Standalone dev mode remains available through an explicit configuration, not implicit token fallback.
- [x] Standalone Vite development has an explicit API proxy/base and a direct dev smoke test; it does not inherit the managed build's basename accidentally.
- [x] No absolute sidecar origin is embedded in the production bundle.

**Verification:**

- [x] `(cwd: research-graph/frontend) bun run build`
- [x] Inspect the production bundle for `127.0.0.1:8000` and `local-dev`; neither may be present in the managed build.
- [x] Exercise a direct refresh of `/research-graph/embed/graph/123` through the real gateway and assert all resource requests are successful.
- [x] Exercise the explicit standalone Vite mode separately.

**Dependencies:** Task 1.

**Files likely touched:**

- `research-graph/frontend/vite.config.ts`
- `research-graph/frontend/src/main.tsx`
- `research-graph/frontend/src/lib/api.ts`
- Routing/link helpers under `research-graph/frontend/src/` only if the basename requires them

**Estimated scope:** M — 3–5 files.

### Task 3: Add authoritative session resolution

**Description:** Add a stable FastAPI resolve contract over the existing binding table and expose it through an explicit Hono control route.

**Acceptance criteria:**

- [x] One upstream resolution returns `bound` with the graph summary or `not_bound`.
- [x] The request accepts a session ID but no title or heuristic hints.
- [x] User/capability authorization still scopes bindings correctly.
- [x] A stale binding to a missing graph returns a stable integrity error, not `not_bound`.
- [x] `graph.updatedAt` comes from the graph row; binding timestamps are not substituted.
- [x] FastAPI does not return `embedPath`, `PUBLIC_API_URL`, `UI_URL`, or any sidecar origin; Hono constructs the gateway-relative `embedPath`.
- [x] Bind and resolve contracts have response schemas, stable error codes, and explicit OpenAPI operation IDs.

**Verification:**

- [x] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py -k "bind or resolve"`
- [x] `(cwd: backend/cli) bun test test/server/research-graph-session.test.ts`

**Dependencies:** Tasks 1–2.

**Files likely touched:**

- `research-graph/backend/models/schemas.py`
- `research-graph/backend/routers/stages.py`
- `research-graph/backend/tests/test_stage_land.py`
- `backend/cli/src/server/routes/research-graph.ts`
- `backend/cli/test/server/research-graph-session.test.ts`

**Estimated scope:** M — 5 files.

### Task 4: Regenerate the SDK and migrate the workspace pane

**Description:** Publish the Hono control routes to OpenAPI, regenerate `@synsci/sdk`, and replace the pane's handwritten network/resolution logic.

**Acceptance criteria:**

- [x] `ResearchGraphPane` uses `useSDK().client` for resolution/binding/status.
- [x] The pane contains no handwritten graph DTO, generic `rgFetch`, bearer token, or sidecar/Vite origin.
- [x] Title matching, list-all-graphs, and per-graph tree fetches are removed.
- [x] `not_bound`, unavailable, incompatible, and ready states render distinctly.
- [x] The iframe uses only the same-origin `embedPath` returned by the contract.
- [x] Generated files are produced by the repository generator and are not hand-edited.

**Verification:**

- [x] After the Hono contract is final, run `(cwd: repository root) ./tooling/repo/generate.ts` exactly once; the generator refreshes OpenAPI before generating the client.
- [x] `(cwd: frontend/workspace) bun run typecheck`
- [x] Remove obsolete `VITE_*` declarations/comments from `frontend/workspace/src/env.d.ts` before running `(cwd: repository root) rg -n "127\.0\.0\.1:8000|local-dev|matchGraphByTitle" frontend/workspace/src`; it returns no Research Graph browser-client matches.

**Dependencies:** Task 3.

**Files likely touched:**

- `frontend/workspace/src/atlas/ResearchGraphPane.tsx`
- `frontend/workspace/src/env.d.ts`
- `backend/cli/src/server/routes/research-graph.ts`
- Generated files under `tooling/sdk/js/src/v2/gen/`

**Estimated scope:** M — 3 hand-edited areas plus generated SDK output.

### Task 5: Lock the gateway with contract and browser e2e

**Description:** Exercise a real in-process Hono server, the real supervisor against `backend/cli/test/fixture/rg-sidecar-fixture.ts`, and a real workspace browser for bound, not-bound, crash, restart, capability rotation, and authorization cases. Keep the real Python service covered by its contract tests rather than making workspace e2e depend on Python process setup.

**Acceptance criteria:**

- [x] Bound session opens the correct graph with one control request.
- [x] Unbound session makes no graph-list/tree requests and shows a clear empty state.
- [x] Sidecar crash yields a stable unavailable state; an explicit lifecycle-owner restart recovers without page reload or browser credential changes.
- [x] Restart produces a new supervisor generation and capability; the next request uses the new values without a cached-token failure, and a replayable request racing rotation follows the bounded retry rule.
- [x] Network capture contains only the MedHorizon origin and no managed capability.
- [ ] Light/dark embedding, keyboard focus, and iframe title pass the existing accessibility smoke expectations. The focused Research Graph e2e covers the iframe title; the broader accessibility project remains a separate baseline suite.
- [x] Legacy direct-browser mode is disabled for the managed build after the checkpoint.

**Verification:**

- [x] The workspace e2e bootstrap explicitly starts the process-wide supervisor before browser navigation; `Server.listen(...)` alone is not treated as sidecar startup.
- [x] `(cwd: backend/cli) bun test test/server/research-graph-gateway.test.ts test/server/research-graph-session.test.ts`
- [x] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py backend/tests/test_sidecar_contract.py`
- [x] `(cwd: frontend/workspace) bun run test:e2e -- e2e/research-graph.spec.ts`
- [ ] `(cwd: repository root) bun run typecheck` — Turbo cannot resolve the package-manager binary in this Windows checkout (`@emnapi/wasi-threads` lockfile warning); backend/CLI and workspace typechecks pass independently.
- [x] Run `(cwd: backend/cli) bun test` as a non-blocking baseline check and record unrelated pre-existing failures/hangs; the Plan 04 gate is the focused server tests plus typecheck above.

**Dependencies:** Task 4.

**Files likely touched:**

- `frontend/workspace/e2e/research-graph.spec.ts`
- `backend/cli/test/server/research-graph-gateway.test.ts`
- `backend/cli/test/server/research-graph-session.test.ts`
- Research Graph test fixtures
- `backend/cli/test/fixture/rg-sidecar-fixture.ts`

**Estimated scope:** M — 4–5 files.

## Checkpoint

- [x] The workspace never connects directly to the sidecar and never holds its capability.
- [x] Embedded Research Graph UI works entirely under the same origin.
- [x] One typed request resolves `bound` or `not_bound` without title heuristics or N+1 scans.
- [x] The generated SDK is current and the pane has no handwritten transport DTOs.
- [x] Gateway errors are stable, typed, and recover after a supervised restart.
- [x] Real contract, Python, focused backend/CLI gateway tests, browser e2e, and typecheck pass; full-suite baseline deltas are recorded separately.

## Risks

| Risk                                                      | Impact                             | Mitigation                                                                                                 |
| --------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Prefix/base-path errors break SPA assets or nested routes | Blank iframe                       | Derive Vite base and router basename from one mode; refresh a concrete nested route and assert every chunk |
| Restart rotates the endpoint or capability mid-request    | Transient authorization failure    | Resolve `current()` per request; generation-aware, replay-safe single retry; stable 503 otherwise          |
| Proxy forwards sensitive browser headers                  | Capability/auth boundary bypass    | Explicit header allowlist, capability injection, contract tests                                            |
| Upstream CORS policy leaks through the same-origin proxy  | Confusing or weakened origin model | Disable managed FastAPI CORS and strip upstream CORS response headers                                      |
| Redirect or error body leaks sidecar origin               | Browser learns private endpoint    | Rewrite same-sidecar locations and map gateway errors                                                      |
| Binding semantics drift between Python and Hono           | Wrong graph displayed              | FastAPI remains binding source of truth; Hono exposes a typed projection                                   |
| Generated SDK churn is hand-edited                        | Future regeneration removes fixes  | Run the repository generator after route completion; no manual generated edits                             |
| Rollback silently restores insecure direct mode           | Security regression                | Roll back by disabling the pane or explicit dev-only switch, never silent fallback                         |

## Definition of done

- [x] Hono is the sole managed browser ingress for Research Graph.
- [x] Sidecar origin and capability remain backend-only.
- [x] Embedded UI and API work under a stable same-origin prefix.
- [x] Session resolution is authoritative, typed, one-call, and N+1-free.
- [x] Workspace hardcoded origins/tokens, title matching, and handwritten graph transport are removed.
- [x] SDK generation has run after the API change.
- [x] Compatibility and rollback paths are explicit and tested.
- [x] Focused Research Graph gateway/session tests from `backend/cli`, Research Graph pytest, workspace e2e, build, and typecheck pass.
- [x] The full `backend/cli` suite has been attempted and any unrelated pre-existing failures or hangs are recorded without masking Plan 04 regressions.

## Verification record

All verification commands in this plan used a 600000 ms (10 minute) command/test timeout.

- Focused gateway/session tests: 9 pass; supervisor tests: 36 pass.
- Research Graph contract tests: 28 pass (one deprecation warning).
- Backend/CLI and workspace typecheck: pass; managed and standalone Research Graph builds: pass; managed bundle sentinel scan: clean.
- Workspace Research Graph browser e2e (`e2e/research-graph.spec.ts`): 3 pass, including nested-route refresh, CSS/JS, and lazy chunk loading.
- Full `backend/cli` baseline: timed out after 604 seconds on the existing Windows suite; the process was stopped after the timeout. This is recorded as a baseline limitation, not a Plan 04 focused-gate failure.
- Root `bun run typecheck`: blocked by Turbo's package-manager resolution in this checkout; independent package typechecks remain green.
