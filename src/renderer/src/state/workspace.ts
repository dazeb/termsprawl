// Pure workspace helpers — node factories and serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'
import type { ChatNodeData, ProjectRemote, SerializedNode } from '@shared/types'
import { agentConfig, agentIds, agentTitle, agentCommand, type AgentId } from '@shared/agents/config'
import { capConversationMessages } from '../../../core/chat/conversation'

export const NODE_TYPES = ['terminal', 'sticky', 'group', 'diff', 'editor', 'browser', 'chat'] as const
export type NodeKind = (typeof NODE_TYPES)[number]

export interface TerminalNodeData {
  kind: 'terminal'
  title: string
  cwd?: string
  /** Optional command the PTY runs instead of a bare shell (e.g. `druk`). */
  command?: string
  /** Agent nodes linked for context sharing — CACHE ONLY. Source of truth is
   * the `.termsprawl/links/*.json` files; rebuilt on project load, so a
   * git-pulled link shows up even if this field was never saved. */
  linkedIds?: string[]
  /** Remote relay terminal (B3): when set to a HOST terminal id, this node is
   * NOT a local pty/tmux session — xterm renders output streamed from the
   * paired relay host over the tunnel, and keystrokes go back over it. The
   * node kind stays 'terminal' so persistence/re-layout just work; presence of
   * relayTerm switches TerminalNode into remote mode. */
  relayTerm?: string
}

export const STICKY_COLORS = ['slate', 'amber', 'lime', 'pink', 'cyan'] as const
export type StickyColor = (typeof STICKY_COLORS)[number]

export interface StickyNodeData {
  kind: 'sticky'
  text: string
  color: StickyColor
  collapsed: boolean
}

export interface GroupNodeData {
  kind: 'group'
  title: string
}

export interface DiffNodeData {
  kind: 'diff'
  /** Absolute path of the file being diffed; null until one is chosen. */
  path: string | null
  /** Which ref the "original" side comes from. */
  base: 'staged' | 'HEAD'
  /** Remote project (Phase 9): the diff is fetched over ssh. Cleared when a
   * local file is picked via the dialog. */
  remote?: ProjectRemote | null
}

export interface EditorNodeData {
  kind: 'editor'
  /** Absolute path of the open file; null until one is chosen. */
  path: string | null
  /** Markdown preview pane (ignored for non-markdown files). */
  preview: boolean
  /** Remote project (Phase 9): read/save go over ssh. Cleared when a local
   * file is picked via the dialog. */
  remote?: ProjectRemote | null
}

/** One tab inside a browser node. Each tab is its own sandboxed <webview>
 * guest (so tabs can run pages side by side and an agent sees each as a
 * separate CDP target). */
export interface BrowserTab {
  id: string
  url: string
}

export interface BrowserNodeData {
  kind: 'browser'
  /** Last known URL (mirrors the ACTIVE tab; persisted so the project file
   * remembers where the node was browsing). */
  url: string
  /** Recent URLs visited in this node, most recent first (capped). Persisted
   * with the project file. */
  history?: string[]
  /** Open tabs. Absent on legacy persisted nodes → treated as one tab at `url`. */
  tabs?: BrowserTab[]
  /** The active tab id; absent → first tab. */
  activeTabId?: string
}

/** Chat node persisted data lives in @shared/types (single declaration — the
 * former workspace-local copy drifted from the core chat model). */
export type { ChatNodeData } from '@shared/types'

export type SprawlNodeData =
  | TerminalNodeData
  | StickyNodeData
  | GroupNodeData
  | DiffNodeData
  | EditorNodeData
  | BrowserNodeData
  | ChatNodeData

let counter = 0
const TERMINAL_DIMENSIONS = { width: 720, height: 420 } as const
/** The inline style every terminal node must carry. React Flow sizes the node
 * DOM element from `style.width/height` (NOT the top-level `width`/`height`,
 * which are measured dimensions). A terminal without this collapses to a
 * narrow left column — the "terminals minimise to the left" bug. */
