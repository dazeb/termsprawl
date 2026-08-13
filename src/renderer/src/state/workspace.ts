// Pure workspace helpers — node factories and serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'
import type { SerializedNode } from '@shared/types'

export const NODE_TYPES = ['terminal', 'sticky'] as const
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

export type SprawlNodeData = TerminalNodeData | StickyNodeData

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
  const firstLine = data.text.split('\n')[0].trim()
  return firstLine || 'sticky note'
}

/** Serialize live React Flow nodes to the persisted shape. */
export function serializeNodes(nodes: Node<SprawlNodeData>[]): SerializedNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type ?? 'terminal',
    position: { x: n.position.x, y: n.position.y },
    data: { ...n.data }
  }))
}

/** Rehydrate persisted nodes into React Flow nodes. */
export function deserializeNodes(serialized: SerializedNode[]): Node<SprawlNodeData>[] {
  return serialized.map((n) => {
    const base = {
      id: n.id,
      type: (n.type as Node['type']) ?? 'terminal',
      position: { x: n.position.x, y: n.position.y }
    }
    const data = n.data as Partial<SprawlNodeData>
    if (data.kind === 'sticky') {
      return {
        ...base,
        data: { kind: 'sticky', text: '', color: 'slate', collapsed: false, ...data } as StickyNodeData
      }
    }
    return {
      ...base,
      data: { kind: 'terminal', title: 'shell', ...data } as TerminalNodeData
    }
  })
}
