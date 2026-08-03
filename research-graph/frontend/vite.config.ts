import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone" || process.env.VITE_RESEARCH_GRAPH_MODE === "standalone"
  const base = standalone ? "/" : "/research-graph/"
  const target = process.env.VITE_RESEARCH_GRAPH_DEV_API?.trim() || "http://127.0.0.1:8000"
  const proxy = standalone
    ? {
        "/api": target,
        "/health": target,
        "/integration": target,
        "/embed/sidebar-card.js": target,
        "/embed/sidebar-card.css": target,
        "/embed/bookmarklet": target,
      }
    : {
        "/research-graph": {
          target,
          rewrite(path: string) {
            return path.replace(/^\/research-graph/, "") || "/"
          },
        },
      }

  return {
    base,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy,
    },
  }
})