const TERMINAL_NODE_STYLE = { width: TERMINAL_DIMENSIONS.width, height: TERMINAL_DIMENSIONS.height } as const

function nextId(): string {
  counter += 1
  return `n${Date.now().toString(36)}-${counter}`
}

export function createTerminalNode(cwd?: string): Node<TerminalNodeData> {
  return {
    id: nextId(),
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    // Explicit wrapper size (style) — the NodeResizer updates THIS, and the
    // node root fills it (width/height 100%). Without it the root's old fixed
    // px size kept the content from actually resizing (learned 2026-08-27).
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'terminal', title: 'shell', cwd }
  }
}

/** A terminal node that mirrors a HOST terminal over the relay tunnel (B3,
 * client role). No local pty/tmux is created — data.relayTerm is the host
 * terminal id this xterm attaches to; keystrokes stream back over the tunnel.
 * The title defaults to the host terminal's title so the node reads naturally. */
export function createRemoteTerminalNode(relayTerm: string, title?: string): Node<TerminalNodeData> {
  return {
    id: nextId(),
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'terminal', title: title && title.length > 0 ? title : 'remote', relayTerm }
  }
}

/** A terminal node preset that launches the druk TUI code editor, opening the
 * project folder (`druk <cwd>`). Falls back to a bare `druk` (current dir)
 * when the project has no folder. */
export function createDrukNode(cwd?: string): Node<TerminalNodeData> {
  return {
    id: nextId(),
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: {
      kind: 'terminal',
      title: 'druk',
      cwd,
      command: cwd ? `druk ${cwd}` : 'druk'
    }
  }
}

/** One above the highest existing node z-index, so a newly added node renders
 * on top (React Flow's elevateNodesOnSelect would otherwise leave interacted
 * nodes above fresh ones). */
export function topZ(nodes: Node[]): number {
  const max = nodes.reduce((m, n) => Math.max(m, (n as Node & { zIndex?: number }).zIndex ?? 0), 0)
  return max + 1
}

/** A terminal node preset that launches an agent CLI once (Phase 7, Task 7.1).
 * The command resolves to an absolute path at spawn time (GUI apps lack the
 * shell PATH where agent CLIs like codex/claude/grok live). Claude gets
 * `--session-id <nodeId>` so hook events map back to this exact node. */
export function createAgentNode(agentId: AgentId, cwd?: string): Node<TerminalNodeData> {
  const id = nextId()
  const command =
    agentId === 'claude' ? `claude --session-id ${id}` : agentCommand(agentId)
  return {
    id,
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: {
      kind: 'terminal',
      title: agentTitle(agentId),
      cwd,
      command
    }
  }
}

/** A NEW node that resumes an OLD agent session (Phase 7, Task 7.4). Claude
 * keeps its session id stable across spawns, so `claude --resume <sessionId>`
 * reattaches to the exact conversation. Other agents get the plain CLI — no
 * resume flag is known yet, so the node is just a fresh spawn. */
export function createResumeAgentNode(
  agentId: AgentId,
  sessionId: string,
  cwd?: string
): Node<TerminalNodeData> {
  const command = agentId === 'claude' ? `claude --resume ${sessionId}` : agentCommand(agentId)
  return {
    id: nextId(),
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: {
      kind: 'terminal',
      title: agentTitle(agentId),
      cwd,
      command
    }
  }
}

/** The old session id a resume command reattaches to, or null for normal
 * spawns. Hook events for a resumed session carry the ORIGINAL session id, so
 * a resume node must also subscribe to that id to keep its status badge. */
export function resumedSessionId(command: string | undefined): string | null {
  if (!command) return null
  const match = /--resume\s+(\S+)/.exec(command)
  return match ? match[1] : null
}

/** A one-shot login terminal for a managed account (7.6). Runs the resolved
 * claude login command; main injects CLAUDE_CONFIG_DIR from the active account,
 * so `claude auth login` writes credentials into that account's dir. */
