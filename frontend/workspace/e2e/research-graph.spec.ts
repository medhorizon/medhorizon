import { test, expect } from "./fixtures"

test("bound gateway embeds resolve once without exposing sidecar credentials", async ({ page }) => {
  const requests: Array<{ url: string; authorization: string | undefined }> = []
  page.on("request", (request) => {
    if (request.url().includes("/research-graph")) {
      requests.push({ url: request.url(), authorization: request.headers().authorization })
    }
  })

  await page.goto("/research-graph/embed/graph/123?session=e2e-bound")
  await expect(page.locator('[data-e2e-graph="ready"]')).toHaveText("E2E Graph")
  await expect(page.locator("body")).toHaveAttribute("data-e2e-status", "bound")
  await expect(page.locator("body")).toHaveAttribute("data-e2e-chunk", "loaded")

  expect(requests.filter((request) => new URL(request.url).pathname === "/api/research-graph/resolve")).toHaveLength(1)
  expect(requests.some((request) => /\/api\/graphs(?:\/|$)|\/api\/stages(?:\/|$)/.test(new URL(request.url).pathname))).toBe(false)
  expect(requests.every((request) => !request.authorization?.startsWith("Bearer "))).toBe(true)
  expect(requests.some((request) => /127\.0\.0\.1:8000|local-dev/.test(request.url))).toBe(false)
})

test("unbound gateway embeds stay empty without graph-list or tree requests", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))

  await page.goto("/research-graph/embed/graph/123?session=unbound")
  await expect(page.locator("body")).toHaveAttribute("data-e2e-status", "not_bound")
  await expect(page.locator("main")).toHaveText("No graph bound")
  expect(requests.some((url) => /\/api\/graphs(?:\/|$)|\/api\/stages(?:\/|$)/.test(new URL(url).pathname))).toBe(false)
})

test("nested gateway refresh loads every prefixed asset and lazy chunk", async ({ page }) => {
  const failures: string[] = []
  page.on("requestfailed", (request) => {
    if (request.url().includes("/research-graph/")) failures.push(request.url())
  })

  const response = await page.goto("/research-graph/embed/graph/123?session=e2e-bound")
  expect(response?.ok()).toBe(true)
  await expect(page.locator('[data-e2e-graph="ready"]')).toHaveText("E2E Graph")
  await expect(page.locator("body")).toHaveAttribute("data-e2e-chunk", "loaded")
  expect(failures).toEqual([])
})
