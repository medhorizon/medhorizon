import { NavLink, Outlet, useLocation } from "react-router-dom"
import { SidebarCard } from "./SidebarCard"

export function Shell() {
  const path = useLocation().pathname
  if (path.startsWith("/embed")) {
    return <Outlet />
  }
  return (
    <div className="app-shell">
      <aside className="nav">
        <p className="brand">Research Graph</p>
        <SidebarCard />
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/experiments">Experiments</NavLink>
        <NavLink to="/search">Search</NavLink>
        <p className="muted" style={{ marginTop: "1.5rem", fontSize: "0.8rem" }}>
          MedHorizon 侧栏卡片经接口注入 · 不改核心
        </p>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
