import { describe, expect, test } from "bun:test"
import { relpath } from "./relpath"

describe("relpath", () => {
  test("strips posix absolute prefix", () => {
    expect(relpath("/proj", "/proj/docs/a.md")).toBe("docs/a.md")
  })

  test("strips windows backslash absolute prefix", () => {
    expect(relpath("D:\\proj", "D:\\proj\\docs\\a.md")).toBe("docs/a.md")
  })

  test("strips when dir uses backslash and file uses forward slash", () => {
    expect(relpath("D:\\proj", "D:/proj/docs/a.md")).toBe("docs/a.md")
  })

  test("strips when dir uses forward slash and file uses backslash", () => {
    expect(relpath("D:/proj", "D:\\proj\\docs\\a.md")).toBe("docs/a.md")
  })

  test("is case-insensitive on the prefix", () => {
    expect(relpath("D:\\Proj", "d:\\proj\\readme.md")).toBe("readme.md")
  })

  test("leaves already-relative paths alone", () => {
    expect(relpath("D:\\proj", "docs/a.md")).toBe("docs/a.md")
  })

  test("leaves paths outside the directory alone", () => {
    expect(relpath("D:\\proj", "D:\\other\\a.md")).toBe("D:\\other\\a.md")
  })

  test("does not treat prefix collisions as matches", () => {
    expect(relpath("/project", "/project-other/file")).toBe("/project-other/file")
  })
})
