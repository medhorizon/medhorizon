import { Hono } from "hono"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
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

const ErrorBody = z.object({
  status: z.string(),
  code: z.string().optional(),
  message: z.string().optional(),
})
const ResolveQuery = z.object({ sessionId: z.string().min(1).max(256) })
const BindInput = z.object({
  sessionId: z.string().min(1).max(256),
  graphId: z.string().min(1).max(256),
  directory: z.string().max(4096).nullable().optional(),
  messageId: z.string().max(256).optional(),
  reason: z.string().max(512).optional(),
})
const GraphSummary = z.object({ id: z.string(), title: z.string(), updatedAt: z.string() })
const ResolveOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("bound"), graph: GraphSummary, embedPath: z.string() }),
  z.object({ status: z.literal("not_bound") }),
])
const BindOutput = z.object({
  sessionId: z.string(),
  graphId: z.string(),
  directory: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const UpstreamResolve = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("bound"),
    graph: z.object({ id: z.string(), title: z.string(), updated_at: z.string() }),
    binding_updated_at: z.string(),
  }),
  z.object({ status: z.literal("not_bound") }),
])

type ControlFailure = Failure | "rejected" | "incompatible" | "integrity" | "upstream_error"

function source(): CurrentEndpoint | null {
  return currentResearchGraphSidecar()
}

function json(c: Context, body: Record<string, string>, status: ContentfulStatusCode): Response {
  return c.json(body, status)
}

function failure(c: Context, code: Failure): Response {
  return json(c, { status: code }, code === "timeout" ? 504 : 503)
}

function controlFailure(c: Context, code: ControlFailure, status: ContentfulStatusCode, message?: string): Response {
  return c.json({ status: code, code: `research_graph_${code}`, ...(message ? { message } : {}) }, status)
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

async function controlRequest(
  endpoint: CurrentEndpoint,
  pathname: string,
  search: string,
  method: "GET" | "POST",
  body?: string,
): Promise<Response | Failure> {
  const requestHeaders = new Headers({ accept: "application/json" })
  if (body !== undefined) requestHeaders.set("content-type", "application/json")
  if (endpoint.endpoint.token) requestHeaders.set("authorization", `Bearer ${endpoint.endpoint.token}`)
  try {
    return await fetch(target(endpoint, pathname, search), {
      method,
      headers: requestHeaders,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    })
  } catch (error) {
    return timedOut(error) ? "timeout" : "unavailable"
  }
}

async function upstreamBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function controlResponse(c: Context, response: Response): Promise<Response | unknown> {
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    return controlFailure(c, "rejected", 502)
  }
  const body = await upstreamBody(response)
  if (!response.ok) {
    const detail = z
      .object({ detail: z.object({ code: z.string(), message: z.string().optional() }).optional() })
      .safeParse(body)
    if (response.status === 409 && detail.success && detail.data.detail?.code === "binding_integrity") {
      return controlFailure(c, "integrity", 409, detail.data.detail.message)
    }
    return controlFailure(c, "upstream_error", 502)
  }
  return body
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

export function ResearchGraphControlRoutes(get: Source = source): Hono {
  return new Hono()
    .get(
      "/resolve",
      describeRoute({
        summary: "Resolve a session's Research Graph binding",
        description: "Return the authoritative graph binding for a session without title matching or graph scans.",
        operationId: "researchGraph.session.resolve",
        responses: {
          200: { description: "Resolved binding", content: { "application/json": { schema: resolver(ResolveOutput) } } },
          400: { description: "Invalid session id", content: { "application/json": { schema: resolver(ErrorBody) } } },
          409: { description: "Binding integrity failure", content: { "application/json": { schema: resolver(ErrorBody) } } },
          502: { description: "Research Graph rejected or failed", content: { "application/json": { schema: resolver(ErrorBody) } } },
          503: { description: "Research Graph unavailable", content: { "application/json": { schema: resolver(ErrorBody) } } },
          504: { description: "Research Graph timed out", content: { "application/json": { schema: resolver(ErrorBody) } } },
        },
      }),
      validator("query", ResolveQuery),
      async (c) => {
        const endpoint = get()
        if (!endpoint) return controlFailure(c, "unavailable", 503)
        const sessionId = c.req.valid("query").sessionId
        const result = await controlRequest(
          endpoint,
          "/api/sessions/resolve",
          `?session_id=${encodeURIComponent(sessionId)}`,
          "GET",
        )
        if (typeof result === "string") return controlFailure(c, result, result === "timeout" ? 504 : 503)
        const body = await controlResponse(c, result)
        if (body instanceof Response) return body
        const parsed = UpstreamResolve.safeParse(body)
        if (!parsed.success) return controlFailure(c, "incompatible", 502)
        if (parsed.data.status === "not_bound") return c.json(parsed.data)
        return c.json({
          status: "bound",
          graph: {
            id: parsed.data.graph.id,
            title: parsed.data.graph.title,
            updatedAt: parsed.data.graph.updated_at,
          },
          embedPath: `${PREFIX}/embed/graph/${encodeURIComponent(parsed.data.graph.id)}`,
        })
      },
    )
    .post(
      "/bind",
      describeRoute({
        summary: "Bind a session to a Research Graph",
        description: "Create or update the authoritative session-to-graph binding.",
        operationId: "researchGraph.session.bind",
        responses: {
          200: { description: "Binding saved", content: { "application/json": { schema: resolver(BindOutput) } } },
          400: { description: "Invalid binding", content: { "application/json": { schema: resolver(ErrorBody) } } },
          502: { description: "Research Graph rejected or failed", content: { "application/json": { schema: resolver(ErrorBody) } } },
          503: { description: "Research Graph unavailable", content: { "application/json": { schema: resolver(ErrorBody) } } },
          504: { description: "Research Graph timed out", content: { "application/json": { schema: resolver(ErrorBody) } } },
        },
      }),
      validator("json", BindInput),
      async (c) => {
        const endpoint = get()
        if (!endpoint) return controlFailure(c, "unavailable", 503)
        const input = c.req.valid("json")
        const result = await controlRequest(
          endpoint,
          "/api/sessions/bind",
          "",
          "POST",
          JSON.stringify({
            session_id: input.sessionId,
            graph_id: input.graphId,
            directory: input.directory,
            message_id: input.messageId,
            reason: input.reason,
          }),
        )
        if (typeof result === "string") return controlFailure(c, result, result === "timeout" ? 504 : 503)
        const body = await controlResponse(c, result)
        if (body instanceof Response) return body
        const parsed = z
          .object({
            session_id: z.string(),
            graph_id: z.string(),
            directory: z.string().nullable(),
            created_at: z.string(),
            updated_at: z.string(),
          })
          .safeParse(body)
        if (!parsed.success) return controlFailure(c, "incompatible", 502)
        return c.json({
          sessionId: parsed.data.session_id,
          graphId: parsed.data.graph_id,
          directory: parsed.data.directory,
          createdAt: parsed.data.created_at,
          updatedAt: parsed.data.updated_at,
        })
      },
    )
    .all("/*", (c) => c.notFound())
}
