import { JSONParseError } from "ai"

/** Buffer SSE so incomplete final `data:` lines are not flushed as truncated JSON. */
export function seal(body: ReadableStream<Uint8Array>) {
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let buf = ""
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        buf += dec.decode(chunk, { stream: true })
        for (;;) {
          const i = buf.indexOf("\n")
          if (i < 0) break
          ctl.enqueue(enc.encode(buf.slice(0, i + 1)))
          buf = buf.slice(i + 1)
        }
      },
      flush(ctl) {
        const rest = buf + dec.decode()
        if (!rest.trim()) return
        const line = rest.trimEnd()
        if (!line.startsWith("data:")) {
          ctl.enqueue(enc.encode(rest.endsWith("\n") ? rest : rest + "\n"))
          return
        }
        const payload = line.slice(5).trimStart()
        if (payload === "[DONE]") {
          ctl.enqueue(enc.encode(rest.endsWith("\n") ? rest : rest + "\n"))
          return
        }
        try {
          JSON.parse(payload)
        } catch (cause) {
          // Truncated final SSE event (common with mid-chunk proxy cuts).
          throw new JSONParseError({ text: payload.slice(0, 500), cause })
        }
        ctl.enqueue(enc.encode(rest.endsWith("\n") ? rest : rest + "\n"))
      },
    }),
  )
}

/** Wrap SSE response bodies so truncated trailing events become JSONParseError. */
export function wrap(res: Response) {
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("text/event-stream") || !res.body) return res
  return new Response(seal(res.body), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}
