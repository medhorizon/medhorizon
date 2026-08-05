import AxeBuilder from "@axe-core/playwright"
import { writeFile } from "node:fs/promises"
import {
  test,
  expect,
  assertScheme,
  closeResearchGraph,
  prepareTheme,
  schemes,
  viewports,
  waitForVisualReady,
} from "./visual"

test.describe.configure({ mode: "serial" })

for (const scheme of schemes) {
  test.describe(`accessibility ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: viewports[1440] })

    test(`axe-${scheme}`, async ({ page, gotoSession, visualSession }, info) => {
      await prepareTheme(page)
      await page.goto("/")
      const home = page.locator('[data-visual-ready="home"]')
      await waitForVisualReady(page, home)
      await assertScheme(page, scheme)
      const homeResult = await new AxeBuilder({ page }).analyze()

      await gotoSession(visualSession)
      await closeResearchGraph(page)
      const session = page.locator(".atlas-root")
      await expect(page.locator(".shiki").first()).toBeVisible()
      await expect(page.locator(".katex").first()).toBeVisible()
      await waitForVisualReady(page, session)
      await assertScheme(page, scheme)
      const sessionResult = await new AxeBuilder({ page }).analyze()

      await page.getByRole("button", { name: "settings", exact: true }).click()
      const settings = page.locator('[data-slot="dialog-content"].settings-dialog')
      await waitForVisualReady(page, settings)
      await assertScheme(page, scheme)
      const settingsResult = await new AxeBuilder({ page }).analyze()
      const result = {
        home: homeResult,
        session: sessionResult,
        settings: settingsResult,
      }
      const report = info.outputPath("axe-report.json")
      await writeFile(report, JSON.stringify(result, null, 2))
      await info.attach("axe-report.json", { path: report, contentType: "application/json" })
      const blocking = Object.values(result).flatMap((item) =>
        item.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical"),
      )
      expect(blocking).toEqual([])
    })
  })
}

test.describe("reduced motion", () => {
  test.use({ colorScheme: "light", contextOptions: { reducedMotion: "reduce" }, viewport: viewports[360] })

  test("drawer keeps the final layout without a long transition", async ({ page, gotoSession, visualSession }) => {
    await prepareTheme(page)
    await gotoSession(visualSession)
    await closeResearchGraph(page)
    await page.getByRole("button", { name: "sessions", exact: true }).click()
    const sidebar = page.getByRole("complementary").filter({ has: page.getByLabel("search sessions") })
    await expect(sidebar).toHaveAttribute("data-mobile-open", "true")
    const duration = await sidebar.evaluate((element) => getComputedStyle(element).transitionDuration)
    expect(duration === "0s" || duration === "0.001s" || duration === "1ms").toBe(true)
  })
})
