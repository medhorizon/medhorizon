/**
 * Plan 06, Task 2 — the two Connectors Promise-dialog migrations.
 *
 * Real-browser coverage of `components/settings/Connectors.tsx` against the
 * isolated local backend:
 *   - remove(): window.confirm → confirmDialog. The dialog shows the connector
 *     name + irreversible impact (danger-styled confirm), stacks on top of the
 *     Settings dialog, cancels without deleting, and restores focus to the
 *     Remove trigger. Confirming deletes the connector for real (backend
 *     config.remove + the config-store mutation + refresh).
 *   - authenticate(): auth.start → window.open popup FIRST, then promptDialog.
 *     Empty code is blocked by validate, cancel never fires the callback, and
 *     focus returns to the Authenticate trigger. Submitting a code drives a
 *     real `mcp.auth.callback` round-trip (the /token exchange is attempted);
 *     the submit path then closes the dialog and refreshes.
 *
 * The popup path needs the backend to reach a real OAuth-capable MCP resource
 * server, so this spec stands up a minimal honest protocol partner on loopback
 * (RFC 9728 protected-resource metadata + RFC 8414 AS metadata + RFC 7591
 * dynamic registration). Nothing here intercepts or mocks the backend's MCP
 * traffic. The token endpoint deliberately rejects code exchange: a genuine
 * authorization-code success needs a real OAuth IdP, which the isolated harness
 * does not provide — that gap, plus the backend's 200-with-failed-status
 * callback behaviour, is documented in the completion report.
 */
import { test, expect } from "./fixtures"
import http from "node:http"
import type { Server } from "node:http"
import type { Locator, Page } from "@playwright/test"
import type { createSdk } from "./utils"

type Sdk = ReturnType<typeof createSdk>

let mcp: Server | undefined
let mcpPort = 0
let tokenHits = 0

