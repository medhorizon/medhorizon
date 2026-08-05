const REDACTED = "[REDACTED]"

export const MAX_SECRET_BYTES = 16 * 1024

type Match = {
  index: number
  value: string
}

function bytes(value: string) {
  return Buffer.byteLength(value, "utf8")
}

function match(input: string, values: string[], limit: number): Match | undefined {
  return values
    .map((value) => ({ value, index: input.indexOf(value) }))
    .filter((item) => item.index >= 0 && item.index < limit)
    .sort((a, b) => a.index - b.index || b.value.length - a.value.length)[0]
}

function redact(input: string, values: string[]) {
  const output: string[] = []
  const state = { rest: input }

  while (state.rest) {
    const found = match(state.rest, values, state.rest.length)
    if (!found) {
      output.push(state.rest)
      break
    }
    output.push(state.rest.slice(0, found.index), REDACTED)
    state.rest = state.rest.slice(found.index + found.value.length)
  }

  return output.join("")
}

/**
 * Redacts registered secrets from streamed text without rescanning prior output.
 * The retained tail is bounded by the longest registered secret, so a secret
 * split across chunks cannot be emitted before the matcher can decide.
 */
export function createRedactor(secrets: Iterable<string>) {
  const values = [...new Set(secrets)].filter((value) => value.length > 0)
  const oversized = values.find((value) => bytes(value) > MAX_SECRET_BYTES)
  if (oversized) throw new Error(`Secret exceeds ${MAX_SECRET_BYTES / 1024} KiB redaction limit`)

  const size = values.reduce((max, value) => Math.max(max, value.length), 0)
  const state = { rest: "" }

  return {
    push(chunk: string) {
      if (!size) return chunk
      state.rest += chunk
      const output: string[] = []

      while (state.rest.length > size - 1) {
        const limit = state.rest.length - size + 1
        const found = match(state.rest, values, limit)
        if (!found) {
          output.push(state.rest.slice(0, limit))
          state.rest = state.rest.slice(limit)
          break
        }
        output.push(state.rest.slice(0, found.index), REDACTED)
        state.rest = state.rest.slice(found.index + found.value.length)
      }

      return output.join("")
    },
    flush() {
      const output = redact(state.rest, values)
      state.rest = ""
      return output
    },
  }
}
