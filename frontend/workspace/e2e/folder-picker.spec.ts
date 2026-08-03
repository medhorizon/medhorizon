/**
 * FolderPicker coverage (Plan 07, Task 3). Opens the in-app Finder-style
 * picker from the session command palette and exercises real local directories
 * under the isolated sandbox home (OPENSCIENCE_TEST_HOME) — no page.route.
 * The picker starts at the sandbox home, so fixtures create real directories
 * inside that home and click their rows to navigate.
 */
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { type Locator, type Page } from "@playwright/test"
import { test, expect } from "./fixtures"
import { modKey } from "./utils"

const home = process.env.OPENSCIENCE_TEST_HOME
if (!home) throw new Error("OPENSCIENCE_TEST_HOME must be set (run through e2e-local.ts)")

async function openPicker(page: Page): Promise<Locator> {
  await page.keyboard.press(`${modKey}+K`)
  const palette = page.getByRole("dialog", { name: "command palette" })
  await expect(palette).toBeVisible()
  await palette.getByRole("button", { name: /Open folder/ }).click()
  const picker = page.locator('[data-component="dialog-lite"]')
  await expect(picker).toBeVisible()
  return picker
}

const row = (picker: Locator, name: string) => picker.locator('[role="button"]', { hasText: name })

test("folder picker lists a real directory and drills into it", async ({ page, gotoSession }) => {
  const name = `picker-real-${Date.now()}`
  const dir = path.join(home, name)
  mkdirSync(path.join(dir, "sub"), { recursive: true })
  try {
    await gotoSession()
    const picker = await openPicker(page)

    await expect(row(picker, name)).toBeVisible()
    await row(picker, name).click()
    await expect(row(picker, "sub")).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a successful empty directory shows no folders here", async ({ page, gotoSession }) => {
  const name = `picker-empty-${Date.now()}`
  const dir = path.join(home, name)
  mkdirSync(dir, { recursive: true })
  try {
    await gotoSession()
    const picker = await openPicker(page)

    await row(picker, name).click()
    await expect(picker.getByText("no folders here", { exact: true })).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a zero-match filter is a second layer, not the empty state", async ({ page, gotoSession }) => {
  const name = `picker-nomatch-${Date.now()}`
  const dir = path.join(home, name)
  mkdirSync(path.join(dir, "sub"), { recursive: true })
  try {
    await gotoSession()
    const picker = await openPicker(page)

    await row(picker, name).click()
    const filter = picker.getByPlaceholder("filter folders…")
    await filter.fill(`__no_match__${Date.now()}`)
    await expect(picker.getByText("no matching folders", { exact: true })).toBeVisible()
    await expect(picker.getByText("no folders here", { exact: true })).toHaveCount(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a refresh error keeps the previous directory and retry recovers", async ({ page, gotoSession }) => {
  const name = `picker-retry-${Date.now()}`
  const dir = path.join(home, name)
  mkdirSync(path.join(dir, "sub"), { recursive: true })
  try {
    await gotoSession()
    const picker = await openPicker(page)

    await row(picker, name).click()
    await expect(row(picker, "sub")).toBeVisible()

    // Delete the current directory, then refresh: the listing fails as a real
    // resource error, but the previous directory's rows stay visible (stale).
    rmSync(dir, { recursive: true, force: true })
    await picker.getByTitle("refresh").click()

    await expect(picker.getByText("couldn't list folders", { exact: true })).toBeVisible()
    await expect(row(picker, "sub")).toBeVisible()

    // Recreate the directory and retry: the error clears and rows return.
    mkdirSync(path.join(dir, "sub"), { recursive: true })
    await picker.getByRole("button", { name: "retry", exact: true }).click()
    await expect(picker.getByText("couldn't list folders", { exact: true })).toHaveCount(0)
    await expect(row(picker, "sub")).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
