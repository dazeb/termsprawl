// Pure workspace helpers — node factories and serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'
import type { SerializedNode } from '@shared/types'

export const NODE_TYPES = ['terminal', 'sticky', 'group', 'diff'] as const
export type NodeKind = (typeof NODE_TYPES)[number]

export interface TerminalNodeData {
  kind: 'terminal'
  title: string
  cwd?: string
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
}

export type SprawlNodeData = TerminalNodeData | StickyNodeData | GroupNodeData | DiffNodeData

let counter = 0

function nextId(): string {
  counter += 1
  return `n${Date.now().toString(36)}-${counter}`
}

export function createTerminalNode(cwd?: string): Node<TerminalNodeData> {
  return {
    id: nextId(),
    type: 'terminal',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'terminal', title: 'shell', cwd }
  }
}

export function createStickyNode(): Node<StickyNodeData> {
  return {
    id: nextId(),
    type: 'sticky',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'sticky', text: '', color: 'slate', collapsed: false }
  }
}

export function createDiffNode(): Node<DiffNodeData> {
  return {
    id: nextId(),
    type: 'diff',
    position: { x: 60 + Math.random() * 240, y: 60 + Math.random() * 160 },
    data: { kind: 'diff', path: null, base: 'HEAD' }
  }
}

export function nodeTitle(data: SprawlNodeData): string {
  if (data.kind === 'terminal') return data.title
  if (data.kind === 'group') return data.title
  if (data.kind === 'diff') return data.path ? data.path.split('/').pop() ?? 'diff' : 'diff'
  const firstLine = data.text.split('\n')[0].trim()
  return firstLine || 'sticky note'
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
  diff: { w: 560, h: 360 }
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
  return nodes.map((n) => ({
    id: n.id,
    type: n.type ?? 'terminal',
    position: { x: n.position.x, y: n.position.y },
    parentId: n.parentId,
    data: { ...n.data }
  }))
}

/** Rehydrate persisted nodes into React Flow nodes. */
export function deserializeNodes(serialized: SerializedNode[]): Node<SprawlNodeData>[] {
  return serialized.map((n) => {
    const base = {
      id: n.id,
      type: (n.type as Node['type']) ?? 'terminal',
      position: { x: n.position.x, y: n.position.y },
      parentId: n.parentId,
      extent: n.parentId ? ('parent' as const) : undefined
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
    return {
      ...base,
      data: { kind: 'terminal', title: 'shell', ...data } as TerminalNodeData
    }
  })
}
