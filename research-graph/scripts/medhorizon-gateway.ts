#!/usr/bin/env bun
/**
 * MedHorizon + Research Graph companion gateway.
 *
 * Proxies MedHorizon's web UI and injects the Research Graph sidebar-card
 * script into HTML responses. Does NOT modify MedHorizon source.
 *
 * Usage:
 *   bun research-graph/scripts/medhorizon-gateway.ts
 *
 * Env:
 *   MEDHORIZON_ORIGIN   default http://127.0.0.1:4444
 *   RESEARCH_GRAPH_API  default http://127.0.0.1:8000
 *   GATEWAY_PORT        default 5199
 */

const origin = (process.env.MEDHORIZON_ORIGIN || "http://127.0.0.1:4444").replace(/\/$/, "")
const api = (process.env.RESEARCH_GRAPH_API || "http://127.0.0.1:8000").replace(/\/$/, "")
const port = Number(process.env.GATEWAY_PORT || 5199)
const snippet = `<script src="${api}/embed/sidebar-card.js" data-rg-api="${api}" defer></script>`

function inject(html: string) {
  if (html.includes("sidebar-card.js") || html.includes("data-rg-card")) return html
  if (html.includes("</head>")) return html.replace("</head>", `${snippet}\n</head>`)
  if (html.includes("</body>")) return html.replace("</body>", `${snippet}\n</body>`)
  return html + snippet
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url)
    const target = `${origin}${url.pathname}${url.search}`
    const headers = new Headers(req.headers)
    headers.delete("host")
    headers.delete("accept-encoding")

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    })

    const type = upstream.headers.get("content-type") || ""
    const out = new Headers(upstream.headers)
    out.delete("content-encoding")
    out.delete("content-length")

    if (type.includes("text/html")) {
      const html = inject(await upstream.text())
      return new Response(html, { status: upstream.status, headers: out })
    }

    return new Response(upstream.body, { status: upstream.status, headers: out })
  },
})

console.log(`Research Graph gateway → MedHorizon ${origin}`)
console.log(`Open http://127.0.0.1:${server.port}  (injects sidebar card from ${api})`)
