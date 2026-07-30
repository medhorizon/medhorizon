---
name: atlas-gepa
description: "Run GEPA prompt/program optimization with generate → evaluate → critique → select → gate. Never apply candidates without user approval."
category: research
---

# Research Graph — atlas-gepa

## Loop

1. Design (gate via `stage gate=true`): freeze objective, splits, evaluator, seed, budget.
2. `atlas_gepa` `start` on an approved experiment.
3. `iterate` — generates candidates, deterministic evaluate, critic report. Candidates stay `pending` until gate.
4. Select/apply (gate): `approve` only after user confirmation. Do not present pending as applied.
5. Report (gate): write summary node / export; keep all iterations.

## Mapping to MedHorizon stage

| Phase | stage gate |
|-------|------------|
| Design | yes |
| Baseline | no |
| Generate / Evaluate / Critique | no |
| Select/apply | yes |
| Report | yes |

Stop on max_iterations, max_candidates, budget, or patience. Use `replay` to branch without erasing history.