export function createAgentLoginNode(command: string, cwd?: string): Node<TerminalNodeData> {
  return {
    id: nextId(),
    type: 'terminal',
    ...TERMINAL_DIMENSIONS,
    style: { ...TERMINAL_NODE_STYLE },
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'terminal', title: 'claude login', cwd, command }
  }
}

/** True when a command launches a known, enabled agent CLI (e.g.
 * `claude --session-id n1` or a bare `codex`). Non-agent terminals (a plain
 * shell or `druk …`) return false. Used to scope context-link peer lists. */
export function isAgentCommand(command: string | undefined): boolean {
  if (!command) return false
  const first = command.trim().split(/\s+/)[0]
  return agentIds().some((id: AgentId) => {
    const cfg = agentConfig(id)
    return cfg.enabled && first === cfg.command
  })
}

export function createStickyNode(): Node<StickyNodeData> {
  return {
    id: nextId(),
    type: 'sticky',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    style: { width: 200, height: 130 },
    data: { kind: 'sticky', text: '', color: 'slate', collapsed: false }
  }
}

export function createDiffNode(remote?: ProjectRemote | null): Node<DiffNodeData> {
  return {
    id: nextId(),
    type: 'diff',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    style: { width: 560, height: 360 },
    data: { kind: 'diff', path: null, base: 'HEAD', ...(remote ? { remote } : {}) }
  }
}

export function createEditorNode(
  path: string | null = null,
  remote?: ProjectRemote | null
): Node<EditorNodeData> {
  return {
    id: nextId(),
    type: 'editor',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    style: { width: 640, height: 420 },
    data: { kind: 'editor', path, preview: false, ...(remote ? { remote } : {}) }
  }
}

/** The default start page for a fresh browser node (or new tab). */
export const DEFAULT_BROWSER_URL = 'https://duckduckgo.com'

/** Resolve the browser home URL: an explicit user setting wins; else the
 * stock default (DuckDuckGo). The user may point this at their own SearXNG. */
export function resolveHomeUrl(settingUrl: string | undefined): string {
  if (settingUrl && settingUrl.trim().length > 0) return settingUrl.trim()
  return DEFAULT_BROWSER_URL
}

/** A readable browser viewport for signing in and working alongside agents. */
export const BROWSER_NODE_SIZE = { width: 1000, height: 720 } as const

export function createBrowserNode(url: string = DEFAULT_BROWSER_URL): Node<BrowserNodeData> {
  const tab = { id: nextBrowserTabId(), url }
  return {
    id: nextId(),
    type: 'browser',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    style: { width: BROWSER_NODE_SIZE.width, height: BROWSER_NODE_SIZE.height },
    data: { kind: 'browser', url, tabs: [tab], activeTabId: tab.id }
  }
}

/** A chat node (Phase 11 Task 11.4): SDK chat, not a PTY — streaming replies,
 * thinking blocks, cost chip. History rides in node data and persists with
 * the project file. */
export const CHAT_NODE_SIZE = { width: 420, height: 480 } as const

export function createChatNode(model?: string): Node<ChatNodeData> {
  return {
    id: nextId(),
    type: 'chat',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    style: { width: CHAT_NODE_SIZE.width, height: CHAT_NODE_SIZE.height },
    data: { kind: 'chat', messages: [], ...(model ? { model } : {}) }
  }
}

let tabCounter = 0

export function nextBrowserTabId(): string {
  tabCounter += 1
  return `tab${Date.now().toString(36)}-${tabCounter}`
}

/** Append a tab and make it active. */
export function addBrowserTab(
  tabs: BrowserTab[] | undefined,
  url = 'about:blank'
): { tabs: BrowserTab[]; activeTabId: string } {
  const tab = { id: nextBrowserTabId(), url }
  return { tabs: [...(tabs ?? []), tab], activeTabId: tab.id }
}

/** Remove a tab, activating a neighbour. Returns null when the LAST tab was
 * removed — the caller should close the node (browser convention). */
