// Pure workspace helpers — node factories and (later) serializers.
// React Flow is the single live source of truth for nodes; this module holds
// no state, only the shapes.

import type { Node } from 'reactflow'

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
