import {
  test,
  expect,
  assertScheme,
  capture,
  closeResearchGraph,
  prepareTheme,
  schemes,
  viewports,
  waitForVisualReady,
} from "./visual"

test.describe.configure({ mode: "serial" })

for (const scheme of schemes) {
  test.describe(`visual ${scheme}`, () => {
    test.use({ colorScheme: scheme })

    for (const [size, viewport] of Object.entries(viewports)) {
      test.describe(`${size}px`, () => {
        test.use({ viewport })

        test(`home-${size}-${scheme}`, async ({ page }, info) => {
          await prepareTheme(page)
          await page.goto("/")
          const root = page.locator('[data-visual-ready="home"]')
          await expect(page.getByRole("button", { name: /new project/i }).first()).toBeVisible()
          await assertScheme(page, scheme)
          await waitForVisualReady(page, root)
          await capture(page, `home-${size}-${scheme}.png`, info)
        })

        test(`session-${size}-${scheme}`, async ({ page, gotoSession, visualSession }, info) => {
          await prepareTheme(page)
          await gotoSession(visualSession)
          await closeResearchGraph(page)
          const root = page.locator(".atlas-root")
          await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
          await expect(page.locator(".shiki").first()).toBeVisible()
          await expect(page.locator(".katex").first()).toBeVisible()
          await page.locator('[data-component="prompt-input"]').blur()
          await assertScheme(page, scheme)
          await waitForVisualReady(page, root)
          await capture(page, `session-${size}-${scheme}.png`, info)
        })

        test(`settings-${size}-${scheme}`, async ({ page, gotoSession, visualSession }, info) => {
          await prepareTheme(page)
          await gotoSession(visualSession)
          await page.getByRole("button", { name: "settings", exact: true }).click()
          const root = page.locator('[data-slot="dialog-content"].settings-dialog')
          await expect(root).toBeVisible()
          await assertScheme(page, scheme)
          await waitForVisualReady(page, root)
          await capture(page, `settings-${size}-${scheme}.png`, info)
        })

        if (size !== "360") return

        test(`session-${size}-${scheme}-drawer-open`, async ({ page, gotoSession, visualSession }, info) => {
          await prepareTheme(page)
          await gotoSession(visualSession)
          await closeResearchGraph(page)
          await page.getByRole("button", { name: "sessions", exact: true }).click()
          const sidebar = page.getByRole("complementary").filter({ has: page.getByLabel("search sessions") })
          await expect(sidebar).toHaveAttribute("data-mobile-open", "true")
          await assertScheme(page, scheme)
          await waitForVisualReady(page, page.locator(".atlas-root"))
          await capture(page, `session-${size}-${scheme}-drawer-open.png`, info)
        })
      })
    }
  })
}
