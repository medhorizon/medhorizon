/**
 * Real-browser characterization of the hardened Dialog context (Plan 06, Task 1).
 *
 * Renders the production DialogProvider + the rebuilt Promise helpers over the
 * real session page. Covered here:
 *   - Settings (a plain `dialog.show(<DialogSettings/>)` consumer) mounts the
 *     non-lite Kobalte modal without reshuffling body children / #root or
 *     resetting scroll, traps focus while open, dismisses on Escape and Close,
 *     leaves no residue, and restores focus to the trigger.
 *   - `/undo` (the only production consumer of `confirmDialog`) shows the
 *     danger confirm, settles exactly once on Escape and cancel without
 *     reverting, and on confirm performs a real backend revert (toast, message
 *     hidden) that `/redo` restores.
 *
 * Not reachable in production today, so NOT covered here (covered by the unit
 * suite instead — `dialog.test.tsx` replacement/stack/returnFocus + `dialogs.test.ts`
 * mode/onClose/show-false settle):
 *   - replace-of-an-existing-dialog: the only `dialog.show` call sites are
 *     Settings, the model picker and the Promise helpers; the helpers stack,
 *     and the model picker's paid path is a Kobalte popover whose manage button
 *     opens `DialogManageModels` with no dialog already on top. `DialogSelectModel`
 *     (with its replace-to-manage button) is exported but not wired.
 *   - nested-over-Settings stacking: no reachable flow shows a second dialog on
 *     top of Settings today; the helpers still mount `mode: "stack"`.
 *   - submit/busy/validate: no reachable consumer passes `submit`/`validate`
 *     yet (Tasks 2/3 add them), so the busy/disabled/error state machine is
 *     deferred to those batches; the coordinator settle paths are unit-tested.
 */
import { test, expect } from "./fixtures"
import { promptSelector } from "./utils"
import type { Page } from "@playwright/test"
import type { createSdk } from "./utils"

type BodySignature = {
  children: string[]
  rootIndex: number
  rootMarked: boolean
  scrollY: number
}

async function bodySignature(page: Page): Promise<BodySignature> {
  return page.evaluate(() => {
    const children = Array.from(document.body.children)
    return {
      children: children.map((el) => `${el.tagName.toLowerCase()}#${el.id || ""}`),
      // The first body child is <noscript>; track #root by position + identity
      // (the mark) so a Kobalte portal mount/teardown cannot silently replace
      // or displace the app element.
      rootIndex: children.findIndex((el) => el.id === "root"),
      rootMarked: document.getElementById("root")?.getAttribute("data-e2e-mark") === "1",
      scrollY: window.scrollY,
    }
  })
}

const activeInsideDialog = (page: Page) =>
  page.evaluate(() => Boolean(document.activeElement?.closest('[data-component="dialog"]')))

const seedMessage = (page: Page) => page.getByText("Seeded for UI e2e", { exact: true })

/**
 * Create a fresh session with one user message so /undo and /redo have a
 * real turn to act on. Each test seeds its own session (unique title) so
 * parallel runs and re-runs never collide on a shared "E2E Session" whose
 * revert state a previous run left behind.
 */
async function seedThread(sdk: ReturnType<typeof createSdk>, title: string): Promise<string> {
  const created = await sdk.session.create({ title }).then((r) => r.data)
  if (!created?.id) throw new Error("Session create did not return an id")
  const sessionID = created.id

  await sdk.session.promptAsync({
    sessionID,
    noReply: true,
    // noReply only persists a user message, but user-message metadata still
    // requires a model id. Pass the suite model explicitly so this setup does
    // not depend on a connected provider or on host-machine credentials.
    model: (() => {
      const [providerID = "e2e", modelID = "echo"] = (process.env.OPENSCIENCE_E2E_MODEL ?? "e2e/echo").split("/")
      return { providerID, modelID }
    })(),
    parts: [{ type: "text", text: "Seeded for UI e2e" }],
  })

  await expect
    .poll(async () => {
      const messages = await sdk.session.messages({ sessionID, limit: 1 }).then((r) => r.data ?? [])
      return messages.length
    })
    .toBeGreaterThan(0)

  return sessionID
}

const openUndo = async (page: Page) => {
  await page.locator(promptSelector).click()
  await page.keyboard.type("/undo")
  const command = page.locator('[data-slash-id="session.undo"]')
  await expect(command).toBeVisible()
  await command.click()
}