export function closeBrowserTab(
  tabs: BrowserTab[] | undefined,
  activeTabId: string | undefined,
  tabId: string
): { tabs: BrowserTab[]; activeTabId: string } | null {
  const list = tabs ?? []
  const idx = list.findIndex((t) => t.id === tabId)
  if (idx === -1) return { tabs: list, activeTabId: activeTabId ?? list[0]?.id ?? '' }
  const next = list.filter((t) => t.id !== tabId)
  if (next.length === 0) return null
  const keepActive =
    activeTabId !== undefined && activeTabId !== tabId && next.some((t) => t.id === activeTabId)
  const activeId = keepActive ? activeTabId : next[Math.min(idx, next.length - 1)].id
  return { tabs: next, activeTabId: activeId }
}

/** Set the active tab; no-op (null) when the tab id is unknown. */
export function activateBrowserTab(
  tabs: BrowserTab[] | undefined,
  tabId: string
): { tabs: BrowserTab[]; activeTabId: string } | null {
  const list = tabs ?? []
  if (!list.some((t) => t.id === tabId)) return null
  return { tabs: list, activeTabId: tabId }
}

/** Update a single tab's URL. */
export function setBrowserTabUrl(
  tabs: BrowserTab[] | undefined,
  tabId: string,
  url: string
): BrowserTab[] {
  return (tabs ?? []).map((t) => (t.id === tabId ? { ...t, url } : t))
}

/** Most-recent-first navigation history for a browser node, capped. Skips
 * empty and about: pages (they are not meaningful "places visited"). */
export function pushBrowserHistory(
  history: string[] | undefined,
  url: string,
  cap = 10
): string[] {
  if (!url || url === 'about:blank' || url === 'about:srcdoc') return history ?? []
  const prev = history ?? []
  if (prev[0] === url) return prev
  return [url, ...prev].slice(0, cap)
}

/** Project name from a chosen folder path (basename), or the fallback when no
 * folder was picked (cwd-less inline project). */
export function projectNameFromPath(cwd: string | null, fallback: string): string {
  if (!cwd) return fallback
  const trimmed = cwd.replace(/\/+$/, '')
  if (!trimmed) return fallback
  const parts = trimmed.split('/')
  return parts[parts.length - 1] || fallback
}

export function nodeTitle(data: SprawlNodeData): string {
  if (data.kind === 'terminal') return data.title
  if (data.kind === 'group') return data.title
  if (data.kind === 'diff') return data.path ? data.path.split('/').pop() ?? 'diff' : 'diff'
  if (data.kind === 'editor') return data.path ? data.path.split('/').pop() ?? 'editor' : 'editor'
  if (data.kind === 'browser') return browserTitle(data.url)
  if (data.kind === 'chat') return data.model ?? 'chat'
  const firstLine = data.text.split('\n')[0].trim()
  return firstLine || 'sticky note'
}

/** A short label for a browser node from its current URL (host or about:blank). */
export function browserTitle(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'about:') return 'browser'
    return u.host || 'browser'
  } catch {
    return 'browser'
  }
}

/**
 * Remove a node. Groups are ungrouped first (children keep absolute
 * positions — terminals inside keep their tmux sessions); the frame itself
 * is removed. Unknown ids are a no-op.
 */
export function removeNode(nodes: Node<SprawlNodeData>[], id: string): Node<SprawlNodeData>[] {
  const target = nodes.find((n) => n.id === id)
  if (!target) return nodes
  if (target.type === 'group') return ungroup(id, nodes)
  return nodes.filter((n) => n.id !== id)
}

// Default node dimensions for frame sizing when React Flow hasn't measured
// a node yet (used in tests and for freshly added nodes).
const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  terminal: { w: 720, h: 420 },
  sticky: { w: 200, h: 130 },
  group: { w: 200, h: 130 },
  diff: { w: 560, h: 360 },
  editor: { w: 640, h: 420 },
  browser: { w: 320, h: 240 },
  chat: { w: 420, h: 480 }
}

function nodeSize(n: Node<SprawlNodeData>): { w: number; h: number } {
  const measured = n.width != null && n.height != null
  if (measured) return { w: n.width as number, h: n.height as number }
  return DEFAULT_SIZE[n.type ?? 'terminal'] ?? DEFAULT_SIZE.terminal
}

