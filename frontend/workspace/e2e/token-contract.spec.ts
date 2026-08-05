import { test, expect } from "./fixtures"

const schemes = ["light", "dark"] as const

for (const scheme of schemes) {
  test.describe(`token contract (${scheme})`, () => {
    test.use({ colorScheme: scheme })

    test("exposes semantic font, layout, motion, and focus aliases", async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("openscience-color-scheme", "system"))
      await page.goto("/")

      await expect.poll(() => page.locator("html").getAttribute("data-color-scheme")).toBe(scheme)

      const tokens = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root)
        const probe = document.createElement("div")
        probe.style.cssText = "font-family: var(--font-ui);"
        const ui = probe.cloneNode() as HTMLElement
        ui.style.fontFamily = "var(--font-ui)"
        const content = probe.cloneNode() as HTMLElement
        content.style.fontFamily = "var(--font-content)"
        const code = probe.cloneNode() as HTMLElement
        code.style.fontFamily = "var(--font-code)"
        document.body.append(ui, content, code)
        const raw = (name: string) => {
          const walk = (rules: CSSRuleList): string | undefined => {
            for (const rule of Array.from(rules)) {
              if (rule instanceof CSSStyleRule) {
                const value = rule.style.getPropertyValue(name).trim()
                if (value) return value
              }
              if ("cssRules" in rule && rule.cssRules) {
                const value = walk(rule.cssRules)
                if (value) return value
              }
            }
            return undefined
          }

          for (const sheet of Array.from(document.styleSheets)) {
            try {
              const value = walk(sheet.cssRules)
              if (value) return value
            } catch {
              continue
            }
          }
          return ""
        }

        return {
          fontUi: raw("--font-ui"),
          fontContent: raw("--font-content"),
          fontCode: raw("--font-code"),
          familyUi: getComputedStyle(ui).fontFamily,
          familyContent: getComputedStyle(content).fontFamily,
          familyCode: getComputedStyle(code).fontFamily,
          spaceOne: raw("--space-1"),
          spaceEight: raw("--space-8"),
          radiusControl: raw("--radius-control"),
          radiusCard: raw("--radius-card"),
          radiusModal: raw("--radius-modal"),
          motionFast: raw("--motion-fast"),
          motionNormal: raw("--motion-normal"),
          motionEase: raw("--motion-ease"),
          focusRing: raw("--focus-ring"),
        }
      })

      expect(tokens.familyUi).toContain("Computer Modern")
      expect(tokens.familyContent).toContain("Computer Modern")
      expect(tokens.familyCode).toContain("IBM Plex Mono")
      expect(tokens.fontUi).toMatch(/var\(--font-family-sans/)
      expect(tokens.fontContent).toMatch(/var\(--font-family-serif/)
      expect(tokens.fontCode).toMatch(/var\(--font-family-mono/)
      expect(tokens.spaceOne).toMatch(/var\(--spacing/)
      expect(tokens.spaceEight).toMatch(/var\(--spacing/)
      expect(tokens.radiusControl).toBe("var(--radius-md)")
      expect(tokens.radiusCard).toBe("var(--radius-lg)")
      expect(tokens.radiusModal).toBe("var(--radius-xl)")
      expect(tokens.motionFast).toBe("var(--duration-fast)")
      expect(tokens.motionNormal).toBe("var(--duration-slow)")
      expect(tokens.motionEase).toBe("var(--ease-standard)")
      expect(tokens.focusRing).toBe("var(--shadow-xs-border-focus)")
    })

    test("collapses motion durations for reduced-motion users", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("openscience-color-scheme", "system"))
      await page.goto("/")

      const motion = await page.locator("html").evaluate((root) => {
        const style = getComputedStyle(root)
        return {
          fast: style.getPropertyValue("--motion-fast").trim(),
          normal: style.getPropertyValue("--motion-normal").trim(),
        }
      })

      expect(motion.fast).toBe("1ms")
      expect(motion.normal).toBe("1ms")
    })
  })
}
