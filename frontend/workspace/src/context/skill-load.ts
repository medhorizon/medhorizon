export type SkillStatus = "loading" | "ready" | "error"

export type SkillPatch<T> =
  | { skill_status: "loading" }
  | { skill: T[]; skill_status: "ready"; skill_error: undefined }
  | { skill_status: "error"; skill_error: string }

/**
 * The single skill-fetch coordinator shared by project bootstrap, `skill.updated`
 * events and UI retry. Start only flips the status — the existing skill array is
 * kept. A failure records a readable error and keeps the old array (the error
 * patch never touches `skill`), so the UI can show stale rows under the banner.
 */
export async function runSkillLoad<T>(input: {
  set: (patch: SkillPatch<T>) => void
  fetch: () => Promise<{ data?: T[] }>
}): Promise<void> {
  input.set({ skill_status: "loading" })
  try {
    const res = await input.fetch()
    input.set({ skill: res.data ?? [], skill_status: "ready", skill_error: undefined })
  } catch (err) {
    input.set({ skill_status: "error", skill_error: err instanceof Error ? err.message : String(err) })
  }
}
