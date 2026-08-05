import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { ScienceFile } from "../../src/file/science"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function route(directory: string, pathname: string, extra: string) {
  return `http://openscience.internal${pathname}?directory=${encodeURIComponent(directory)}${extra}`
}

describe("file science HTTP routes", () => {
  test("inspect → preview → raw download round trip with Range", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "data.csv"), "a,b,c\n1,2,3\n4,5,6\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetch = Server.internalFetch()
        const csv = "&path=" + encodeURIComponent("data.csv")

        // inspect
        const inspect = await fetch(route(tmp.path, "/file/inspect", csv))
        expect(inspect.status).toBe(200)
        const detection = await inspect.json()
        expect(detection.format).toBe("csv")
        expect(detection.mode).toBe("text")
        expect(detection.preview).toContain("a,b,c")
        expect(ScienceFile.Inspect.safeParse(detection).success).toBe(true)

        // preview
        const preview = await fetch(route(tmp.path, "/file/preview", csv))
        expect(preview.status).toBe(200)
        const previewBody = await preview.json()
        expect(previewBody.mode).toBe("text")
        expect(previewBody.preview).toContain("1,2,3")
        expect(ScienceFile.Preview.safeParse(previewBody).success).toBe(true)

        // raw full download — a stream, not JSON/base64
        const raw = await fetch(route(tmp.path, "/file/raw", csv))
        expect(raw.status).toBe(200)
        expect(raw.headers.get("accept-ranges")).toBe("bytes")
        expect(await raw.text()).toBe("a,b,c\n1,2,3\n4,5,6\n")

        // raw Range — 206 partial content
        const ranged = await fetch(route(tmp.path, "/file/raw", csv), { headers: { range: "bytes=0-3" } })
        expect(ranged.status).toBe(206)
        expect(ranged.headers.get("content-range")).toBe("bytes 0-3/18")
        expect(await ranged.text()).toBe("a,b,")

        // suffix range
        const suffix = await fetch(route(tmp.path, "/file/raw", csv), { headers: { range: "bytes=-5" } })
        expect(suffix.status).toBe(206)
        expect(suffix.headers.get("content-range")).toBe("bytes 13-17/18")
        expect(await suffix.text()).toBe(",5,6\n")

        // unsatisfiable range → 416
        const bad = await fetch(route(tmp.path, "/file/raw", csv), { headers: { range: "bytes=999-" } })
        expect(bad.status).toBe(416)

        // existing read route still works
        const read = await fetch(route(tmp.path, "/file/content", csv))
        expect(read.status).toBe(200)
        expect((await read.json()).content).toBe("a,b,c\n1,2,3\n4,5,6\n")
      },
    })
  })

  test("rejects traversal, cross-project, cross-drive and directory targets with safe error bodies", async () => {
    await using other = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "top secret payload")
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "sub", "inner.txt"), "inner")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetch = Server.internalFetch()
        const cases = [
          `&path=${encodeURIComponent("../../secret.txt")}`, // `..` traversal
          `&path=${encodeURIComponent(path.join(other.path, "secret.txt"))}`, // cross-project absolute
          "&path=" + encodeURIComponent("sub"), // directory target
        ]
        if (process.platform === "win32") {
          cases.push("&path=" + encodeURIComponent("Z:\\windows\\win.ini")) // cross-drive
        }
        for (const extra of cases) {
          const res = await fetch(route(tmp.path, "/file/inspect", extra))
          expect([400, 403, 404]).toContain(res.status)
          const body = await res.text()
          // no absolute paths, no internal stack frames, no file content leaked
          expect(body).not.toContain(tmp.path)
          expect(body).not.toContain(other.path)
          expect(body).not.toContain("secret")
          expect(body).not.toContain("inner")
          expect(body).not.toContain(" at ")
          expect(body).not.toContain("\n")
        }
      },
    })
  })

  test("rejects a symlink that escapes the project (skips when symlinks unavailable)", async () => {
    let created = false
    await using outside = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "secret.txt"), "top secret payload")
      },
    })
    await using tmp = await tmpdir({
      init: async (dir) => {
        try {
          await fs.symlink(path.join(outside.path, "secret.txt"), path.join(dir, "link.txt"))
          created = true
        } catch {
          created = false
        }
      },
    })
    if (!created) return
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetch = Server.internalFetch()
        const res = await fetch(route(tmp.path, "/file/inspect", "&path=" + encodeURIComponent("link.txt")))
        expect(res.status).toBe(403)
        const body = await res.text()
        expect(body).not.toContain(tmp.path)
        expect(body).not.toContain("secret")
        expect(body).not.toContain("\n")
      },
    })
  })

  test("missing file inspect → 404 with a safe body", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetch = Server.internalFetch()
        const res = await fetch(route(tmp.path, "/file/inspect", "&path=" + encodeURIComponent("nope.txt")))
        expect(res.status).toBe(404)
        const body = await res.text()
        expect(body).not.toContain(tmp.path)
        expect(body).not.toContain("\n")
      },
    })
  })

  test("existing file.write route still works", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fetch = Server.internalFetch()
        const res = await fetch(route(tmp.path, "/file/content", ""), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "fresh.txt", content: "new content\n" }),
        })
        expect(res.status).toBe(200)
        expect((await res.json()).content).toContain("new content")
        expect(await Bun.file(path.join(tmp.path, "fresh.txt")).text()).toBe("new content\n")
      },
    })
  })

  test("OPENSCIENCE_ENABLE_ATLAS=1: science file routes never reach the Atlas bridge", async () => {
    const prev = process.env.OPENSCIENCE_ENABLE_ATLAS
    process.env.OPENSCIENCE_ENABLE_ATLAS = "1"
    try {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "data.csv"), "a,b,c\n1,2,3\n")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const hits: string[] = []
          const realFetch = globalThis.fetch
          globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            hits.push(String(input))
            return realFetch(input, init)
          }) as typeof fetch
          try {
            const fetch = Server.internalFetch()
            const csv = "&path=" + encodeURIComponent("data.csv")
            for (const endpoint of ["/file/inspect", "/file/preview", "/file/raw"]) {
              const res = await fetch(route(tmp.path, endpoint, csv))
              expect(res.status).toBe(200)
            }
            // Enabling the Atlas cloud flag must not cause project-file I/O to
            // touch the Atlas bridge (/api/atlas/*) or any outbound network.
            expect(hits).toEqual([])
          } finally {
            globalThis.fetch = realFetch
          }
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENSCIENCE_ENABLE_ATLAS
      else process.env.OPENSCIENCE_ENABLE_ATLAS = prev
    }
  })
})
