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
    await page.locator('[role="tab"][title="Files"]').click()
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

// A fresh session has no artifacts: the module shows the success empty state
// (never an error banner). Registering a new artifact on disk (sidecar first,
// `.dat` last — the visibility commit) and clicking refresh surfaces it WITHOUT
// reloading the whole session; the list is re-read through the session API only.
test("empty session shows success empty; refresh surfaces a newly registered artifact without a page reload", async ({ page, sdk, gotoSession }) => {
  const atlasHits: string[] = []
  let loadCount = 0
  page.on("request", (req) => {
    let pathname: string
    try {
      pathname = new URL(req.url()).pathname
    } catch {
      return
    }
    if (pathname.includes("/api/atlas")) atlasHits.push(pathname)
  })
  page.on("load", () => loadCount++)

  const created = await sdk.session.create({ title: `session artifacts refresh ${Date.now()}` }).then((r) => r.data)
  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    await gotoSession(sessionID)
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()

    // Empty session renders the success empty state, never an error banner.
    await expect(page.getByText("no artifacts in this session")).toBeVisible()
    await expect(page.locator('[data-slot="async-state-banner"]')).toHaveCount(0)

    // Register a new artifact on disk while the module is already open.
    const id = "art-e2e-refresh"
    const summary = "freshly registered artifact"
    const dir = join(process.env.XDG_DATA_HOME!, "medhorizon", "artifacts", sessionID)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${id}.meta.json`),
      JSON.stringify({ version: 1, id, type: "analysis", summary, size: 7, createdAt: new Date().toISOString() }),
    )
    await writeFile(join(dir, `${id}.dat`), "hello!!")

    // Click refresh: the new row appears with no full page reload.
    const loadsBeforeRefresh = loadCount
    await page.getByRole("button", { name: "refresh artifacts" }).click()
    const row = page.locator(`[data-artifact-id="${id}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(summary)
    expect(loadCount).toBe(loadsBeforeRefresh)

    expect(atlasHits).toEqual([])
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})

// A payload larger than the server preview cap is listed normally but previewed
// as a bounded slice: the UI surfaces the "truncated" marker and the preview
// DOM carries only the capped slice, never the full payload.
test("a payload over the preview cap lists and previews as truncated without loading the full payload", async ({ page, sdk, gotoSession }) => {
  const created = await sdk.session.create({ title: `session artifacts large ${Date.now()}` }).then((r) => r.data)
  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  try {
    const id = "art-e2e-large"
    const summary = "oversized raw payload"
    // Larger than the server-fixed PREVIEW_CAP (32 KiB); the E2E seeds exactly
    // what the route must bound, so the preview slice below is deterministic.
    const size = 40 * 1024 + 7
    const dir = join(process.env.XDG_DATA_HOME!, "medhorizon", "artifacts", sessionID)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, `${id}.meta.json`),
      JSON.stringify({ version: 1, id, type: "raw_output", summary, size, createdAt: new Date().toISOString() }),
    )
    await writeFile(join(dir, `${id}.dat`), "x".repeat(size))

    await gotoSession(sessionID)
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()

    const row = page.locator(`[data-artifact-id="${id}"]`)
    await expect(row).toBeVisible()
    await row.click()

    const preview = page.locator('[data-component="artifact-preview"]')
    await expect(preview).toBeVisible()
    await expect(preview.getByText("truncated", { exact: true })).toBeVisible()
    const content = await page.locator('[data-slot="artifact-preview-content"]').textContent()
    expect(content).toBe("x".repeat(32 * 1024))
    expect(content!.length).toBeLessThan(size)
  } finally {
    await sdk.session.delete({ sessionID }).catch(() => undefined)
  }
})

// Keep-mounted module state is scoped to one sessionID. Navigating in-app from
// session A to session B resets the artifacts page/selection/preview; A's rows
// never appear under B, and returning to A reloads under the new scope instead
// of relying on stale keep-mounted DOM.
test("switching from session A to session B resets the artifacts scope; returning to A reloads fresh", async ({ page, slug, sdk, gotoSession }) => {
  const stamp = Date.now()
  const a = await sdk.session.create({ title: `e2e artifact scope A ${stamp}` }).then((r) => r.data)
  const b = await sdk.session.create({ title: `e2e artifact scope B ${stamp}` }).then((r) => r.data)
  if (!a?.id || !b?.id) throw new Error("Session create did not return ids")

  try {
    const seed = async (dir: string, id: string, summary: string) => {
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, `${id}.meta.json`),
        JSON.stringify({ version: 1, id, type: "analysis", summary, size: 4, createdAt: new Date().toISOString() }),
      )
      await writeFile(join(dir, `${id}.dat`), "data")
    }
    const root = join(process.env.XDG_DATA_HOME!, "medhorizon", "artifacts")
    await seed(join(root, a.id), "art-e2e-a", "artifact of session A")
    await seed(join(root, b.id), "art-e2e-b", "artifact of session B")

    await gotoSession(a.id)
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()

    // Session A lists and selects its own artifact.
    const rowA = page.locator('[data-artifact-id="art-e2e-a"]')
    await expect(rowA).toBeVisible()
    await expect(page.locator('[data-artifact-id="art-e2e-b"]')).toHaveCount(0)
    await rowA.click()
    await expect(page.locator('[data-component="artifact-preview"]')).toBeVisible()

    // Navigate in-app to session B via the sidebar (client-side, no reload).
    const sidebar = page.getByRole("complementary").filter({ has: page.getByPlaceholder("Search sessions") })
    const targetB = sidebar.locator('[role="button"]').filter({ hasText: `e2e artifact scope B ${stamp}` })
    await expect(targetB).toBeVisible()
    await targetB.scrollIntoViewIfNeeded()
    await targetB.click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session/${b.id}(?:\\?|#|$)`))

    // Under session B only B's artifact appears: A's row, selection and preview
    // are gone (no stale keep-mounted DOM from the old scope).
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()
    await expect(page.locator('[data-artifact-id="art-e2e-b"]')).toBeVisible()
    await expect(page.locator('[data-artifact-id="art-e2e-a"]')).toHaveCount(0)
    await expect(page.locator('[data-component="artifact-preview"]')).toHaveCount(0)

    // Returning to session A reloads A's artifacts under the new scope.
    const targetA = sidebar.locator('[role="button"]').filter({ hasText: `e2e artifact scope A ${stamp}` })
    await expect(targetA).toBeVisible()
    await targetA.scrollIntoViewIfNeeded()
    await targetA.click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session/${a.id}(?:\\?|#|$)`))
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByRole("tab", { name: "Session Artifacts", exact: true }).click()
    await expect(page.locator('[data-artifact-id="art-e2e-a"]')).toBeVisible()
    await expect(page.locator('[data-artifact-id="art-e2e-b"]')).toHaveCount(0)
    await expect(page.locator('[data-component="artifact-preview"]')).toHaveCount(0)
  } finally {
    await sdk.session.delete({ sessionID: a.id }).catch(() => undefined)
    await sdk.session.delete({ sessionID: b.id }).catch(() => undefined)
  }
})
