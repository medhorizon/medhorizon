import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test, expect } from "./fixtures"

// Navigate the Files explorer to `directory` and open `filename` as a
// center-pane document tab (the reachable FileView surface).
async function openFileFromTempDir(
  page: import("@playwright/test").Page,
  gotoSession: (sessionID?: string) => Promise<void>,
  directory: string,
  filename: string,
) {
  await gotoSession()
  await page.getByRole("tab", { name: "Files", exact: true }).click()
  await page.getByPlaceholder("/absolute/path").fill(directory)
  await page.getByPlaceholder("/absolute/path").press("Enter")
  await page.getByPlaceholder("filter this folder…").fill(filename)
  await page.getByRole("button", { name: new RegExp(`^${filename}\\b`) }).click()
  const tab = page.locator(`[role="tab"][title="${filename}"]`)
  await expect(tab).toHaveAttribute("aria-selected", "true")
}

test("smoke file viewer renders real file content", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.getByRole("tab", { name: "Files", exact: true }).click()
  await page.getByPlaceholder("filter this folder…").fill("package.json")

  const fileItem = page.getByRole("button", { name: /^package\.json\b/ }).first()
  await expect(fileItem).toBeVisible()
  await fileItem.click()

  const tab = page.locator('[role="tab"][title="package.json"]')
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute("aria-selected", "true")

  await expect(page.getByText("@synsci/monorepo")).toBeVisible()
})

test("an empty text file shows empty file and still enters the edit/source flow", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-empty-"))
  const filename = "empty.txt"
  const filepath = path.join(directory, filename)
  writeFileSync(filepath, "")
  try {
    await openFileFromTempDir(page, gotoSession, directory, filename)

    // A successful read of zero-length content maps to the empty state, not an
    // error, and the header's edit toggle still works from there.
    await expect(page.getByText("empty file", { exact: true })).toBeVisible()
    await page.getByTitle("edit source", { exact: true }).click()

    const editor = page.locator("textarea:visible").last()
    await expect(editor).toHaveValue("")
    await editor.fill("now it has content\n")
    await page.getByRole("button", { name: "save", exact: true }).click()
    await expect.poll(() => readFileSync(filepath, "utf8")).toBe("now it has content\n")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a binary file shows the unsupported capability state, not an error", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-binary-"))
  const filename = "blob.gz"
  const filepath = path.join(directory, filename)
  writeFileSync(filepath, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]))
  try {
    await openFileFromTempDir(page, gotoSession, directory, filename)

    // binary/unsupported is a capability state after a successful read — the
    // download affordance is available and it is never surfaced as an error.
    await expect(page.getByText(/Binary file — no inline preview/)).toBeVisible()
    await expect(page.getByText("couldn't open this file", { exact: true })).toHaveCount(0)
    await expect(page.getByTitle("download", { exact: true })).toBeVisible()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a file deleted on disk re-reads as empty content after a refresh", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-gone-"))
  const filename = "gone.txt"
  const filepath = path.join(directory, filename)
  writeFileSync(filepath, "will disappear\n")
  try {
    await openFileFromTempDir(page, gotoSession, directory, filename)
    await expect(page.getByText("will disappear")).toBeVisible()

    rmSync(filepath)
    await page.locator('[title="refresh"]:visible').click()

    // The backend's File.read is lenient for a missing file (returns empty
    // content), so the FileView maps the re-read to the successful-empty state.
    await expect(page.getByText("empty file", { exact: true })).toBeVisible()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
