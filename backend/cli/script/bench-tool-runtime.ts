import { resourceUsage } from "node:process"

type Workload = {
  id: string
  class: "startup" | "scientific" | "research"
  source: string
  code: string
  weight: number
}

type Sample = {
  workload: string
  class: Workload["class"]
  mode: "one-shot" | "kernel-cold" | "kernel-warm"
  status: "ok" | "unavailable" | "failure"
  wallMs?: number
  outputBytes?: number
  childCount?: number
  idleProcessCount?: number
  peakRssBytes?: number
  cpuUserMicros?: number
  cpuSystemMicros?: number
  cancelLatencyMs?: number
  reason?: string
}

const root = process.cwd()
const defaultIterations = 30
const cap = 10 * 1024 * 1024
const workloads: Workload[] = [
  {
    id: "startup-light",
    class: "startup",
    source: "inline:python-startup",
    code: "print(2 + 2)",
    weight: 1,
  },
  {
    id: "scientific-import",
    class: "scientific",
    source: "inline:scientific-array",
    code: "import math\nvalues = [math.sin(i / 10) for i in range(1000)]\nprint(round(sum(values), 6))",
    weight: 1,
  },
  {
    id: "research-graph-transform",
    class: "research",
    source: "research-graph/scripts/medhorizon-gateway.py",
    code: "import json\nrecords = [{\"kind\": \"evidence\", \"score\": i / 10} for i in range(10)]\nprint(json.dumps(records, separators=(\",\", \":\")))",
    weight: 1,
  },
]

function iterations() {
  const index = Bun.argv.indexOf("--iterations")
  const value = index >= 0 ? Number(Bun.argv[index + 1]) : defaultIterations
  if (!Number.isInteger(value) || value < 1 || value > 300) throw new Error("--iterations must be an integer from 1 to 300")
  return value
}

function manifest(count: number): Workload[] {
  const result: Workload[] = []
  const groups = workloads.map((workload) => ({ workload, count: 0 }))
  for (const _ of Array.from({ length: count })) {
    for (const group of groups) {
      if (group.count >= count / workloads.length) continue
      result.push(group.workload)
      group.count += 1
    }
  }
  while (result.length < count) result.push(workloads[result.length % workloads.length])
  return result.slice(0, count)
}

function rss(pid: number | undefined) {
  if (!pid || process.platform !== "linux") return undefined
  const text = Bun.file(`/proc/${pid}/status`).text()
  return text.then((value) => {
    const match = value.match(/^VmHWM:\s+(\d+)\s+kB$/m) ?? value.match(/^VmRSS:\s+(\d+)\s+kB$/m)
    return match ? Number(match[1]) * 1024 : undefined
  }).catch(() => undefined)
}

async function runProcess(binary: string, code: string, workload: Workload, mode: Sample["mode"]): Promise<Sample> {
  const before = resourceUsage()
  const started = performance.now()
  const proc = Bun.spawn([binary, "-c", code], { cwd: root, stdout: "pipe", stderr: "pipe" })
  const output = await new Response(proc.stdout).arrayBuffer().then((value) => value.byteLength).catch(() => 0)
  const error = await new Response(proc.stderr).text().catch(() => "")
  const exit = await proc.exited
  const ended = performance.now()
  const after = resourceUsage()
  const memory = await rss(proc.pid)
  if (exit !== 0) {
    return {
      workload: workload.id,
      class: workload.class,
      mode,
      status: "failure",
      reason: error.slice(0, 120) || `exit-${exit}`,
      wallMs: ended - started,
      outputBytes: output,
      childCount: 1,
      idleProcessCount: 0,
      peakRssBytes: memory,
      cpuUserMicros: after.userCPUTime - before.userCPUTime,
      cpuSystemMicros: after.systemCPUTime - before.systemCPUTime,
    }
  }
  return {
    workload: workload.id,
    class: workload.class,
    mode,
    status: "ok",
    wallMs: ended - started,
    outputBytes: output,
    childCount: 1,
    idleProcessCount: 0,
    peakRssBytes: memory,
    cpuUserMicros: after.userCPUTime - before.userCPUTime,
    cpuSystemMicros: after.systemCPUTime - before.systemCPUTime,
  }
}

