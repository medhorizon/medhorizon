/**
 * Skill Library dialog coverage (Plan 07, Task 4). Opens the library through
 * the RightPane "skill library" button — this is the Dialog surface, distinct
 * from the SkillsPage tab covered by skills.spec.ts. Exercises ready/search/
 * pick against the real local backend; the skill-fetch error coordinator is
 * covered by the focused src/context/skill-load.test.ts instead of page.route.
 */
import { test, expect } from "./fixtures"

test("skill library opens from the right pane, searches, and picks a skill", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.getByTitle("skill library").click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveText("Skill Library")

  // Source-mode runs include the on-disk bundled catalog. The standalone
  // binary resolves that catalog from Atlas after login but always embeds its
  // system skills, so account-free installs remain usable.
  const knownSkill = process.env.OPENSCIENCE_E2E_PACKAGED === "1" ? "initialize-atlas-graph" : "scientific-writing"

  // Ready library: the seeded skill row is visible.
  await expect(dialog.getByText(`/${knownSkill}`, { exact: true }).first()).toBeVisible()

  // Search narrows the ready library to the matching row.
  const search = dialog.getByPlaceholder("search skills…")
  await search.fill(knownSkill.split("-")[0])
  await expect(dialog.getByText(`/${knownSkill}`, { exact: true }).first()).toBeVisible()

  // A query with no match is a distinct second layer — not the resource-level
  // empty state (the ready library is non-empty here).
  await search.fill("no-such-skill-zzz")
  await expect(dialog.getByText("no matching skills", { exact: true })).toBeVisible()

  // Clearing the query restores the full list; picking a skill closes the dialog.
  await search.fill("")
  await dialog.getByText(`/${knownSkill}`, { exact: true }).first().click()
  await expect(dialog).toHaveCount(0)
})
