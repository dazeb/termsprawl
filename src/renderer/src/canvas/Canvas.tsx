import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from 'reactflow'
import { TerminalNode } from '../nodes/TerminalNode'
import { createTerminalNode, serializeNodes, deserializeNodes } from '../state/workspace'
import { useHistory } from '../state/history'
import { useProjects } from '../state/projects'
import type { SprawlNodeData } from '../state/workspace'

const nodeTypes = { terminal: TerminalNode }

interface CanvasProps {
  cwd?: string
}

export function Canvas({ cwd }: CanvasProps): React.JSX.Element {
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const nodeCache = useProjects((s) => s.nodeCache)
  const saveNodes = useProjects((s) => s.saveNodes)

  const [nodes, setNodes] = useState<Node<SprawlNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const loadingRef = useRef(false)

  // Load the active project's serialized nodes into React Flow.
  // keyed on activeProjectId — switching projects swaps the canvas.
  useEffect(() => {
    loadingRef.current = true
    const serialized = activeProjectId ? nodeCache[activeProjectId] ?? [] : []
    const initial = deserializeNodes(serialized)
    setNodes(initial.length > 0 ? initial : [createTerminalNode(cwd)])
    setEdges([])
    // let React Flow settle before clearing the loading flag
    setTimeout(() => {
      loadingRef.current = false
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    []
  )

  // Undo/redo: debounced snapshots of the nodes array.
  const { push, undo, redo, canUndo, canRedo } = useHistory(nodes, setNodes)

  const addTerminal = useCallback(() => {
    const node = createTerminalNode(cwd)
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    setNodes((nds) => [...nds, node])
    push()
    setMenu(null)
  }, [cwd, menu, push, screenToFlowPosition])

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const onPaneClick = useCallback(() => setMenu(null), [])

  // Persist the active project's nodes (debounced) as the canvas settles.
  useEffect(() => {
    if (loadingRef.current) return
    if (!activeProjectId) return
    const timer = setTimeout(() => {
      void saveNodes(serializeNodes(nodes))
    }, 600)
    return () => clearTimeout(timer)
  }, [nodes, activeProjectId, saveNodes])

  // Ctrl+Z / Ctrl+Shift+Z undo/redo — skip while typing in inputs/terminals.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const nodeTypesMemo = useMemo(() => nodeTypes, [])

  return (
    <div className="canvas" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMemo}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={onPaneClick}
        panOnScroll
        zoomOnScroll={false}
        selectionOnDrag
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} color="#2a2a28" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#3a3a38" maskColor="rgba(10,10,10,0.7)" />
      </ReactFlow>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={addTerminal}>New terminal</button>
        </div>
      )}

      <div className="history-bar">
        <button disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          ↩
        </button>
        <button disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          ↪
        </button>
      </div>
    </div>
  )
}
