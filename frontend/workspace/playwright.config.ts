import { defineConfig, devices } from "@playwright/test"
import { resolvePlaywrightTarget } from "./script/e2e-mode"

const target = resolvePlaywrightTarget(process.env)
const baseURL = target.baseURL
const serverHost = process.env.VITE_OPENSCIENCE_SERVER_HOST ?? process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"
const serverPort = process.env.VITE_OPENSCIENCE_SERVER_PORT ?? process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const proxyTarget =
  process.env.VITE_OPENSCIENCE_PROXY_TARGET ??
  `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Basic-Auth creds for the in-process openscience server. e2e-local.ts pins both
// OPENSCIENCE_SERVER_* (server side) and VITE_OPENSCIENCE_SERVER_* (frontend side) to
// the same value so the Playwright-hosted frontend can authenticate.
const serverUsername = process.env.VITE_OPENSCIENCE_SERVER_USERNAME ?? "openscience"
const serverPassword = process.env.VITE_OPENSCIENCE_SERVER_PASSWORD ?? ""
const bun = process.env.BUN_EXEC_PATH ?? "bun"
const command = `${JSON.stringify(bun)} run dev -- --host 0.0.0.0 --port ${target.port}`

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  // The integration harness intentionally shares one backend, project
  // worktree, deterministic model, and PTY pool. Parallel browser contexts
  // mutate that shared state and can abort prompts or tear down another
  // test's terminal, so keep this suite serial and deterministic.
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  ...(target.startWebServer
    ? {
        webServer: {
          command,
          url: baseURL,
          // The isolated harness owns a freshly allocated port. Reusing any
          // listener would make it possible to test a different checkout.
          reuseExistingServer: target.reuseExistingServer,
          timeout: 120_000,
          env: {
            VITE_OPENSCIENCE_SERVER_HOST: serverHost,
            VITE_OPENSCIENCE_SERVER_PORT: serverPort,
            VITE_OPENSCIENCE_SERVER_USERNAME: serverUsername,
            VITE_OPENSCIENCE_SERVER_PASSWORD: serverPassword,
            VITE_OPENSCIENCE_PROXY_TARGET: proxyTarget,
          },
        },
      }
    : {}),
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Inject Basic-Auth on every browser request. The frontend's
    // openscience-fetch.ts wraps fetch() with the same header, but its
    // dev-mode gate + port-match check is fragile under windows-latest
    // env-var propagation. Setting the header at the Playwright layer
    // bypasses both gates and is independent of how Vite resolves env.
    extraHTTPHeaders: serverPassword
      ? { Authorization: `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` }
      : undefined,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: [/visual-shells\.spec\.ts/, /accessibility\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        // Prefer an installed Chrome when Playwright's bundled Chromium is
        // unavailable (common on fresh Windows hosts before `playwright install`).
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL as "chrome" | "msedge" | "chrome-beta" }
          : {}),
      },
    },
    {
      name: "visual-a11y",
      testMatch: [/visual-shells\.spec\.ts/, /accessibility\.spec\.ts/],
      fullyParallel: false,
      retries: 0,
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL as "chrome" | "msedge" | "chrome-beta" }
          : {}),
      },
    },
  ],
})
