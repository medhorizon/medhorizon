import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { Agent } from "../../src/agent/agent"
import { ToolSelection } from "../../src/tool/selection"

describe("tool.registry", () => {
  test("loads tools from .openscience/tool (singular)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const openscienceDir = path.join(dir, ".openscience")
        await fs.mkdir(openscienceDir, { recursive: true })

        const toolDir = path.join(openscienceDir, "tool")
        await fs.mkdir(toolDir, { recursive: true })

        await Bun.write(
          path.join(toolDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("loads tools from .openscience/tools (plural)", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const openscienceDir = path.join(dir, ".openscience")
        await fs.mkdir(openscienceDir, { recursive: true })

        const toolsDir = path.join(openscienceDir, "tools")
        await fs.mkdir(toolsDir, { recursive: true })

        await Bun.write(
          path.join(toolsDir, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids).toContain("hello")
      },
    })
  })

  test("initializes only selected tool ids", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { providerID: "openrouter", modelID: "claude-3" }
        const selected = new Set(["read", "glob"])
        const tools = await ToolRegistry.tools(model, undefined, selected)
        expect(tools.map((t) => t.id).sort()).toEqual(["glob", "read"])
      },
    })
  })

  test("exposes the shared notebook to compute agents while keeping biology databases gated", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { providerID: "openrouter", modelID: "claude-3" }

        for (const name of ["biology", "research", "ml", "physics"]) {
          const agent = await Agent.get(name)
          expect(agent).toBeDefined()
          const ids = await ToolRegistry.ids(model, agent)
          expect(ids.filter((id) => id === "notebook")).toHaveLength(1)
          expect(ToolSelection.matches("notebook", agent!.toolset!)).toBe(true)
          if (name === "physics") expect(ids).toContain("artifact")

          const selected = ToolSelection.selected({
            ids,
            toolset: agent!.toolset,
            permission: agent!.permission,
          })
          const tools = await ToolRegistry.tools(model, agent, selected)
          expect(tools.filter((tool) => tool.id === "notebook")).toHaveLength(1)
        }

        const biology = await Agent.get("biology")
        const research = await Agent.get("research")
        expect((await ToolRegistry.ids(model, biology)).filter((id) => id === "query_uniprot")).toHaveLength(1)
        expect(await ToolRegistry.ids(model, research)).not.toContain("query_uniprot")
      },
    })
  })

  test("does not let a custom notebook shadow the shared built-in", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const toolDir = path.join(dir, ".openscience", "tool")
        await fs.mkdir(toolDir, { recursive: true })
        await Bun.write(
          path.join(toolDir, "notebook.ts"),
          [
            "export default {",
            "  description: 'shadow',",
            "  args: {},",
            "  execute: async () => 'shadow',",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids = await ToolRegistry.ids()
        expect(ids.filter((id) => id === "notebook")).toHaveLength(1)
        expect(ids.length).toBe(new Set(ids).size)
        expect(await ToolRegistry.customIds()).not.toContain("notebook")

        const explore = await Agent.get("explore")
        const model = { providerID: "openrouter", modelID: "claude-3" }
        const exploreIds = await ToolRegistry.ids(model, explore)
        expect(exploreIds).toContain("list")
      },
    })
  })
})
