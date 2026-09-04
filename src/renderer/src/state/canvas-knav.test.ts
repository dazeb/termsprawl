// canvas-knav.test.ts — keyboard navigation order helper (pure).
import { describe, it, expect } from 'vitest'
import { NAV_ORDER, nextSelection, type NavNode } from './canvas-knav'

function n(id: string, x: number, y: number, extra: Partial<NavNode> = {}): NavNode {
  return { id, position: { x, y }, ...extra }
}

describe('NAV_ORDER', () => {
  it('returns an empty array for an empty list', () => {
    expect(NAV_ORDER([])).toEqual([])
  })

  it('orders by y asc, then x asc — independent of array order', () => {
    const nodes = [n('c', 0, 500), n('a', 100, 0), n('b', 0, 100), n('d', 50, 0)]
    expect(NAV_ORDER(nodes).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('breaks y/x ties by id asc for stability', () => {
    const nodes = [n('z', 0, 0), n('a', 0, 0), n('m', 0, 0)]
    expect(NAV_ORDER(nodes).map((x) => x.id)).toEqual(['a', 'm', 'z'])
  })

  it('excludes group frames and parented children; keeps terminals/stickies/chats', () => {
    const nodes = [
      n('t1', 0, 0, { type: 'terminal' }),
      n('g', 0, 50, { type: 'group' }),
      n('kid', 0, 75, { parentId: 'g' }),
      n('s1', 0, 100, { type: 'sticky' }),
      n('chat1', 0, 150, { type: 'chat' })
    ]
    expect(NAV_ORDER(nodes).map((x) => x.id)).toEqual(['t1', 's1', 'chat1'])
  })

  it('does not mutate the input array', () => {
    const nodes = [n('b', 0, 100), n('a', 0, 0)]
    const snapshot = JSON.stringify(nodes)
    NAV_ORDER(nodes)
    expect(JSON.stringify(nodes)).toBe(snapshot)
  })
})

describe('nextSelection', () => {
  const nodes = [n('t1', 0, 0), n('s1', 0, 100), n('chat1', 0, 200)]

  it('returns null when there are no nodes', () => {
    expect(nextSelection([], null, 1)).toBeNull()
    expect(nextSelection([], 't1', -1)).toBeNull()
  })

  it('selects the only node regardless of dir/current', () => {
    const single = [n('only', 0, 0)]
    expect(nextSelection(single, null, 1)).toBe('only')
    expect(nextSelection(single, 'only', -1)).toBe('only')
  })

  it('starts at the first (dir=1) or last (dir=-1) node when current is null', () => {
    expect(nextSelection(nodes, null, 1)).toBe('t1')
    expect(nextSelection(nodes, null, -1)).toBe('chat1')
  })

  it('steps forward and wraps to the first node', () => {
    expect(nextSelection(nodes, 't1', 1)).toBe('s1')
    expect(nextSelection(nodes, 'chat1', 1)).toBe('t1')
  })

  it('steps backward and wraps to the last node', () => {
    expect(nextSelection(nodes, 's1', -1)).toBe('t1')
    expect(nextSelection(nodes, 't1', -1)).toBe('chat1')
  })

  it('treats an unknown currentId like null', () => {
    expect(nextSelection(nodes, 'ghost', 1)).toBe('t1')
    expect(nextSelection(nodes, 'ghost', -1)).toBe('chat1')
  })

  it('uses NAV_ORDER (filtered, reading order) not array order', () => {
    const messy = [n('kid', 0, -5, { parentId: 'g' }), n('g', 0, -5, { type: 'group' }), n('a', 0, 10)]
    expect(nextSelection(messy, null, 1)).toBe('a')
  })
})
