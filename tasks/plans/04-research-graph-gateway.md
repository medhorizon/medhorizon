# 04 — Same-origin Research Graph gateway and authoritative session binding

**Status:** Planned

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

The gateway obtains the current endpoint/capability from the supervisor in memory. It strips browser `Authorization`, `Cookie`, `Host`, forwarding, and hop-by-hop headers; injects the managed capability; preserves method, query, status, safe response headers, and streaming bodies; and rewrites same-sidecar redirects to the gateway prefix.

Add an authoritative resolver with a discriminated response:

- `{ status: "bound", graph: { id, title, updatedAt }, embedPath }`
- `{ status: "not_bound" }`

Unavailable, incompatible, timed-out, and rejected upstream responses use stable codes rather than parsed error strings. The resolver never receives a session title and never scans all graphs.

The bundled Research Graph UI uses a gateway base and router basename when embedded. Standalone development remains an explicit build/runtime mode. The workspace pane calls only the generated SDK resolver and points its iframe at the returned same-origin path.

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

- [ ] Browser requests use the MedHorizon origin exclusively.
- [ ] The sidecar endpoint and capability never appear in response bodies, headers, redirects, or logs.
- [ ] Methods, query strings, request bodies, upstream status, content type, cache metadata, and streaming responses are preserved where safe.
- [ ] Browser credentials and hop-by-hop/forwarding headers are not passed upstream.
- [ ] Path traversal and encoded-prefix escape attempts are rejected.
- [ ] Down, timeout, identity mismatch, and upstream rejection have stable error codes.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/server/research-graph-gateway.test.ts`
- [ ] `(cwd: backend/cli) bun run typecheck`

**Dependencies:** Plan 03.

**Files likely touched:**

- `backend/cli/src/server/routes/research-graph.ts`
- `backend/cli/src/server/server.ts`
- `backend/cli/src/sidecar/research-graph.ts`
- `backend/cli/test/server/research-graph-gateway.test.ts`

**Estimated scope:** M — 4 files.

### Task 2: Make the embedded Research Graph UI prefix-aware

**Description:** Configure the bundled React app's asset base, API base, and router basename for `/research-graph` while keeping standalone development explicit.

**Acceptance criteria:**

- [ ] HTML, JS, CSS, assets, client routes, and API calls work under the gateway prefix.
- [ ] The embedded app sends no `local-dev` token and reads no managed capability from local storage.
- [ ] Refreshing a nested embed/graph route returns the SPA rather than a 404.
- [ ] Standalone dev mode remains available through an explicit configuration, not implicit token fallback.
- [ ] No absolute sidecar origin is embedded in the production bundle.

**Verification:**

- [ ] `(cwd: research-graph/frontend) bun run build`
- [ ] Inspect the production bundle for `127.0.0.1:8000` and `local-dev`; neither may be present in the managed build.
- [ ] Exercise `/research-graph/embed/graph/:id` through the real gateway.

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

- [ ] One upstream resolution returns `bound` with the graph summary or `not_bound`.
- [ ] The request accepts a session ID but no title or heuristic hints.
- [ ] User/capability authorization still scopes bindings correctly.
- [ ] A stale binding to a missing graph returns a stable integrity error, not `not_bound`.
- [ ] Bind and resolve contracts have response schemas and stable error codes.

**Verification:**

- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py -k "bind or resolve"`
- [ ] `(cwd: backend/cli) bun test test/server/research-graph-session.test.ts`

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

- [ ] `ResearchGraphPane` uses `useSDK().client` for resolution/binding/status.
- [ ] The pane contains no handwritten graph DTO, generic `rgFetch`, bearer token, or sidecar/Vite origin.
- [ ] Title matching, list-all-graphs, and per-graph tree fetches are removed.
- [ ] `not_bound`, unavailable, incompatible, and ready states render distinctly.
- [ ] The iframe uses only the same-origin `embedPath` returned by the contract.
- [ ] Generated files are produced by the repository generator and are not hand-edited.

**Verification:**

- [ ] `(cwd: repository root) ./tooling/repo/generate.ts`
- [ ] `(cwd: frontend/workspace) bun run typecheck`
- [ ] `(cwd: repository root) rg -n "127\.0\.0\.1:8000|local-dev|matchGraphByTitle" frontend/workspace/src` returns no Research Graph browser-client matches.

