import path from "node:path"
import type { Page } from "@playwright/test"
import { test, expect } from "./fixtures"

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

async function openFile(page: Page, directory: string, relativePath: string) {
  await page.locator('[role="tab"][title="Files"]').click()

  const folder = path.join(directory, path.dirname(relativePath))
  const filename = path.basename(relativePath)
  const location = page.getByPlaceholder("/absolute/path")
  await location.fill(folder)
  await location.press("Enter")

  await page.getByPlaceholder("filter this folder…").fill(filename)
  const file = page.getByRole("button", { name: new RegExp(`^${escapeRegex(filename)}\\b`) }).first()
  await expect(file).toBeVisible()
  await file.click()
  await expect(page.locator(`[role="tab"][title="${filename}"]`)).toHaveAttribute("aria-selected", "true")
}

test("markdown files render and can toggle their raw source", async ({ page, directory, gotoSession }) => {
  await gotoSession()
  await openFile(page, directory, "README.md")

  await expect(page.locator("[data-component=markdown].atlas-md")).toBeVisible()
  await expect(page.getByText("支持可控节点与人机协作的 AI Agent 工作台", { exact: true })).toBeVisible()
  await page.getByTitle("raw source", { exact: true }).click()
  await expect(page.getByTitle("rendered view", { exact: true })).toBeVisible()
  await expect(
    page.getByText("### 支持可控节点与人机协作的 AI Agent 工作台", { exact: true }),
  ).toBeVisible()
})

test("image files render their decoded dimensions via a same-origin raw URL (never a data URL)", async ({
  page,
  directory,
  gotoSession,
}) => {
  await gotoSession()
  await openFile(page, directory, "frontend/ui/src/assets/images/social-share.png")

  const image = page.getByRole("img", { name: "social-share.png", exact: true })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([
    1280,
    721,
  ])

  // The image is streamed natively through the canonical same-origin raw/Range
  // URL — never a data:*;base64 transport.
  const src = await image.evaluate((node: HTMLImageElement) => node.src)
  expect(src.startsWith("data:")).toBe(false)
  expect(src).toContain("/file/raw")
})

test("PDF files rasterize their pages from a same-origin raw URL (never a data URL)", async ({
  page,
  directory,
  gotoSession,
}) => {
  const rawRequest = page.waitForRequest((req) => {
    const u = new URL(req.url())
    return u.pathname.endsWith("/file/raw") && u.searchParams.get("path") === "icml_numpapers.pdf"
  })
  await gotoSession()
  await openFile(page, directory, "backend/cli/skills/writing/ml-paper-writing/templates/icml2026/icml_numpapers.pdf")

  const viewer = page.locator('[data-component="science-pdf"]')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('[data-slot="pdf-header"]')).toContainText("1 page", { timeout: 30_000 })
  const canvas = viewer.locator('[data-slot="pdf-body"] canvas').first()
  await expect(canvas).toBeVisible()
  expect(await canvas.evaluate((node: HTMLCanvasElement) => node.width * node.height)).toBeGreaterThan(0)
  await expect(viewer.locator('[data-slot="pdf-error"]')).toHaveCount(0)

  // pdfjs consumed the same-origin raw/Range stream — a data URL is rejected.
  const pdfUrl = (await rawRequest).url()
  expect(pdfUrl.startsWith("data:")).toBe(false)
  expect(pdfUrl).toContain("/file/raw")
})
