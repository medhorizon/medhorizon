import { describe, expect, test } from "bun:test"
import { ScienceFile } from "../../src/file/science"

const text = (value: string) => new TextEncoder().encode(value)
const hdf5 = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])

type Case = {
  name: string
  head?: Uint8Array
  size: number
  family: ScienceFile.Family
  format: ScienceFile.Format
  mode: ScienceFile.Mode
  capability: ScienceFile.Capability
  readPolicy: ScienceFile.ReadPolicy
  evidence: ScienceFile.Evidence
  magic?: boolean
  warning?: string
}

const cases: Case[] = [
  // table
  { name: "data.csv", head: text("a,b,c\n1,2,3\n"), size: 12, family: "table", format: "csv", mode: "text", capability: "table", readPolicy: "editable-full", evidence: "extension" },
  { name: "matrix.tsv", head: text("a\tb\n1\t2\n"), size: 8, family: "table", format: "tsv", mode: "text", capability: "table", readPolicy: "editable-full", evidence: "extension" },
  // sequence
  { name: "genome.fasta", head: text(">seq1\nACGT\n"), size: 12, family: "sequence", format: "fasta", mode: "text", capability: "sequence", readPolicy: "editable-full", evidence: "extension" },
  { name: "reads.fastq", head: text("@r1\nACGT\n+\nIIII\n"), size: 16, family: "sequence", format: "fastq", mode: "text", capability: "sequence", readPolicy: "editable-full", evidence: "extension" },
  // genome
  { name: "peaks.bed", head: text("chr1\t10\t20\n"), size: 13, family: "genome", format: "bed", mode: "text", capability: "genome", readPolicy: "editable-full", evidence: "extension", warning: "GenomeTrack" },
  { name: "genes.gff3", head: text("chr1\tsrc\tgene\t1\t100\n"), size: 22, family: "genome", format: "gff", mode: "text", capability: "genome", readPolicy: "editable-full", evidence: "extension", warning: "GenomeTrack" },
  { name: "genes.gtf", head: text("chr1\tsrc\tgene\t1\t100\n"), size: 22, family: "genome", format: "gtf", mode: "text", capability: "genome", readPolicy: "editable-full", evidence: "extension", warning: "GenomeTrack" },
  { name: "vars.vcf", head: text("##fileformat=VCFv4.2\n"), size: 22, family: "genome", format: "vcf", mode: "text", capability: "genome", readPolicy: "editable-full", evidence: "extension", warning: "GenomeTrack" },
  // structure
  { name: "protein.pdb", head: text("HEADER    TEST\nATOM      1\n"), size: 20, family: "structure", format: "pdb", mode: "text", capability: "structure", readPolicy: "editable-full", evidence: "extension" },
  { name: "crystal.cif", head: text("data_crystal\n"), size: 14, family: "structure", format: "mmcif", mode: "text", capability: "structure", readPolicy: "editable-full", evidence: "extension" },
  { name: "frame.xyz", head: text("3\ncomment\nC 0 0 0\n"), size: 16, family: "structure", format: "xyz", mode: "text", capability: "structure", readPolicy: "editable-full", evidence: "extension" },
  { name: "ligand.mol", head: text("molfile\n"), size: 8, family: "structure", format: "mol", mode: "text", capability: "structure", readPolicy: "editable-full", evidence: "extension" },
  { name: "compound.sdf", head: text("cpd\n"), size: 5, family: "structure", format: "sdf", mode: "text", capability: "structure", readPolicy: "editable-full", evidence: "extension" },
  // document
  { name: "paper.tex", head: text("\\documentclass{article}\n"), size: 22, family: "document", format: "latex", mode: "text", capability: "document", readPolicy: "editable-full", evidence: "extension" },
  { name: "doc.pdf", head: text("%PDF-1.7\n"), size: 9, family: "document", format: "pdf", mode: "binary", capability: "pdf", readPolicy: "streamed-media", evidence: "magic", magic: true },
  // binary data — container magic never guesses h5ad/loom
  { name: "data.h5", head: hdf5, size: 8, family: "binary", format: "hdf5", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true },
  { name: "cells.h5ad", head: hdf5, size: 8, family: "binary", format: "hdf5", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true, warning: "overrides extension" },
  { name: "atlas.loom", head: hdf5, size: 8, family: "binary", format: "hdf5", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true, warning: "overrides extension" },
  { name: "table.parquet", head: text("PAR1"), size: 4, family: "binary", format: "parquet", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true },
  { name: "stream.arrow", head: text("ARROW1"), size: 6, family: "binary", format: "arrow", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true },
  { name: "aln.bam", head: text("BAM\x01"), size: 4, family: "binary", format: "bam", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "extension" },
  { name: "aln.cram", head: text("CRAM"), size: 4, family: "binary", format: "cram", mode: "binary", capability: "binary", readPolicy: "metadata-only", evidence: "magic", magic: true },
]

