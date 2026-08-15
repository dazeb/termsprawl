import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
import { StickyNode } from '../nodes/StickyNode'
import { GroupNode } from '../nodes/GroupNode'
import { DiffNode } from '../nodes/DiffNode'
import {
  createDiffNode,
  createGroup,
  createStickyNode,
  createTerminalNode,
  removeNode,
  serializeNodes,
  deserializeNodes,
  ungroup
} from '../state/workspace'
import { useHistory } from '../state/history'
import { useProjects } from '../state/projects'
import type { SprawlNodeData } from '../state/workspace'

const nodeTypes = { terminal: TerminalNode, sticky: StickyNode, group: GroupNode, diff: DiffNode }

// Canvas context: lets custom nodes update their own data and record undo
// snapshots without polluting serialized node data with callbacks.
interface CanvasApi {
  updateNodeData(id: string, patch: Partial<SprawlNodeData>, record?: boolean): void
  commit(): void
  /** Remove a node; groups ungroup their children instead of deleting them. */
  closeNode(id: string): void
}
const CanvasContext = createContext<CanvasApi | null>(null)

export function useCanvas(): CanvasApi {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('useCanvas must be used inside Canvas')
  return ctx
}

interface CanvasProps {
  cwd?: string
}

export function Canvas({ cwd }: CanvasProps): React.JSX.Element {
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const nodeCache = useProjects((s) => s.nodeCache)
  const saveNodes = useProjects((s) => s.saveNodes)

  const [nodes, setNodes] = useState<Node<SprawlNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
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
    (changes: NodeChange[]) =>
      setNodes((nds) => {
        const removes = changes.filter((c): c is NodeChange & { id: string; type: 'remove' } => c.type === 'remove')
        if (removes.length === 0) return applyNodeChanges(changes, nds)

        // Intercept group deletion: React Flow cascades removal to children
        // (parentId). We ungroup them instead — terminals inside keep their
        // tmux sessions. Only groups and explicitly-selected nodes are removed.
        const removedIds = new Set(removes.map((c) => c.id))
        const groupIds = removes
          .map((c) => c.id)
          .filter((id) => nds.find((n) => n.id === id)?.type === 'group')
        if (groupIds.length === 0) return applyNodeChanges(changes, nds)

        let result = nds
        for (const gid of groupIds) result = ungroup(gid, result)
        const toRemove = new Set(
          [...removedIds].filter((id) => groupIds.includes(id) || selectedIds.includes(id))
        )
        return result.filter((n) => !toRemove.has(n.id))
      }),
    [selectedIds]
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

  // Custom-node updates (sticky/editor/diff): patch node data, optionally
  // record a history snapshot (e.g. collapse toggles, blur commits).
  const updateNodeData = useCallback(
    (id: string, patch: Partial<SprawlNodeData>, record = false) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } as SprawlNodeData } : n))
      )
      if (record) push()
    },
    [push]
  )
  const commit = useCallback(() => push(), [push])
  const closeNode = useCallback(
    (id: string) => {
      setNodes((nds) => removeNode(nds, id))
      push()
    },
    [push]
  )
  const canvasApi = useMemo(
    () => ({ updateNodeData, commit, closeNode }),
    [updateNodeData, commit, closeNode]
  )

  const addTerminal = useCallback(() => {
    try {
      const node = createTerminalNode(cwd)
      if (menu && wrapperRef.current) {
        node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
      }
      console.log('[canvas] addTerminal', node.id)
      setNodes((nds) => [...nds, node])
      push()
      setMenu(null)
    } catch (err) {
      console.error('[canvas] addTerminal failed:', err)
      throw err
    }
  }, [cwd, menu, push, screenToFlowPosition])

  const addSticky = useCallback(() => {
    const node = createStickyNode()
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    setNodes((nds) => [...nds, node])
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition])

  const addDiff = useCallback(() => {
    const node = createDiffNode()
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    setNodes((nds) => [...nds, node])
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition])

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  const onPaneClick = useCallback(() => setMenu(null), [])
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedIds(sel.map((n) => n.id))
  }, [])

  // Group the current selection (plus the right-clicked node) under a frame.
  const groupSelection = useCallback(() => {
    const ids = new Set(selectedIds)
    if (menu?.nodeId) ids.add(menu.nodeId)
    const targets = nodes.filter(
      (n) => ids.has(n.id) && n.type !== 'group' && !n.parentId
    )
    if (targets.length < 2) return

    // Frame origin: top-left of the union bounds, padded so the label fits.
    const minX = Math.min(...targets.map((n) => n.position.x))
    const minY = Math.min(...targets.map((n) => n.position.y))
    const pad = 24
    const origin = { x: minX - pad, y: minY - pad }

    const { group, children } = createGroup(targets, origin)
    const targetIds = new Set(targets.map((n) => n.id))
    setNodes((nds) => [...nds.filter((n) => !targetIds.has(n.id)), group, ...children])
    push()
    setMenu(null)
  }, [selectedIds, menu, nodes, push])

  // Ungroup the right-clicked group: children keep their absolute positions.
  const ungroupGroup = useCallback(() => {
    if (!menu?.nodeId) return
    setNodes((nds) => ungroup(menu.nodeId as string, nds))
    push()
    setMenu(null)
  }, [menu, push])

  const closeMenuNode = useCallback(() => {
    if (!menu?.nodeId) return
    closeNode(menu.nodeId)
    setMenu(null)
  }, [menu, closeNode])

  // Deleting a group ungroups its children instead of destroying them —
  // terminals inside keep their tmux sessions. Intercepted in onNodesChange
  // (React Flow v11's onNodesDelete can't veto the cascade removal).

  const menuNode = menu?.nodeId ? nodes.find((n) => n.id === menu.nodeId) : undefined
  const menuIsGroup = menuNode?.type === 'group'
  const canGroup = menuNode !== undefined && menuNode.type !== 'group'

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
    <CanvasContext.Provider value={canvasApi}>
      <div className="canvas" ref={wrapperRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypesMemo}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
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
          {menuIsGroup ? (
            <button onClick={ungroupGroup}>Ungroup</button>
          ) : (
            canGroup && <button onClick={groupSelection}>Group selection</button>
          )}
          {menu?.nodeId && <button onClick={closeMenuNode}>Close</button>}
          <button onClick={addTerminal}>New terminal</button>
          <button onClick={addSticky}>New sticky note</button>
          <button onClick={addDiff}>New diff</button>
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
    </CanvasContext.Provider>
  )
}
