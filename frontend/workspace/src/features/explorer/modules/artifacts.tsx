import type { Component } from "solid-js"
import type { ExplorerModule, ExplorerScope } from "../contract"
import { SessionArtifacts } from "../SessionArtifacts"

/**
 * Session Artifacts module — the second Explorer surface. It consumes ONLY the
 * generated SDK (session.artifacts.list / session.artifact.preview) plus the
 * typed relative downloadPath; it never touches Atlas APIs, Atlas flags, or
 * Research Graph. List/selection/preview state lives inside SessionArtifacts.
 */
const ArtifactsComponent: Component<ExplorerScope> = (props) => <SessionArtifacts sessionID={props.sessionID} />

export const artifactsModule: ExplorerModule = {
  id: "session-artifacts",
  label: "Session Artifacts",
  component: ArtifactsComponent,
}