async function runKernel(binary: string, tasks: Workload[], mode: "kernel-cold" | "kernel-warm") {
  const script = [
    "import json,sys",
    "for line in sys.stdin:",
    "  code=json.loads(line)",
    "  if code is None: break",
    "  exec(compile(code, '<benchmark>', 'exec'), globals())",
    "  print('__OPENSCIENCE_BENCH_DONE__', flush=True)",
  ].join("\n")
  const proc = Bun.spawn([binary, "-u", "-c", script], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const writer = proc.stdin as unknown as WritableStreamDefaultWriter<Uint8Array>
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  const state = { pending: "" }
  const readCell = async () => {
    while (!state.pending.includes("__OPENSCIENCE_BENCH_DONE__")) {
      const chunk = await reader.read()
      if (chunk.done) break
      state.pending += decoder.decode(chunk.value, { stream: true })
      if (state.pending.length > cap) state.pending = state.pending.slice(-cap)
    }
    const index = state.pending.indexOf("__OPENSCIENCE_BENCH_DONE__")
    if (index >= 0) state.pending = state.pending.slice(index + "__OPENSCIENCE_BENCH_DONE__".length)
  }
  const result: Sample[] = []
  for (const workload of tasks) {
    const before = resourceUsage()
    const started = performance.now()
    await writer.write(new TextEncoder().encode(`${JSON.stringify(workload.code)}\n`))
    await readCell()
    const ended = performance.now()
    const after = resourceUsage()
    result.push({
      workload: workload.id,
      class: workload.class,
      mode,
      status: "ok",
      wallMs: ended - started,
      outputBytes: Buffer.byteLength(state.pending),
      childCount: 1,
      idleProcessCount: mode === "kernel-warm" ? 1 : 0,
      cpuUserMicros: after.userCPUTime - before.userCPUTime,
      cpuSystemMicros: after.systemCPUTime - before.systemCPUTime,
    })
  }
  await writer.write(new TextEncoder().encode("null\n"))
  await writer.close()
  reader.releaseLock()
  await proc.exited
  return result
}

function unavailable(binary: string | undefined, mode: Sample["mode"]): Sample[] {
  return manifest(iterations()).map((workload) => ({
    workload: workload.id,
    class: workload.class,
    mode,
    status: "unavailable",
    reason: binary ? undefined : "python executable not found",
  }))
}

async function main() {
  const count = iterations()
  const binary = Bun.which("python3") ?? Bun.which("python") ?? undefined
  const tasks = manifest(count)
  const oneShot = binary ? await Promise.all(tasks.map((workload) => runProcess(binary, workload.code, workload, "one-shot"))) : unavailable(binary, "one-shot")
  const cold = binary ? (await Promise.all(tasks.map((workload) => runKernel(binary, [workload], "kernel-cold")))).flat() : unavailable(binary, "kernel-cold")
  const warm = binary ? await runKernel(binary, tasks, "kernel-warm") : unavailable(binary, "kernel-warm")
  const report = {
    schema: "plan18.tool-runtime-benchmark.v1",
    generatedAt: new Date().toISOString(),
    iterations: count,
    workloadMix: workloads.map(({ id, class: group, source, weight }) => ({ id, class: group, source, weight })),
    dependencies: { python: binary ? "available" : "unavailable", r: Bun.which("Rscript") ? "available" : "unavailable" },
    representative: workloads.every((workload) => !workload.source.startsWith("inline:")),
    samples: [...oneShot, ...cold, ...warm],
    notes: [
      "Samples contain timing and anonymous workload IDs only; command text, env values, secrets, and absolute paths are excluded.",
      "Use workload IDs/classes for routing decisions; do not promote local wall-time thresholds across platforms.",
    ],
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

await main()
