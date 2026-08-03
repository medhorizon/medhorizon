/**
 * DOM tests for `./ProjectScienceView`: the thin project wrapper validates and
 * CLIPS bounded input before mounting a renderer, and invalid/empty input must
 * never mount the sample-bearing Sequence/MSA/GenomeTrack renderers.
 *
 * Mirrors the Plan 07 frontend/ui render approach: bun classic-transpiles .tsx
 * to React.createElement, so a test-local bridge maps that onto the deep Solid
 * client primitives (solid-js/web/dist/web.js). Under bun's node condition
 * solid-js resolves to its non-reactive build, so these tests exercise the
 * synchronous render tree only — which is exactly where the validate/clip
 * guard lives.
 */
import { afterEach, describe, expect, test } from "bun:test"
import type { JSX } from "solid-js"
import type * as SolidWeb from "solid-js/web/types/client.d.ts"
// @ts-expect-error — no .d.ts for the deep client build
import * as client from "solid-js/web/dist/web.js"
import type { ScienceFileInspect } from "@synsci/sdk/v2/client"
import { ProjectBudget } from "./files"
import { ProjectScienceView, type ProjectScienceViewProps } from "./ProjectScienceView"

const { render, insert, createComponent } = client as typeof SolidWeb

const React = {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    const p: Record<string, unknown> = { ...(props ?? {}) }
    if (children.length === 1) p.children = children[0]
    else if (children.length > 1) p.children = children
    if (typeof type === "function") return createComponent(type as (props: Record<string, unknown>) => JSX.Element, p)
    const el = document.createElement(type as string)
    for (const [k, v] of Object.entries(p)) {
      if (k === "children") continue
      if (k === "style" && v && typeof v === "object") Object.assign((el as HTMLElement).style, v)
      else if (v != null) el.setAttribute(k, String(v))
    }
    if ("children" in p) insert<unknown>(el, p.children as never)
    return el
  },
}

;(globalThis as { React?: unknown }).React = React

type Overrides = {
  capability?: ScienceFileInspect["capability"]
  readPolicy?: ScienceFileInspect["readPolicy"]
  format?: ScienceFileInspect["format"]
  family?: ScienceFileInspect["family"]
  mode?: "text" | "binary"
  preview?: string
  truncated?: boolean
  warnings?: string[]
}

function textInspect(over: Overrides = {}): ScienceFileInspect {
  return {
    name: "sample.fa",
    size: 64,
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
    totalBytes: 64,
    truncated: false,
    lines: 2,
    ...over,
  } as ScienceFileInspect
}

function binaryInspect(over: Overrides = {}): ScienceFileInspect {
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

function mount(props: ProjectScienceViewProps) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const dispose = render(() => createComponent(ProjectScienceView, props), host)
  return { host, dispose }
}

const FASTA_SINGLE =
  ">sp|P69905|HBA_HUMAN\nMVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF\nDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR"

const FASTA_MULTI = [
  ">human",
  "MKTAYIAKQR-QISFVKSHFSRQLEERLGLIEVQ",
  ">mouse",
  "MKTAYIAKQR-QISFVKSHFSRQLEDRLGLIEVQ",
  ">chick",
  "MKTAYIAKER-QISFVKSHFSKQLEERLGLIEVQ",
].join("\n")

afterEach(() => {
  document.body.innerHTML = ""
})

