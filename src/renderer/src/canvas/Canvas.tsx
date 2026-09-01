import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from 'reactflow'
import { TerminalNode } from '../nodes/TerminalNode'
import { FileTree } from '../components/FileTree'
import { StickyNode } from '../nodes/StickyNode'
import { GroupNode } from '../nodes/GroupNode'
import { BrowserNode } from '../nodes/BrowserNode'
import { ChatNode } from '../nodes/ChatNode'
import {
  applyLayoutPositions,
  createAgentLoginNode,
  createAgentNode,
  createDiffNode,
  createDrukNode,
  createEditorNode,
  createGroup,
  createResumeAgentNode,
  createStickyNode,
  createTerminalNode,
  createBrowserNode,
  createChatNode,
  isAgentCommand,
  layoutCascade,
  layoutFlat,
  layoutRestore,
  removeNode,
  resolveHomeUrl,
  serializeNodes,
  deserializeNodes,
  topZ,
  ungroup
} from '../state/workspace'
import type { OrganizeSnapshot } from '../state/workspace'
import { agentIds, agentName, agentTitle } from '@shared/agents/config'
import type { AgentId } from '@shared/agents/config'
import type { NodeLink, ProjectRemote } from '@shared/types'
import { connectableLinkKinds, linkDefaultConfig } from '../../../core/links/registry'
import { useHistory } from '../state/history'
import { useProjects } from '../state/projects'
import { useCanvasRequests } from '../state/canvas-requests'
import { useBrowserHome } from '../state/browser-home'
import { deserializeLinks, linksFromSerialized, removeLinksForNode, serializeLinks } from '../state/workspace-links'
import { NodeLinkEdge } from './NodeLinkEdge'
import { LinkInspector } from '../components/LinkInspector'
import type { SprawlNodeData, TerminalNodeData } from '../state/workspace'

// Monaco-backed nodes load on first use (audit F7): the editor + diff bundles
// (~10 MB of Monaco + workers) no longer sit in the boot-critical chunk. The
// wrappers cast through unknown because React Flow's ComponentType contract
// wants the exact node props type; the lazy wrapper re-exposes the same props.
const DiffNodeLazy = lazy(async () => ({ default: (await import('../nodes/DiffNode')).DiffNode })) as unknown as React.ComponentType<NodeProps<SprawlNodeData>>
const EditorNodeLazy = lazy(async () => ({ default: (await import('../nodes/EditorNode')).EditorNode })) as unknown as React.ComponentType<NodeProps<SprawlNodeData>>
const MonacoFallback = (
  <div className="monaco-node-fallback">loading editor…</div>
)

const nodeTypes = {
  terminal: TerminalNode,
  sticky: StickyNode,
  group: GroupNode,
  // Monaco nodes render through Suspense (audit F7) — lazy chunks load on
  // the first editor/diff node, not at boot.
  diff: (props: NodeProps<SprawlNodeData>) => (
    <Suspense fallback={MonacoFallback}>
      <DiffNodeLazy {...props} />
    </Suspense>
  ),
  editor: (props: NodeProps<SprawlNodeData>) => (
    <Suspense fallback={MonacoFallback}>
      <EditorNodeLazy {...props} />
    </Suspense>
  ),
  browser: BrowserNode,
  chat: ChatNode
} as const

const edgeTypes = { nodelink: NodeLinkEdge } as const

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
  /** Remote project destination (Phase 9): terminals spawn over ssh, and the
   * file tree / source control / editor+diff nodes run against the remote. */
  remote?: ProjectRemote
  /** Invert the mousewheel zoom direction (scroll up = zoom out). */
  invertWheelZoom?: boolean
}

// Match React Flow's default zoom bounds so the inverted (custom) wheel path
// clamps to the same range as the native zoom-on-scroll.
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2

