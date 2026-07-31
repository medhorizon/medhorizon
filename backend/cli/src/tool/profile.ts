/** Deterministic tool availability profiles for native agents (plan 13, task 5). */

const core = ["invalid"] as const

export const CHAT = ["question", ...core] as const

export const CODE = ["read", "glob", "grep", "bash", "edit", "write", "apply_patch", ...core] as const

export const COMPUTE = ["read", "glob", "grep", "notebook", "rkernel", "artifact", ...core] as const

/** Compute workflow without Research Graph atlas tools (plan 13 task 5). */
export const COMPUTE_WORKFLOW = [
  ...COMPUTE,
  "bash",
  "edit",
  "write",
  "apply_patch",
  "skill",
  "science_*",
  "provenance_*",
  "webfetch",
  "websearch",
  "codesearch",
  "learn",
  "task",
  ...core,
] as const

export const GRAPH = ["stage", "atlas_*", "read", "glob", "grep", ...core] as const

/** Research workflow + local Research Graph atlas tools (v0.3.10 default). */
export const RESEARCH = [
  "read",
  "glob",
  "grep",
  "bash",
  "edit",
  "write",
  "apply_patch",
  "skill",
  "stage",
  "webfetch",
  "websearch",
  "codesearch",
  "science_*",
  "provenance_*",
  "artifact",
  "learn",
  "notebook",
  "rkernel",
  "task",
  "todoread",
  "todowrite",
  "atlas_*",
  ...core,
] as const

export const EXPLORE = [
  "read",
  "glob",
  "grep",
  "bash",
  "list",
  "webfetch",
  "websearch",
  "codesearch",
  ...core,
] as const

export const LITERATURE = [
  "read",
  "glob",
  "grep",
  "bash",
  "webfetch",
  "websearch",
  "codesearch",
  "skill",
  ...core,
] as const

export const READONLY = ["read", "glob", "grep", "skill", ...core] as const

export const CRITIQUE = ["read", "glob", "grep", "skill", ...core] as const

export const PHYSICS_CRITIQUE = ["read", "glob", "grep", "bash", ...core] as const

export const REVIEWER = ["read", "glob", "grep", "bash", "skill", ...core] as const

export const TASK = [
  ...CODE,
  "task",
  "webfetch",
  "websearch",
  "codesearch",
  "skill",
] as const

export const PLAN = [
  "read",
  "glob",
  "grep",
  "question",
  "planwrite",
  "plan_exit",
  "plan_enter",
  "todoread",
  "skill",
  ...core,
] as const

export const BIOLOGY = [...RESEARCH, "query_*"] as const

/** Scientific writing subagent — search, provenance, artifacts; no graph/compute schemas. */
export const WRITE = [
  "read",
  "glob",
  "grep",
  "bash",
  "edit",
  "write",
  "apply_patch",
  "skill",
  "webfetch",
  "websearch",
  "codesearch",
  "provenance_*",
  "artifact",
  ...core,
] as const

export const NONE: readonly string[] = []
