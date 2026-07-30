import { useEffect, useMemo } from "react"
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

export function GraphCanvas(props: {
  nodes: Node[]
  edges: Edge[]
  onSelect?: (node: Node | null) => void
}) {
  const initialNodes: FlowNode[] = useMemo(
    () =>
      props.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 140 },
        data: { label: `${n.kind}: ${n.title}` },
        style: {
          border: `1px solid ${KIND_COLOR[n.kind] ?? "#6a736e"}`,
          background: "#18201c",
          color: "#e8efe9",
          borderRadius: 8,
          padding: 8,
          fontSize: 12,
          width: 180,
          opacity: n.lifecycle === "archived" ? 0.45 : 1,
        },
      })),
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

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        onNodeClick={(_, node) => {
          const found = props.nodes.find((n) => n.id === node.id) ?? null
          props.onSelect?.(found)
        }}
        onPaneClick={() => props.onSelect?.(null)}
      >
        <Background color="#2a3830" gap={18} />
        <MiniMap nodeStrokeColor="#3d9b6e" maskColor="rgb(10,14,12,0.7)" />
        <Controls />
      </ReactFlow>
    </div>
  )
}
