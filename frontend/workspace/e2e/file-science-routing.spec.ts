import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures"

/**
 * Science project-file routing E2E (Plan 19 Task 4).
 *
 * Exercises the inspect-first load policy through the real Files → document-tab
 * flow: `file.inspect` decides the read policy, the FileView selects the
 * renderer / bounded preview / metadata / streamed-media path from the generated
 * contract, and the project renderer registry is never bypassed. Text/header
 * fixtures are generated at runtime into a temp project; only the minimal PDF
 * (binary, awkward to generate inline) lives in `e2e/fixtures/science/`.
 */

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

async function openFile(page: Page, filename: string) {
  // Re-show the Files tab (opening a doc hides it, but the explorer stays
  // mounted with its cwd intact) and open the file by filter.
  await page.locator('[role="tab"][title="Files"]').click()
  await page.getByPlaceholder("filter this folder…").fill(filename)
  const item = page.getByRole("button", { name: new RegExp(`^${escapeRegex(filename)}\\b`) }).first()
  await expect(item).toBeVisible()
  await item.click()
  await expect(page.locator(`[role="tab"][title="${filename}"]`)).toHaveAttribute("aria-selected", "true")
}

test("science fixtures route inspect -> policy -> renderer/fallback with zero /api/atlas requests", async ({
  page,
  gotoSession,
}) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-science-routing-"))
  const hdf5Magic = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
  writeFileSync(path.join(directory, "sample.fa"), ">sample\nACGTACGTACGTACGTACGT\n")
  writeFileSync(path.join(directory, "multi.fa"), ">one\nACGTACGTACGT\n>two\nACGTACGTACGT\n")
  writeFileSync(path.join(directory, "regions.vcf"), "##fileformat=VCFv4.2\n#CHROM\tPOS\nchr1\t100\n")
  writeFileSync(path.join(directory, "large.txt"), "first line\n" + "y".repeat(1024 * 1024))
  writeFileSync(path.join(directory, "blob.h5"), hdf5Magic)
  writeFileSync(path.join(directory, "notes.md"), "# Notes\n\nHello science\n")

  const atlas: string[] = []
  page.on("request", (req) => {
    if (req.url().includes("/api/atlas")) atlas.push(req.url())
  })

  try {
    await gotoSession()
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByPlaceholder("/absolute/path").fill(directory)
    await page.getByPlaceholder("/absolute/path").press("Enter")

    // small FASTA -> render mode via the project registry (sequence renderer)
    await openFile(page, "sample.fa")
    await expect(page.locator('[data-component="project-science-view"][data-mode="render"]')).toBeVisible()
    await expect(page.locator('[data-component="science-sequence"]')).toBeVisible()

    // multi-record FASTA -> MSA renderer
    await openFile(page, "multi.fa")
    await expect(page.locator('[data-component="science-msa"]')).toBeVisible()

    // VCF -> bounded text fallback, never GenomeTrack (no Range/index transport)
    await openFile(page, "regions.vcf")
    await expect(page.locator(".atlas-md").filter({ hasText: "##fileformat=VCFv4.2" })).toBeVisible()
    await expect(page.locator('[data-component="science-genome-track"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="genome-track-sample-badge"]')).toHaveCount(0)

    // over-budget text -> server-bounded preview only, truncated note, no full read
    await openFile(page, "large.txt")
    await expect(page.locator('[data-slot="project-science-truncated"]')).toBeVisible()
    await expect(page.locator('[data-slot="project-science-text-body"]')).toBeVisible()
    await expect(page.getByText("couldn't open this file", { exact: true })).toHaveCount(0)

    // HDF5-magic binary -> metadata/capability summary, never an error or a data URL
    await openFile(page, "blob.h5")
    await expect(page.getByText(/Binary file — no inline preview/)).toBeVisible()
    await expect(page.locator('[data-slot="project-science-meta"]')).toBeVisible()
    await expect(page.getByText("couldn't open this file", { exact: true })).toHaveCount(0)

    // markdown still renders through the editable-full path
    await openFile(page, "notes.md")
    await expect(page.locator("[data-component=markdown].atlas-md").filter({ visible: true })).toBeVisible()
    await expect(page.getByText("Hello science")).toBeVisible()

    expect(atlas).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("fast switching between science files never shows a stale renderer", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-science-fast-"))
  writeFileSync(path.join(directory, "sample.fa"), ">sample\nACGTACGTACGTACGTACGT\n")
  writeFileSync(path.join(directory, "regions.vcf"), "##fileformat=VCFv4.2\n#CHROM\tPOS\nchr1\t100\n")
  writeFileSync(path.join(directory, "blob.h5"), Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]))
  writeFileSync(path.join(directory, "large.txt"), "first line\n" + "y".repeat(1024 * 1024))

  try {
    await gotoSession()
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByPlaceholder("/absolute/path").fill(directory)
    await page.getByPlaceholder("/absolute/path").press("Enter")

    // open all four in rapid succession (each mounts its own FileView)
    const files = ["sample.fa", "regions.vcf", "blob.h5", "large.txt"]
    for (const file of files) await openFile(page, file)
    for (const file of files) await expect(page.locator(`[role="tab"][title="${file}"]`)).toBeVisible()

    // switch to each and verify it shows ITS OWN content, never a stale one
    await page.locator('[role="tab"][title="sample.fa"]').click()
    await expect(page.locator('[data-component="science-sequence"]')).toBeVisible()

    await page.locator('[role="tab"][title="regions.vcf"]').click()
    await expect(page.locator(".atlas-md").filter({ hasText: "##fileformat=VCFv4.2" })).toBeVisible()
    await expect(page.locator('[data-component="science-genome-track"]')).toHaveCount(0)

    await page.locator('[role="tab"][title="blob.h5"]').click()
    await expect(page.getByText(/Binary file — no inline preview/)).toBeVisible()

    await page.locator('[role="tab"][title="large.txt"]').click()
    await expect(page.locator('[data-slot="project-science-truncated"]')).toBeVisible()
    await expect(page.locator('[data-component="science-sequence"]')).toBeHidden()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a pdf project file streams through the canonical same-origin raw URL", async ({ page, gotoSession }) => {
  const directory = mkdtempSync(path.join(tmpdir(), "openscience-science-pdf-"))
  copyFileSync(new URL("./fixtures/science/sample.pdf", import.meta.url), path.join(directory, "sample.pdf"))
  try {
    await gotoSession()
    await page.locator('[role="tab"][title="Files"]').click()
    await page.getByPlaceholder("/absolute/path").fill(directory)
    await page.getByPlaceholder("/absolute/path").press("Enter")
    await openFile(page, "sample.pdf")

    // streamed-media policy: the native consumer (pdfjs) loads the raw/Range
    // URL — real visible output, no base64/data-URL content state.
    await expect(page.locator('[data-component="science-pdf"]')).toBeVisible()
    await expect(page.locator('[data-slot="pdf-header"]')).toContainText("1 page", { timeout: 30_000 })
    await expect(page.locator('[data-slot="pdf-error"]')).toHaveCount(0)
    const canvas = page.locator('[data-slot="pdf-body"] canvas').first()
    await expect(canvas).toBeVisible()
    expect(await canvas.evaluate((node: HTMLCanvasElement) => node.width * node.height)).toBeGreaterThan(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