// A minimal RFC 9728/8414/7591 OAuth-protected MCP resource server. The local
// backend connects to POST /mcp, gets a 401 with a Bearer WWW-Authenticate,
// discovers the AS metadata, dynamically registers a client, and builds an
// authorization URL. `/authorize` serves the popup page; `/token` is the real
// code-exchange endpoint that rejects with invalid_grant (no real IdP here).
function startMcpResourceServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${mcpPort}`)
      const origin = `http://127.0.0.1:${mcpPort}`

      if (req.method === "POST" && url.pathname === "/mcp") {
        res.writeHead(401, {
          "WWW-Authenticate": `Bearer realm="openscience-e2e", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        })
        res.end()
        return
      }
      if (url.pathname === "/.well-known/oauth-protected-resource") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }))
        return
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
          }),
        )
        return
      }
      if (req.method === "POST" && url.pathname === "/register") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            client_id: "e2e-mcp-client",
            redirect_uris: ["http://127.0.0.1:19876/mcp/oauth/callback"],
          }),
        )
        return
      }
      if (url.pathname === "/authorize") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end("<!doctype html><title>e2e authorize</title><p>e2e OAuth authorization endpoint</p>")
        return
      }
      if (req.method === "POST" && url.pathname === "/token") {
        tokenHits += 1
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "no real OAuth IdP in the isolated e2e harness",
          }),
        )
        return
      }
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("not found")
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to bind the e2e MCP resource server"))
        return
      }
      mcp = server
      mcpPort = address.port
      resolve(mcpPort)
    })
  })
}

async function openConnectors(page: Page) {
  await page.getByRole("button", { name: "settings", exact: true }).click()
  const settings = page.locator('[data-component="dialog"]').filter({ hasText: "Connectors" })
  await expect(settings).toBeVisible()
  return settings
}

// The visible name span inside a connector Row (the switch's sr-only label also
// carries the name, so first() pins the DOM-ordered span). Row is three levels
// above the span: span → name row → identity column → Row.
function connectorRow(settings: Locator, name: string) {
  return settings.getByText(name, { exact: true }).first().locator("xpath=../../..")
}

async function removeConnector(sdk: Sdk, ...names: string[]) {
  for (const name of names) await sdk.mcp.config.remove({ name, scope: "global" }).catch(() => undefined)
}

test.setTimeout(120_000)

test.beforeAll(async () => {
  mcpPort = await startMcpResourceServer()
})

async function openSession(page: Page, gotoSession: () => Promise<void>) {
  try {
    await gotoSession()
  } catch {
    // The isolated harness compiles the app on the first page load, so the
    // fixture's 10s prompt-input wait can expire on the very first test. The
    // retry re-navigates onto the warm Vite cache and is deterministic.
    await page.waitForTimeout(5_000)
    await gotoSession()
  }
}

test.beforeEach(() => {
  tokenHits = 0
})

test.afterAll(() => {
  mcp?.close()
  mcp = undefined
})

test("connector remove confirm cancels without deleting and restores focus", async ({ page, gotoSession, sdk }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const name = "e2e-remove-cancel"
  await sdk.mcp.config.set({
    name,
    config: { type: "remote", url: `http://127.0.0.1:${mcpPort}/mcp`, oauth: false },
    scope: "global",
  })
  try {
    await openSession(page, () => gotoSession())
    const settings = await openConnectors(page)
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()

    const row = connectorRow(settings, name)
    await row.getByRole("button", { name: "Remove", exact: true }).click()

    const confirm = page.locator('[data-component="dialog"]').filter({ hasText: `Remove connector "${name}"?` })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator('[data-slot="dialog-title"]')).toHaveText(`Remove connector "${name}"?`)
    await expect(confirm.locator('[data-slot="dialog-description"]')).toHaveText(
      "It will be disconnected and deleted from config.",
    )
    // danger semantics: error-tinted confirm button, not just a label.
    await expect(confirm.getByRole("button", { name: "remove", exact: true })).toHaveAttribute("style", /color-error/)
    // nested Settings stack: the parent dialog stays mounted underneath.
    await expect(settings).toHaveCount(1)
    await expect(settings).toBeVisible()

    // cancel keeps the connector and restores focus to the Remove trigger.
    await confirm.getByRole("button", { name: "cancel", exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Remove")
  } finally {
    await removeConnector(sdk, name)
  }

  expect(pageErrors).toEqual([])
})

test("connector remove confirm deletes the connector", async ({ page, gotoSession, sdk }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const name = "e2e-remove-confirm"
  await sdk.mcp.config.set({
    name,
    config: { type: "remote", url: `http://127.0.0.1:${mcpPort}/mcp`, oauth: false },
    scope: "global",
  })
  try {
    await openSession(page, () => gotoSession())
    const settings = await openConnectors(page)
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()

    await connectorRow(settings, name).getByRole("button", { name: "Remove", exact: true }).click()

    const confirm = page.locator('[data-component="dialog"]').filter({ hasText: `Remove connector "${name}"?` })
    await expect(confirm).toBeVisible()
    await confirm.getByRole("button", { name: "remove", exact: true }).click()

    await expect(confirm).toHaveCount(0)
    // the config-store mutation + refresh remove the row for real.
    await expect(settings.getByText(name, { exact: true }).first()).toHaveCount(0)
    await expect.poll(async () => (await sdk.mcp.status()).data?.[name]).toBeUndefined()
    await expect(page.locator('[data-component="toast"]')).toHaveCount(0)
  } finally {
    await removeConnector(sdk, name)
  }

  expect(pageErrors).toEqual([])
})

