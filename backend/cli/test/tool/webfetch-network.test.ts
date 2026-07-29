import { afterEach, expect, test } from "bun:test"
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

afterEach(async () => {
  await Network.set({ allowlistEnabled: false, enabled: ["package-management"], custom: [] })
})

test("webfetch blocks disallowed hosts before permission prompts", async () => {
  await Network.set({ allowlistEnabled: true, enabled: [], custom: ["allowed.test"] })
  const webfetch = await WebFetchTool.init()

  await expect(webfetch.execute({ url: "https://blocked.test", format: "markdown" }, ctx)).rejects.toThrow("allow-list")
})
