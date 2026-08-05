import z from "zod"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { Network } from "@/settings/network"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

type Response = {
  status: number
  headers: Headers
  body: IncomingMessage
  close: () => void
}

function safe(url: URL): string {
  const copy = new URL(url)
  for (const key of copy.searchParams.keys()) {
    if (/token|secret|password|passwd|api[_-]?key|auth|credential/i.test(key)) copy.searchParams.set(key, "[redacted]")
  }
  return copy.toString()
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") result.set(key, value)
    if (Array.isArray(value)) result.set(key, value.join(", "))
  }
  return result
}

async function request(url: URL, address: Network.Address, signal: AbortSignal, headers: Record<string, string>): Promise<Response> {
  if (signal.aborted) throw new Error("webfetch request aborted")

  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const common = {
    hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: {
      ...headers,
      Host: url.host,
    },
    lookup: (
      _name: string,
      options: { all?: boolean },
      callback: (error: Error | null, result: string | Array<{ address: string; family: number }>, family?: number) => void,
    ) => {
      const value = { address: address.address, family: address.family }
      if (options.all) return callback(null, [value])
      callback(null, value.address, value.family)
    },
  }

  return new Promise((resolve, reject) => {
    const state: { request?: ClientRequest; body?: IncomingMessage; settled: boolean } = { settled: false }
    const stop = () => {
      state.request?.destroy(new Error("webfetch request aborted"))
      state.body?.destroy(new Error("webfetch request aborted"))
    }
    const cleanup = () => signal.removeEventListener("abort", stop)
    const fail = (error: Error) => {
      if (state.settled) return
      state.settled = true
      cleanup()
      reject(error)
    }
    const done = (body: IncomingMessage) => {
      if (state.settled) return
      state.settled = true
      state.body = body
      resolve({
        status: body.statusCode ?? 0,
        headers: responseHeaders(body.headers),
        body,
        close: () => {
          cleanup()
          body.destroy()
          state.request?.destroy()
        },
      })
    }

    signal.addEventListener("abort", stop, { once: true })
    const transport = url.protocol === "https:" ? https : http
    const req =
      url.protocol === "https:"
        ? transport.request(
            {
              ...common,
              servername: isIP(hostname) ? undefined : hostname,
            },
            done,
          )
        : transport.request(common, done)
    state.request = req
    req.once("error", (error) => fail(new Error("webfetch network request failed", { cause: error })))
    req.end()
  })
}

async function readBody(response: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const length = Number(response.headers["content-length"])
  if (Number.isFinite(length) && length > MAX_RESPONSE_SIZE) {
    response.destroy()
    throw new Error("webfetch response too large: exceeds 5 MiB limit")
  }

  const state = { size: 0, chunks: [] as Buffer[] }
  const stop = () => response.destroy(new Error("webfetch request aborted"))
  signal.addEventListener("abort", stop, { once: true })
  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const size = state.size + buffer.byteLength
      if (size > MAX_RESPONSE_SIZE) {
        response.destroy()
        throw new Error("webfetch response too large: exceeds 5 MiB limit")
      }
      state.chunks.push(buffer)
      state.size = size
    }
    return Buffer.concat(state.chunks, state.size)
  } finally {
    signal.removeEventListener("abort", stop)
  }
}

async function follow(
  resolution: Network.Resolution,
  headers: Record<string, string>,
  signal: AbortSignal,
  hops: number,
  retried = false,
): Promise<{ resolution: Network.Resolution; response: Response }> {
  const address = resolution.addresses[0]
  if (!address) throw new Error("webfetch DNS resolution returned no address")
  const first = await request(resolution.url, address, signal, headers)
  const challenge = first.status === 403 && first.headers.get("cf-mitigated") === "challenge"
  if (challenge && !retried) {
    first.close()
    return follow(
      resolution,
      {
        ...headers,
        "User-Agent": "openscience",
      },
      signal,
      hops,
      true,
    )
  }

  const location = first.headers.get("location")
  if (first.status < 300 || first.status >= 400 || !location) return { resolution, response: first }
  first.close()
  if (hops >= MAX_REDIRECTS) throw new Error("webfetch redirect limit exceeded")

  const next = URL.canParse(location, resolution.url.toString()) ? new URL(location, resolution.url) : undefined
  if (!next) throw new Error("webfetch invalid redirect location")
  const target = await Network.resolve(next.toString(), signal)
  return follow(target, headers, signal, hops + 1)
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    const parsed = URL.canParse(params.url) ? new URL(params.url) : undefined
    if (!parsed) throw new Error(`webfetch invalid URL: ${params.url}`)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`webfetch unsupported URL scheme: ${parsed.protocol}`)
    }
    if (parsed.username || parsed.password) throw new Error("webfetch URL credentials are not allowed")
    await Network.assertAllowed(parsed.toString())

    await ctx.ask({
      permission: "webfetch",
      patterns: [safe(parsed)],
      always: ["*"],
      metadata: {
        url: safe(parsed),
        format: params.format,
        timeout: params.timeout,
      },
    })

    const timeout = Math.max(1, Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT))

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort("timeout"), timeout)

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }

    const signal = AbortSignal.any([controller.signal, ctx.abort])
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "identity",
    }

    try {
      const resolution = await Network.resolve(parsed.toString(), signal)
      const result = await follow(resolution, headers, signal, 0)
      try {
        if (result.response.status < 200 || result.response.status >= 300) {
          throw new Error(`webfetch HTTP error: ${result.response.status}`)
        }

        const content = new TextDecoder().decode(await readBody(result.response.body, signal))
        const contentType = result.response.headers.get("content-type") || ""
        const title = `${safe(result.resolution.url)} (${contentType})`

        switch (params.format) {
          case "markdown":
            return {
              output: contentType.includes("text/html") ? convertHTMLToMarkdown(content) : content,
              title,
              metadata: {},
            }
          case "text":
            return {
              output: contentType.includes("text/html") ? await extractTextFromHTML(content) : content,
              title,
              metadata: {},
            }
          case "html":
            return { output: content, title, metadata: {} }
          default:
            return { output: content, title, metadata: {} }
        }
      } finally {
        result.response.close()
      }
    } catch (error) {
      if (ctx.abort.aborted) throw new Error("webfetch aborted", { cause: error })
      if (controller.signal.aborted) throw new Error("webfetch timeout", { cause: error })
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  },
})

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