describe("ScienceFile.detect first-batch matrix", () => {
  for (const c of cases) {
    test(`detect ${c.name}`, () => {
      const result = ScienceFile.detect({ name: c.name, size: c.size, head: c.head })
      expect(result.family).toBe(c.family)
      expect(result.format).toBe(c.format)
      expect(result.mode).toBe(c.mode)
      expect(result.capability).toBe(c.capability)
      expect(result.readPolicy).toBe(c.readPolicy)
      expect(result.evidence).toBe(c.evidence)
      expect(result.magic).toBe(c.magic ?? false)
      if (c.warning) expect(result.warnings.join(" ")).toContain(c.warning)
    })
  }
})

describe("ScienceFile extension case-insensitivity & aliases", () => {
  const aliases: Array<[string, ScienceFile.Format]> = [
    ["SEQ.FASTA", "fasta"],
    ["seq.fa", "fasta"],
    ["genome.fna", "fasta"],
    ["reads.fq", "fastq"],
    ["crystal.CIF", "mmcif"],
    ["table.PARQUET", "parquet"],
    ["cells.H5AD", "h5ad"],
    ["DATA.TSV", "tsv"],
    ["cpd.sd", "sdf"],
    ["molecule.molfile", "mol"],
    ["annotations.gff3", "gff"],
  ]
  for (const [name, format] of aliases) {
    test(`extension ${name} → ${format}`, () => {
      const result = ScienceFile.detect({ name, size: 8, head: text("anything") })
      expect(result.format).toBe(format)
      expect(result.evidence).toBe("extension")
    })
  }
})

describe("ScienceFile magic vs extension", () => {
  test("HDF5 magic wins over a conflicting text extension", () => {
    const result = ScienceFile.detect({ name: "data.csv", size: 8, head: hdf5 })
    expect(result.format).toBe("hdf5")
    expect(result.family).toBe("binary")
    expect(result.evidence).toBe("magic")
    expect(result.magic).toBe(true)
    expect(result.warnings.join(" ")).toContain("overrides extension .csv")
  })

  test("HDF5 magic is never guessed as H5AD/loom", () => {
    const noExt = ScienceFile.detect({ name: "dataset", size: 8, head: hdf5 })
    expect(noExt.format).toBe("hdf5")
    expect(noExt.evidence).toBe("magic")
    expect(noExt.warnings.join(" ")).toContain("no extension")

    const h5ad = ScienceFile.detect({ name: "cells.h5ad", size: 8, head: hdf5 })
    expect(h5ad.format).toBe("hdf5")
    expect(h5ad.warnings.join(" ")).toContain("overrides extension .h5ad")
  })

  test("PDF magic wins over a mismatched extension", () => {
    const result = ScienceFile.detect({ name: "notes.txt", size: 6, head: text("%PDF-1.4") })
    expect(result.format).toBe("pdf")
    expect(result.evidence).toBe("magic")
    expect(result.warnings.join(" ")).toContain("overrides extension .txt")
  })
})

describe("ScienceFile no extension / corrupted / empty / unknown", () => {
  test("no extension with HDF5 magic classifies by magic", () => {
    const result = ScienceFile.detect({ name: "data", size: 8, head: hdf5 })
    expect(result.format).toBe("hdf5")
    expect(result.evidence).toBe("magic")
  })

  test("no extension with text content is unknown text", () => {
    const result = ScienceFile.detect({ name: "README", size: 5, head: text("hello") })
    expect(result.family).toBe("unknown")
    expect(result.format).toBe("unknown")
    expect(result.mode).toBe("text")
    expect(result.capability).toBe("text")
    expect(result.readPolicy).toBe("editable-full")
    expect(result.warnings.join(" ")).toContain("no extension")
  })

  test("corrupted HDF5 header keeps extension evidence and warns", () => {
    const result = ScienceFile.detect({ name: "cells.h5ad", size: 8, head: text("garbage!!") })
    expect(result.format).toBe("h5ad")
    expect(result.evidence).toBe("extension")
    expect(result.warnings.join(" ")).toContain("header mismatch")
  })

  test("empty file is unknown with an empty warning", () => {
    const result = ScienceFile.detect({ name: "data.csv", size: 0, head: new Uint8Array(0) })
    expect(result.family).toBe("unknown")
    expect(result.format).toBe("unknown")
    expect(result.mode).toBe("text")
    expect(result.warnings).toContain("empty file")
    expect(result.readPolicy).toBe("editable-full")
  })

  test("unrecognized binary content is unknown binary metadata-only", () => {
    const result = ScienceFile.detect({ name: "payload.bin", size: 8, head: new Uint8Array([0x00, 0x01, 0x02, 0x03]) })
    expect(result.family).toBe("unknown")
    expect(result.mode).toBe("binary")
    expect(result.capability).toBe("binary")
    expect(result.readPolicy).toBe("metadata-only")
    expect(result.warnings.join(" ")).toContain("unrecognized binary content")
  })
})