**Dependencies:** Task 3.

**Files likely touched:**

- `frontend/workspace/src/atlas/ResearchGraphPane.tsx`
- `frontend/workspace/src/env.d.ts`
- `backend/cli/src/server/routes/research-graph.ts`
- Generated files under `tooling/sdk/js/src/v2/gen/`

**Estimated scope:** M — 3 hand-edited areas plus generated SDK output.

### Task 5: Lock the gateway with contract and browser e2e

**Description:** Exercise a real Hono server, real Research Graph sidecar, and real workspace browser for bound, not-bound, crash, restart, and authorization cases.

**Acceptance criteria:**

- [ ] Bound session opens the correct graph with one control request.
- [ ] Unbound session makes no graph-list/tree requests and shows a clear empty state.
- [ ] Sidecar crash yields a stable unavailable state; supervisor restart recovers without page reload or token changes.
- [ ] Network capture contains only the MedHorizon origin and no managed capability.
- [ ] Light/dark embedding, keyboard focus, and iframe title pass the existing accessibility smoke expectations.
- [ ] Legacy direct-browser mode is disabled for the managed build after the checkpoint.

**Verification:**

- [ ] `(cwd: backend/cli) bun test test/server/research-graph-gateway.test.ts test/server/research-graph-session.test.ts`
- [ ] `(cwd: research-graph) python -m pytest backend/tests/test_stage_land.py backend/tests/test_sidecar_contract.py`
- [ ] `(cwd: frontend/workspace) bun run test:e2e -- --grep "Research Graph"`
- [ ] `(cwd: backend/cli) bun test`
- [ ] `(cwd: repository root) bun run typecheck`

**Dependencies:** Task 4.

**Files likely touched:**

- `frontend/workspace/e2e/research-graph.spec.ts`
- `backend/cli/test/server/research-graph-gateway.test.ts`
- `backend/cli/test/server/research-graph-session.test.ts`
- Research Graph test fixtures

**Estimated scope:** M — 3–4 files.

## Checkpoint

- [ ] The workspace never connects directly to the sidecar and never holds its capability.
- [ ] Embedded Research Graph UI works entirely under the same origin.
- [ ] One typed request resolves `bound` or `not_bound` without title heuristics or N+1 scans.
- [ ] The generated SDK is current and the pane has no handwritten transport DTOs.
- [ ] Gateway errors are stable, typed, and recover after a supervised restart.
- [ ] Real contract, Python, browser e2e, full backend/CLI tests, and typecheck pass.

## Risks

| Risk                                                      | Impact                            | Mitigation                                                                         |
| --------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Prefix/base-path errors break SPA assets or nested routes | Blank iframe                      | Build under the real prefix and test nested-route refresh                          |
| Proxy forwards sensitive browser headers                  | Capability/auth boundary bypass   | Explicit header allowlist, capability injection, contract tests                    |
| Redirect or error body leaks sidecar origin               | Browser learns private endpoint   | Rewrite same-sidecar locations and map gateway errors                              |
| Binding semantics drift between Python and Hono           | Wrong graph displayed             | FastAPI remains binding source of truth; Hono exposes a typed projection           |
| Generated SDK churn is hand-edited                        | Future regeneration removes fixes | Run the repository generator after route completion; no manual generated edits     |
| Rollback silently restores insecure direct mode           | Security regression               | Roll back by disabling the pane or explicit dev-only switch, never silent fallback |

## Definition of done

- [ ] Hono is the sole managed browser ingress for Research Graph.
- [ ] Sidecar origin and capability remain backend-only.
- [ ] Embedded UI and API work under a stable same-origin prefix.
- [ ] Session resolution is authoritative, typed, one-call, and N+1-free.
- [ ] Workspace hardcoded origins/tokens, title matching, and handwritten graph transport are removed.
- [ ] SDK generation has run after the API change.
- [ ] Compatibility and rollback paths are explicit and tested.
- [ ] Full `bun test` from `backend/cli`, Research Graph pytest, workspace e2e, build, and typecheck pass.