/**
 * Group selected nodes under a parent frame.
 * @param nodes  nodes to group (their positions are absolute canvas coords)
 * @param origin top-left of the frame in absolute coords; child positions
 *               become relative to it
 * @returns the new group node (sized to cover its children) plus the
 *          children rewritten with parentId / relative positions / parent
 *          extent
 */
export function createGroup(
  nodes: Node<SprawlNodeData>[],
  origin: { x: number; y: number }
): { group: Node<GroupNodeData>; children: Node<SprawlNodeData>[] } {
  const maxX = Math.max(...nodes.map((n) => n.position.x + nodeSize(n).w))
  const maxY = Math.max(...nodes.map((n) => n.position.y + nodeSize(n).h))
  const group: Node<GroupNodeData> = {
    id: nextId(),
    type: 'group',
    position: { x: origin.x, y: origin.y },
    style: { width: maxX - origin.x + 24, height: maxY - origin.y + 24 },
    data: { kind: 'group', title: 'group' }
  }
  const children = nodes.map((n) => ({
    ...n,
    parentId: group.id,
    extent: 'parent' as const,
    position: { x: n.position.x - origin.x, y: n.position.y - origin.y }
  }))
  return { group, children }
}

/**
 * Remove a group node, converting its children back to absolute canvas
 * positions (dropping parentId and the parent extent).
 *
 * Implementation note: written differently from the fork's `ungroupNodes`
 * (fold over a Map of group origins, destructure parent fields away) — the
 * clean-room check is a hard stop on structural twins.
 */
export function ungroup(groupId: string, nodes: Node<SprawlNodeData>[]): Node<SprawlNodeData>[] {
  const frame = nodes.find((n) => n.id === groupId)
  if (!frame) return nodes
  const anchor = frame.position
  const detach = (child: Node<SprawlNodeData>): Node<SprawlNodeData> => {
    if (child.parentId !== groupId) return child
    const { parentId, extent, ...rest } = child
    return { ...rest, position: { x: child.position.x + anchor.x, y: child.position.y + anchor.y } }
  }
  return nodes.reduce<Node<SprawlNodeData>[]>((acc, n) => {
    if (n.id === groupId) return acc
    acc.push(detach(n))
    return acc
  }, [])
}

/** Serialize live React Flow nodes to the persisted shape. */
export function serializeNodes(nodes: Node<SprawlNodeData>[]): SerializedNode[] {
  return nodes.map((n) => {
    // Chat history rides in node data; apply the conversation byte cap on the
    // way to disk (audit B5) so a long-running chat can't bloat project.json
    // and break the git-shareable-projects promise. The live node keeps its
    // full transcript — only the persisted copy is capped.
    const data =
      n.data.kind === 'chat' && n.data.messages.length > 0
        ? { ...n.data, messages: capConversationMessages(n.data.messages) }
        : n.data
    return {
      id: n.id,
      type: n.type ?? 'terminal',
      position: { x: n.position.x, y: n.position.y },
      parentId: n.parentId,
      width: n.width ?? undefined,
      height: n.height ?? undefined,
      style: n.style ? ({ ...n.style } as Record<string, unknown>) : undefined,
      data: { ...data }
    }
  })
}

