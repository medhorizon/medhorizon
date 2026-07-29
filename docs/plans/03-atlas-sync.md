# 03 — Atlas account sync: correctness + resilience

Workstream: make sync between OpenScience and Atlas correct and resilient — identity, entitlements, and state stay consistent; sync recovers from interruption; no silent divergence. OpenScience paths under `backend/cli/src/`; Atlas under `backend/app/` (cloned reference).

## Current state

The single fetch `GET /api/cli/sync` (`cli.py:508`) returns everything the CLI bootstraps from: **identity** (`user_id`, email, github), **entitlements** (`subscription_status`/`plan`, eligibility via `byok_gate.py:44-80`), **per-provider credentials + base URLs**, and the **model whitelist** (`enabled_providers` + per-provider `whitelist`). Balance is separate (`/api/cli/balance`, 30 s cache, `index.ts:1118-1142`; `/api/cli/billing-mode`, `index.ts:1487`).

Per-provider routing is **BYOK-first** (`cli.py:559-620`): a decryptable stored key → `source:"byok"`; else if proxy-eligible + `SHARED_*` key + `thk_` on the request → managed-proxy env (`*_BASE_URL`→`/api/llm/proxy/<provider>` + the caller's `thk_` as api-key, `cli.py:604-610`) → `source:"managed_proxy"`; else `connected:false` with a typed reason. **Billing class is decided by the credential value** (`billing-gate.ts:63-99`): `thk_`→managed (wallet-gated + reported), OAuth→oauth-free, else byok.

**When it runs:** login persists the key but doesn't sync (the UI flow syncs right after, `connect.ts:17-34`); a per-command + per-step `refreshIfStale()` (10 s TTL, `index.ts:388`) hits the cheap `/api/cli/sync/version` and only fires a **background** full sync (applying to the _next_ message) when the hash changed; workspace launch syncs before binding (6 s race cap, `web.ts:114-145`); plus explicit `connect sync`, the wizard, post-codex-login, and `keys add`. The version hash (`cli.py:738-784`) folds mode + `MAX(updated_at)`/`COUNT(*)` of `user_provider_keys` + plan/status + `ENABLE_LLM_PROXY` + a coarse balance bucket.

**On disk:** `synced-env.json` (flat env, replayed synchronously at boot by `preload-env.ts:28-51`, **only where the var is unset** — "shell exports win"); `openscience-synced.json` (model lockdown, highest-priority config layer, `config.ts:190-193`); `openscience-session.json` (`api_key`, `user_id`, `cached_v`, `last_check_ts`); the bundled atlas-cli config (re-seeded on every sync). Sign-out (`clearSession`, `index.ts:501-520`) unlinks all of these + drops the usage queue. Server 401 → auto-clear; 403/402 → keep session, return `null`.

## What's broken / missing (resilience gaps)

- **G1 (HIGH) — in-process sync clobbers shell exports → silent billing flip.** `preload-env.ts:47` respects a pre-existing export, but `syncServices()` assigns **unconditionally** (`index.ts:789-790`). A user who `export ANTHROPIC_API_KEY=sk-…` (no Atlas key) gets it overwritten with `thk_…`+proxy base URL on the first background sync → `resolveCredentialSource` reads `thk_` → classifies **managed** → the call is wallet-gated and **reported/billed**, mid-session. The remove path guards on value-match; the add path doesn't.
- **G2 (HIGH) — version-hash table ≠ credential-read table.** The hash reads `user_provider_keys` (new, `cli.py:756`); `/sync` reads `user_compute_provider_keys` (legacy, `compute_keys_service.py:341`). Consistency rides on a dual-write bridge; any divergence → stale creds served indefinitely (probe can't see the change) or a wasted sync. No reconciliation.
- **G3 (HIGH) — non-atomic writes brick config.** `synced-env.json` and `openscience-synced.json` are plain `Bun.write` (no temp+rename), 4 independent writes, no barrier. A torn `synced-env.json` → `preload-env` swallows it → managed keys silently vanish. A torn `openscience-synced.json` → `config.ts:193` load **throws** uncaught in `Config.state()` → **CLI unusable until the file is removed by hand**.
- **G4 (MED) — interrupted sync leaves mixed generations** across `process.env` + the two files, no transaction, no generation stamp.
- **G5 (HIGH) — 402/entitlement lapse strands stale creds with no signal.** When a plan lapses the hash flips and a sync fires, but `/sync` now 402/403s and `syncServices()` returns `null` **before** the cleanup/rewrite — nothing unset, whitelist untouched. The middleware swallows it; the user sees nothing until a call finally 402s into `InsufficientCreditsError`.
- **G6 (MED) — no max-age on replayed env.** `synced-env.json` replays forever; an offline machine keeps injecting managed proxy env (1-yr `thk_` TTL) even after entitlements lapse or the host migrates. The server URL isn't in the hash, so a pure host migration never triggers a refetch.
- **G7 (MED) — no single-flight; launch-vs-middleware race.** `Lock.write` guards only the usage queue; ~10 uncoordinated `syncServices()` call sites; at launch the `web.ts` sync and the middleware background sync can interleave (both `clear()` then repopulate + rewrite the same files), dropping an unset / last-writer-wins.
- **G8 (LOW/MED) — `updateSession` read-modify-write races** can lose `cached_v`/`last_check_ts`; also `cached_v` is unset after login (only the background path sets it), so the first probe always double-syncs.
- **G9 (LOW) — `dropUsageQueue` unlinks without the queue lock** → logout vs in-flight flush can re-materialize another account's queued rows.
- **G10 (LOW/MED) — reconnect depends on one post-login sync** — the previous account's replayed env stays live until the first successful sync; a transient failure runs the new session on the old account's env.
- **G11 (LOW) — inconsistent error surfacing** — `syncServices()` collapses every failure to `null`; middleware/per-step paths swallow silently.

## Proposed change — reliable, self-healing sync

- **P1 (→G1)** — in the apply loop (`index.ts:784-792`), reuse the `previous` map already computed at `:777-778`: assign only when `process.env[key]` is unset or equals a prior synced value. Mirrors `unsetSyncedVar`'s guard; restores "shell exports win"; closes the BYOK→managed billing flip.
- **P2 (→G3,G4,G6)** — atomic temp-file+rename for both synced files (and session); wrap them in one `{generation, synced_at, server_url, env, config}` envelope; make `config.ts:193` load the synced config **tolerantly** (catch → empty, like `preload-env` already does) so a torn file can never brick startup; have `preload-env` refuse a snapshot older than a max-age and re-sync eagerly.
- **P3 (→G7,G8)** — single-flight `syncServices()` with `Lock.write` + in-process promise-dedupe; lock `updateSession`/`saveSession`; set `cached_v` at the end of the login/connect sync so the first probe doesn't double-sync.
- **P4 (→G5,G10,G11)** — on 402/403, instead of a bare `null`: clear the **managed (`thk_`)** portion of env + the locked whitelist (leave BYOK/OAuth), rewrite the snapshot, and surface a throttled structured notice ("Atlas entitlements changed — managed unavailable; use your own keys / top up"). Distinguish 402 (entitlement) from 403 (WAF/rate-limit, keep silently). Add `reconcileAfterLogin()`.
- **P5 (→G2,G6, Atlas-side)** — make `_compute_sync_version` hash the **same** source `/sync` reads, and include the server URL in the hash; add a telemetry assertion the two tables agree while the bridge exists. _(Atlas repo change — flagged.)_
- **P6 (→G9)** — `dropUsageQueue` acquires `Lock.write(pendingQueuePath)`.
- **P7** — fold `Provider.invalidate()` into `syncServices()` whenever the env set changed, so no call site leaves a stale SDK.

## Risks

Precedence change (P1) could regress users who _rely_ on sync to override a stale export — only protect values differing from any known synced value + log when a shell export shadows a managed key. Clearing managed env on 402 (P4) could flap on transient 402s — act only on explicit `insufficient`/`byok_not_unlocked` bodies, require two consecutive signals, never touch BYOK/OAuth. Atomic envelope (P2) changes on-disk schema — read old+new during rollout. Single-flight (P3) must not deadlock the 6 s launch budget. Server hash change (P5) forces a one-time fleet-wide resync.

## Acceptance criteria

1. **No silent divergence on entitlement change** — cancel a plan, send one message: within one probe cycle the CLI drops managed, keeps BYOK/OAuth, surfaces one clear notice.
2. **Shell exports always win** — an exported `ANTHROPIC_API_KEY` is never rewritten to `thk_`; classification stays `byok`; no unexpected wallet debit.
3. **Crash-safe artifacts** — killing mid-sync never leaves a torn file; next boot fully applies the prior generation or cleanly re-syncs; a corrupt synced config never fails startup.
4. **Recovery from interruption** — the next successful sync fully reconciles env + whitelist to server truth; an offline machine doesn't replay past a bounded max-age.
5. **Reconnect / swap** — logout→login leaves zero prior-account artifacts and the first post-login sync is authoritative.
6. **Concurrency-safe** — concurrent launch+middleware+`serve` syncs produce one coherent generation; logout can't race the usage flush into re-billing.
7. **Version parity** — `/sync/version` and `/sync` never disagree across attach/disconnect/rotate/host-migration (targeted test writes each table independently).

**Atlas-side changes required:** P5 (version-hash parity + server-URL in hash) — flagged for the owner/Atlas team. **Key files:** OpenScience `openscience/index.ts` (sync core), `preload-env.ts`, `index.ts:102` (middleware), `config/config.ts:190-193`, `session/{processor,billing-gate}.ts`, `cli/cmd/{connect,web}.ts`. Atlas `routes/cli.py:508/738/839`, `auth/{api_key,byok_gate,secret_store}.py`, `services/compute_keys_service.py:332`.
