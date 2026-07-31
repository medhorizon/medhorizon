import { describe, expect, test } from "bun:test"
import { PermissionNext } from "../../src/permission/next"
import { ToolSelection } from "../../src/tool/selection"

const permission = PermissionNext.fromConfig({
  "*": "allow",
  read: "deny",
})

describe("tool.selection", () => {
  test("absent toolset includes every candidate id", () => {
    const ids = ["read", "glob", "grep"]
    expect(ToolSelection.selected({ ids, permission: [] })).toEqual(new Set(ids))
  })

  test("toolset wildcard keeps matching ids only", () => {
    const selected = ToolSelection.selected({
      ids: ["read", "glob", "grep", "atlas_graph", "atlas_stage"],
      toolset: ["read", "glob", "atlas_*"],
      permission: [],
    })
    expect([...selected].sort()).toEqual(["atlas_graph", "atlas_stage", "glob", "read"])
  })

  test('tools["*"] === false keeps only explicit true overrides', () => {
    const selected = ToolSelection.selected({
      ids: ["read", "glob", "grep"],
      message: { "*": false, read: true },
      permission: [],
    })
    expect([...selected]).toEqual(["read"])
  })

  test("explicit false removes a tool from default-inclusive set", () => {
    const selected = ToolSelection.selected({
      ids: ["read", "glob", "grep"],
      message: { grep: false },
      permission: [],
    })
    expect([...selected].sort()).toEqual(["glob", "read"])
  })

  test("permission deny removes a tool even when availability is true", () => {
    const selected = ToolSelection.selected({
      ids: ["read", "glob", "grep"],
      message: { read: true },
      permission,
    })
    expect([...selected].sort()).toEqual(["glob", "grep"])
  })

  test("matches supports provenance and science wildcards", () => {
    expect(ToolSelection.matches("provenance_record", ["provenance_*"])).toBe(true)
    expect(ToolSelection.matches("science_search", ["science_*"])).toBe(true)
    expect(ToolSelection.matches("bash", ["science_*"])).toBe(false)
  })
})
