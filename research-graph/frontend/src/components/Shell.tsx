import { NavLink, Outlet } from "react-router-dom"

export function Shell() {
  return (
    <div className="app-shell">
      <aside className="nav">
        <p className="brand">Research Graph</p>
        <NavLink to="/" end>
          Dashboard
        </NavLink>
        <NavLink to="/experiments">Experiments</NavLink>
        <NavLink to="/search">Search</NavLink>
        <p className="muted" style={{ marginTop: "1.5rem", fontSize: "0.8rem" }}>
          Independent module UI · opens at localhost:5173
        </p>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
