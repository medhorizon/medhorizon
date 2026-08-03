import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Shell } from "./components/Shell"
import { Dashboard } from "./pages/Dashboard"
import { ExperimentView } from "./pages/ExperimentView"
import { Experiments } from "./pages/Experiments"
import { GepaRun } from "./pages/GepaRun"
import { GraphView } from "./pages/GraphView"
import { EmbedCard } from "./pages/EmbedCard"
import { Search } from "./pages/Search"
import "./styles/app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || undefined}>
      <Routes>
        <Route path="embed/card" element={<EmbedCard />} />
        {/* Chromeless graph canvas for MedHorizon right-pane iframe */}
        <Route path="embed/graph/:id" element={<GraphView />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="graphs/:id" element={<GraphView />} />
          <Route path="experiments" element={<Experiments />} />
          <Route path="experiments/:id" element={<ExperimentView />} />
          <Route path="gepa/:id" element={<GepaRun />} />
          <Route path="search" element={<Search />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
