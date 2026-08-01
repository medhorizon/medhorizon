import { test, expect } from "bun:test"
import path from "path"
import { readFileSync } from "fs"
import { ConfigMarkdown } from "../../src/config/markdown"
import { Skill } from "../../src/skill"

const Frontmatter = Skill.Info.pick({ name: true, description: true, category: true, tags: true, entry: true })
const root = path.join(import.meta.dir, "..", "..", "skills")
const files = await Array.fromAsync(new Bun.Glob("**/SKILL.md").scan({ cwd: root, absolute: true }))

test("default system skill registry does not include initialize-atlas-graph", () => {
  const skillTs = readFileSync(path.join(import.meta.dir, "../../src/skill/skill.ts"), "utf-8")
  expect(skillTs).toContain('{ name: "goal"')
  expect(skillTs).not.toMatch(/SYSTEM_SKILLS[\s\S]*initialize-atlas-graph/)
  expect(skillTs).toContain("initialize-atlas-graph") // source kept unreachable; noted in comment
})

test("every bundled skill with frontmatter parses and validates", async () => {
  expect(files.length).toBeGreaterThan(0)
  const broken = await Promise.all(
    files.map(async (file) => {
      const raw = await Bun.file(file).text()
      if (!raw.startsWith("---")) return undefined
      const parsed = await ConfigMarkdown.parse(file)
      return Frontmatter.safeParse(parsed.data).success ? undefined : path.relative(root, file)
    }),
  )
  expect(broken.filter(Boolean)).toEqual([])
})

test("Ray extras remain scalar dependency names", async () => {
  const train = await ConfigMarkdown.parse(path.join(root, "ml-training", "ray-train", "SKILL.md"))
  const data = await ConfigMarkdown.parse(path.join(root, "data-engineering", "ray-data", "SKILL.md"))
  expect(train.data.dependencies[0]).toBe("ray[train]")
  expect(data.data.dependencies[0]).toBe("ray[data]")
})
