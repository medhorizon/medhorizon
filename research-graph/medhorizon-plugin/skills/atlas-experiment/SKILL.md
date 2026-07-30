---
name: atlas-experiment
description: "Design, approve, and run Research Graph experiments with dry-run default, sandbox argv runner, and immutable run history."
category: research
---

# Research Graph — atlas-experiment

## Flow

1. Design ExperimentSpec (objective, dataset/code refs, parameters, baseline, budget) — ask user to review.
2. `atlas_experiment` `create` then `approve` (permission ask).
3. Prefer `start` with `dry_run=true` first.
4. Record metrics via run get; attach artifacts through the module API.
5. Map stages with MedHorizon `stage` tool (Design gated, Baseline, Execute, Report gated). Do not invent a parallel stage store.

## Safety

- Never shell-string commands; only argv arrays inside worktree.
- Real runs require approve + permission ask + budget check.
- Failed/succeeded runs are immutable — create a new experiment revision instead of overwriting.
