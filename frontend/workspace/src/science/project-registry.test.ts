/**
 * Registry tests for `./project-registry`: renderer selection from the
 * generated inspect result + bounded project content. No DOM, no network.
 * Locks the v1 exclusions (GenomeTrack, Chem2D, FASTQ) and the empty-input
 * guarantee (never a selection that would show sample content).
 */
import { describe, expect, test } from "bun:test"
import type { ScienceFileInspect } from "@synsci/sdk/v2/client"
import { MsaViewer } from "./renderers/genomics/MsaViewer"
import { ProteinStructure } from "./renderers/molecular/ProteinStructure"
import { SequenceViewer } from "./renderers/documents/SequenceViewer"
import { parseFastaRecords, selectProjectRenderer } from "./project-registry"
import { ProjectBudget } from "./files"

type Overrides = {
  capability?: ScienceFileInspect["capability"]
  readPolicy?: ScienceFileInspect["readPolicy"]
  format?: ScienceFileInspect["format"]
  family?: ScienceFileInspect["family"]
  mode?: "text" | "binary"
}

function inspectOf(over: Overrides = {}): ScienceFileInspect {
  return {
    name: "sample",
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

const FASTA_SINGLE = ">sp|P69905|HBA_HUMAN\nMVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF\nDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR"

const FASTA_MULTI = [
  ">human",
  "MKTAYIAKQR-QISFVKSHFSRQLEERLGLIEVQ",
  ">mouse",
  "MKTAYIAKQR-QISFVKSHFSRQLEDRLGLIEVQ",
  ">chick",
  "MKTAYIAKER-QISFVKSHFSKQLEERLGLIEVQ",
].join("\n")

describe("parseFastaRecords", () => {
  test("parses headers, wrapped sequence lines and ids", () => {
    const records = parseFastaRecords(">seq one\nACGT\nTGCA\n>seq two\nGGGG\n")
    expect(records).toEqual([
      { id: "seq", seq: "ACGT" + "TGCA" },
      { id: "seq", seq: "GGGG" },
    ])
  })

  test("treats a header-less file as a bare single record", () => {
    expect(parseFastaRecords("ACGTACGT\n")).toEqual([{ id: undefined, seq: "ACGTACGT" }])
  })

  test("returns no records for empty or whitespace content", () => {
    expect(parseFastaRecords("")).toEqual([])
    expect(parseFastaRecords("   \n  ")).toEqual([])
  })

  test("a header with no sequence yields one empty record", () => {
    expect(parseFastaRecords(">empty\n")).toEqual([{ id: "empty", seq: "" }])
  })
})

describe("selectProjectRenderer — sequence family", () => {
  test("single-record FASTA selects the linear SequenceViewer", () => {
    const sel = selectProjectRenderer(inspectOf(), FASTA_SINGLE)
    expect(sel).toBeDefined()
    expect(sel!.kind).toBe("sequence")
    expect(sel!.component).toBe(SequenceViewer)
    expect((sel!.payload as { fasta: string }).fasta).toContain(">sp|P69905|HBA_HUMAN")
    expect(sel!.clipped).toBe(false)
  })

  test("multi-record FASTA within budget selects the MSA renderer", () => {
    const sel = selectProjectRenderer(inspectOf(), FASTA_MULTI)
    expect(sel).toBeDefined()
    expect(sel!.kind).toBe("msa")
    expect(sel!.component).toBe(MsaViewer)
    const rows = (sel!.payload as { sequences: { id: string; seq: string }[] }).sequences
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ id: "human", seq: "MKTAYIAKQR-QISFVKSHFSRQLEERLGLIEVQ" })
  })

  test("a huge single record is clipped to the DOM-safe residue budget", () => {
    const long = `>big\n${"ACGT".repeat(5000)}`
    const sel = selectProjectRenderer(inspectOf(), long)
    expect(sel).toBeDefined()
    expect(sel!.kind).toBe("sequence")
    expect(sel!.clipped).toBe(true)
    const seq = (sel!.payload as { fasta: string }).fasta.replace(/^>\w+\n/, "")
    expect(seq.length).toBe(ProjectBudget.SEQUENCE_MAX_RESIDUES)
  })

  test("over-budget multi-record FASTA falls back to the linear first record", () => {
    const many = Array.from({ length: ProjectBudget.MSA_MAX_ROWS + 1 }, (_, i) => `>s${i}\nACGT`).join("\n")
    const sel = selectProjectRenderer(inspectOf(), many)
    expect(sel).toBeDefined()
    expect(sel!.kind).toBe("sequence")
  })

  test("empty and header-only content never select a renderer", () => {
    expect(selectProjectRenderer(inspectOf(), "")).toBeUndefined()
    expect(selectProjectRenderer(inspectOf(), "   \n ")).toBeUndefined()
    expect(selectProjectRenderer(inspectOf(), ">header\n")).toBeUndefined()
    expect(selectProjectRenderer(inspectOf(), ">header")).toBeUndefined()
  })

  test("FASTQ has no v1 renderer and falls back to text", () => {
    expect(selectProjectRenderer(inspectOf({ format: "fastq" }), "@read\nACGT\n+\n!!!!")).toBeUndefined()
  })
})

