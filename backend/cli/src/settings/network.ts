import path from "path"
import fs from "fs/promises"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import z from "zod"
import { Global } from "../global"
import { Log } from "../util/log"

// Outbound domain allow-list. A catalog of curated science-connector domain
// sets (each toggleable as a group) plus a free-form list of custom domains.
// Persisted as a single JSON document under the ~/.openscience data dir and readable
// by the backend via `Network.allowlist()`.
export namespace Network {
  const log = Log.create({ service: "settings.network" })

  export const Group = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string(),
    domains: z.array(z.string()),
  })
  export type Group = z.infer<typeof Group>

  // Curated groups wired to the science connectors the agents actually reach.
  export const CATALOG: Group[] = [
    {
      id: "package-management",
      label: "Package management",
      description: "Python, R, JS, Rust package indexes and source hosting.",
      domains: [
        "pypi.org",
        "files.pythonhosted.org",
        "registry.npmjs.org",
        "conda.anaconda.org",
        "cran.r-project.org",
        "crates.io",
        "github.com",
        "raw.githubusercontent.com",
        "objects.githubusercontent.com",
      ],
    },
    {
      id: "ncbi-nih",
      label: "NCBI / NIH",
      description: "PubMed, Entrez E-utilities, and NIH data services.",
      domains: [
        "ncbi.nlm.nih.gov",
        "www.ncbi.nlm.nih.gov",
        "eutils.ncbi.nlm.nih.gov",
        "pubmed.ncbi.nlm.nih.gov",
        "ftp.ncbi.nlm.nih.gov",
        "nih.gov",
      ],
    },
    {
      id: "genomics-biology",
      label: "Genomics & biology",
      description: "Ensembl, UCSC Genome Browser, and EBI resources.",
      domains: [
        "ensembl.org",
        "rest.ensembl.org",
        "ucsc.edu",
        "genome.ucsc.edu",
        "genome-euro.ucsc.edu",
        "ebi.ac.uk",
        "www.ebi.ac.uk",
      ],
    },
    {
      id: "proteomics",
      label: "Proteomics",
      description: "UniProt, RCSB PDB, and AlphaFold structure services.",
      domains: [
        "uniprot.org",
        "rest.uniprot.org",
        "rcsb.org",
        "files.rcsb.org",
        "alphafold.ebi.ac.uk",
        "www.ebi.ac.uk",
      ],
    },
    {
      id: "literature-citations",
      label: "Literature & citations",
      description: "Preprint servers, Semantic Scholar, Crossref, and DOIs.",
      domains: [
        "arxiv.org",
        "biorxiv.org",
        "medrxiv.org",
        "semanticscholar.org",
        "api.semanticscholar.org",
        "crossref.org",
        "api.crossref.org",
        "doi.org",
        "europepmc.org",
      ],
    },
    {
      id: "clinical-pharma",
      label: "Clinical & pharma",
      description: "Clinical trials, drug databases, and regulatory agencies.",
      domains: ["clinicaltrials.gov", "go.drugbank.com", "fda.gov", "api.fda.gov", "who.int", "ema.europa.eu"],
    },
  ]

  export const State = z.object({
    // When false the allow-list is advisory only (agent may reach any domain).
    allowlistEnabled: z.boolean(),
    // Enabled catalog group ids.
    enabled: z.array(z.string()),
    // Custom user-added domains.
    custom: z.array(z.string()),
  })
  export type State = z.infer<typeof State>

  export type Address = {
    address: string
    family: 4 | 6
  }

  export type Resolution = {
    url: URL
    addresses: Address[]
  }

  const file = path.join(Global.Path.data, "settings", "network.json")

  function defaultState(): State {
    return { allowlistEnabled: false, enabled: ["package-management"], custom: [] }
  }

  function normalize(domain: string): string {
    return domain.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "")
  }

  function domains(state: State): string[] {
    const result = new Set<string>(state.custom.map(normalize).filter(Boolean))
    for (const group of CATALOG) {
      if (!state.enabled.includes(group.id)) continue
      for (const domain of group.domains) result.add(normalize(domain))
    }
    return [...result].sort()
  }

  export function domainAllowed(hostname: string, allowlist: string[]): boolean {
    const host = normalize(hostname)
    return allowlist.map(normalize).some((domain) => host === domain || host.endsWith(`.${domain}`))
  }

  export async function get(): Promise<State> {
    const text = await Bun.file(file)
      .text()
      .catch(() => undefined)
    if (!text) return defaultState()
    try {
      const parsed = State.safeParse(JSON.parse(text))
      if (parsed.success) return parsed.data
    } catch (e) {
      log.error("failed to parse network state", { error: e })
    }
    return defaultState()
  }

  export async function set(state: State): Promise<State> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await Bun.write(file, JSON.stringify(state, null, 2))
    return state
  }

  // Effective flat list of allowed domains (enabled groups ∪ custom). Readable
  // by any backend caller that wants to gate outbound access.
  export async function allowlist(): Promise<string[]> {
    return domains(await get())
  }

  export async function assertAllowed(raw: string): Promise<void> {
    const state = await get()
    if (!state.allowlistEnabled) return
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new Error(`Invalid network URL: ${raw}`)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Network URL must use http or https: ${raw}`)
    }
    const allowed = domains(state)
    if (domainAllowed(url.hostname, allowed)) return
    throw new Error(`Network access to ${url.hostname} is not in the configured allow-list`)
  }

  function range(value: number, base: number, bits: number): boolean {
    const size = 2 ** (32 - bits)
    return value >= base && value < base + size
  }

  function ipv4(value: string): boolean {
    const parts = value.split(".")
    if (parts.length !== 4) return true
    const octets = parts.map(Number)
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
    const number = octets.reduce((result, part) => result * 256 + part, 0)
    return [
      [0, 8],
      [0x0a000000, 8],
      [0x64400000, 10],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0000000, 24],
      [0xc0000200, 24],
      [0xc0586300, 24],
      [0xc0a80000, 16],
      [0xc6120000, 15],
      [0xc6336400, 24],
      [0xcb007100, 24],
      [0xe0000000, 4],
    ].some(([base, bits]) => range(number, base, bits))
  }

  function ipv6(value: string): boolean {
    const text = value.toLowerCase().split("%")[0]
    const sections = text.split("::")
    if (sections.length > 2) return true

    const parse = (part: string): number[] | undefined => {
      if (!part) return []
      const pieces = part.split(":")
      const last = pieces.at(-1)
      if (last?.includes(".")) {
        const octets = last.split(".").map(Number)
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
          return undefined
        }
        pieces.splice(-1, 1, `${(octets[0] * 256 + octets[1]).toString(16)}`, `${(octets[2] * 256 + octets[3]).toString(16)}`)
      }
      if (pieces.some((piece) => !piece || !/^[0-9a-f]{1,4}$/.test(piece))) return undefined
      return pieces.map((piece) => Number.parseInt(piece, 16))
    }

    const left = parse(sections[0])
    const right = sections.length === 2 ? parse(sections[1]) : []
    if (!left || !right) return true
    const missing = 8 - left.length - right.length
    if (missing < 0) return true
    const groups = sections.length === 2 ? [...left, ...Array(missing).fill(0), ...right] : left
    if (groups.length !== 8) return true

    const number = groups.reduce((result, part) => (result << 16n) | BigInt(part), 0n)
    const mapped = number >> 32n === 0xffffn
    if (mapped) {
      const mappedValue = Number(number & 0xffffffffn)
      return ipv4(`${mappedValue >>> 24}.${(mappedValue >>> 16) & 255}.${(mappedValue >>> 8) & 255}.${mappedValue & 255}`)
    }
    if (number >> 32n === 0n) {
      const compatible = Number(number & 0xffffffffn)
      return ipv4(`${compatible >>> 24}.${(compatible >>> 16) & 255}.${(compatible >>> 8) & 255}.${compatible & 255}`)
    }

    const prefix = (base: bigint, bits: number) => number >> BigInt(128 - bits) === base >> BigInt(128 - bits)
    return (
      number === 0n ||
      number === 1n ||
      prefix(0xfc000000000000000000000000000000n, 7) ||
      prefix(0xfe000000000000000000000000000000n, 9) ||
      prefix(0xff000000000000000000000000000000n, 8) ||
      prefix(0x20010db8000000000000000000000000n, 32)
    )
  }

  function restricted(value: string): boolean {
    const family = isIP(value)
    if (family === 4) return ipv4(value)
    if (family === 6) return ipv6(value)
    return true
  }

  async function resolveAll(hostname: string, signal?: AbortSignal): Promise<Address[]> {
    const task = lookup(hostname, { all: true, verbatim: true }).then((values) =>
      values.map((value) => ({ address: value.address, family: value.family === 6 ? 6 : 4 }) satisfies Address),
    )
    if (!signal) return task
    if (signal.aborted) throw new Error("webfetch DNS resolution aborted")
    return new Promise((resolve, reject) => {
      const stop = () => {
        signal.removeEventListener("abort", stop)
        reject(new Error("webfetch DNS resolution aborted"))
      }
      signal.addEventListener("abort", stop, { once: true })
      void task.then(
        (values) => {
          signal.removeEventListener("abort", stop)
          resolve(values)
        },
        (error) => {
          signal.removeEventListener("abort", stop)
          reject(error)
        },
      )
    })
  }

  export async function resolve(raw: string, signal?: AbortSignal): Promise<Resolution> {
    const url = URL.canParse(raw) ? new URL(raw) : undefined
    if (!url) throw new Error(`webfetch invalid URL: ${raw}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`webfetch unsupported URL scheme: ${url.protocol}`)
    }
    if (url.username || url.password) throw new Error("webfetch URL credentials are not allowed")

    await assertAllowed(url.toString())
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    const addresses = await resolveAll(hostname, signal).catch((error) => {
      if (signal?.aborted) throw error
      throw new Error(`webfetch DNS resolution failed for ${hostname}`, { cause: error })
    })
    if (!addresses.length || addresses.some((value) => restricted(value.address))) {
      throw new Error(`webfetch blocked private or reserved address for ${hostname}`)
    }
    return { url, addresses }
  }
}