export function Canvas({ cwd, remote, invertWheelZoom = false }: CanvasProps): React.JSX.Element {
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const nodeCache = useProjects((s) => s.nodeCache)
  const saveNodes = useProjects((s) => s.saveNodes)
  const saveProjectNodes = useProjects((s) => s.saveProjectNodes)
  const dropCachedNode = useProjects((s) => s.dropCachedNode)

  const [nodes, setNodes] = useState<Node<SprawlNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  // Links are the persisted reality behind the edges (Phase 18): the project
  // file stores NodeLink records; the `edges` state mirrors them for React Flow.
  const linksRef = useRef<NodeLink[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [linkMenuOpen, setLinkMenuOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, getViewport, setViewport, fitView } = useReactFlow()
  const loadingRef = useRef(false)
  const latestNodesRef = useRef(nodes)
  latestNodesRef.current = nodes
  /** Live mirror of activeProjectId for unload handlers (audit F8). */
  const activeProjectIdRef = useRef<string | null>(activeProjectId)
  activeProjectIdRef.current = activeProjectId

  // Mirror the invert setting so the capture-phase wheel listener below always
  // reads the latest value without re-binding on every toggle.
  const invertWheelZoomRef = useRef(invertWheelZoom)
  invertWheelZoomRef.current = invertWheelZoom

  // Inverted mousewheel zoom: when the setting is on, take over wheel-zoom so
  // the direction flips. Mirrors React Flow's native zoom-on-scroll (same delta
  // math, cursor anchoring, min/max clamp, and the `nowheel` guard) but negates
  // the direction. When off, we do nothing and let native zoom handle it.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onWheel = (event: WheelEvent): void => {
      if (!invertWheelZoomRef.current) return
      const target = event.target as HTMLElement | null
      // Only the pan/zoom surface (the renderer subtree): skip the context
      // menu, history bar, file tree, controls, minimap, and any `nowheel`
      // content (terminals/editors scroll themselves).
      if (!target || !target.closest('.react-flow__renderer')) return
      if (target.closest('.nowheel')) return

      event.preventDefault()
      event.stopPropagation()

      const viewport = getViewport()
      const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002)
      const scale = 2 ** -delta // negate: invert the default direction
      const rect = wrapper.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const flowX = (px - viewport.x) / viewport.zoom
      const flowY = (py - viewport.y) / viewport.zoom
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * scale))
      setViewport({ x: px - flowX * nextZoom, y: py - flowY * nextZoom, zoom: nextZoom })
    }
    wrapper.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
  }, [getViewport, setViewport])

  // Load the active project's serialized nodes into React Flow.
  // keyed on activeProjectId — switching projects swaps the canvas.
  useEffect(() => {
    loadingRef.current = true
    const serialized = activeProjectId ? nodeCache[activeProjectId] ?? [] : []
    const initial = deserializeNodes(serialized)
    setNodes(activeProjectId ? (initial.length > 0 ? initial : [createTerminalNode(cwd)]) : [])
    setEdges([])
    linksRef.current = []
    // Links load over IPC (project file) and rebuild the edges once they land.
    if (activeProjectId) {
      void window.termsprawl.links
        .list(activeProjectId)
        .then((links) => {
          linksRef.current = deserializeLinks(links)
          setEdges(linksFromSerialized(linksRef.current))
        })
        .catch(() => {
          // No link support (old main) — canvas stays linkless, never breaks.
        })
    }
    // let React Flow settle before clearing the loading flag
    setTimeout(() => {
      loadingRef.current = false
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId])

  // Undo/redo: debounced snapshots of the nodes array. Permanent terminal
  // closes invalidate that id in every snapshot so undo cannot revive it.
  const { push, undo, redo, invalidate, canUndo, canRedo } = useHistory(nodes, setNodes)

  // --- Node links (Phase 18) ------------------------------------------------
  // Declared before the removal handlers so delete cascades can call them.
  /** Persist the current links (explicit-state; the engine reads these). */
  const persistLinks = useCallback(
    (projectId: string, links: NodeLink[]) => {
      void window.termsprawl.links.update(projectId, serializeLinks(links)).catch(() => {})
    },
    []
  )

  /** Delete a link by id (edge delete key, edge context menu, inspector). */
  const deleteLink = useCallback((linkId: string): void => {
    linksRef.current = linksRef.current.filter((l) => l.id !== linkId)
    if (activeProjectIdRef.current) persistLinks(activeProjectIdRef.current, linksRef.current)
  }, [persistLinks])

  /** Node delete cascade: drop every link touching the removed nodes. */
  const cascadeLinksForNodes = useCallback((removedIds: string[]): void => {
    if (removedIds.length === 0) return
    const before = linksRef.current
    let after = before
    for (const id of removedIds) after = removeLinksForNode(after, id)
    if (after.length !== before.length) {
      linksRef.current = after
      setEdges(linksFromSerialized(after))
      if (activeProjectIdRef.current) persistLinks(activeProjectIdRef.current, after)
    }
  }, [persistLinks])

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
          cascadeLinksForNodes([...committed])
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
    [activeProjectId, dropCachedNode, invalidate, nodes, selectedIds, cascadeLinksForNodes]
  )
  // Create a link from a React Flow connection, validating kinds.
  const createLinkFromConnection = useCallback(
    (connection: Connection): void => {
      const source = latestNodesRef.current.find((n) => n.id === connection.source)
      const target = latestNodesRef.current.find((n) => n.id === connection.target)
      if (!source || !target || !connection.source || !connection.target) return
      const kinds = connectableLinkKinds(source.data.kind, target.data.kind)
      if (kinds.length === 0) return
      // One link per ordered pair; re-connecting updates the existing link.
      const existing = linksRef.current.find((l) => l.source === connection.source && l.target === connection.target)
      if (existing) {
        existing.kind = kinds[0]
        existing.config = linkDefaultConfig(kinds[0])
        existing.auto = false
        setEdges(linksFromSerialized([...linksRef.current]))
        if (activeProjectIdRef.current) persistLinks(activeProjectIdRef.current, [...linksRef.current])
        return
      }
      const link: NodeLink = {
        id: `lk-${crypto.randomUUID().slice(0, 8)}`,
        source: connection.source,
        target: connection.target,
        kind: kinds[0],
        auto: false,
        config: linkDefaultConfig(kinds[0]),
        createdAt: Date.now()
      }
      linksRef.current = [...linksRef.current, link]
      setEdges((eds) => [...eds, ...linksFromSerialized([link])])
      if (activeProjectIdRef.current) persistLinks(activeProjectIdRef.current, linksRef.current)
    },
    [persistLinks]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') deleteLink(change.id)
      }
      setEdges((eds) => applyEdgeChanges(changes, eds))
    },
    [deleteLink]
  )

  const onConnect = useCallback(
    (connection: Connection) => createLinkFromConnection(connection),
    [createLinkFromConnection]
  )

  /** Live connect guard: only linkable source→target pairs accept a drag. */
  const isValidConnection = useCallback((connection: Connection) => {
    const source = latestNodesRef.current.find((n) => n.id === connection.source)
    const target = latestNodesRef.current.find((n) => n.id === connection.target)
    if (!source || !target || !connection.source || !connection.target) return false
    return connectableLinkKinds(source.data.kind, target.data.kind).length > 0
  }, [])


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
        cascadeLinksForNodes([id])
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
          cascadeLinksForNodes([id])
          if (result.cleanupPendingIds.length > 0) {
            setCleanupError(`Terminal closed; session cleanup will retry: ${id}`)
          }
        })
        .catch((error: unknown) => {
          setCleanupError(`Could not close terminal: ${error instanceof Error ? error.message : String(error)}`)
        })
    },
    [activeProjectId, dropCachedNode, invalidate, nodes, push, cascadeLinksForNodes]
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

  const openFileFromTree = useCallback(
    (path: string) => {
      const current = latestNodesRef.current
      const existing = current.find(
        (node) => node.data.kind === 'editor' && node.data.path === path
      )
      if (existing) {
        setNodes((nds) =>
          nds.map((node) => ({
            ...node,
            selected: node.id === existing.id,
            zIndex: node.id === existing.id ? topZ(nds) : node.zIndex
          }))
        )
        return
      }
      const node = createEditorNode(path, remote)
      if (wrapperRef.current) {
        const box = wrapperRef.current.getBoundingClientRect()
        node.position = screenToFlowPosition({
          x: box.left + box.width / 2,
          y: box.top + box.height / 2
        })
      }
      appendOnTop(node)
      push()
    },
    [appendOnTop, push, remote, screenToFlowPosition]
  )

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
    const node = createDiffNode(remote)
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, remote, screenToFlowPosition, appendOnTop])

  const addEditor = useCallback(() => {
    const node = createEditorNode(null, remote)
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, screenToFlowPosition, appendOnTop])

  const addBrowser = useCallback(() => {
    const node = createBrowserNode(resolveHomeUrl(useBrowserHome.getState().homeUrl))
    if (menu && wrapperRef.current) {
      node.position = screenToFlowPosition({ x: menu.x, y: menu.y })
    }
    appendOnTop(node)
    push()
    setMenu(null)
  }, [menu, push, remote, screenToFlowPosition, appendOnTop])

  const addChat = useCallback(() => {
    const node = createChatNode()
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
    setLinkMenuOpen(false)
    setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    event.stopPropagation()
    setAgentMenuOpen(false)
    setLinkMenuOpen(false)
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  const onPaneClick = useCallback(() => setMenu(null), [])
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedIds(sel.map((n) => n.id))
  }, [])

  // --- Link inspector (Phase 18) ---------------------------------------------
  // Selecting an edge opens the inspector; Escape / pane click closes it.
  const [inspectedLinkId, setInspectedLinkId] = useState<string | null>(null)
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setInspectedLinkId(edge.id)
  }, [])
  const closeInspector = useCallback(() => setInspectedLinkId(null), [])
  useEffect(() => {
    if (!inspectedLinkId) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setInspectedLinkId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectedLinkId])
  const updateLink = useCallback(
    (linkId: string, patch: Partial<Pick<NodeLink, 'kind' | 'auto' | 'config'>>): void => {
      linksRef.current = linksRef.current.map((l) =>
        l.id === linkId
          ? {
              ...l,
              ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
              ...(patch.auto !== undefined ? { auto: patch.auto } : {}),
              ...(patch.config !== undefined ? { config: patch.config } : {})
            }
          : l
      )
      setEdges(linksFromSerialized(linksRef.current))
      if (activeProjectIdRef.current) persistLinks(activeProjectIdRef.current, linksRef.current)
    },
    [persistLinks]
  )
  /** Re-read the latest link record after a run (lastRun status for the UI). */
  const refreshLinkAfterRun = useCallback(
    (linkId: string, result: { ok: boolean; summary: string }): void => {
      linksRef.current = linksRef.current.map((l) =>
        l.id === linkId ? { ...l, lastRun: { at: Date.now(), ok: result.ok, summary: result.summary } } : l
      )
      setEdges(linksFromSerialized(linksRef.current))
    },
    []
  )
  const [linkRunBusy, setLinkRunBusy] = useState<string | null>(null)
  /** The inspected link + its endpoint node kinds (null when the edge vanished). */
  const inspectedLink = useMemo(() => {
    if (!inspectedLinkId) return null
    const link = linksRef.current.find((l) => l.id === inspectedLinkId)
    if (!link) return null
    const source = nodes.find((n) => n.id === link.source)
    const target = nodes.find((n) => n.id === link.target)
    return {
      link,
      sourceKind: source?.data.kind ?? 'terminal',
      targetKind: link.kind === 'a2a-peer' ? 'a2a-peer' : target?.data.kind ?? 'file'
    }
  }, [inspectedLinkId, nodes])

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

  // Organize layouts (toolbar button → canvas request): cascade / flat /
  // restore. Cascade and flat take a snapshot of the current positions first;
  // restore replays it. The BASE snapshot (before the first layout of an
  // organize session) is the one restore keeps — organize → flat → restore
  // returns you to how the windows were before you started, not to the
  // intermediate cascade. A new layout after a restore starts a fresh session.
  // ONE undo entry per action — the layout is a single setNodes + push. The
  // origin anchors the layout near the top-left of the current content so it
  // lands in view, and the viewport refits so the result is visible.
  const organizeSnapshotRef = useRef<OrganizeSnapshot | null>(null)
  const organize = useCallback(
    (mode: 'cascade' | 'flat' | 'restore') => {
      const current = latestNodesRef.current
      if (current.length === 0) return
      // Origin: top-left of the union bounds — organized layouts appear where
      // the content already is.
      const xs = current.map((n) => n.position.x)
      const ys = current.map((n) => n.position.y)
      const origin = { x: Math.min(...xs), y: Math.min(...ys) }

      if (mode === 'restore') {
        const snap = organizeSnapshotRef.current
        if (!snap) return // nothing to restore yet — the click is a no-op
        const { positions } = layoutRestore(current, snap)
        setNodes((nds) => applyLayoutPositions(nds, positions))
        organizeSnapshotRef.current = null // consumed — next layout starts fresh
      } else {
        // Keep the FIRST snapshot of the session as the restore base.
        if (!organizeSnapshotRef.current) {
          organizeSnapshotRef.current =
            mode === 'cascade' ? layoutCascade(current, origin).snapshot : layoutFlat(current, origin).snapshot
        }
        const layout = mode === 'cascade' ? layoutCascade(current, origin) : layoutFlat(current, origin)
        setNodes((nds) => applyLayoutPositions(nds, layout.positions))
      }
      push()
      // Frame the new layout: fitView a beat after React Flow applies the
      // positions (same settle pattern as the project-load path).
      setTimeout(() => {
        void fitView({ padding: 0.15, duration: 200 })
      }, 50)
    },
    [push, fitView]
  )

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

  // Consume a one-shot spawn request raised OUTSIDE the canvas (managed-account
  // login nodes come from the settings panel). Canvas stays the source of truth
  // for node state.
  const spawnRequest = useCanvasRequests((s) => s.request)
  useEffect(() => {
    if (!spawnRequest) return
    if (spawnRequest.kind === 'agentLogin') {
      const node = createAgentLoginNode(spawnRequest.command, cwd)
      appendOnTop(node)
      push()
    } else if (spawnRequest.kind === 'browser') {
      const node = createBrowserNode(spawnRequest.url)
      appendOnTop(node)
      push()
    } else if (spawnRequest.kind === 'switchProject') {
      // An imported online snapshot: switch the canvas to the fresh project.
      // The nodes were already saved to disk in main and cached in the
      // projects store — the activeProjectId effect above hydrates them.
      useProjects.getState().select(spawnRequest.projectId)
    } else if (spawnRequest.kind === 'organize') {
      organize(spawnRequest.mode)
    }
    useCanvasRequests.getState().consume()
  }, [spawnRequest, cwd, appendOnTop, push, organize])

  // An external agent (via the loopback agent-control server) can ask the app to
  // open a browser node; route it through the same one-shot spawn store so the
  // user sees the agent's page appear on the canvas automatically.
  useEffect(() => {
    return window.termsprawl.browser.onAgentOpen((info) => {
      useCanvasRequests.getState().spawn({ kind: 'browser', url: info.url })
    })
  }, [])

  // Context links (7.5): link files on disk are the source of truth; `linkedIds`
  // is a cache we keep in sync here. Undo is intentionally NOT pushed for links
  // — they are disk state, rebuilt from the files on project load.
  const toggleLink = useCallback(
    (peerId: string, already: boolean) => {
      if (!menu?.nodeId || !cwd) return
      const selfId = menu.nodeId
      const action = already
        ? window.termsprawl.contextLinks.remove
        : window.termsprawl.contextLinks.add
      void action(cwd, selfId, peerId).then((res) => {
        if (res.ok) {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id !== selfId) return n
              const base = n.data as TerminalNodeData
              return {
                ...n,
                data: {
                  ...base,
                  linkedIds: already
                    ? (base.linkedIds ?? []).filter((id) => id !== peerId)
                    : [...(base.linkedIds ?? []), peerId]
                }
              }
            })
          )
        } else {
          setCleanupError(`Could not ${already ? 'unlink' : 'link'}: ${res.error}`)
        }
      })
      setLinkMenuOpen(false)
    },
    [cwd, menu, setCleanupError]
  )

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

  // --- A2A send-to-peer (Phase 19): any agent terminal can forward its content
  // to a configured peer (Settings → Connections → A2A peers).
  const [a2aMenuOpen, setA2aMenuOpen] = useState(false)
  const [a2aPeers, setA2aPeers] = useState<Array<{ id: string; label: string; endpoint: string }>>([])
  const [a2aSendNote, setA2aSendNote] = useState<string | null>(null)
  const menuIsAgentNode =
    menuNode?.type === 'terminal' && isAgentCommand((menuNode.data as { command?: string }).command)
  // Load the peer list when the submenu opens (settings are the source).
  useEffect(() => {
    if (!a2aMenuOpen) return
    let cancelled = false
    void window.termsprawl.settings
      .get()
      .then((s) => {
        if (!cancelled) setA2aPeers(s.a2aPeers ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [a2aMenuOpen])
  const sendToA2aPeer = useCallback(
    (peerId: string, peerLabel: string) => {
      if (!menu?.nodeId) return
      setA2aSendNote(`sending to ${peerLabel}…`)
      void window.termsprawl.links
        .sendToPeer(menu.nodeId, peerId)
        .then((res) => setA2aSendNote(`${res.ok ? '✓' : '✗'} ${res.summary}`))
        .catch((err: unknown) => setA2aSendNote(`✗ ${err instanceof Error ? err.message : String(err)}`))
    },
    [menu]
  )

  // Context-link submenu: other agent terminals on this canvas (folder projects
  // only). `linkedIds` mirrors the link files on disk.
  const menuNodeData = menu?.nodeId ? (menuNode?.data as TerminalNodeData | undefined) : undefined
  const linkedIds = cwd ? (menuNodeData?.linkedIds ?? []) : []
  const agentPeers = cwd
    ? nodes.filter(
        (n) =>
          n.id !== menu?.nodeId &&
          n.type === 'terminal' &&
          isAgentCommand((n.data as { command?: string }).command)
      )
    : []

  // Persist the active project's nodes (debounced) as the canvas settles.
  useEffect(() => {
    if (loadingRef.current) return
    if (!activeProjectId) return
    const timer = setTimeout(() => {
      void saveNodes(serializeNodes(nodes))
    }, 600)
    return () => clearTimeout(timer)
  }, [nodes, activeProjectId, saveNodes])

  // Quit/tab-close flush (audit F8): the 600ms debounce above loses layout
  // changes made in the final 600ms before the renderer unloads. The main
  // process persists again on before-quit via its own store, but the renderer
  // is the live source of truth — push the latest nodes synchronously here.
  useEffect(() => {
    const flush = (): void => {
      if (loadingRef.current || !activeProjectIdRef.current) return
      void saveProjectNodes(activeProjectIdRef.current, serializeNodes(latestNodesRef.current))
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [saveProjectNodes])

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
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onPaneClick={() => {
          setMenu(null)
          setInspectedLinkId(null)
        }}
        onSelectionChange={onSelectionChange}
        zoomOnScroll
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
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
          {menuIsAgentNode && (
            <>
              <button
                className="context-submenu-toggle"
                onClick={() => setA2aMenuOpen((v) => !v)}
              >
                {a2aMenuOpen ? 'A2A send to peer ▾' : 'A2A send to peer ▸'}
              </button>
              {a2aMenuOpen && (
                <div className="context-submenu">
                  {a2aPeers.length === 0 && (
                    <button disabled title="Add peers in Settings → Connections → A2A peers">
                      no peers configured
                    </button>
                  )}
                  {a2aPeers.map((peer) => (
                    <button key={peer.id} onClick={() => sendToA2aPeer(peer.id, peer.label)}>
                      send to {peer.label}
                    </button>
                  ))}
                  {a2aSendNote && <div className="context-note">{a2aSendNote}</div>}
                </div>
              )}
            </>
          )}
          {menuIsClaudeAgent && (
            <>
              <button onClick={branchAgentSession} title="Send /branch to the agent">
                Branch session
              </button>
              <button onClick={resumeAgentSession} title="New node resuming this session">
                Resume session in new node
              </button>
              {cwd && agentPeers.length > 0 && (
                <>
                  <button
                    className="context-submenu-toggle"
                    onClick={() => setLinkMenuOpen((v) => !v)}
                  >
                    {linkMenuOpen ? 'link to another agent ▾' : 'link to another agent ▸'}
                  </button>
                  {linkMenuOpen && (
                    <div className="context-submenu">
                      {agentPeers.map((peer) => {
                        const already = linkedIds.includes(peer.id)
                        const title = (peer.data as { title?: string }).title ?? peer.id
                        return (
                          <button key={peer.id} onClick={() => toggleLink(peer.id, already)}>
                            {already ? `unlink ${title}` : `link ${title}`}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <button onClick={addTerminal}>New terminal</button>
          <button onClick={addSticky}>New sticky note</button>
          <button onClick={addDiff}>New diff</button>
          <button onClick={addEditor}>New editor</button>
          <button onClick={addBrowser}>New browser</button>
          <button onClick={addChat}>New chat</button>
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
      <FileTree
        cwd={cwd}
        remote={remote}
        onOpenFile={openFileFromTree}
        openEditors={openEditorTabs(nodes)}
      />

      {inspectedLink && (
        <LinkInspector
          link={inspectedLink.link}
          sourceKind={inspectedLink.sourceKind}
          targetKind={inspectedLink.targetKind}
          running={linkRunBusy === inspectedLink.link.id}
          onChange={(patch) => updateLink(inspectedLink.link.id, patch)}
          onRun={() => {
            const linkId = inspectedLink.link.id
            setLinkRunBusy(linkId)
            void window.termsprawl.links
              .run(linkId)
              .then((result) => refreshLinkAfterRun(linkId, result))
              .finally(() => setLinkRunBusy(null))
          }}
          onDelete={() => {
            deleteLink(inspectedLink.link.id)
            setInspectedLinkId(null)
          }}
          onClose={closeInspector}
        />
      )}
      </div>
    </CanvasContext.Provider>
  )
}

// The sidebar's "tabs" section lists the files open in editor nodes (VS Code's
// OPEN EDITORS). Derived from live canvas state so it tracks as editors open.
function openEditorTabs(nodes: Node<SprawlNodeData>[]): { id: string; path: string }[] {
  const tabs: { id: string; path: string }[] = []
  for (const node of nodes) {
    const data = node.data
    if (data.kind === 'editor' && data.path) tabs.push({ id: node.id, path: data.path })
  }
  return tabs
}
