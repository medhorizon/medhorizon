import type { JSX } from "solid-js"

/** Navigation and control typography, bridged to the @synsci/ui theme. */
export const FONT_UI = "var(--font-ui)"
/** Long-form content typography, bridged to the @synsci/ui theme. */
export const FONT_CONTENT = "var(--font-content)"
/** Code, paths, and numeric readouts, bridged to the @synsci/ui mono theme. */
export const FONT_CODE = "var(--font-code)"

/** @deprecated Use FONT_UI. */
export const FONT_SANS = FONT_UI
/** @deprecated Use FONT_CONTENT. */
export const FONT_SERIF = FONT_CONTENT
/** @deprecated Use FONT_CODE for code-shaped text; retained for compatibility. */
export const FONT_MONO = FONT_UI
/** @deprecated Use FONT_UI. */
export const FONT_UI_SANS = FONT_UI

export const RADIUS_CONTROL = "var(--radius-control)"
export const RADIUS_CARD = "var(--radius-card)"
export const RADIUS_MODAL = "var(--radius-modal)"
/** @deprecated Use RADIUS_CONTROL. */
export const RADIUS = RADIUS_CONTROL

export const MOTION_FAST = "var(--motion-fast)"
export const MOTION_NORMAL = "var(--motion-normal)"
export const MOTION_EASE = "var(--motion-ease)"
export const FOCUS_RING = "var(--focus-ring)"

export const Z = {
  header: 20,
  sticky: 50,
  fab: 100,
  overlay: 200,
  modal: 300,
  toast: 400,
} as const

export const ICON_SIZE = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 16,
} as const

/** The one uppercase "eyebrow" label spec — mirror of .atlas-section-label. */
export const sectionTitle: JSX.CSSProperties = {
  "font-family": FONT_UI,
  "font-size": "10px",
  "font-weight": 400,
  "letter-spacing": "0.08em",
  "text-transform": "uppercase",
  color: "var(--color-text-faint)",
}

export const cardStyle: JSX.CSSProperties = {
  background: "var(--color-surface-solid)",
  border: "1px solid var(--color-border)",
  "border-radius": RADIUS_CONTROL,
  padding: "12px 16px",
}

export const monoText = (size: number, color: string = "var(--color-text)"): JSX.CSSProperties => ({
  "font-family": FONT_CODE,
  "font-size": `${size}px`,
  color,
})

export const sansText = (size: number, color: string = "var(--color-text)"): JSX.CSSProperties => ({
  "font-family": FONT_UI,
  "font-size": `${size}px`,
  color,
})
