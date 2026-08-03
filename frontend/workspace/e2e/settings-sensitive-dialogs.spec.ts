/**
 * Real-browser characterization of the app dialogs that Plan 06 (Task 3) puts
 * in front of destructive Settings actions (Credentials remove confirms and the
 * Storage change-location prompt).
 *
 * The Settings panel is a `mode: "replace"` dialog; the Promise helpers mount
 * `mode: "stack"`, so every action below opens a SECOND dialog nested over the
 * still-mounted Settings panel. Kobalte's nested modal hides the underlying
 * panel from the accessibility tree (aria-hidden) while it stays mounted, so
 * the nested dialog is located by `[data-slot="dialog-content"]` + text rather
 * than by role queries. Covered here:
 *   - the nested confirm/prompt mounts on top of the still-mounted Settings
 *     panel (stack mode) and disappears on close, leaving Settings as the only
 *     dialog again;
 *   - Escape, backdrop and cancel each settle the nested dialog exactly once
 *     without running the destructive submit;
 *   - the danger confirm carries the error-tinted button style;
 *   - the Storage prompt validates (empty/relative paths rejected with the
 *     input retained) before any request can run;
 *   - focus returns to the triggering Settings button after the nested dialog
 *     closes.
 *
 * The destructive submit paths themselves (removing a provider key) hit the
 * real test backend and are asserted with the SDK; the Storage move is not
 * submitted because it genuinely relocates the sandboxed data directory.
 */
import { test, expect } from "./fixtures"
import type { Locator, Page } from "@playwright/test"
import type { createSdk } from "./utils"

type Sdk = ReturnType<typeof createSdk>

// Kobalte mounts every dialog's kit content under this slot. It is stable
// regardless of the aria-hidden the nested modal applies to the panel below.
const dialogContent = (page: Page) => page.locator('[data-slot="dialog-content"]')

async function seedOpenAIKey(sdk: Sdk) {
  await sdk.auth.remove({ providerID: "openai" }).catch(() => undefined)
  await sdk.auth.set({ providerID: "openai", auth: { type: "api", key: "sk-e2e-sensitive" } })
  await sdk.global.dispose().catch(() => undefined)
}

async function openCredentials(page: Page) {
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Credentials", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Credentials" })).toBeVisible()
  return dialog
}

async function openRemoveConfirm(page: Page, dialog: Locator) {
  await expect(dialog.getByText("OpenAI", { exact: true }).last()).toBeVisible()
  const row = dialog.getByText("OpenAI", { exact: true }).last().locator("xpath=../..")
  await row.getByRole("button", { name: "remove", exact: true }).click()
  const confirm = dialogContent(page).filter({ hasText: "Remove the OpenAI key" })
  await expect(confirm).toBeVisible()
  await expect(dialogContent(page)).toHaveCount(2)
  return confirm
}

// The Settings panel stays mounted underneath the nested dialog; its content is
// aria-hidden to the role tree, so assert it through the content slot + text.
const settingsPanel = (page: Page, text: string) =>
  dialogContent(page).filter({ hasText: text })

test("credentials remove nests a danger confirm over settings and deletes on confirm", async ({
  page,
  gotoSession,
  sdk,
}) => {
  await seedOpenAIKey(sdk)
  try {
    await gotoSession()
    const dialog = await openCredentials(page)
    const confirm = await openRemoveConfirm(page, dialog)

    // The nested dialog is a real open Kobalte modal on top of the still-
    // mounted Settings panel (stack mode), with a danger-styled confirm button.
    await expect(confirm).toHaveAttribute("data-expanded", "")
    await expect(settingsPanel(page, "Connect external services")).toBeVisible()
    const confirmButton = confirm.locator("button").filter({ hasText: "remove" })
    await expect(confirmButton).toBeVisible()
    await expect(confirmButton).toHaveAttribute("style", /color-error/)

    await confirmButton.click()

    // Single delete, single settle: only the nested dialog closes and the key
    // is really gone from the backend.
    await expect(confirm).toHaveCount(0)
    await expect(dialogContent(page)).toHaveCount(1)
    await expect
      .poll(async () => {
        const response = await sdk.provider.list()
        return response.data?.connected.includes("openai")
      })
      .toBe(false)
    await expect(settingsPanel(page, "Connect external services")).toBeVisible()
  } finally {
    await sdk.auth.remove({ providerID: "openai" }).catch(() => undefined)
    await sdk.global.dispose().catch(() => undefined)
  }
})

