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
import { EditorNode } from '../nodes/EditorNode'
import {
  createAgentNode,
  createDiffNode,
  createDrukNode,
  createEditorNode,
  createGroup,
  createResumeAgentNode,
  createStickyNode,
  createTerminalNode,
  removeNode,
  serializeNodes,
  deserializeNodes,
  topZ,
  ungroup
} from '../state/workspace'
import { agentIds, agentName, agentTitle } from '@shared/agents/config'
import type { AgentId } from '@shared/agents/config'
import { useHistory } from '../state/history'
import { useProjects } from '../state/projects'
import type { SprawlNodeData } from '../state/workspace'

const nodeTypes = {
  terminal: TerminalNode,
  sticky: StickyNode,
  group: GroupNode,
  diff: DiffNode,
  editor: EditorNode
}

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
  const saveProjectNodes = useProjects((s) => s.saveProjectNodes)
  const dropCachedNode = useProjects((s) => s.dropCachedNode)

  const [nodes, setNodes] = useState<Node<SprawlNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()
  const loadingRef = useRef(false)
  const latestNodesRef = useRef(nodes)
  latestNodesRef.current = nodes

  // Load the active project's serialized nodes into React Flow.
  // keyed on activeProjectId — switching projects swaps the canvas.
  useEffect(() => {
    loadingRef.current = true
    const serialized = activeProjectId ? nodeCache[activeProjectId] ?? [] : []
    const initial = deserializeNodes(serialized)
    setNodes(activeProjectId ? (initial.length > 0 ? initial : [createTerminalNode(cwd)]) : [])
    setEdges([])
    // let React Flow settle before clearing the loading flag
    setTimeout(() => {
      loadingRef.current = false
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  // Undo/redo: debounced snapshots of the nodes array. Permanent terminal
  // closes invalidate that id in every snapshot so undo cannot revive it.
  const { push, undo, redo, invalidate, canUndo, canRedo } = useHistory(nodes, setNodes)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removes = changes.filter(
        (change): change is NodeChange & { id: string; type: 'remove' } => change.type === 'remove'
      )
      const permanentRemovalIds = (source: Node<SprawlNodeData>[]): Set<string> => {
        const removedIds = new Set(removes.map((change) => change.id))
        const groupIds = removes
          .map((change) => change.id)
          .filter((id) => source.find((node) => node.id === id)?.type === 'group')
        return groupIds.length === 0
          ? removedIds
          : new Set([...removedIds].filter((id) => groupIds.includes(id) || selectedIds.includes(id)))
      }
      const applyChanges = (
        source: Node<SprawlNodeData>[],
        successfulTerminalIds?: Set<string>
      ): Node<SprawlNodeData>[] => {
        if (removes.length === 0) return applyNodeChanges(changes, source)
        const allowedRemovalIds = permanentRemovalIds(source)
        const effectiveChanges = changes.filter((change) => {
          if (change.type !== 'remove') return true
          const node = source.find((item) => item.id === change.id)
          return node?.type !== 'terminal' || successfulTerminalIds?.has(change.id) === true
        })
        const effectiveRemoves = effectiveChanges.filter(
          (change): change is NodeChange & { id: string; type: 'remove' } => change.type === 'remove'
        )
        const groupIds = removes
          .map((change) => change.id)
          .filter((id) => source.find((node) => node.id === id)?.type === 'group')
        if (groupIds.length === 0) return applyNodeChanges(effectiveChanges, source)
        let result = source
        for (const groupId of groupIds) result = ungroup(groupId, result)
        const toRemove = new Set(
          effectiveRemoves.map((change) => change.id).filter((id) => allowedRemovalIds.has(id))
        )
        return result.filter((node) => !toRemove.has(node.id))
      }

      const terminalIds = [...permanentRemovalIds(nodes)].filter(
        (id) => nodes.find((node) => node.id === id)?.type === 'terminal'
      )
      if (terminalIds.length === 0) {
        setNodes((current) => applyChanges(current))
        return
      }

      const originProjectId = activeProjectId
      setCleanupError(null)
      if (!originProjectId) return
      void Promise.allSettled(
        terminalIds.map((id) => window.termsprawl.pty.closeNode(originProjectId, id))
      )
        .then((results) => {
          const committed = new Set(
            terminalIds.filter((_id, index) => results[index].status === 'fulfilled')
          )
          const failed = terminalIds.filter((_id, index) => results[index].status === 'rejected')
          const cleanupPending = results.flatMap((result) =>
            result.status === 'fulfilled' ? result.value.cleanupPendingIds : []
          )
          invalidate(committed)
          for (const id of committed) dropCachedNode(originProjectId, id)
          if (useProjects.getState().activeProjectId === originProjectId) {
            setNodes((current) => applyChanges(current, committed))
          }
          if (failed.length > 0) {
            setCleanupError(`Could not commit terminal close: ${failed.join(', ')}`)
          } else if (cleanupPending.length > 0) {
            setCleanupError(`Terminal closed; session cleanup will retry: ${cleanupPending.join(', ')}`)
          }
        })
        .catch((error: unknown) => {
          setCleanupError(`Could not close terminal: ${error instanceof Error ? error.message : String(error)}`)
        })
    },
    [activeProjectId, dropCachedNode, invalidate, nodes, selectedIds]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    []
  )


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
      const target = nodes.find((node) => node.id === id)
      if (!target) return
      if (target.type !== 'terminal') {
        setNodes((current) => removeNode(current, id))
        push()
        return
      }

      // Explicit node close is permanent. Component unmount alone is not: it
      // also happens while switching projects, where the tmux session must live.
      const originProjectId = activeProjectId
      setCleanupError(null)
      if (!originProjectId) return
      void window.termsprawl.pty.closeNode(originProjectId, id)
        .then((result) => {
          invalidate([id])
          dropCachedNode(originProjectId, id)
          if (useProjects.getState().activeProjectId === originProjectId) {
            setNodes((current) => removeNode(current, id))
          }
          if (result.cleanupPendingIds.length > 0) {
            setCleanupError(`Terminal closed; session cleanup will retry: ${id}`)
          }
        })
        .catch((error: unknown) => {
          setCleanupError(`Could not close terminal: ${error instanceof Error ? error.message : String(error)}`)
        })
    },
    [activeProjectId, dropCachedNode, invalidate, nodes, push]
  )
  const canvasApi = useMemo(
    () => ({ updateNodeData, commit, closeNode }),
    [updateNodeData, commit, closeNode]
  )

  // Append a node with a z-index above everything else so it renders on top.
  // Also select it (and deselect the rest) so React Flow doesn't leave an
  // older node visually "active" over the new one.
  const appendOnTop = useCallback((node: Node<SprawlNodeData>) => {
    setNodes((nds) => [
      ...nds.map((n) => ({ ...n, selected: false })),
      { ...node, zIndex: topZ(nds), selected: true }
    ])
  }, [])

  const addTerminal = useCallback(() => {
    try {
      const node = createTerminalNode(cwd)
      if (menu && wrapperRef.current) {
        node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
      }
      console.log('[canvas] addTerminal', node.id)
      appendOnTop(node)
      push()
      setMenu(null)
    } catch (err) {
      console.error('[canvas] addTerminal failed:', err)
      throw err
    }
  }, [cwd, menu, push, screenToFlowPosition, appendOnTop])

  const addSticky = useCallback(() => {
    const node = createStickyNode()
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition, appendOnTop])

  const addDiff = useCallback(() => {
    const node = createDiffNode()
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition, appendOnTop])

  const addEditor = useCallback(() => {
    const node = createEditorNode()
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition, appendOnTop])

  // A druk terminal: launches the druk TUI code editor in the project cwd.
  const addDruk = useCallback(() => {
    const node = createDrukNode(cwd)
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [cwd, menu, push, screenToFlowPosition, appendOnTop])

  // An agent terminal: launches the agent CLI once in the project cwd.
  const addAgent = useCallback(
    (agentId: AgentId) => {
      const node = createAgentNode(agentId, cwd)
      if (menu && wrapperRef.current) {
        node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
      }
      appendOnTop(node)
      push()
      setMenu(null)
      setAgentMenuOpen(false)
    },
    [cwd, menu, push, screenToFlowPosition, appendOnTop]
  )

  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setAgentMenuOpen(false)
    setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    event.stopPropagation()
    setAgentMenuOpen(false)
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

  // Agent-node actions (Phase 7, Task 7.4). An agent node is a terminal whose
  // command launches a CLI (claude/codex/gemini/grok/druk). Branching pushes
  // Claude's /branch into the live PTY; resuming spawns a NEW node that
  // reattaches to the old session (`claude --resume <nodeId>` — node id IS the
  // session id for claude).
  const branchAgentSession = useCallback(() => {
    if (!menu?.nodeId) return
    window.termsprawl.pty.write(menu.nodeId, '/branch\r')
    setMenu(null)
  }, [menu])

  const resumeAgentSession = useCallback(() => {
    if (!menu?.nodeId) return
    const node = createResumeAgentNode('claude', menu.nodeId, cwd)
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, cwd, push, screenToFlowPosition, appendOnTop])

  // Deleting a group ungroups its children instead of destroying them —
  // terminals inside keep their tmux sessions. Intercepted in onNodesChange
  // (React Flow v11's onNodesDelete can't veto the cascade removal).

  const menuNode = menu?.nodeId ? nodes.find((n) => n.id === menu.nodeId) : undefined
  const menuIsGroup = menuNode?.type === 'group'
  const canGroup = menuNode !== undefined && menuNode.type !== 'group'
  // A claude agent node = terminal node whose command launches the claude CLI.
  const menuIsClaudeAgent =
    menuNode?.type === 'terminal' &&
    typeof (menuNode.data as { command?: string }).command === 'string' &&
    (menuNode.data as { command?: string }).command?.startsWith('claude') === true

  // Persist the active project's nodes (debounced) as the canvas settles.
  useEffect(() => {
    if (loadingRef.current) return
    if (!activeProjectId) return
    const timer = setTimeout(() => {
      void saveNodes(serializeNodes(nodes))
    }, 600)
    return () => clearTimeout(timer)
  }, [nodes, activeProjectId, saveNodes])

  // A project switch cancels the debounce above. Flush the outgoing canvas
  // explicitly so rapid edits are not replaced by its older cached snapshot.
  useEffect(() => {
    if (!activeProjectId) return
    const projectId = activeProjectId
    return () => {
      void saveProjectNodes(projectId, serializeNodes(latestNodesRef.current))
    }
  }, [activeProjectId, saveProjectNodes])

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
        {cleanupError && (
          <div className="error-banner" role="alert" onClick={() => setCleanupError(null)}>
            {cleanupError}
          </div>
        )}
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
        elevateNodesOnSelect={false}
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
          {menuIsClaudeAgent && (
            <>
              <button onClick={branchAgentSession} title="Send /branch to the agent">
                Branch session
              </button>
              <button onClick={resumeAgentSession} title="New node resuming this session">
                Resume session in new node
              </button>
            </>
          )}
          <button onClick={addTerminal}>New terminal</button>
          <button onClick={addSticky}>New sticky note</button>
          <button onClick={addDiff}>New diff</button>
          <button onClick={addEditor}>New editor</button>
          <button onClick={addDruk}>Open druk</button>
          <button
            className="context-submenu-toggle"
            onClick={() => setAgentMenuOpen((v) => !v)}
          >
            Open agent ▸
          </button>
          {agentMenuOpen && (
            <div className="context-submenu">
              {agentIds().map((id) => (
                <button key={id} onClick={() => addAgent(id)} title={agentName(id)}>
                  {agentTitle(id)}
                </button>
              ))}
            </div>
          )}
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