describe("ProjectScienceView render path", () => {
  test("valid FASTA mounts the linear sequence renderer without sample content", () => {
    const { host } = mount({ inspect: textInspect(), content: FASTA_SINGLE })
    expect(host.querySelector('[data-component="science-sequence"]')).toBeTruthy()
    expect(host.querySelector('[data-slot="sequence-sample-badge"]')).toBeFalsy()
    expect(host.querySelector('[data-component="project-science-view"]')?.getAttribute("data-mode")).toBe("render")
  })

  test("multi-record FASTA mounts the MSA renderer without sample content", () => {
    const { host } = mount({ inspect: textInspect(), content: FASTA_MULTI })
    expect(host.querySelector('[data-component="science-msa"]')).toBeTruthy()
    expect(host.querySelector('[data-slot="msa-sample-badge"]')).toBeFalsy()
  })

  test("empty/invalid content falls back to text and never mounts a sample renderer", () => {
    for (const content of ["", "   ", ">header\n"]) {
      const { host } = mount({ inspect: textInspect(), content })
      expect(host.querySelector('[data-slot="project-science-text"]')).toBeTruthy()
      expect(host.querySelector('[data-component="science-sequence"]')).toBeFalsy()
      expect(host.querySelector('[data-component="science-msa"]')).toBeFalsy()
      expect(host.querySelector('[data-slot="sequence-sample-badge"]')).toBeFalsy()
      expect(host.querySelector('[data-slot="msa-sample-badge"]')).toBeFalsy()
      host.remove()
    }
  })

  test("FASTQ falls back to the text view (no faithful renderer)", () => {
    const { host } = mount({
      inspect: textInspect({ format: "fastq" }),
      content: "@read\nACGT\n+\n!!!!",
    })
    expect(host.querySelector('[data-slot="project-science-text"]')).toBeTruthy()
    expect(host.querySelector('[data-component="science-sequence"]')).toBeFalsy()
  })

  test("genome files never mount GenomeTrack or sample genome", () => {
    const { host } = mount({
      inspect: textInspect({ capability: "genome", format: "vcf", family: "genome" }),
      content: "##fileformat=VCFv4.2\n#CHROM\tPOS\nchr1\t100\n",
    })
    expect(host.querySelector('[data-slot="project-science-text"]')).toBeTruthy()
    expect(host.querySelector('[data-component="science-genome-track"]')).toBeFalsy()
    expect(host.querySelector('[data-slot="genome-track-sample-badge"]')).toBeFalsy()
  })
})

describe("ProjectScienceView fallback views", () => {
  test("metadata-only binary shows the metadata card", () => {
    const { host } = mount({ inspect: binaryInspect() })
    expect(host.querySelector('[data-slot="project-science-metadata"]')).toBeTruthy()
    expect(host.querySelector('[data-slot="project-science-text"]')).toBeFalsy()
    expect(host.querySelector('[data-slot="project-science-meta"]')?.textContent).toContain("hdf5")
  })

  test("streamed pdf shows the stream view and a same-origin open link", () => {
    const { host } = mount({
      inspect: binaryInspect({
        capability: "pdf",
        format: "pdf",
        readPolicy: "streamed-media",
        family: "document",
      }),
      downloadUrl: "/file/raw?path=paper.pdf",
    })
    expect(host.querySelector('[data-slot="project-science-stream"]')).toBeTruthy()
    expect(host.querySelector('[data-slot="project-science-open"]')?.getAttribute("href")).toBe("/file/raw?path=paper.pdf")
  })

  test("warnings from the inspect result are surfaced", () => {
    const { host } = mount({
      inspect: textInspect({ capability: "genome", format: "vcf", family: "genome", warnings: ["v1 does not wire GenomeTrack"] }),
      content: "chr1\t1\t2\n",
    })
    expect(host.querySelector('[data-slot="project-science-warnings"]')?.textContent).toContain("GenomeTrack")
  })
})

describe("ProjectScienceView clipping", () => {
  test("a huge FASTA is clipped to the DOM-safe residue budget before mounting", () => {
    const long = `>big\n${"ACGT".repeat(5000)}`
    const { host } = mount({ inspect: textInspect(), content: long })
    const renderer = host.querySelector('[data-component="science-sequence"]')
    expect(renderer).toBeTruthy()
    const residues = host.querySelectorAll('[data-slot="sequence-residues"] span')
    expect(residues.length).toBeLessThanOrEqual(ProjectBudget.SEQUENCE_MAX_RESIDUES)
    expect(host.querySelector('[data-slot="project-science-truncated"]')).toBeTruthy()
  })

  test("a server-truncated preview surfaces the truncation note", () => {
    const { host } = mount({
      inspect: textInspect({ truncated: true }),
      content: FASTA_SINGLE,
    })
    expect(host.querySelector('[data-slot="project-science-truncated"]')).toBeTruthy()
  })
})