/** Rehydrate persisted nodes into React Flow nodes. */
export function deserializeNodes(serialized: SerializedNode[]): Node<SprawlNodeData>[] {
  return serialized.map((n) => {
    const base = {
      id: n.id,
      type: (n.type as Node['type']) ?? 'terminal',
      position: { x: n.position.x, y: n.position.y },
      parentId: n.parentId,
      extent: n.parentId ? ('parent' as const) : undefined,
      // Restore the saved size so a resized node keeps its dimensions instead of
      // reverting to the content-measured default after a project switch.
      ...(n.width != null ? { width: n.width } : {}),
      ...(n.height != null ? { height: n.height } : {}),
      ...(n.style ? { style: { ...n.style } } : {})
    }
    const data = n.data as Partial<SprawlNodeData>
    if (data.kind === 'sticky') {
      return {
        ...base,
        data: { kind: 'sticky', text: '', color: 'slate', collapsed: false, ...data } as StickyNodeData
      }
    }
    if (data.kind === 'group') {
      return {
        ...base,
        data: { kind: 'group', title: 'group', ...data } as GroupNodeData
      }
    }
    if (data.kind === 'diff') {
      return {
        ...base,
        data: { kind: 'diff', path: null, base: 'HEAD', ...data } as DiffNodeData
      }
    }
    if (data.kind === 'editor') {
      return {
        ...base,
        data: { kind: 'editor', path: null, preview: false, ...data } as EditorNodeData
      }
    }
    if (data.kind === 'browser') {
      return {
        ...base,
        data: { kind: 'browser', url: 'about:blank', ...data } as BrowserNodeData
      }
    }
    if (data.kind === 'chat') {
      return {
        ...base,
        data: { kind: 'chat', messages: [], ...data, streaming: false } as ChatNodeData
      }
    }
    // Terminal (default branch). The node's DOM size comes from `style.width/
    // height` — NOT the top-level width/height (React Flow's measured dims). A
    // terminal rehydrated without a style (legacy saved nodes, or any preset
    // created before the style fix) collapses to a narrow left column, so
    // synthesize a default style when one is missing.
    const width = n.width ?? TERMINAL_DIMENSIONS.width
    const height = n.height ?? TERMINAL_DIMENSIONS.height
    return {
      ...base,
      ...TERMINAL_DIMENSIONS,
      ...(n.width != null ? { width: n.width } : {}),
      ...(n.height != null ? { height: n.height } : {}),
      style: n.style ? { ...n.style } : { width, height },
      data: { kind: 'terminal', title: 'shell', linkedIds: [], ...data } as TerminalNodeData
    }
  })
}

// ── Organize layouts (cascade / flat / restore) ─────────────────────────────
// Pure position math over the live node list — the canvas applies the result
// and records ONE undo snapshot, so every organize action is one Ctrl+Z.

/** How layouts are ordered: window nodes in selection order (or z-order when
 * nothing is selected), then stickies. Groups are never moved (their children
 * move with them via React Flow's parent extent); child nodes are skipped —
 * repositioning a parented child fights the group frame. The toolbar button
 * is single-click and CYCLES through the modes (cascade → flat → restore). */
export type OrganizeMode = 'cascade' | 'flat' | 'restore'

const ORGANIZE_GAP = 32

/** Undo record: one snapshot of every touched node's pre-layout position. */
export interface OrganizeSnapshot {
  mode: OrganizeMode
  /** nodeId → absolute position before the layout ran. */
  positions: Record<string, { x: number; y: number }>
}

function isOrganizable(n: Node<SprawlNodeData>): boolean {
  // Group frames stay put (moving one drags its children); parented children
  // are skipped (React Flow positions them relative to the parent anyway).
  return n.type !== 'group' && !n.parentId
}

function sortForLayout(a: Node<SprawlNodeData>, b: Node<SprawlNodeData>): number {
  // Stickies last: in cascade they ride above the windows; in flat they sit
  // in their own row after the window row (notes belong together, not
  // interleaved between terminals).
  const aSticky = a.type === 'sticky' ? 1 : 0
  const bSticky = b.type === 'sticky' ? 1 : 0
  if (aSticky !== bSticky) return aSticky - bSticky
  return 0
}

/** Cascade: every window at the same top-left with a fixed diagonal offset —
 * each title bar stays clickable. Stickies cascade in a tighter diagonal
 * ABOVE the windows (aligned along the top). */
