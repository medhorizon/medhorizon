import { test, expect } from "./fixtures"
import { promptSelector, sessionPath } from "./utils"

test("favorite toast shows once, dismisses, auto-expires, and keeps one region", async ({
  page,
  directory,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("openscience.setup.dismissed", "1")
  })

  await page.goto("/")
  const region = page.locator('[data-component="toast-region"]')
  await expect(region).toHaveCount(1)

  const project = page.getByRole("main").getByRole("button").filter({ hasText: directory }).first()
  await expect(project).toBeVisible()

  await project.hover()
  await project.getByRole("button", { name: "favorite" }).click()

  const toast = page.locator('[data-component="toast"]')
  await expect(toast).toHaveCount(1)
  await expect(toast.locator('[data-slot="toast-title"]')).toHaveText("favorited")
  await expect(toast.locator('[data-slot="toast-description"]')).toHaveText(directory)

  const close = toast.locator('[data-slot="toast-close-button"]')
  await expect(close).toBeVisible()
  await close.click()
  await expect(toast).toHaveCount(0)

  // Fresh notification for auto-dismiss + cross-route host identity.
  await project.hover()
  await project.getByRole("button", { name: "unfavorite" }).click()
  await expect(toast).toHaveCount(1)
  await expect(toast.locator('[data-slot="toast-title"]')).toHaveText("unfavorited")

  await page.goto(sessionPath(directory))
  await expect(region).toHaveCount(1)
  // Same toast may still be present; it must never be duplicated by navigation.
  expect(await toast.count()).toBeLessThanOrEqual(1)
  if ((await toast.count()) === 1) {
    await expect(toast.locator('[data-slot="toast-title"]')).toHaveText("unfavorited")
  }

  await page.goto("/")
  await expect(region).toHaveCount(1)
  expect(await toast.count()).toBeLessThanOrEqual(1)
  await expect(toast).toHaveCount(0, { timeout: 7000 })

  // Session remains a live PromptInput route with a single toast host.
  await page.goto(sessionPath(directory))
  await expect(region).toHaveCount(1)
  await expect(page.locator(promptSelector)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("atlas", { exact: true })).toHaveCount(0)
  await expect(page.locator("text=artifacts")).toHaveCount(0)
})
