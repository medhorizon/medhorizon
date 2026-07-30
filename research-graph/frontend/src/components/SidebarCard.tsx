import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { api } from "../lib/api"

type Card = {
  title: string
  subtitle: string
  mode: string
  metrics: { graphs: number; experiments: number; gepa_awaiting_gate: number }
  latest_graph: { id: string; title: string } | null
  cta: { label: string; href: string }
}

const empty: Card = {
  title: "Research Graph",
  subtitle: "图谱 · 实验 · GEPA",
  mode: "…",
  metrics: { graphs: 0, experiments: 0, gepa_awaiting_gate: 0 },
  latest_graph: null,
  cta: { label: "打开研究图谱", href: "/" },
}

export function SidebarCard(props: { compact?: boolean }) {
  const [card, setCard] = useState<Card>(empty)

  useEffect(() => {
    let alive = true
    const load = () =>
      api.sidebarCard().then((data) => {
        if (alive) setCard(data)
      }).catch(() => {
        if (alive) setCard({ ...empty, mode: "offline", subtitle: "侧车未连接" })
      })
    load()
    const timer = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  return (
    <aside className={`rg-sidebar-card${props.compact ? " compact" : ""}`} data-featured="true">
      <div className="rg-sidebar-card-head">
        <span className="rg-sidebar-kicker">突出模块</span>
        <span className="badge">{card.mode}</span>
      </div>
      <h2 className="rg-sidebar-title">{card.title}</h2>
      <p className="muted rg-sidebar-sub">{card.subtitle}</p>
      <div className="rg-sidebar-metrics">
        <div>
          <strong>{card.metrics.graphs}</strong>
          <span>图谱</span>
        </div>
        <div>
          <strong>{card.metrics.experiments}</strong>
          <span>实验</span>
        </div>
        <div>
          <strong>{card.metrics.gepa_awaiting_gate}</strong>
          <span>待门控</span>
        </div>
      </div>
      {card.latest_graph ? (
        <Link className="rg-sidebar-latest" to={`/graphs/${card.latest_graph.id}`}>
          最近：{card.latest_graph.title}
        </Link>
      ) : (
        <p className="muted rg-sidebar-latest">尚未创建图谱</p>
      )}
      <Link className="rg-sidebar-cta" to="/">
        {card.cta.label}
      </Link>
    </aside>
  )
}
