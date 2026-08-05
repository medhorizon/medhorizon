import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test, expect } from "./fixtures"

test("file browser can descend folders and open a file", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.getByRole("tab", { name: "Files", exact: true }).click()

  const item = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first()
  for (const folder of ["frontend", "workspace"]) {
    await expect(item(folder)).toBeVisible()
    await item(folder).click()
  }

  const file = item("package\\.json")
  await expect(file).toBeVisible()
  await file.click()

  await expect(page.locator('[role="tab"][title="package.json"]')).toHaveAttribute("aria-selected", "true")
})

test("a zero-result filter shows no matching files", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.getByRole("tab", { name: "Files", exact: true }).click()

  await page.getByPlaceholder("filter this folder…").fill("__no_such_file__")
  await expect(page.getByText("no matching files")).toBeVisible()
})

test("a successful empty directory shows no files here", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-file-empty-"))
  try {
    await gotoSession()
    await page.getByRole("tab", { name: "Files", exact: true }).click()

    const location = page.getByPlaceholder("/absolute/path")
    await location.fill(directory)
    await location.press("Enter")

    await expect(page.getByText("no files here")).toBeVisible()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a missing path surfaces a real error with retry", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.getByRole("tab", { name: "Files", exact: true }).click()

  const missing = path.join(tmpdir(), `openscience-missing-${Date.now()}`)
  const location = page.getByPlaceholder("/absolute/path")
  await location.fill(missing)
  await location.press("Enter")

  await expect(page.getByText("can't read this folder")).toBeVisible()
  await expect(page.getByText(/path not found/)).toBeVisible()
  await expect(page.getByRole("button", { name: "retry", exact: true })).toBeVisible()
})

test("a failed navigation does not retain files from the previous folder", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-file-stale-"))
  const file = path.join(directory, "stale.txt")
  try {
    await Bun.write(file, "stale")
    await gotoSession()
    await page.getByRole("tab", { name: "Files", exact: true }).click()

    const location = page.getByPlaceholder("/absolute/path")
    await location.fill(directory)
    await location.press("Enter")
    await expect(page.getByRole("button", { name: /^stale\.txt\b/ })).toBeVisible()

    await location.fill(path.join(directory, "missing"))
    await location.press("Enter")
    await expect(page.getByText("can't read this folder")).toBeVisible()
    await expect(page.getByRole("button", { name: /^stale\.txt\b/ })).toHaveCount(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("retry recovers once the directory exists", async ({ page, gotoSession }) => {
  const parent = mkdtempSync(path.join(tmpdir(), "openscience-retry-"))
  const target = path.join(parent, "recover")
  try {
    await gotoSession()
    await page.getByRole("tab", { name: "Files", exact: true }).click()

    const location = page.getByPlaceholder("/absolute/path")
    await location.fill(target)
    await location.press("Enter")
    await expect(page.getByText("can't read this folder")).toBeVisible()

    mkdirSync(target)
    await page.getByRole("button", { name: "retry", exact: true }).click()

    await expect(page.getByText("no files here")).toBeVisible()
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