export function layoutCascade(
  nodes: Node<SprawlNodeData>[],
  origin: { x: number; y: number } = { x: 0, y: 0 }
): { positions: Record<string, { x: number; y: number }>; snapshot: OrganizeSnapshot } {
  const movable = nodes.filter(isOrganizable).sort(sortForLayout)
  const windows = movable.filter((n) => n.type !== 'sticky')
  const stickies = movable.filter((n) => n.type === 'sticky')
  const step = 42
  const positions: Record<string, { x: number; y: number }> = {}
  windows.forEach((n, i) => {
    positions[n.id] = { x: origin.x + i * step, y: origin.y + i * step }
  })
  // Stickies: tighter step, stacked upward from the top window's top edge so
  // they hug the top of the cascade without covering the first title bar.
  const stickyW = nodeSize(stickies[0] ?? createStickyNode()).w
  stickies.forEach((n, i) => {
    positions[n.id] = {
      x: origin.x + i * (stickyW + 16),
      y: origin.y - 170 + (i % 3) * 8
    }
  })
  const snapshot: OrganizeSnapshot = {
    mode: 'cascade',
    positions: Object.fromEntries(movable.map((n) => [n.id, { ...n.position }]))
  }
  return { positions, snapshot }
}

/** Flat: all windows side by side in one row (same top edge), ordered by
 * width so the row reads evenly; the row wraps when it would exceed
 * maxRowWidth. Stickies align in a second row along the top of the windows
 * (left to right, evenly spaced). */
export function layoutFlat(
  nodes: Node<SprawlNodeData>[],
  origin: { x: number; y: number } = { x: 0, y: 0 },
  maxRowWidth = 5200
): { positions: Record<string, { x: number; y: number }>; snapshot: OrganizeSnapshot } {
  const movable = nodes.filter(isOrganizable).sort(sortForLayout)
  const windows = movable.filter((n) => n.type !== 'sticky')
  const stickies = movable.filter((n) => n.type === 'sticky')
  const positions: Record<string, { x: number; y: number }> = {}
  let x = origin.x
  let y = origin.y
  let rowHeight = 0
  for (const n of windows) {
    const size = nodeSize(n)
    if (x > origin.x && x + size.w - origin.x > maxRowWidth) {
      x = origin.x
      y += rowHeight + ORGANIZE_GAP
      rowHeight = 0
    }
    positions[n.id] = { x, y }
    x += size.w + ORGANIZE_GAP
    rowHeight = Math.max(rowHeight, size.h)
  }
  // Sticky row along the top: only when there are stickies AND a window row
  // exists to sit above — otherwise they take the origin row themselves.
  if (stickies.length > 0 && windows.length > 0) {
    let sx = origin.x
    for (const n of stickies) {
      const size = nodeSize(n)
      positions[n.id] = { x: sx, y: origin.y - size.h - ORGANIZE_GAP }
      sx += size.w + ORGANIZE_GAP
    }
  } else {
    let sx = origin.x
    for (const n of stickies) {
      const size = nodeSize(n)
      positions[n.id] = { x: sx, y }
      sx += size.w + ORGANIZE_GAP
    }
  }
  const snapshot: OrganizeSnapshot = {
    mode: 'flat',
    positions: Object.fromEntries(movable.map((n) => [n.id, { ...n.position }]))
  }
  return { positions, snapshot }
}

/** Restore: replay a snapshot taken by a previous organize (the snapshot IS
 * the "how they were"). Nodes added since the snapshot keep their position;
 * the returned snapshot is the consumed one (restore is one-shot — pressing
 * organize again starts a fresh cascade/flat cycle). */
export function layoutRestore(
  nodes: Node<SprawlNodeData>[],
  snapshot: OrganizeSnapshot
): { positions: Record<string, { x: number; y: number }>; snapshot: null } {
  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    const pos = snapshot.positions[n.id]
    if (pos) positions[n.id] = { ...pos }
  }
  return { positions, snapshot: null }
}

/** Apply a layout's positions to the node list (pure — used by Canvas). */
export function applyLayoutPositions(
  nodes: Node<SprawlNodeData>[],
  positions: Record<string, { x: number; y: number }>
): Node<SprawlNodeData>[] {
  return nodes.map((n) => {
    const pos = positions[n.id]
    return pos ? { ...n, position: { ...pos } } : n
  })
}