describe("selectProjectRenderer — genome family (GenomeTrack excluded)", () => {
  test.each(["bed", "gff", "gtf", "vcf"] as const)("%s never selects a renderer", (format) => {
    const sel = selectProjectRenderer(
      inspectOf({ capability: "genome", format, family: "genome" }),
      "chr1\t100\t200\tfeat\n",
    )
    expect(sel).toBeUndefined()
  })
})

describe("selectProjectRenderer — structure family", () => {
  test("PDB selects the Mol* renderer with an inline pdb payload", () => {
    const sel = selectProjectRenderer(inspectOf({ capability: "structure", format: "pdb", family: "structure" }), "ATOM      1  N\nEND")
    expect(sel).toBeDefined()
    expect(sel!.component).toBe(ProteinStructure)
    expect(sel!.kind).toBe("protein-structure")
    expect((sel!.payload as { pdb: string }).pdb).toBe("ATOM      1  N\nEND")
  })

  test("mmCIF selects protein-structure; xyz/mol/sdf select chem-3d", () => {
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "mmcif" }), "data_x\nloop_")!.kind).toBe("protein-structure")
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "xyz" }), "3\ncomment\nC 0 0 0\n")!.kind).toBe("chem-3d")
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "mol" }), "methane\n  OpenScience\n")!.kind).toBe("chem-3d")
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "sdf" }), "methane\n  OpenScience\n")!.kind).toBe("chem-3d")
  })

  test("empty structure content never selects a renderer", () => {
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "pdb" }), "   ")).toBeUndefined()
    expect(selectProjectRenderer(inspectOf({ capability: "structure", format: "pdb" }), "")).toBeUndefined()
  })

  test("oversized structure text is clipped and flagged", () => {
    const huge = "ATOM      1  N  ALA A   1\n".repeat(40_000)
    const sel = selectProjectRenderer(inspectOf({ capability: "structure", format: "pdb" }), huge)
    expect(sel).toBeDefined()
    expect(sel!.clipped).toBe(true)
    expect((sel!.payload as { pdb: string }).pdb.length).toBe(ProjectBudget.STRUCTURE_MAX_CHARS)
  })
})

describe("selectProjectRenderer — non-render capabilities and binary", () => {
  test("table/document/text/unknown capabilities fall back to text", () => {
    for (const capability of ["table", "document", "text", "unknown"] as const) {
      expect(selectProjectRenderer(inspectOf({ capability }), "abc")).toBeUndefined()
    }
  })

  test("binary inspects never select a renderer", () => {
    expect(selectProjectRenderer(inspectOf({ mode: "binary", capability: "binary", format: "hdf5" }), "")).toBeUndefined()
  })
})
