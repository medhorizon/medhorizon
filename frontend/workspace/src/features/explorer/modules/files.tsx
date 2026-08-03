import type { Component } from "solid-js"
import type { ExplorerModule, ExplorerScope } from "../contract"
import { FileExplorer } from "@/atlas/FileExplorer"

/**
 * Files compatibility adapter — the single allowed reference to the legacy
 * host FileExplorer. It only mounts the existing component unchanged and does
 * not copy its implementation. The Session page currently passes FileExplorer
 * no props, so the adapter passes none through.
 */
const FilesComponent: Component<ExplorerScope> = () => <FileExplorer />

export const filesModule: ExplorerModule = {
  id: "files",
  label: "Files",
  component: FilesComponent,
}
