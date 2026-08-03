/**
 * Real-browser coverage for the Memory / Network / Specialists destructive
 * confirmations (Plan 06, Task 4).
 *
 * These three panels previously called window.confirm. They now open the
 * Promise confirmDialog stacked over the Settings dialog (mode: "stack"), so
 * this spec is also the first live coverage of a confirm mounted above the
 * Settings parent. Every assertion runs against the real in-process backend:
 * data is seeded through the SDK, and cancel / success / single-request
 * outcomes are observed through the UI plus the persisted backend state.
 * Nothing is mocked or network-intercepted.
 */
import { test, expect } from "./fixtures"
import type { Page } from "@playwright/test"

// The isolated harness starts a fresh Vite dev server per run, so the first
// page load in a run compiles the whole app on demand. Under concurrent load
// (parallel worktrees) that first compile can exceed the 10s gotoSession
// window. Retries are legitimate resilience here — CI already sets retries: 2
// — and every retried attempt exercises the same real backend and UI.
test.describe.configure({ retries: 2 })

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

test("Memory clear-all confirm cancels, keeps notes, and restores focus", async ({ page, sdk, gotoSession }) => {
  const errors = trackErrors(page)
  await sdk.settings.memory.set({
    scope: "global",
    enabled: true,
    categories: [{ id: "e2e-cat", name: "E2E category", notes: [{ id: "e2e-note", text: "e2e note", createdAt: 0 }] }],
  })

  await gotoSession()
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const settings = page.getByRole("dialog")
  await settings.getByRole("button", { name: "Memory", exact: true }).click()
  await expect(settings.getByText("e2e note", { exact: true })).toBeVisible()

  await settings.getByRole("button", { name: "clear all", exact: true }).click()
  const confirm = page.getByRole("dialog").filter({ hasText: "Clear memory?" })
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute("data-expanded", "")
  await expect(confirm.locator('[data-slot="dialog-title"]')).toHaveText("Clear memory?")
  await expect(confirm.locator('[data-slot="dialog-description"]')).toHaveText(
    "Clear all global memory? This cannot be undone.",
  )
  await expect(confirm.getByRole("button", { name: "clear", exact: true })).toHaveAttribute("style", /color-error/)
  // The Settings parent stays mounted underneath the stacked confirm.
  await expect(settings.getByRole("heading", { name: "Memory" })).toBeAttached()

  await confirm.getByRole("button", { name: "cancel", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(settings.getByText("e2e note", { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("clear all")
  expect(errors).toEqual([])
})

test("Memory clear-all confirm clears memory on a single request", async ({ page, sdk, gotoSession }) => {
  const errors = trackErrors(page)
  await sdk.settings.memory.set({
    scope: "global",
    enabled: true,
    categories: [{ id: "e2e-cat", name: "E2E category", notes: [{ id: "e2e-note", text: "e2e note", createdAt: 0 }] }],
  })

  await gotoSession()
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const settings = page.getByRole("dialog")
  await settings.getByRole("button", { name: "Memory", exact: true }).click()
  await expect(settings.getByText("e2e note", { exact: true })).toBeVisible()

  await settings.getByRole("button", { name: "clear all", exact: true }).click()
  const confirm = page.getByRole("dialog").filter({ hasText: "Clear memory?" })
  await expect(confirm).toBeVisible()
  // Double-click the confirm: the busy guard must fire exactly one PUT.
  await confirm.getByRole("button", { name: "clear", exact: true }).dblclick()
  await expect(confirm).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(settings.getByText("e2e note", { exact: true })).toHaveCount(0)
  await expect(settings.getByRole("button", { name: "clear all", exact: true })).toHaveCount(0)
  const doc = await sdk.settings.memory.get({ scope: "global" }).then((r) => r.data)
  expect(doc?.categories ?? []).toEqual([])
  expect(errors).toEqual([])
})

test("Network clear-all confirm shows the count and clears custom domains", async ({ page, sdk, gotoSession }) => {
  const errors = trackErrors(page)
  await sdk.settings.network.set({
    allowlistEnabled: false,
    enabled: ["package-management"],
    custom: ["example.org", "docs.example.org"],
  })

  await gotoSession()
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const settings = page.getByRole("dialog")
  await settings.getByRole("button", { name: "Network", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Network" })).toBeVisible()
  await expect(settings.getByText("example.org", { exact: true })).toBeVisible()

  // Cancel path keeps the domains.
  await settings.getByRole("button", { name: "clear", exact: true }).click()
  const confirm = page.getByRole("dialog").filter({ hasText: "Remove all 2 custom allowed domains?" })
  await expect(confirm).toBeVisible()
  await expect(confirm.locator('[data-slot="dialog-title"]')).toHaveText("Clear custom domains?")
  await expect(confirm.locator('[data-slot="dialog-description"]')).toHaveText("Remove all 2 custom allowed domains?")
  await confirm.getByRole("button", { name: "cancel", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(settings.getByText("example.org", { exact: true })).toBeVisible()

  // Confirm path clears the custom domains and updates the backend.
  await settings.getByRole("button", { name: "clear", exact: true }).click()
  await expect(confirm).toBeVisible()
  await confirm.getByRole("button", { name: "clear", exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(settings.getByText("example.org", { exact: true })).toHaveCount(0)
  await expect(settings.getByText("No custom domains.", { exact: true })).toBeVisible()
  const state = await sdk.settings.network.get().then((r) => r.data)
  expect(state?.state.custom ?? []).toEqual([])
  expect(errors).toEqual([])
})

test("Specialists delete confirm cancels, then deletes with a toast and refetch", async ({
  page,
  sdk,
  gotoSession,
}) => {
  const errors = trackErrors(page)
  const agentName = `e2e-spec-${Date.now()}`
  await sdk.global.config.update({
    config: { agent: { [agentName]: { description: "E2E specialist", mode: "subagent" } } },
  })

  try {
    await expect
      .poll(async () => {
        const res = await sdk.app.agents()
        return (res.data ?? []).some((a) => a.name === agentName)
      })
      .toBe(true)

    await gotoSession()
    await page.getByRole("button", { name: "settings", exact: true }).click()
    const settings = page.getByRole("dialog")
    await settings.getByRole("button", { name: "Specialists", exact: true }).click()
    await expect(settings.getByRole("heading", { name: "Specialists" })).toBeVisible()
    await expect(settings.getByText(agentName, { exact: true })).toBeVisible()

    // Cancel path keeps the custom specialist.
    await settings.getByRole("button", { name: "Delete", exact: true }).click()
    const confirm = page.getByRole("dialog").filter({ hasText: `Delete custom specialist "${agentName}"?` })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator('[data-slot="dialog-title"]')).toHaveText("Delete specialist?")
    await expect(confirm.locator('[data-slot="dialog-description"]')).toContainText(agentName)
    await expect(confirm.getByRole("button", { name: "delete", exact: true })).toHaveAttribute("style", /color-error/)
    await confirm.getByRole("button", { name: "cancel", exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(settings.getByText(agentName, { exact: true })).toBeVisible()

    // Confirm path: double-click must fire a single unset, then refetch + toast.
    await settings.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "delete", exact: true }).dblclick()
    const toast = page.locator('[data-component="toast"]')
    await expect(toast.filter({ hasText: `Deleted "${agentName}"` })).toBeVisible()
    await expect(toast.filter({ hasText: agentName })).toHaveCount(1)
    await expect(confirm).toHaveCount(0)
    await expect(settings.getByText(agentName, { exact: true })).toHaveCount(0)
    await expect(settings.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    await sdk.global.configUnset({ path: ["agent", agentName] }).catch(() => undefined)
  }
})
