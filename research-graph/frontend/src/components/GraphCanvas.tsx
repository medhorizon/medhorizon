import { useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  useEdgesState,
  useNodesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { Edge, Node } from "../lib/api"

const KIND_COLOR: Record<string, string> = {
  hypothesis: "#c4a35a",
  evidence: "#3d9b6e",
  literature: "#7eb6ff",
  experiment: "#b07cc6",
  note: "#9aa89f",
  insight: "#e0a070",
  conclusion: "#d06b6b",
}

function isStageNode(node: Node) {
  return Boolean(node.meta?.medhorizon_stage?.session_id)
}

type Menu = { x: number; y: number; node: Node }

export function GraphCanvas(props: {
  nodes: Node[]
  edges: Edge[]
  onSelect?: (node: Node | null) => void
  onOpenSession?: (node: Node) => void
  onBranch?: (node: Node) => void
}) {
  const [menu, setMenu] = useState<Menu | null>(null)

  const initialNodes: FlowNode[] = useMemo(
    () =>
      props.nodes.map((n, i) => {
        const stage = isStageNode(n)
        return {
          id: n.id,
          position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 140 },
          data: { label: `${n.kind}: ${n.title}` },
          style: {
            border: `1px solid ${KIND_COLOR[n.kind] ?? "#6a736e"}`,
            background: stage ? "#1c2a24" : "#18201c",
            color: "#e8efe9",
            borderRadius: 8,
            padding: 8,
            fontSize: 12,
            width: 180,
            boxShadow: stage ? "inset 0 0 0 1px #3d9b6e66" : undefined,
            opacity: n.lifecycle === "archived" ? 0.45 : 1,
            cursor: stage ? "pointer" : "default",
          },
        }
      }),
    [props.nodes],
  )

  const initialEdges: FlowEdge[] = useMemo(
    () =>
      props.edges.map((e) => ({
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        label: e.relation,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#4a6354" },
      })),
    [props.edges],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [])

  return (
    <div className="canvas-wrap" onContextMenu={(e) => e.preventDefault()}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        onNodeClick={(_, node) => {
          setMenu(null)
          const found = props.nodes.find((n) => n.id === node.id) ?? null
          props.onSelect?.(found)
        }}
        onNodeDoubleClick={(_, node) => {
          const found = props.nodes.find((n) => n.id === node.id)
          if (found && isStageNode(found)) props.onOpenSession?.(found)
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          const found = props.nodes.find((n) => n.id === node.id)
          if (!found) return
          props.onSelect?.(found)
          if (!isStageNode(found)) {
            setMenu(null)
            return
          }
          setMenu({ x: event.clientX, y: event.clientY, node: found })
        }}
        onPaneClick={() => {
          setMenu(null)
          props.onSelect?.(null)
        }}
      >
        <Background color="#2a3830" gap={18} />
        <MiniMap nodeStrokeColor="#3d9b6e" maskColor="rgb(10,14,12,0.7)" />
        <Controls />
      </ReactFlow>
      {menu ? (
        <div className="rg-context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(null)
              props.onOpenSession?.(menu.node)
            }}
          >
            打开 MedHorizon 对话
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(null)
              props.onBranch?.(menu.node)
            }}
          >
            在此开分支
          </button>
        </div>
      ) : null}
    </div>
  )
}
