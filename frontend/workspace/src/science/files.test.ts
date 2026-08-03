/**
 * Mapper tests for `./files`: the exhaustive capability × readPolicy → UI mode
 * grid and the inspect-content helpers. Pure — no DOM, no network.
 */
import { describe, expect, test } from "bun:test"
import type { ScienceFileCapability, ScienceFileInspect, ScienceFileReadPolicy } from "@synsci/sdk/v2/client"
import {
  PROJECT_UI_GRID,
  clipText,
  formatBytes,
  hasPreviewContent,
  mapInspectToUi,
  previewOf,
} from "./files"

const CAPABILITIES: ScienceFileCapability[] = [
  "table",
  "sequence",
  "genome",
  "structure",
  "document",
  "pdf",
  "binary",
  "text",
  "unknown",
]

const READ_POLICIES: ScienceFileReadPolicy[] = [
  "editable-full",
  "bounded-preview",
  "metadata-only",
  "streamed-media",
]

const MODES = ["render", "text", "metadata", "stream"] as const

type TextOverrides = {
  capability?: ScienceFileCapability
  readPolicy?: ScienceFileReadPolicy
  format?: ScienceFileInspect["format"]
  family?: ScienceFileInspect["family"]
  size?: number
  preview?: string
  truncated?: boolean
}

function textInspect(over: TextOverrides = {}): ScienceFileInspect {
  return {
    name: "sample.fa",
    size: 12,
    family: "sequence",
    format: "fasta",
    capability: "sequence",
    readPolicy: "editable-full",
    evidence: "extension",
    magic: false,
    warnings: [],
    mode: "text",
    preview: ">a\nACGT",
    contentBytes: 8,
    totalBytes: 12,
    truncated: false,
    lines: 2,
    ...over,
  } as ScienceFileInspect
}

type BinaryOverrides = {
  capability?: ScienceFileCapability
  readPolicy?: ScienceFileReadPolicy
  format?: ScienceFileInspect["format"]
  family?: ScienceFileInspect["family"]
}

function binaryInspect(over: BinaryOverrides = {}): ScienceFileInspect {
  return {
    name: "sample.bin",
    size: 1024,
    family: "binary",
    format: "hdf5",
    capability: "binary",
    readPolicy: "metadata-only",
    evidence: "magic",
    magic: true,
    warnings: [],
    mode: "binary",
    ...over,
  } as ScienceFileInspect
}

describe("PROJECT_UI_GRID is exhaustive over capability × readPolicy", () => {
  test("every cell is defined and one of the four UI modes", () => {
    for (const capability of CAPABILITIES) {
      for (const readPolicy of READ_POLICIES) {
        const mode = PROJECT_UI_GRID[capability][readPolicy]
        expect(MODES).toContain(mode)
      }
    }
  })

  test("content-bearing sequence/structure files render", () => {
    for (const readPolicy of ["editable-full", "bounded-preview"] as const) {
      expect(PROJECT_UI_GRID.sequence[readPolicy]).toBe("render")
      expect(PROJECT_UI_GRID.structure[readPolicy]).toBe("render")
    }
  })

  test("genome files never render (GenomeTrack excluded in v1)", () => {
    for (const readPolicy of ["editable-full", "bounded-preview"] as const) {
      expect(PROJECT_UI_GRID.genome[readPolicy]).toBe("text")
    }
  })

  test("table/document/text/unknown stay in the text view when content-bearing", () => {
    for (const readPolicy of ["editable-full", "bounded-preview"] as const) {
      for (const capability of ["table", "document", "text", "unknown"] as const) {
        expect(PROJECT_UI_GRID[capability][readPolicy]).toBe("text")
      }
    }
  })

  test("metadata-only always lands in the metadata card", () => {
    for (const capability of CAPABILITIES) {
      expect(PROJECT_UI_GRID[capability]["metadata-only"]).toBe("metadata")
    }
  })

  test("pdf streams; binary is never shown as text", () => {
    expect(PROJECT_UI_GRID.pdf["streamed-media"]).toBe("stream")
    expect(PROJECT_UI_GRID.pdf["editable-full"]).toBe("stream")
    for (const readPolicy of READ_POLICIES) {
      expect(PROJECT_UI_GRID.binary[readPolicy]).toBe("metadata")
    }
  })
})

describe("mapInspectToUi", () => {
  test("maps a sequence editable-full file to render", () => {
    expect(mapInspectToUi(textInspect()).mode).toBe("render")
  })

  test("maps a genome bounded-preview file to text", () => {
    expect(
      mapInspectToUi(textInspect({ capability: "genome", format: "vcf", readPolicy: "bounded-preview", family: "genome" }))
        .mode,
    ).toBe("text")
  })

  test("maps a pdf streamed-media file to stream", () => {
    expect(mapInspectToUi(binaryInspect({ capability: "pdf", format: "pdf", readPolicy: "streamed-media", family: "document" })).mode).toBe("stream")
  })

  test("maps an hdf5 metadata-only file to metadata", () => {
    expect(mapInspectToUi(binaryInspect()).mode).toBe("metadata")
  })
})

describe("inspect content helpers", () => {
  test("hasPreviewContent is true only for text inspects with non-empty preview", () => {
    expect(hasPreviewContent(textInspect())).toBe(true)
    expect(hasPreviewContent(textInspect({ preview: "   " }))).toBe(false)
    expect(hasPreviewContent(binaryInspect())).toBe(false)
  })

  test("previewOf returns the bounded preview for text, empty string for binary", () => {
    expect(previewOf(textInspect({ preview: ">a\nACGT" }))).toBe(">a\nACGT")
    expect(previewOf(binaryInspect())).toBe("")
  })

  test("clipText caps a long string and passes through a short one", () => {
    expect(clipText("x".repeat(100), 10)).toBe("x".repeat(10))
    expect(clipText("short", 10)).toBe("short")
  })

  test("formatBytes renders compact units", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB")
  })
})
