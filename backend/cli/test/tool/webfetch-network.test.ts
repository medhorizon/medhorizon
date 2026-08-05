import { afterEach, expect, test } from "bun:test"
import http from "node:http"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import type { PermissionNext } from "../../src/permission/next"
import { Network } from "../../src/settings/network"
import { WebFetchTool } from "../../src/tool/webfetch"

const ctx = {
  sessionID: "session_test",
  messageID: "message_test",
  agent: "research",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => {},
  ask: async () => {
    throw new Error("permission should not be requested for blocked network hosts")
  },
}

const askCtx = {
  ...ctx,
  ask: async () => {},
}

afterEach(async () => {
  await Network.set({ allowlistEnabled: false, enabled: ["package-management"], custom: [] })
})

test("webfetch blocks disallowed hosts before permission prompts", async () => {
  await Network.set({ allowlistEnabled: true, enabled: [], custom: ["allowed.test"] })
  const webfetch = await WebFetchTool.init()

  await expect(webfetch.execute({ url: "https://blocked.test", format: "markdown" }, ctx)).rejects.toThrow("allow-list")
})

test("webfetch rejects loopback DNS targets before opening a real local server", async () => {
  let hits = 0
  const server = http.createServer((_request, response) => {
    hits += 1
    response.end("should not be reached")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("local test server did not expose a port")

  try {
    await Instance.provide({
      directory: path.join(import.meta.dir, "../.."),
      fn: async () => {
        const webfetch = await WebFetchTool.init()
        await expect(
          webfetch.execute({ url: `http://127.0.0.1:${address.port}/private`, format: "text" }, askCtx),
        ).rejects.toThrow(/private|loopback|reserved/i)
      },
    })
    expect(hits).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test("network resolution rejects localhost even when the allow-list is advisory", async () => {
  await Network.set({ allowlistEnabled: false, enabled: [], custom: [] })

  await expect(Network.resolve("http://localhost/", AbortSignal.any([]))).rejects.toThrow(
    /private|loopback|reserved/i,
  )
})

test("webfetch permission metadata redacts credential-like query values", async () => {
  const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
  const permissionCtx = {
    ...askCtx,
    ask: async (request: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
      requests.push(request)
    },
  }

  await Instance.provide({
    directory: path.join(import.meta.dir, "../.."),
    fn: async () => {
      const webfetch = await WebFetchTool.init()
      await webfetch
        .execute({ url: "http://127.0.0.1/?api_key=secret-value", format: "text" }, permissionCtx)
        .catch(() => {})
    },
  })

  expect(requests[0]?.metadata?.url).toContain("api_key=%5Bredacted%5D")
  expect(requests[0]?.metadata?.url).not.toContain("secret-value")
})
