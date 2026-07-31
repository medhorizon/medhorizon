---
name: initialize-atlas-graph
description: "OPTIONAL Atlas cloud only. Create/link this repo's Atlas project graph when the user explicitly asks for Atlas, or the Atlas canvas says 'no graph for this project'. Do NOT use for default research persistence — use atlas-graph (local Research Graph) instead."
category: research
allowed-tools: [Bash]
---

# Initialize the Atlas Research Graph

## Overview

An Atlas **project** is this repo's **cloud** research graph — the root that hypotheses,
experiments, training/eval runs, evidence, and decisions hang off when Atlas is enabled.
Creating (or linking to an existing) graph is a one-command, dedupe-safe operation. It is
keyed off the **git repo**, not the opened folder, so a subfolder or a fresh
clone at a different path resolves to the **same** graph.

**Default research memory is the local Research Graph (`atlas-graph` / `atlas_graph`).**
Do not run this skill at the start of ordinary research unless Atlas cloud was requested.

Run this skill when:
- The user explicitly asks to "initialize Atlas", "set up Atlas cloud", or sync to Atlas.
- The Atlas canvas shows "no graph for this project" / the folder isn't linked yet and the user wants the cloud canvas.

Do **not** run this skill when:
- Starting a normal research task (use `atlas-graph` instead).
- The user has not configured Atlas login / plan.

## Steps

1. **(Optional) Confirm the CLI is authenticated.**
   ```bash
   atlas doctor --format=json
   ```
   If it reports unavailable/unauthenticated, tell the user to run
   `openscience login` — the cloud graph cannot be created without a session.
   Then fall back to local `atlas-graph` for research memory.

2. **Create or link the graph** (idempotent — safe to re-run; returns the
   existing graph if one already exists):
   ```bash
   medhorizon project init --format=json
   ```
   On success this prints `{"project_id":"<id>"}` and writes `.medhorizon/project.json`
   at the repo root so the canvas links to it immediately.

   On failure it prints `project_id: null` plus an `error` kind (and `host`,
   `status`, `message` when known). Relay the fix that matches the kind — do
   NOT guess or tell the user to re-login for a network problem:
   - `"unauthenticated"` — no session, or the backend rejected the saved key.
     Tell the user to run `openscience login`, and continue with local Research Graph.
   - `"unreachable"` — the Atlas backend at the printed `host` could not be
     reached (network/DNS error or 5xx). The user IS logged in; suggest checking
     connectivity and any `OPENSCIENCE_API_BASE`/`SYNSC_API_BASE` override, then
     retrying — not re-authenticating.
   - `"plan"` — authenticated, but the account has no active Atlas plan. Point
     the user at https://app.syntheticsciences.ai/billing; include the
     backend `message` if present.
   - `"backend"` — anything else; show the backend's `status`/`message` verbatim.

3. **Confirm to the user.** Report the `project_id` and tell them the graph now
   shows in the canvas (Atlas pane). From here, milestones are recorded against
   this graph as the work progresses.

## Notes

- **Idempotent & dedupe-safe:** re-running never creates a duplicate; it returns
  the same graph for the same repo.
- **Repo-rooted:** run it from anywhere inside the repo — it resolves to the git
  top-level.
- **Do not** hand-edit `.medhorizon/project.json`; let `medhorizon project init` manage
  it (use `medhorizon project merge` to pick a canonical root if duplicates exist).
