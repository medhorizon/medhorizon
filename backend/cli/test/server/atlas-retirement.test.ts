import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../../src/global"
import { AccountRoutes } from "../../src/server/routes/account"
import { BillingSettingsRoutes } from "../../src/server/routes/settings/billing"
import { WalletSettingsRoutes } from "../../src/server/routes/settings/wallet"
import { AtlasDisabled } from "../../src/openscience"
import { Server } from "../../src/server/server"

const sessionFile = path.join(Global.Path.data, "medhorizon-session.json")
const configFile = path.join(Global.Path.config, "openscience.json")
const realFetch = globalThis.fetch

describe("Atlas HTTP retirement contracts", () => {
  const prev = process.env.OPENSCIENCE_ENABLE_ATLAS

  beforeEach(async () => {
    await fs.rm(sessionFile, { force: true })
    await fs.rm(configFile, { force: true }).catch(() => {})
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    await fs.rm(sessionFile, { force: true })
    await fs.rm(configFile, { force: true }).catch(() => {})
    if (prev === undefined) delete process.env.OPENSCIENCE_ENABLE_ATLAS
    else process.env.OPENSCIENCE_ENABLE_ATLAS = prev
  })

  test("default-off: /account/session is disabled without sync or upstream fetch", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    const hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hits.push(String(input))
      return realFetch(input, init)
    }) as typeof fetch

    await Bun.write(sessionFile, JSON.stringify({ api_key: "thk_test.fake", user_id: "u1" }))
    const res = await AccountRoutes().request("/session")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: false })
    expect(hits).toEqual([])
  })

  test("default-off: billing/wallet stay local-only and coerce managed", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    await fs.mkdir(Global.Path.config, { recursive: true })
    await Bun.write(configFile, JSON.stringify({ billing: { llm: "managed", compute: "managed" } }, null, 2))

    const hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hits.push(String(input))
      return realFetch(input, init)
    }) as typeof fetch

    const billing = await BillingSettingsRoutes().request("/")
    expect(billing.status).toBe(200)
    expect(await billing.json()).toEqual({
      llm: "byok",
      compute: "byok",
      wallet: { signedIn: false, balanceUsd: -1 },
    })

    const put = await BillingSettingsRoutes().request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ llm: "managed", compute: "managed" }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({ llm: "byok", compute: "byok" })

    const wallet = await WalletSettingsRoutes().request("/")
    expect(wallet.status).toBe(200)
    expect(await wallet.json()).toMatchObject({ signedIn: false, balanceUsd: -1 })
    expect(hits).toEqual([])
  })

  test("default-off: /api/atlas returns ATLAS_DISABLED without upstream", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    const hits: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hits.push(String(input))
      return realFetch(input, init)
    }) as typeof fetch

    const fetch = Server.internalFetch()
    const res = await fetch("http://openscience.local/api/atlas/graphs")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe(AtlasDisabled.code)
    expect(hits).toEqual([])
  })
})
