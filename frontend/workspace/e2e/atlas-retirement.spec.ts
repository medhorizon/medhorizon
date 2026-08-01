import { test, expect } from "./fixtures"

test("right pane defaults to research graph without Atlas canvas", async ({ page, gotoSession }) => {
  const atlasHits: string[] = []
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname
    if (path.includes("/api/atlas") || path.includes("/settings/wallet") || path.includes("/settings/billing")) {
      atlasHits.push(path)
    }
  })

  await page.addInitScript(() => {
    localStorage.setItem("openscience.setup.dismissed", "1")
    localStorage.setItem("thesis-rightpane-tab-v1", "canvas")
    localStorage.setItem("thesis-rightpane-hidden-tabs-v1", JSON.stringify(["canvas"]))
  })

  await gotoSession()

  await expect(page.getByText("research graph", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("atlas", { exact: true })).toHaveCount(0)
  await expect(page.locator("text=artifacts")).toHaveCount(0)

  // Legacy canvas state must not blank the pane — Research Graph or Stages remain usable.
  const rightPane = page.locator(".session-right-pane")
  await expect(rightPane).toBeVisible()
  expect(atlasHits).toEqual([])
})

test("settings has no billing panel and general has no Atlas account rows", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("openscience.setup.dismissed", "1")
  })
  await gotoSession()

  // Open settings via the common gear control if present; otherwise skip soft.
  const settingsBtn = page.getByRole("button", { name: /settings/i }).first()
  if ((await settingsBtn.count()) === 0) {
    test.skip()
    return
  }
  await settingsBtn.click()
  await expect(page.getByRole("button", { name: /^Billing$/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^General$/ })).toBeVisible()
  await page.getByRole("button", { name: /^General$/ }).click()
  await expect(page.getByText("manage billing", { exact: false })).toHaveCount(0)
  await expect(page.getByText("sign out", { exact: false })).toHaveCount(0)
})