describe("ScienceFile frozen budgets", () => {
  test("budget constants are frozen", () => {
    expect(ScienceFile.Budget.INSPECT_HEADER_BYTES).toBe(4096)
    expect(ScienceFile.Budget.INSPECT_TAIL_BYTES).toBe(4096)
    expect(ScienceFile.Budget.PREVIEW_BYTES).toBe(256 * 1024)
    expect(ScienceFile.Budget.PREVIEW_LINES).toBe(4096)
    expect(ScienceFile.Budget.PREVIEW_RECORDS).toBe(1024)
    expect(ScienceFile.Budget.FULL_READ_BYTES).toBe(1024 * 1024)
    expect(ScienceFile.Budget.BROWSER_RETAINED_CHARS).toBe(512 * 1024)
    expect(ScienceFile.Budget.DOM_NODE_CAP).toBe(4096)
    expect(ScienceFile.Budget.PARSE_DEADLINE_MS).toBe(250)
  })
})

describe("ScienceFile oversized read policies", () => {
  test("text over FULL_READ_BYTES degrades to bounded-preview", () => {
    const large = ScienceFile.Budget.FULL_READ_BYTES + 1
    for (const name of ["big.fasta", "big.vcf", "big.tsv"]) {
      const result = ScienceFile.detect({ name, size: large, head: text(">seq\n") })
      expect(result.readPolicy).toBe("bounded-preview")
    }
  })

  test("small text stays editable-full", () => {
    const result = ScienceFile.detect({ name: "small.csv", size: 12, head: text("a,b,c\n1,2,3\n") })
    expect(result.readPolicy).toBe("editable-full")
  })

  test("binary stays metadata-only regardless of size", () => {
    const huge = 8 * 1024 * 1024 * 1024
    for (const name of ["big.bam", "big.h5ad", "big.parquet"]) {
      const result = ScienceFile.detect({ name, size: huge, head: text("x") })
      expect(result.readPolicy).toBe("metadata-only")
    }
  })

  test("PDF streams regardless of size", () => {
    const huge = 2 * 1024 * 1024 * 1024
    const result = ScienceFile.detect({ name: "big.pdf", size: huge, head: text("%PDF-1.7") })
    expect(result.readPolicy).toBe("streamed-media")
  })
})

describe("ScienceFile zod response schema", () => {
  test("Detection parses a detector result", () => {
    const result = ScienceFile.detect({ name: "x.csv", size: 5, head: text("a,b,c") })
    expect(ScienceFile.Detection.safeParse(result).success).toBe(true)
  })

  test("text Inspect parses with fixed-cap preview fields", () => {
    const result = ScienceFile.detect({ name: "x.csv", size: 12, head: text("a,b,c\n1,2,3\n") })
    const inspect = { ...result, preview: "a,b,c", contentBytes: 12, totalBytes: 12, truncated: false, lines: 1 }
    expect(ScienceFile.Inspect.safeParse(inspect).success).toBe(true)
  })

  test("binary Inspect parses without preview", () => {
    const result = ScienceFile.detect({ name: "x.h5", size: 8, head: hdf5 })
    expect(ScienceFile.Inspect.safeParse(result).success).toBe(true)
  })

  test("binary Inspect rejects preview fields", () => {
    const result = ScienceFile.detect({ name: "x.h5", size: 8, head: hdf5 })
    const inspect = { ...result, preview: "not allowed for binary" }
    expect(ScienceFile.Inspect.safeParse(inspect).success).toBe(false)
  })
})
