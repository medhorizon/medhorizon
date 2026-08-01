import { expect, test } from "bun:test"
import { build } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"
import desktopPlugin from "../vite"
import { workspaceManualChunks } from "../vite.config"

const root = fileURLToPath(new URL("..", import.meta.url))

/** Retired Atlas product modules that must not appear in production chunk graphs. */
const DENYLIST = ["AtlasCanvas.tsx", "atlas/api/atlas.ts", "components/settings/Billing.tsx"]

test("production Rollup chunk.modules exclude retired Atlas product modules", async () => {
  const modules = new Set<string>()

  await build({
    configFile: false,
    root,
    logLevel: "error",
    plugins: [
      desktopPlugin as never,
      {
        name: "atlas-reachability-collector",
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type !== "chunk" || !chunk.modules) continue
            for (const id of Object.keys(chunk.modules)) {
              modules.add(id.replaceAll("\\", "/"))
            }
          }
        },
      },
    ],
    resolve: { dedupe: ["shiki"] },
    build: {
      write: false,
      emptyOutDir: false,
      target: "esnext",
      rollupOptions: {
        output: {
          onlyExplicitManualChunks: true,
          manualChunks: workspaceManualChunks,
        },
      },
    },
  })

  const offenders = DENYLIST.filter((needle) => [...modules].some((id) => id.endsWith(needle) || id.includes(`/${needle}`)))
  expect(offenders).toEqual([])

  // Sanity: Research Graph / Stage remain reachable in the live graph.
  const allow = ["ResearchGraphPane.tsx", "StagesPanel.tsx"]
  for (const needle of allow) {
    expect([...modules].some((id) => id.endsWith(needle) || id.includes(`/${needle}`))).toBe(true)
  }
}, 120_000)
