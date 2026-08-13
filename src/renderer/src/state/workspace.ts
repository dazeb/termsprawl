// Pure workspace helpers — node factories and serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'
import type { SerializedNode } from '@shared/types'

export const NODE_TYPES = ['terminal', 'sticky', 'group'] as const
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

export type SprawlNodeData = TerminalNodeData | StickyNodeData | GroupNodeData

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

export function nodeTitle(data: SprawlNodeData): string {
  if (data.kind === 'terminal') return data.title
  if (data.kind === 'group') return data.title
  const firstLine = data.text.split('\n')[0].trim()
  return firstLine || 'sticky note'
}

/**
 * Group selected nodes under a parent frame.
 * @param nodes  nodes to group (their positions are absolute canvas coords)
 * @param origin top-left of the frame in absolute coords; child positions
 *               become relative to it
 * @returns the new group node plus the children rewritten with parentId /
 *          relative positions / parent extent
 */
export function createGroup(
  nodes: Node<SprawlNodeData>[],
  origin: { x: number; y: number }
): { group: Node<GroupNodeData>; children: Node<SprawlNodeData>[] } {
  const group: Node<GroupNodeData> = {
    id: nextId(),
    type: 'group',
    position: { x: origin.x, y: origin.y },
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
 */
export function ungroup(groupId: string, nodes: Node<SprawlNodeData>[]): Node<SprawlNodeData>[] {
  const group = nodes.find((n) => n.id === groupId)
  if (!group) return nodes
  return nodes
    .filter((n) => n.id !== groupId)
    .map((n) =>
      n.parentId === groupId
        ? {
            ...n,
            parentId: undefined,
            extent: undefined,
            position: {
              x: n.position.x + group.position.x,
              y: n.position.y + group.position.y
            }
          }
        : n
    )
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
    return {
      ...base,
      data: { kind: 'terminal', title: 'shell', ...data } as TerminalNodeData
    }
  })
}
