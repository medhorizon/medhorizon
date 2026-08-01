# OpenScience × Atlas — improvement sprint (Phase 0: plans)

> **Direction changed — 2026-08-01.** Atlas is no longer a target product surface; Stage and Research Graph replace it. Atlas-specific workstreams are superseded by [`tasks/plans/15-atlas-surface-retirement.md`](../../tasks/plans/15-atlas-surface-retirement.md). This directory remains a historical planning snapshot.

Branch: `sprint/openscience-atlas-polish`. This directory holds one plan doc per workstream.
Each plan: **Current state · What's broken/missing · Proposed change · Risks · Acceptance criteria**.
Investigation-heavy workstreams (CI, compute, sandboxing) are findings-first.

Landed bugfixes (RCA + index): [`docs/bugfix.md`](../bugfix.md). Docs hub: [`docs/README.md`](../README.md).

Nothing irreversible ships without owner sign-off — **sandboxing (10) is design-only pending a go/no-go**.

## Workstreams

| #   | Workstream                             | Plan                                                                             | Kind                        | Status |
| --- | -------------------------------------- | -------------------------------------------------------------------------------- | --------------------------- | ------ |
| 1   | CI + test suite hardening              | [01-ci-tests.md](01-ci-tests.md)                                                 | fix + investigate           | 🚧     |
| 2   | Codex OAuth login                      | [02-codex-oauth.md](<not to do/02-codex-oauth.md>)                               | Atlas token path retired    | ⛔     |
| 3   | Atlas account sync                     | [03-atlas-sync.md](<not to do/03-atlas-sync.md>)                                 | superseded                  | ⛔     |
| 4   | Onboarding → local/BYOK setup          | [04-onboarding-setup.md](04-onboarding-setup.md)                                 | local/BYOK scope only       | 📝     |
| 5   | UX polish                              | [05-ux-polish.md](05-ux-polish.md)                                               | feature                     | 📝     |
| 6   | Compute integrations audit             | [06-compute-integrations.md](06-compute-integrations.md)                         | BYOK/local scope only       | 📝     |
| 7   | Atlas experience                       | [07-atlas-experience.md](07-atlas-experience.md)                                 | superseded                  | ⛔     |
| 8   | Wallet + usage in settings             | [08-wallet-usage-settings.md](08-wallet-usage-settings.md)                       | superseded                  | ⛔     |
| 9   | arXiv fetching                         | [09-arxiv-retrieval.md](09-arxiv-retrieval.md)                                   | fix                         | 📝     |
| 10  | Agent sandboxing (design only)         | [10-agent-sandboxing.md](10-agent-sandboxing.md)                                 | design — needs sign-off     | 📝     |
| 11  | Reviewer agent + open ideas            | [11-reviewer-agent.md](11-reviewer-agent.md)                                     | prototype/spec              | 📝     |
| 12  | Research Graph GEPA optimization       | [12-research-graph-gepa-optimization.md](12-research-graph-gepa-optimization.md) | feature (RG module)         | 📝     |
| 13  | Agent tool context optimization        | [13-agent-tool-context-optimization.md](13-agent-tool-context-optimization.md)   | performance + architecture  | 📝     |
| 14  | Orchestrator parent + narrow subagents | [14-orchestrator-subagent-routing.md](14-orchestrator-subagent-routing.md)       | architecture (builds on 13) | 📝     |

Status: 🔎 exploring · 📝 plan drafted · 🚧 implementing · ✅ done · ⛔ blocked or superseded (see row kind/note).

## Landed so far (implementation)

- **Urgent hang fix** — every Atlas call (bridge + client) is now timeout-bounded, so `openscience project init` (run every session by the research prompt) and the per-command sync probe can't wedge a session for 60 min.
- **WS1 — CI determinism 🚧** — tests use a committed models.dev catalog fixture, the live delisting check runs nightly, root installs are frozen, and PR CI runs the backend suite once with a Bun-native coverage report. A green Linux baseline and static floor remain; feature coverage still grows with each workstream.
- **WS2 — Codex login (partial implementation, follow-up retired)** — OAuth hardening landed, but the Atlas managed-proxy consumer and browser product path are no longer planned.

Next: execute the current modular roadmap under `tasks/plans`; Atlas-specific implementation work is retired by Plan 15.

## Notes at kickoff

- **CI is already green** on `main` — the previously-flaky live-catalog tests were fixed by #91/#92. Workstream 1 is now hardening + coverage on the paths this sprint touches, not firefighting.
- The historical settings surface shipped wallet/usage routes, but those Atlas product paths should now be hidden/default-disabled; local Storage and BYOK Compute remain in scope.
- **Phase 0 exploration produced plans 1–14.** The current execution source is `tasks/plans`; Atlas-specific historical items in this directory are superseded by Plan 15.
- Atlas managed compute is no longer in scope. Plan 06 may retain only BYOK/local compute work that does not require Atlas login, wallet, sync, or managed routes.
- **No isolation exists today** — the default permission policy is `"*": "allow"`, so in-project `bash`/`edit`/`webfetch` run unprompted (see [10](10-agent-sandboxing.md), design-only, needs sign-off).
- Atlas-side product work is closed. Preserve only the minimal compatibility capability proven to be called by Stage or Research Graph; do not reopen the full Atlas surface.
