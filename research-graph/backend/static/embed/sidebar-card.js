/* Research Graph — inject into MedHorizon session sidebar without core edits.
 * Loaded by gateway rewrite or bookmarklet.
 */
;(function () {
  if (window.__RG_SIDEBAR_CARD__) return
  window.__RG_SIDEBAR_CARD__ = true

  const script = document.currentScript
  const api = (script && script.dataset && script.dataset.rgApi) || window.__RG_API__ || "http://127.0.0.1:8000"
  const cssHref = api.replace(/\/$/, "") + "/embed/sidebar-card.css"
  const cardHref = api.replace(/\/$/, "") + "/integration/sidebar-card"

  function ensureCss() {
    if (document.getElementById("rg-sidebar-card-css")) return
    const link = document.createElement("link")
    link.id = "rg-sidebar-card-css"
    link.rel = "stylesheet"
    link.href = cssHref
    document.head.appendChild(link)
  }

  function mount(host, data) {
    const existing = host.querySelector("#rg-featured-card")
    if (existing) existing.remove()

    const card = document.createElement("aside")
    card.id = "rg-featured-card"
    card.className = "rg-featured-card"
    card.setAttribute("data-rg-card", "1")
    card.setAttribute("role", "complementary")
    card.setAttribute("aria-label", "Research Graph")

    const metrics = data.metrics || {}
    const latest = data.latest_graph
    const cta = (data.cta && data.cta.href) || "http://127.0.0.1:5173"

    card.innerHTML =
      '<div class="rg-card-glow"></div>' +
      '<div class="rg-card-head">' +
      '<span class="rg-card-kicker">MedHorizon 模块</span>' +
      '<span class="rg-card-badge">' +
      (data.mode || "local") +
      "</span></div>" +
      '<h3 class="rg-card-title">' +
      (data.title || "Research Graph") +
      "</h3>" +
      '<p class="rg-card-sub">' +
      (data.subtitle || "") +
      "</p>" +
      '<div class="rg-card-metrics">' +
      "<div><strong>" +
      (metrics.graphs ?? 0) +
      "</strong><span>图谱</span></div>" +
      "<div><strong>" +
      (metrics.experiments ?? 0) +
      "</strong><span>实验</span></div>" +
      "<div><strong>" +
      (metrics.gepa_awaiting_gate ?? 0) +
      "</strong><span>待门控</span></div>" +
      "</div>" +
      (latest
        ? '<p class="rg-card-latest">最近：' + escapeHtml(latest.title) + "</p>"
        : '<p class="rg-card-latest muted">尚未创建图谱</p>') +
      '<a class="rg-card-cta" href="' +
      cta +
      '" target="_blank" rel="noopener noreferrer">' +
      ((data.cta && data.cta.label) || "打开研究图谱") +
      "</a>"

    const pad = host.firstElementChild
    if (pad) host.insertBefore(card, pad)
    else host.appendChild(card)
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  function findSidebar() {
    return (
      document.querySelector(".session-sidebar") ||
      document.querySelector('aside[class*="session-sidebar"]') ||
      document.querySelector('[class*="session-sidebar"]')
    )
  }

  async function refresh(host) {
    let data
    try {
      const res = await fetch(cardHref, {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer local-dev",
        },
        credentials: "omit",
      })
      data = res.ok
        ? await res.json()
        : {
            title: "Research Graph",
            subtitle: "API " + res.status,
            mode: "offline",
            metrics: { graphs: 0, experiments: 0, gepa_awaiting_gate: 0 },
            cta: { label: "打开研究图谱", href: "http://127.0.0.1:5173" },
          }
    } catch (err) {
      data = {
        title: "Research Graph",
        subtitle: "侧车未启动",
        mode: "offline",
        metrics: { graphs: 0, experiments: 0, gepa_awaiting_gate: 0 },
        cta: { label: "打开研究图谱", href: "http://127.0.0.1:5173" },
      }
    }
    mount(host, data)
  }

  function boot() {
    ensureCss()
    const host = findSidebar()
    if (!host) return false
    refresh(host)
    return true
  }

  function watch() {
    if (boot()) return
    const obs = new MutationObserver(function () {
      if (boot()) obs.disconnect()
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(function () {
      obs.disconnect()
      if (!document.getElementById("rg-featured-card")) {
        const dock = document.createElement("div")
        dock.id = "rg-featured-card-dock"
        dock.className = "rg-featured-dock"
        document.body.appendChild(dock)
        refresh(dock)
      }
    }, 8000)
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch)
  } else {
    watch()
  }

  setInterval(function () {
    const host = findSidebar() || document.getElementById("rg-featured-card-dock")
    if (host) refresh(host)
  }, 30000)
})()
