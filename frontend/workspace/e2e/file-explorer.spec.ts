import { test, expect } from "./fixtures"

// Baseline proof that the Files surface (host FileExplorer) browses real host
// directories exclusively through host file endpoints. Listing hits /file (and
// /find/file), opening a file reads /file/content. The filter input is purely
// client-side — it narrows the already-loaded directory, so "search" adds no
// network request at all. The invariant: no request may ever match /api/atlas/*.
test("Files listing, search, and open use only host file endpoints", async ({ page, gotoSession }) => {
  const hostFileCalls: string[] = []
  const atlasHits: string[] = []
  page.on("request", (req) => {
    // Defensive: some lifecycle URLs are not parseable absolute URLs; never let
    // a capture handler throw and abort page script mid-navigation.
    let pathname: string
    try {
      pathname = new URL(req.url()).pathname
    } catch {
      return
    }
    if (pathname.startsWith("/file") || pathname.startsWith("/find/file")) {
      hostFileCalls.push(pathname)
    }
    if (pathname.includes("/api/atlas")) {
      atlasHits.push(pathname)
    }
  })

  await gotoSession()
  await page.getByRole("tab", { name: "Files", exact: true }).click()

  // Directory listing: descend into the repo tree.
  const item = (name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first()
  await expect(item("frontend")).toBeVisible()
  await item("frontend").click()
  await expect(item("workspace")).toBeVisible()
  await item("workspace").click()

  // Search: narrow the current directory to a single file.
  await page.getByPlaceholder("filter this folder…").fill("package.json")

  // Open: click the matched file row into a center document tab.
  const fileRow = page.getByRole("button", { name: /^package\.json\b/ }).first()
  await expect(fileRow).toBeVisible()
  await fileRow.click()
  await expect(page.locator('[role="tab"][title="package.json"]')).toHaveAttribute("aria-selected", "true")

  // Directory listing reached the backend through a host file endpoint.
  expect(hostFileCalls.length).toBeGreaterThan(0)
  // The whole interaction made zero Atlas API requests.
  expect(atlasHits).toEqual([])
})
