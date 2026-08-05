import { test as base, expect } from "./fixtures"
import { createSdk, getWorktree } from "./utils"
import type { Locator, Page, TestInfo } from "@playwright/test"

type VisualFixtures = {
  visualSession: string
}

type Scheme = "light" | "dark"

export const viewports = {
  360: { width: 360, height: 800 },
  768: { width: 768, height: 1024 },
  1440: { width: 1440, height: 900 },
} as const

export const schemes: Scheme[] = ["light", "dark"]

export const mask = [
  {
    selector: '[data-visual-mask="relative-time"], [data-slot="relative-time"]',
    reason: "Relative timestamps depend on the wall clock even with a fixed session fixture.",
  },
] as const

const markdown = [
  "E2E_VISUAL_MARKDOWN_BEGIN",
  "# Visual regression fixture",
  "",
  "A fixed paragraph exercises the content font and stable line wrapping.",
  "",
  "```python",
  "def measure(value: int) -> int:",
  "    return value * 2",
  "```",
  "",
  "$$E = mc^2$$",
  "E2E_VISUAL_MARKDOWN_END",
].join("\n")

async function seed(directory: string) {
  const sdk = createSdk(directory)
  const created = await sdk.session.create({ title: "Visual Regression Fixture" }).then((result) => result.data)
  if (!created?.id) throw new Error("Visual fixture session was not created")

  const reply = await sdk.session
    .prompt({
      sessionID: created.id,
      model: { providerID: "e2e", modelID: "echo" },
      parts: [{ type: "text", text: markdown }],
    })
    .then((result) => result.data)
  if (!reply?.info.id) throw new Error("Visual fixture prompt did not complete")

  return { id: created.id, sdk }
}

export const test = base.extend<VisualFixtures>({
  visualSession: [
    async ({}, use) => {
      const directory = await getWorktree()
      const fixture = await seed(directory)
      await use(fixture.id)
      await fixture.sdk.session.delete({ sessionID: fixture.id }).catch(() => undefined)
    },
    { scope: "worker" },
  ],
})

export { expect }

export async function prepareTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("openscience-color-scheme", "system")
  })
}

export async function assertScheme(page: Page, scheme: Scheme) {
  const root = page.locator("html")
  await expect(root).toHaveAttribute("data-theme", /.+/)
  await expect(root).toHaveAttribute("data-color-scheme", scheme)
  await expect.poll(() => root.evaluate((element) => getComputedStyle(element).colorScheme)).toBe(scheme)
}

export async function waitForVisualReady(page: Page, root: Locator) {
  await expect(root).toBeVisible()
  const marker = root.locator("[data-visual-ready]").first()
  await expect
    .poll(
      async () => {
        if (await marker.count()) {
          const nested = await marker.getAttribute("data-visual-ready")
          if (nested) return nested
        }
        return root.getAttribute("data-visual-ready")
      },
      { timeout: 60_000 },
    )
    .toMatch(/.+/)
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await expect
    .poll(() =>
      root.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => {
              const effect = animation.effect as (AnimationEffect & { target?: EventTarget | null }) | null
              const target = effect?.target
              if (!(target instanceof Element)) return false
              if (target.closest("[data-visual-ignore-motion]")) return false
              const iterations = animation.effect?.getComputedTiming().iterations
              // Decorative loops (cursor/orbit/glow) have no settling point. They
              // are explicitly excluded from readiness while finite transitions
              // still have to finish before a snapshot is captured.
              return iterations !== Infinity
            })
            .filter((animation) => animation.playState === "running" || animation.playState === "pending").length,
      ),
    )
    .toBe(0)

  await root.evaluate((element) => {
    const state = { previous: element.getBoundingClientRect().toJSON(), stable: 0 }
    return new Promise<void>((resolve) => {
      const frame = () => {
        const current = element.getBoundingClientRect().toJSON()
        const same =
          current.x === state.previous.x &&
          current.y === state.previous.y &&
          current.width === state.previous.width &&
          current.height === state.previous.height
        state.stable = same ? state.stable + 1 : 0
        state.previous = current
        if (state.stable >= 2) return resolve()
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  })
}

export async function closeResearchGraph(page: Page) {
  const hide = page.getByTitle("hide panel")
  if ((await hide.count()) === 0) return
  await hide.click()
  await expect(page.locator(".session-right-pane")).toHaveCount(0)
}

export function masks(page: Page) {
  return mask.map((item) => page.locator(item.selector))
}

export async function capture(page: Page, name: string, info: TestInfo) {
  if (process.env.VISUAL_OBSERVE === "1" && process.env.VISUAL_BASELINE_UPDATE !== "1") {
    await info.attach(name, {
      body: await page.screenshot({ animations: "disabled", caret: "hide", mask: masks(page) }),
      contentType: "image/png",
    })
    return
  }
  await expect(page).toHaveScreenshot(name, { caret: "hide", mask: masks(page), animations: "disabled" })
}
