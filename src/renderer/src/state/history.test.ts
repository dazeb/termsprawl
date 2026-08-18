import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { pruneHistorySnapshots } from './history'
import type { SprawlNodeData } from './workspace'

function node(id: string): Node<SprawlNodeData> {
  return {
    id,
    type: id.startsWith('terminal') ? 'terminal' : 'sticky',
    position: { x: 0, y: 0 },
    data: id.startsWith('terminal')
      ? { kind: 'terminal', title: id }
      : { kind: 'sticky', text: id, color: 'amber', collapsed: false }
  }
}

describe('pruneHistorySnapshots', () => {
  it('removes permanently closed terminals from every undo and redo snapshot', () => {
    const snapshots = [
      [node('terminal-a'), node('sticky-a')],
      [node('terminal-a'), node('terminal-b')]
    ]

    expect(pruneHistorySnapshots(snapshots, new Set(['terminal-a']))).toEqual([
      [node('sticky-a')],
      [node('terminal-b')]
    ])
  })
})