test("connector authenticate opens popup then dialog; empty code blocked; cancel fires no callback", async ({
  page,
  gotoSession,
  sdk,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const name = "e2e-oauth-cancel"
  await sdk.mcp.config.set({
    name,
    config: { type: "remote", url: `http://127.0.0.1:${mcpPort}/mcp`, oauth: {} },
    scope: "global",
  })
  try {
    await openSession(page, () => gotoSession())
    const settings = await openConnectors(page)
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()

    const row = connectorRow(settings, name)
    // CSS-scoped: the settings dialog is aria-hidden under the stacked prompt,
    // so getByRole would not resolve the button while the flow is in flight.
    const authTrigger = row.locator('[data-component="icon-button"][aria-label="Authenticate"]')
    const popupPromise = page.waitForEvent("popup")
    await authTrigger.click()
    const popup = await popupPromise
    await expect(popup.url()).toContain("/authorize")
    await popup.close()

    // auth.start resolved → popup opened FIRST, then the app dialog appears.
    const prompt = page.locator('[data-component="dialog"]').filter({ hasText: "Authorize connector" })
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('[data-slot="dialog-title"]')).toHaveText("Authorize connector")
    await expect(prompt.locator('[data-slot="dialog-description"]')).toHaveText(
      "Authorize in the opened tab, then paste the authorization code here.",
    )
    await expect(prompt.getByPlaceholder("authorization code")).toBeVisible()
    // nested Settings stack: parent dialog stays mounted; focus is trapped in the prompt.
    await expect(settings).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[data-component="dialog"]')))).toBe(
      true,
    )
    // the panel busy guard disables the trigger while the flow is in flight.
    await expect(authTrigger).toBeDisabled()

    // empty code cannot submit.
    await prompt.locator('[data-component="button"]').filter({ hasText: /^authorize$/ }).click()
    await expect(prompt.locator('[data-slot="input-error"]')).toHaveText("Authorization code is required")
    await expect(prompt).toBeVisible()
    expect(tokenHits).toBe(0)

    // typing clears the error and the code stays in the input.
    await prompt.getByPlaceholder("authorization code").fill("some-authorization-code")
    await expect(prompt.locator('[data-slot="input-error"]')).toHaveCount(0)
    await expect(prompt.getByPlaceholder("authorization code")).toHaveValue("some-authorization-code")

    // cancel closes without firing the callback; focus returns to the trigger.
    await prompt.locator('[data-component="button"]').filter({ hasText: /^cancel$/ }).click()
    await expect(prompt).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(tokenHits).toBe(0)
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Authenticate")
  } finally {
    await removeConnector(sdk, name)
  }

  expect(pageErrors).toEqual([])
})

test("connector authenticate submit drives a real callback and closes the dialog", async ({
  page,
  gotoSession,
  sdk,
}) => {
  const pageErrors: string[] = []
  page.on("pageerror", (error) => pageErrors.push(error.message))

  const name = "e2e-oauth-submit"
  await sdk.mcp.config.set({
    name,
    config: { type: "remote", url: `http://127.0.0.1:${mcpPort}/mcp`, oauth: {} },
    scope: "global",
  })
  try {
    await openSession(page, () => gotoSession())
    const settings = await openConnectors(page)

    const row = connectorRow(settings, name)
    const popupPromise = page.waitForEvent("popup")
    await row.getByRole("button", { name: "Authenticate", exact: true }).click()
    const popup = await popupPromise
    await popup.close()

    const prompt = page.locator('[data-component="dialog"]').filter({ hasText: "Authorize connector" })
    await expect(prompt).toBeVisible()
    await prompt.getByPlaceholder("authorization code").fill("a-real-shaped-code")
    await prompt.locator('[data-component="button"]').filter({ hasText: /^authorize$/ }).click()

    // The callback round-trips to the backend and the code exchange is really
    // attempted at the resource server's token endpoint (the isolated harness
    // has no IdP, so the exchange is rejected there — never mocked).
    await expect(prompt).toHaveCount(0)
    await expect.poll(() => tokenHits).toBeGreaterThanOrEqual(1)
    await expect(page.locator('[data-component="toast"]')).toHaveCount(0)
    // the row is untouched by a failed exchange and focus returns to the trigger.
    await expect(settings.getByText(name, { exact: true }).first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Authenticate")
  } finally {
    await removeConnector(sdk, name)
  }

  expect(pageErrors).toEqual([])
})
