import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../../src/global"
import { AccountRoutes } from "../../src/server/routes/account"

const sessionFile = path.join(Global.Path.data, "medhorizon-session.json")

describe("account.session", () => {
  const prev = process.env.OPENSCIENCE_ENABLE_ATLAS

  beforeEach(async () => {
    await fs.rm(sessionFile, { force: true })
  })

  afterEach(async () => {
    await fs.rm(sessionFile, { force: true })
    if (prev === undefined) delete process.env.OPENSCIENCE_ENABLE_ATLAS
    else process.env.OPENSCIENCE_ENABLE_ATLAS = prev
  })

  test("reports signed out from local state", async () => {
    process.env.OPENSCIENCE_ENABLE_ATLAS = "1"
    const response = await AccountRoutes().request("/session")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: false })
  })

  test("reports signed in from local state without an Atlas round trip when Atlas is enabled", async () => {
    process.env.OPENSCIENCE_ENABLE_ATLAS = "1"
    await Bun.write(sessionFile, JSON.stringify({ api_key: "thk_test.fake", user_id: "test-user" }))

    const response = await AccountRoutes().request("/session")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: true })
  })

  test("default-off reports session false even when a local key file exists", async () => {
    delete process.env.OPENSCIENCE_ENABLE_ATLAS
    await Bun.write(sessionFile, JSON.stringify({ api_key: "thk_test.fake", user_id: "test-user" }))

    const response = await AccountRoutes().request("/session")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ session: false })
  })
})

