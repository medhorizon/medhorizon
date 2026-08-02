import { describe, expect, test } from "bun:test"
import { mapToastOptions } from "./Toast"

describe("mapToastOptions", () => {
  test("maps info/success/error variants and default ttl", () => {
    expect(mapToastOptions({ kind: "info", title: "hello", description: "world" })).toEqual({
      title: "hello",
      description: "world",
      variant: "default",
      duration: 4500,
    })
    expect(mapToastOptions({ kind: "success", title: "ok" })).toEqual({
      title: "ok",
      description: undefined,
      variant: "success",
      duration: 4500,
    })
    expect(mapToastOptions({ kind: "error", title: "nope", ttl_ms: 2000 })).toEqual({
      title: "nope",
      description: undefined,
      variant: "error",
      duration: 2000,
    })
  })

  test("prefixes warning titles once without changing description", () => {
    expect(
      mapToastOptions({ kind: "warning", title: "careful", description: "details stay" }),
    ).toEqual({
      title: "⚠ careful",
      description: "details stay",
      variant: "default",
      duration: 4500,
    })
    expect(mapToastOptions({ kind: "warning", title: "⚠ already" })).toEqual({
      title: "⚠ already",
      description: undefined,
      variant: "default",
      duration: 4500,
    })
  })

  test("maps non-positive ttl to persistent", () => {
    expect(mapToastOptions({ kind: "info", title: "stay", ttl_ms: 0 })).toEqual({
      title: "stay",
      description: undefined,
      variant: "default",
      persistent: true,
    })
    expect(mapToastOptions({ kind: "info", title: "stay", ttl_ms: -1 })).toEqual({
      title: "stay",
      description: undefined,
      variant: "default",
      persistent: true,
    })
  })
})