test("credentials remove Escape, cancel and backdrop settle once without deleting", async ({
  page,
  gotoSession,
  sdk,
}) => {
  await seedOpenAIKey(sdk)
  try {
    await gotoSession()
    const dialog = await openCredentials(page)

    // Escape closes only the nested confirm — the key survives and Settings stays.
    const viaEscape = await openRemoveConfirm(page, dialog)
    await page.keyboard.press("Escape")
    await expect(viaEscape).toHaveCount(0)
    await expect(dialogContent(page)).toHaveCount(1)
    await expect(settingsPanel(page, "Connect external services")).toBeVisible()

    // Cancel path: same settle, still no deletion.
    const viaCancel = await openRemoveConfirm(page, dialog)
    await viaCancel.locator("button").filter({ hasText: "cancel" }).click()
    await expect(viaCancel).toHaveCount(0)
    await expect(dialogContent(page)).toHaveCount(1)

    // Backdrop click on the topmost overlay closes only the nested dialog.
    const viaBackdrop = await openRemoveConfirm(page, dialog)
    await page
      .locator('[data-component="dialog-overlay"]')
      .last()
      .click({ position: { x: 8, y: 8 } })
    await expect(viaBackdrop).toHaveCount(0)
    await expect(dialogContent(page)).toHaveCount(1)
    await expect(settingsPanel(page, "Connect external services")).toBeVisible()

    await expect
      .poll(async () => {
        const response = await sdk.provider.list()
        return response.data?.connected.includes("openai")
      })
      .toBe(true)
  } finally {
    await sdk.auth.remove({ providerID: "openai" }).catch(() => undefined)
    await sdk.global.dispose().catch(() => undefined)
  }
})

test("storage change location prompt validates paths and cancels without moving", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Storage", exact: true }).click()
  await expect(dialog.getByRole("heading", { name: "Storage", exact: true })).toBeVisible()

  await dialog.getByRole("button", { name: "change location", exact: true }).click()

  const prompt = dialogContent(page).filter({ hasText: "Change data location" })
  await expect(prompt).toBeVisible()
  await expect(dialogContent(page)).toHaveCount(2)

  const input = prompt.getByPlaceholder("/absolute/path/to/data")
  await expect(input).toBeVisible()

  // A relative path is rejected before any request can run; the input stays.
  await input.fill("data/foo")
  await prompt.locator("button").filter({ hasText: "move" }).click()
  await expect(prompt.getByText("Enter an absolute path (leading / or a Windows drive letter).")).toBeVisible()
  await expect(input).toHaveValue("data/foo")
  await expect(dialogContent(page)).toHaveCount(2)

  // An empty value is rejected too, with its own message.
  await input.fill("")
  await prompt.locator("button").filter({ hasText: "move" }).click()
  await expect(prompt.getByText("Enter a path for the data directory.")).toBeVisible()
  await expect(dialogContent(page)).toHaveCount(2)

  // Cancel closes only the prompt; Settings stays and focus returns to the
  // change-location button the user acted on.
  await prompt.locator("button").filter({ hasText: "cancel" }).click()
  await expect(prompt).toHaveCount(0)
  await expect(dialogContent(page)).toHaveCount(1)
  await expect(settingsPanel(page, "Where MedHorizon keeps data on disk")).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("change location")
})
