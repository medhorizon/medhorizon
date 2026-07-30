# Changelog

MedHorizon follows [semantic versioning](https://semver.org). GitHub Releases
(`v0.x`) ship native binaries for Linux, macOS (Apple Silicon), and Windows via
the `Release` workflow. Upstream OpenScience history is retained below.

## MedHorizon v0.3.8 — 2026-07-30

### Added

- **Stage → node landing protocol** (Research Graph plugin only, no MedHorizon
  core edits): when the LLM enters a MedHorizon `stage`, a plugin hook mirrors
  it onto a Research Graph node (`meta.medhorizon_stage`). Tools: `atlas_stage`.
  Docs: `research-graph/docs/STAGE_LANDING.md`.
- **Graph UI navigate / branch**: double-click a stage node to open the MedHorizon
  session; right-click → 在此开分支 forks via MedHorizon `stages/jump` (proxied
  by Research Graph API, no core edits).

## MedHorizon v0.3.7 — 2026-07-30

### Fixed

- Research Graph desktop sidecar auth: UI sends `Bearer local-dev`; sidecar
  defaults to `APP_ENV=development` so Create graph works without Supabase JWT.
  Fixes the `authorization required` / sidebar `OFFLINE` state on first open.

## MedHorizon v0.3.6 — 2026-07-30

### Added

- **Research Graph bundled into release installers** as a sibling sidecar binary
  (`research-graph` / `research-graph.exe`) next to MedHorizon.
- **Auto-start sidecar** when opening MedHorizon (`web` / `serve`, `start.bat`,
  `start.sh`). UI+API at `http://127.0.0.1:8000`. Set `RESEARCH_GRAPH_DISABLE=1`
  to skip.
- PyInstaller packaging under `research-graph/sidecar/` embeds the built SPA.

## MedHorizon v0.3.5 — 2026-07-30

### Changed

- Release **installer archives now embed the MedHorizon binary** (offline install).
  - Windows: `medhorizon-windows-installer.zip` = `medhorizon.exe` + `install.bat` /
    `install.ps1` / `start.bat` / `VERSION`
  - macOS/Linux: `*-installer.tar.gz` = binary + `install.sh` + `VERSION`
- Install scripts no longer download from GitHub; they copy the local binary.
- Standalone download-only `install.bat` / `install.ps1` / `install.sh` are no
  longer published as Release assets.

## MedHorizon v0.3.4 — 2026-07-30

### Fixed

- Windows `install.ps1` is now **ASCII-only with CRLF** (same class of failure as
  UTF-8/LF `install.bat` under Windows PowerShell/cmd).
- Generated `start.bat` is written as ASCII + CRLF (no UTF-8 BOM).
- Release packaging rewrites both `install.bat` and `install.ps1` to CRLF before
  upload; `.gitattributes` forces `*.ps1` to `eol=crlf`.

## MedHorizon v0.3.3 — 2026-07-30

### Fixed

- Windows `install.bat` is now **ASCII-only with CRLF** line endings so `cmd.exe`
  does not misparse UTF-8/LF batches from the Release zip.
- Release packaging rewrites `install.bat` to CRLF before upload; `.gitattributes`
  forces `*.bat` / `*.cmd` to `eol=crlf`.

## MedHorizon v0.3.2 — 2026-07-30

### Fixed

- Windows one-click installer: Release now ships `install.ps1` alongside
  `install.bat`, plus `medhorizon-windows-installer.zip`. `install.bat` also
  auto-downloads `install.ps1` from GitHub when missing.
- Also attach `install.sh` on the Release for offline/macOS-Linux installs.

### Added

- Research Graph sidebar-card integration and prettier/CI formatting fixes from
  the v0.3.1 line, bundled into this installer cut.

## MedHorizon v0.3.1 — 2026-07-30

### Added

- **Research Graph ↔ MedHorizon sidebar card** (no core edits): HTTP integration
  contract (`/integration/manifest`, `/integration/sidebar-card`), embed script
  that injects a featured card into `.session-sidebar`, and a loopback gateway
  (`research-graph/scripts/medhorizon-gateway.py`) that proxies MedHorizon UI
  and injects the script.
- Plugin tool `atlas_sidebar` + skill `atlas-sidebar` for agents to surface the
  card / inject hints.
- Research Graph UI `SidebarCard` + `/embed/card` iframe surface.

### Notes

- Open `http://127.0.0.1:5199` via the gateway (MedHorizon on `:4444`, RG API on
  `:8000`) to see the card in the session sidebar.
- Bookmarklet alternative: `http://127.0.0.1:8000/embed/bookmarklet`.

## MedHorizon v0.3.0 — 2026-07-30

### Added

- **Research Graph** optional sidecar (`research-graph/`): independent FastAPI +
  React module for research graphs, experiments, artifacts, and GEPA loops.
  Does not modify MedHorizon core; enable via plugin overlay /
  `OPENSCIENCE_CONFIG_DIR` + `RESEARCH_GRAPH_API`.
- Graph CRUD with nodes/edges, archive/export, Markdown import/export, and
  React Flow canvas UI.
- Experiment specs, runs, result-node promotion back onto the graph.
- GEPA optimization loop with reproducible seeds, budget/iteration limits, and
  human gate (accept/reject candidates).
- Artifact store + sync outbox; local SQLite when Supabase is unset.
- Visual usage guide with screenshots: `research-graph/docs/USAGE.md`.

### Notes

- Search / AI chat require `OPENAI_API_KEY` on the module backend (503 without).
- Installers and CLI binaries remain the same three platform targets as v0.2.0.

## MedHorizon v0.2.0 — 2026-07-30

### Changed

- Product rebrand to **MedHorizon** (CLI, UI, config paths with dual-read).
- Release matrix: Windows x64, macOS arm64, Linux x64 (no macos-x64).

## v1.2.8 — 2026-07-06

### Fixed

- Managed models (e.g. GPT-5.5, Gemini) failed with "isn't connected to your
  Atlas wallet" or a proxy 401 ("thk\_\* token not found") when a provider key
  such as `OPENAI_API_KEY` was exported in the shell. Managed-proxy calls now
  always authorize with the Atlas session token, so an ambient shell key can't
  shadow it — for OpenAI, Anthropic, Gemini, and OpenRouter.
- OAuth subscriptions (Sign in with ChatGPT/Codex, Claude Pro/Max, Copilot) are
  no longer blocked when managed LLM spend is on — they run on your own account,
  free of the wallet.

## v1.2.7 — 2026-07-06

### Fixed

- The `initialize-atlas-graph` system skill — invoked by the canvas and the
  research agent — now resolves in every install. Released builds load skills
  from the Atlas catalog, which omitted it, so it failed with "Skill not found"
  outside a source checkout; it is now embedded and materialized locally when the
  catalog lacks it.

### Changed

- In-project workspace polish: on-scale typography (hero heading, chat-markdown,
  tabs), a tighter header, unified sidebar and tab alignment, and corrected
  muted-text tokens that had rendered at full strength.
- Landing page: structured data (JSON-LD) for search engines and async image
  decoding.
- Docs: a changelog, release-process and verification notes, a skills reference,
  and a supported-versions security policy.

## v1.2.6 — 2026-07-06

Atlas experience polish.

### Added

- Unified `openscience status`: connection, plan, wallet balance + lifetime
  spend, recent usage, managed-compute availability, and the bundled `atlas`
  companion version — all in one view, degrading gracefully when signed out.
- Wallet settings panel and a `/settings/wallet` route surfacing the Atlas
  credits balance, billing mode, and recent transaction ledger.
- Browser Atlas login (`/account/login-key` + a first-run setup dialog) and a
  first-run flow that no longer dead-ends when no model is configured.
- Opt-in reviewer gate (`experimental.reviewGate`) that runs a blind review pass
  on a primary agent's final answer and annotates it with the verdict.

### Changed

- Bundled `@synsci/atlas` companion bumped to `^0.13.2` so managed compute
  resolves.
- arXiv retrieval hardened: per-host throttling, honest content negotiation,
  PDF-link and error-response parsing, and graceful degradation when a source
  fails.
- Model-catalog tests are deterministic (fixtured) with a nightly delisting
  tripwire.

### Fixed

- Every Atlas network call is timeout-bounded, fixing a hang where
  `project init` could run indefinitely.
- Credential sync no longer flips managed billing when a user's own exported key
  is present; synced files are written atomically.
- Codex OAuth recovers from refresh-token rotation and distinguishes a
  reconnect-required error from a transient one.

## v1.2.5 — 2026-07-05

- Seamless first-run onboarding with a clear managed vs. BYOK choice.
- Centralized catalog model pins with a delisting tripwire.
- OpenScience docs site at openscience.sh/docs.
- Spend controls in the workspace; compute keys actually applied.

## v1.2.4 — 2026-07-04

- Codex recovers from refresh-token rotation races.
- Release and npm-provenance fixes so packages publish reliably.

## v1.2.3 — 2026-07-04

- First tagged release of the `1.2.x` line.
