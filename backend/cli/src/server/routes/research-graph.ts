import { Hono } from "hono"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { currentResearchGraphSidecar } from "../../sidecar/research-graph"
import type { CurrentEndpoint } from "../../sidecar/research-graph"

const PREFIX = "/research-graph"
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])
const PRIVATE_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "origin",
  "referer",
  "content-length",
  "forwarded",
  "via",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
])
const RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "vary",
])
const REPLAYABLE = new Set(["GET", "HEAD", "OPTIONS"])

type Source = () => CurrentEndpoint | null
type Failure = "unavailable" | "timeout"

function source(): CurrentEndpoint | null {
  return currentResearchGraphSidecar()
}

function json(c: Context, body: Record<string, string>, status: ContentfulStatusCode): Response {
  return c.json(body, status)
}

function failure(c: Context, code: Failure): Response {
  return json(c, { status: code }, code === "timeout" ? 504 : 503)
}

function path(c: Context): string | null {
  const raw = c.req.path
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded.startsWith("/") || decoded.includes("\u0000") || /%2e|%2f|%5c/i.test(decoded)) return null
  const parts = decoded.split("/")
  if (parts.some((part) => part === "." || part === "..")) return null
  return parts.map((part) => encodeURIComponent(part)).join("/").replace(/^%2F/i, "/") || "/"
}

function headers(request: Request, token: string): Headers {
  const out = new Headers()
  for (const [key, value] of request.headers) {
    const name = key.toLowerCase()
    if (HOP_HEADERS.has(name) || PRIVATE_HEADERS.has(name) || name.startsWith("access-control-")) continue
    out.set(key, value)
  }
  if (token) out.set("authorization", `Bearer ${token}`)
  return out
}

function target(endpoint: CurrentEndpoint, pathname: string, search: string): string {
  const url = new URL(endpoint.endpoint.api || endpoint.endpoint.origin)
  url.pathname = pathname
  url.search = search
  return url.href
}

function timedOut(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")
}

async function request(
  input: Request,
  endpoint: CurrentEndpoint,
  pathname: string,
  search: string,
): Promise<Response | Failure> {
  try {
    return await fetch(target(endpoint, pathname, search), {
      method: input.method,
      headers: headers(input, endpoint.mode === "managed" ? endpoint.endpoint.token : endpoint.endpoint.token),
      body: REPLAYABLE.has(input.method) ? undefined : input.body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    return timedOut(error) ? "timeout" : "unavailable"
  }
}

function redirect(value: string, endpoint: CurrentEndpoint): string | null {
  try {
    const url = new URL(value, endpoint.endpoint.origin)
    if (url.origin !== endpoint.endpoint.origin) return value
    return `${PREFIX}${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function responseHeaders(response: Response, endpoint: CurrentEndpoint): Headers {
  const out = new Headers()
  for (const [key, value] of response.headers) {
    const name = key.toLowerCase()
    if (!RESPONSE_HEADERS.has(name) || HOP_HEADERS.has(name) || name.startsWith("access-control-")) continue
    if (name === "location") {
      const location = redirect(value, endpoint)
      if (location) out.set("location", location)
      continue
    }
    out.set(key, value)
  }
  return out
}

function pass(response: Response, endpoint: CurrentEndpoint): Response {
  if (response.status === 401 || response.status === 403) {
    return Response.json({ status: "rejected" }, { status: 502 })
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response, endpoint),
  })
}

async function proxy(c: Context, get: Source): Promise<Response> {
  const pathname = path(c)
  if (!pathname) return json(c, { status: "invalid_path" }, 400)
  const first = get()
  if (!first) return failure(c, "unavailable")
  const input = c.req.raw
  const search = new URL(input.url).search
  const firstResult = await request(input, first, pathname, search)
  if (typeof firstResult === "string") {
    if (firstResult === "timeout") return failure(c, firstResult)
    const next = get()
    if (!REPLAYABLE.has(input.method) || !next || next.generation === first.generation) return failure(c, firstResult)
    const retry = await request(input, next, pathname, search)
    return typeof retry === "string" ? failure(c, retry) : pass(retry, next)
  }
  if ((firstResult.status === 401 || firstResult.status === 403) && REPLAYABLE.has(input.method)) {
    const next = get()
    if (next && next.generation !== first.generation) {
      firstResult.body?.cancel()
      const retry = await request(input, next, pathname, search)
      return typeof retry === "string" ? failure(c, retry) : pass(retry, next)
    }
  }
  return pass(firstResult, first)
}

export function ResearchGraphProxyRoutes(get: Source = source): Hono {
  return new Hono().all("/*", (c) => proxy(c, get))
}