test("non-lite dialog mounts without reshuffling #root or leaving residue", async ({ page, gotoSession }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await gotoSession()
  await page.evaluate(() => document.getElementById("root")?.setAttribute("data-e2e-mark", "1"))
  await page.evaluate(() => window.scrollTo(0, 500))

  const before = await bodySignature(page)
  expect(before.rootIndex).toBeGreaterThanOrEqual(0)
  expect(before.rootMarked).toBe(true)

  await page.getByRole("button", { name: "settings", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  // Kobalte's modal Content does not set aria-modal; the open state is marked
  // with data-expanded. Modality is covered by the overlay + focus trap below.
  await expect(dialog).toHaveAttribute("data-expanded", "")
  await expect(page.locator('[data-component="dialog-overlay"]')).toBeVisible()

  // #root keeps its position and identity; scroll is untouched.
  const during = await bodySignature(page)
  expect(during.rootIndex).toBe(before.rootIndex)
  expect(during.rootMarked).toBe(true)
  expect(during.children.length).toBeGreaterThan(before.children.length)
  expect(during.scrollY).toBe(before.scrollY)

  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(300) // let the 100ms dispose timer + Kobalte cleanup run

  const after = await bodySignature(page)
  expect(after.children.length).toBe(before.children.length)
  expect(after.rootIndex).toBe(before.rootIndex)
  expect(after.rootMarked).toBe(true)
  expect(after.scrollY).toBe(before.scrollY)

  expect(pageErrors).toEqual([])
})

test("non-lite dialog traps focus, dismisses on Escape, and restores focus", async ({ page, gotoSession }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await gotoSession()
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  await expect.poll(() => activeInsideDialog(page)).toBe(true)
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab")
    await expect.poll(() => activeInsideDialog(page)).toBe(true)
  }
  await page.keyboard.press("Shift+Tab")
  await expect.poll(() => activeInsideDialog(page)).toBe(true)

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(300)

  // Kobalte's default onCloseAutoFocus returns focus to the settings trigger.
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("settings")

  expect(pageErrors).toEqual([])
})

test("/undo confirm settles on Escape and cancel without reverting", async ({ page, sdk, gotoSession }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const sessionID = await seedThread(sdk, `undo e2e settle ${Date.now()}`)
  await gotoSession(sessionID)
  const message = seedMessage(page)
  await expect(message).toBeVisible()

  // Escape path: settles with false, nothing reverts, no toast.
  await openUndo(page)
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute("data-expanded", "")
  await expect(dialog.locator('[data-slot="dialog-title"]')).toHaveText("Undo from here?")
  await expect(dialog.locator('[data-slot="dialog-description"]')).toContainText("Hides this message")
  const confirm = dialog.getByRole("button", { name: "undo", exact: true })
  await expect(confirm).toBeVisible()
  await expect(dialog.getByRole("button", { name: "cancel", exact: true })).toBeVisible()
  // danger semantics: the confirm button carries the error-tinted style, not just a label.
  await expect(confirm).toHaveAttribute("style", /color-error/)

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(message).toBeVisible()
  await expect(page.locator('[data-component="toast"]')).toHaveCount(0)

  // Cancel path: same outcome through the cancel button.
  await openUndo(page)
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "cancel", exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(message).toBeVisible()
  await expect(page.locator('[data-component="toast"]')).toHaveCount(0)

  expect(pageErrors).toEqual([])
})

test("/undo confirm reverts the session and /redo restores it", async ({ page, sdk, gotoSession }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const sessionID = await seedThread(sdk, `undo e2e revert ${Date.now()}`)
  await gotoSession(sessionID)
  const message = seedMessage(page)
  await expect(message).toBeVisible()

  await openUndo(page)
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "undo", exact: true }).click()

  await expect(dialog).toHaveCount(0)
  const toast = page.locator('[data-component="toast"]')
  const reverted = toast.filter({ hasText: "reverted" })
  await expect(reverted).toBeVisible()
  await expect(reverted.locator('[data-slot="toast-title"]')).toHaveText("reverted")
  await expect(message).toHaveCount(0)

  // /redo restores the hidden turn and fires its own toast.
  await page.locator(promptSelector).click()
  await page.keyboard.type("/redo")
  const redo = page.locator('[data-slash-id="session.redo"]')
  await expect(redo).toBeVisible()
  await redo.click()

  await expect(toast.filter({ hasText: "messages restored" })).toBeVisible()
  await expect(message).toBeVisible()

  expect(pageErrors).toEqual([])
})
