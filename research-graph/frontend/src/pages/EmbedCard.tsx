import { SidebarCard } from "../components/SidebarCard"

/** Minimal iframe surface for MedHorizon embeds (`/embed/card`). */
export function EmbedCard() {
  return (
    <div className="embed-card-page">
      <SidebarCard compact />
    </div>
  )
}
