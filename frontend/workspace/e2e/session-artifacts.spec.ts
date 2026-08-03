import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test, expect } from "./fixtures"

// Seed session artifacts directly on disk in the harness's isolated data dir.
// RLMArtifacts stores per-session payloads at <data>/artifacts/<sessionID>/;
// <data> is XDG_DATA_HOME/medhorizon in the isolated E2E harness. The two-phase
// commit visibility rule means a `.dat` only lists once its metadata sidecar is
// in place — write the sidecar first, the `.dat` last. A sidecar-less `.dat` is
// a legacy entry the backend projects as type "unknown".
async function seedArtifacts(sessionID: string) {
  const dataDir = process.env.XDG_DATA_HOME
  if (!dataDir) throw new Error("E2E harness must set XDG_DATA_HOME")
  const dir = join(dataDir, "medhorizon", "artifacts", sessionID)
  await mkdir(dir, { recursive: true })

  const now = Date.now()
  const modern = {
    id: "art-e2e-analysis",
    type: "analysis",
    summary: "analysis summary one",
    size: 12,
    createdAt: new Date(now).toISOString(),
  }
  const meta = {
    version: 1,
    id: modern.id,
    type: modern.type,
    summary: modern.summary,
    size: modern.size,
    createdAt: modern.createdAt,
  }
  // Sidecar first, payload `.dat` last (the visibility commit).
  await writeFile(join(dir, `${modern.id}.meta.json`), JSON.stringify(meta))
  await writeFile(join(dir, `${modern.id}.dat`), "x".repeat(modern.size))

  // Legacy payload: no sidecar → backend falls back to type "unknown".
  const legacy = "art-e2e-legacy"
  await writeFile(join(dir, `${legacy}.dat`), "legacy-payload".repeat(4))

  return { modern, legacy }
}

// The module list surface works entirely through the session API — listing and
// preview hit the generated SDK's /session/:id/artifacts routes, download
// navigates the typed relative downloadPath, and no request ever matches
// /api/atlas/*.
test("session artifacts list, preview, and download use only the session API", async ({ page, sdk, gotoSession }) => {
  const atlasHits: string[] = []
  page.on("request", (req) => {
    let pathname: string
    try {
      pathname = new URL(req.url()).pathname
    } catch {
      return
    }
    if (pathname.includes("/api/atlas")) atlasHits.push(pathname)
  })

  const created = await sdk.session.create({ title: `session artifacts ${Date.now()}` }).then((r) => r.data)
  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    const { modern, legacy } = await seedArtifacts(sessionID)

    await gotoSession(sessionID)

    // Open the center Files surface, then the Session Artifacts module tab.
    await page.getByRole("tab", { name: "Files", exact: true }).click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()

    // Rows render summary, type, size and created time; the legacy entry is
    // explicitly "unknown", and long summaries never break the row layout.
    const modernRow = page.locator(`[data-artifact-id="${modern.id}"]`)
    await expect(modernRow).toBeVisible()
    await expect(modernRow).toContainText(modern.summary)
    await expect(modernRow).toContainText(modern.type)
    await expect(modernRow).toContainText("12 B")
    const legacyRow = page.locator(`[data-artifact-id="${legacy}"]`)
    await expect(legacyRow).toBeVisible()
    await expect(legacyRow).toContainText("unknown")

    // Selecting a row loads a bounded preview; the list stays visible.
    await modernRow.click()
    await expect(page.locator('[data-component="artifact-preview"]')).toBeVisible()
    await expect(page.locator('[data-slot="artifact-preview-content"]')).toContainText("x".repeat(modern.size))
    await expect(modernRow).toBeVisible()

    // Download navigates the typed relative downloadPath to the content route.
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
    await page.getByRole("button", { name: "download artifact" }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`${modern.id}.dat`)

    // The whole interaction made zero Atlas API requests.
    expect(atlasHits).toEqual([])
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})
