interface ImportMetaEnv {
  readonly VITE_OPENSCIENCE_SERVER_HOST: string
  readonly VITE_OPENSCIENCE_SERVER_PORT: string
  readonly VITE_OPENSCIENCE_SERVER?: string
  /** Research Graph UI origin (iframe). Default http://127.0.0.1:8000 */
  readonly VITE_RESEARCH_GRAPH_UI?: string
  /** Research Graph API origin (health/bind/list). Default http://127.0.0.1:8000 */
  readonly VITE_RESEARCH_GRAPH_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __OPENSCIENCE_BASE_URL__?: string
}
