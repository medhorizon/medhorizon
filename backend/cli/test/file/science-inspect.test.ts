import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { ScienceFile } from "../../src/file/science"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const GIB = 1024 * 1024 * 1024

const hdf5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
const encoder = new TextEncoder()

/** Create a true sparse file of `size` bytes with optional leading content.
 * POSIX truncate creates a hole; on Windows the file must be flagged sparse
 * BEFORE extending or the extension physically allocates (ENOSPC on a full
 * disk), and any later `Bun.write` to the whole file would destroy the flag. */
async function makeSparse(dir: string, name: string, size: number, head = "x") {
  const p = path.join(dir, name)
  await Bun.write(p, head)
  if (process.platform === "win32") {
    await $`fsutil sparse setflag ${p}`.quiet().nothrow()
    await $`fsutil file seteof ${p} ${size}`.quiet().nothrow()
  } else {
    await fs.truncate(p, size)
  }
  const stat = await fs.stat(p)
  if (stat.size !== size) throw new Error(`sparse fixture failed: ${stat.size} != ${size}`)
}

async function writeHDF5(dir: string, name: string, ext: string) {
  // HDF5 header + some NUL padding so it reads as binary, in a `.h5`/`.h5ad`
  // file. The detection contract only ever reports the `hdf5` family.
  const bytes = new Uint8Array(512)
  bytes.set(hdf5, 0)
  await Bun.write(path.join(dir, name), bytes)
}

/** Narrow the Inspect union to the text variant (typecheck helper). */
type TextInspect = Extract<ScienceFile.Inspect, { mode: "text" }>
function textOf(result: ScienceFile.Inspect): TextInspect {
  if (result.mode !== "text") throw new Error("expected text inspect")
  return result
}

/** Narrow the Preview union to the text variant (typecheck helper). */
type TextPreview = Extract<ScienceFile.Preview, { mode: "text" }>
function textPreviewOf(result: ScienceFile.Preview): TextPreview {
  if (result.mode !== "text") throw new Error("expected text preview")
  return result
}

describe("ScienceFile.inspect — bounded I/O", () => {
  test("small text csv returns detection plus a fixed-cap preview", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "data.csv"), "a,b,c\n1,2,3\n4,5,6\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScienceFile.inspect({ path: "data.csv" })
        const text = textOf(result)
        expect(ScienceFile.Inspect.safeParse(result).success).toBe(true)
        expect(result.format).toBe("csv")
        expect(result.family).toBe("table")
        expect(result.mode).toBe("text")
        expect(result.readPolicy).toBe("editable-full")
        expect(text.preview).toBe("a,b,c\n1,2,3\n4,5,6\n")
        expect(text.contentBytes).toBe(18)
        expect(text.totalBytes).toBe(18)
        expect(text.truncated).toBe(false)
        expect(text.lines).toBe(3)
      },
    })
  })

  test("empty file inspects as unknown text with an empty preview", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "empty.csv"), "")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScienceFile.inspect({ path: "empty.csv" })
        const text = textOf(result)
        expect(result.format).toBe("unknown")
        expect(result.mode).toBe("text")
        expect(text.preview).toBe("")
        expect(text.totalBytes).toBe(0)
        expect(text.contentBytes).toBe(0)
        expect(text.truncated).toBe(false)
        expect(text.lines).toBe(0)
        expect(result.warnings).toContain("empty file")
      },
    })
  })

  test("1 GiB sparse/seek fixture — inspect never full-reads and stays within budget", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        // Head content, then a 1 GiB sparse hole. A tail marker written after
        // the sparse extension proves the preview is built only from the head.
        await makeSparse(dir, "big.fasta", GIB, ">seq\nACGT\n")
        const handle = await fs.open(path.join(dir, "big.fasta"), "r+")
        await handle.write("TAILMARKER", GIB - "TAILMARKER".length, "utf8")
        await handle.close()
        await makeSparse(dir, "big.bin", GIB)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const stat = await fs.stat(path.join(tmp.path, "big.fasta"))
        expect(stat.size).toBe(GIB)

        // Text: preview is bounded to the inspect head window; truncated=true;
        // the tail marker never leaks into the preview (a full read would).
        const text = textOf(await ScienceFile.inspect({ path: "big.fasta" }))
        expect(text.totalBytes).toBe(GIB)
        expect(text.mode).toBe("text")
        expect(text.readPolicy).toBe("bounded-preview")
        expect(text.truncated).toBe(true)
        expect(text.contentBytes).toBeLessThanOrEqual(ScienceFile.Budget.INSPECT_HEADER_BYTES)
        expect(text.preview).toBeDefined()
        expect(text.preview!.startsWith(">seq\nACGT\n")).toBe(true)
        expect(text.preview!.includes("TAILMARKER")).toBe(false)

        // Binary: metadata-only, no preview fields at all.
        const bin = await ScienceFile.inspect({ path: "big.bin" })
        expect(bin.size).toBe(GIB)
        expect(bin.mode).toBe("binary")
        expect(bin.readPolicy).toBe("metadata-only")
        expect("preview" in bin).toBe(false)
      },
    })
  })

  test("binary hdf5 is metadata-only and never guessed as h5ad/loom", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeHDF5(dir, "cells.h5ad", "h5ad")
        await writeHDF5(dir, "raw.h5", "h5")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const h5ad = await ScienceFile.inspect({ path: "cells.h5ad" })
        expect(h5ad.mode).toBe("binary")
        expect(h5ad.format).toBe("hdf5")
        expect(h5ad.family).toBe("binary")
        expect(h5ad.evidence).toBe("magic")
        expect(h5ad.warnings.join(" ")).toContain("overrides extension .h5ad")
        expect("preview" in h5ad).toBe(false)

        const h5 = await ScienceFile.inspect({ path: "raw.h5" })
        expect(h5.format).toBe("hdf5")
        expect(h5.readPolicy).toBe("metadata-only")
      },
    })
  })

  test(".gz and .bgz double extensions resolve by decompressing the inspected window", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "reads.fastq.gz"), Bun.gzipSync(encoder.encode("@r1\nACGT\n+\nIIII\n")))
        await Bun.write(path.join(dir, "variants.vcf.bgz"), Bun.gzipSync(encoder.encode("##fileformat=VCFv4.2\n#CHROM\tPOS\n")))
        await Bun.write(path.join(dir, "matrix.tsv.gz"), Bun.gzipSync(encoder.encode("a\tb\n1\t2\n")))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const fastq = textOf(await ScienceFile.inspect({ path: "reads.fastq.gz" }))
        expect(fastq.format).toBe("fastq")
        expect(fastq.family).toBe("sequence")
        expect(fastq.mode).toBe("text")
        expect(fastq.name).toBe("reads.fastq.gz")
        expect(fastq.preview).toContain("@r1")
        expect(fastq.warnings.join(" ")).toContain("gzip-compressed")

        const vcf = textOf(await ScienceFile.inspect({ path: "variants.vcf.bgz" }))
        expect(vcf.format).toBe("vcf")
        expect(vcf.family).toBe("genome")
        expect(vcf.mode).toBe("text")
        expect(vcf.preview).toContain("fileformat=VCFv4.2")

        const tsv = textOf(await ScienceFile.inspect({ path: "matrix.tsv.gz" }))
        expect(tsv.format).toBe("tsv")
        expect(tsv.preview).toContain("a\tb")
      },
    })
  })

  test("a corrupt .gz degrades to inner-extension detection instead of failing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "broken.fastq.gz"), encoder.encode("this is not gzip"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScienceFile.inspect({ path: "broken.fastq.gz" })
        expect(result.format).toBe("fastq")
        expect(result.mode).toBe("text")
        expect(result.warnings.join(" ")).toContain("gzip-compressed")
      },
    })
  })
})

