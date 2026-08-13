// Pure workspace helpers — node factories and serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'
import type { SerializedNode } from '@shared/types'

export const NODE_TYPES = ['terminal'] as const
export type NodeKind = (typeof NODE_TYPES)[number]

export interface TerminalNodeData {
  kind: 'terminal'
  title: string
  cwd?: string
}

export type SprawlNodeData = TerminalNodeData

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

export function nodeTitle(data: SprawlNodeData): string {
  return data.kind === 'terminal' ? data.title : data.kind
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
  return serialized.map((n) => ({
    id: n.id,
    type: (n.type as Node['type']) ?? 'terminal',
    position: { x: n.position.x, y: n.position.y },
    data: { kind: 'terminal', title: 'shell', ...n.data } as SprawlNodeData
  }))
}