describe("ScienceFile.preview — bounded caps", () => {
  test("preview line cap fixes lines at PREVIEW_LINES and marks truncated", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const lines = Array.from({ length: ScienceFile.Budget.PREVIEW_LINES + 100 }, (_, i) => `line${i}`)
        await Bun.write(path.join(dir, "many.csv"), lines.join("\n"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScienceFile.preview({ path: "many.csv" })
        const text = textPreviewOf(result)
        expect(ScienceFile.Preview.safeParse(result).success).toBe(true)
        expect(text.mode).toBe("text")
        expect(text.format).toBe("csv")
        expect(text.lines).toBe(ScienceFile.Budget.PREVIEW_LINES)
        expect(text.truncated).toBe(true)
        expect(text.contentBytes).toBeLessThanOrEqual(ScienceFile.Budget.PREVIEW_BYTES)
        expect(text.preview).toContain("line0")
        expect(text.preview).not.toContain(`line${ScienceFile.Budget.PREVIEW_LINES}`)
      },
    })
  })

  test("preview byte cap fixes contentBytes at PREVIEW_BYTES and marks truncated", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const chunk = "x".repeat(256) + "\n"
        const content = chunk.repeat(4000) // ~1 MB of text
        await Bun.write(path.join(dir, "big.txt"), content)
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const text = textPreviewOf(await ScienceFile.preview({ path: "big.txt" }))
        expect(text.mode).toBe("text")
        expect(text.truncated).toBe(true)
        expect(text.contentBytes).toBe(ScienceFile.Budget.PREVIEW_BYTES)
        expect(text.totalBytes).toBeGreaterThan(text.contentBytes)
      },
    })
  })

  test("binary preview returns metadata-only with no content", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeHDF5(dir, "data.h5", "h5")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ScienceFile.preview({ path: "data.h5" })
        expect(result.mode).toBe("binary")
        expect("preview" in result).toBe(false)
      },
    })
  })

  test("preview of a .gz decompresses the bounded window", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "reads.fastq.gz"), Bun.gzipSync(encoder.encode("@r1\nACGT\n+\nIIII\n")))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const text = textPreviewOf(await ScienceFile.preview({ path: "reads.fastq.gz" }))
        expect(text.mode).toBe("text")
        expect(text.format).toBe("fastq")
        expect(text.preview).toContain("@r1")
      },
    })
  })
})

describe("ScienceFile deadline", () => {
  test("inspect enforces the frozen parse deadline (test seam)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "x.csv"), "a,b,c\n1,2,3\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let elapsed = 0
        await expect(
          ScienceFile.inspect({
            path: "x.csv",
            options: { deadlineMs: 10, now: () => (elapsed += 1000) },
          }),
        ).rejects.toThrow(ScienceFile.DeadlineExceeded)
      },
    })
  })

  test("preview enforces the frozen parse deadline (test seam)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "x.csv"), "a,b,c\n1,2,3\n")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let elapsed = 0
        await expect(
          ScienceFile.preview({
            path: "x.csv",
            options: { deadlineMs: 0, now: () => (elapsed += 1000) },
          }),
        ).rejects.toThrow(ScienceFile.DeadlineExceeded)
      },
    })
  })
})
