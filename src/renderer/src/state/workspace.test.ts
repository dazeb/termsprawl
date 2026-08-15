import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import {
  createDiffNode,
  createGroup,
  createStickyNode,
  createTerminalNode,
  deserializeNodes,
  nodeTitle,
  removeNode,
  serializeNodes,
  ungroup
} from './workspace'
import type { SprawlNodeData } from './workspace'

describe('sticky nodes', () => {
  it('creates a sticky node with defaults', () => {
    const node = createStickyNode()
    expect(node.type).toBe('sticky')
    expect(node.data.kind).toBe('sticky')
    expect(node.data.text).toBe('')
    expect(node.data.color).toBe('slate')
    expect(node.data.collapsed).toBe(false)
  })

  it('round-trips sticky data through serialize/deserialize', () => {
    const node = createStickyNode()
    node.data.text = 'remember to hydrate'
    node.data.color = 'amber'
    node.data.collapsed = true

    const restored = deserializeNodes(serializeNodes([node]))[0]
    expect(restored.type).toBe('sticky')
    if (restored.data.kind !== 'sticky') throw new Error('expected sticky node')
    expect(restored.data.text).toBe('remember to hydrate')
    expect(restored.data.color).toBe('amber')
    expect(restored.data.collapsed).toBe(true)
  })

  it('does not break terminal round-trips', () => {
    const node = createTerminalNode('/tmp')
    const restored = deserializeNodes(serializeNodes([node]))[0]
    expect(restored.type).toBe('terminal')
    if (restored.data.kind !== 'terminal') throw new Error('expected terminal node')
    expect(restored.data.cwd).toBe('/tmp')
  })

  it('titles sticky notes with their first line', () => {
    const node = createStickyNode()
    expect(nodeTitle(node.data)).toBe('sticky note')
    node.data.text = 'TODO\n- ship phase 6'
    expect(nodeTitle(node.data)).toBe('TODO')
  })
})

describe('group nodes', () => {
  const twoNodes = (): Node<SprawlNodeData>[] => {
    const a = createTerminalNode('/tmp')
    a.position = { x: 100, y: 120 }
    a.id = 'term-a'
    const b = createStickyNode()
    b.position = { x: 300, y: 260 }
    b.id = 'sticky-b'
    return [a, b]
  }

  it('createGroup returns a group node at the bounds origin', () => {
    const [a, b] = twoNodes()
    const { group, children } = createGroup([a, b], { x: 80, y: 100 })

    expect(group.type).toBe('group')
    expect(group.data.kind).toBe('group')
    expect(group.position).toEqual({ x: 80, y: 100 })
    // bounds computed from node positions (min x/y)
    expect(children).toHaveLength(2)
  })

  it('children gain parentId and relative positions', () => {
    const [a, b] = twoNodes()
    const { group, children } = createGroup([a, b], { x: 80, y: 100 })

    const childA = children.find((n) => n.id === 'term-a')
    const childB = children.find((n) => n.id === 'sticky-b')
    expect(childA?.parentId).toBe(group.id)
    expect(childB?.parentId).toBe(group.id)
    expect(childA?.position).toEqual({ x: 20, y: 20 }) // 100-80, 120-100
    expect(childB?.position).toEqual({ x: 220, y: 160 }) // 300-80, 260-100
  })

  it('children are constrained to the parent', () => {
    const [a] = twoNodes()
    const { children } = createGroup([a], { x: 80, y: 100 })
    expect(children[0].extent).toBe('parent')
  })

  it('ungroup removes the group and restores absolute positions', () => {
    const [a, b] = twoNodes()
    const { group, children } = createGroup([a, b], { x: 80, y: 100 })
    const grouped = [...children, group]

    const result = ungroup(group.id, grouped)
    expect(result.some((n) => n.id === group.id)).toBe(false)

    const childA = result.find((n) => n.id === 'term-a')
    const childB = result.find((n) => n.id === 'sticky-b')
    expect(childA?.position).toEqual({ x: 100, y: 120 })
    expect(childB?.position).toEqual({ x: 300, y: 260 })
    expect(childA?.parentId).toBeUndefined()
    expect(childB?.extent).toBeUndefined()
  })

  it('round-trips parentId through serialize/deserialize', () => {
    const [a, b] = twoNodes()
    const { group, children } = createGroup([a, b], { x: 80, y: 100 })
    const nodes = [...children, group]

    const restored = deserializeNodes(serializeNodes(nodes))
    const childA = restored.find((n) => n.id === 'term-a')
    const groupRestored = restored.find((n) => n.id === group.id)

    expect(childA?.parentId).toBe(group.id)
    expect(childA?.position).toEqual({ x: 20, y: 20 })
    expect(groupRestored?.type).toBe('group')
    expect(groupRestored?.data.kind).toBe('group')
  })
})

describe('removeNode', () => {
  it('removes a plain node and leaves others', () => {
    const a = createTerminalNode('/tmp')
    a.id = 'term-a'
    const b = createStickyNode()
    b.id = 'sticky-b'

    const result = removeNode([a, b], 'term-a')
    expect(result.map((n) => n.id)).toEqual(['sticky-b'])
  })

  it('removing a group ungroups its children instead of deleting them', () => {
    const a = createTerminalNode('/tmp')
    a.position = { x: 100, y: 120 }
    a.id = 'term-a'
    const { group, children } = createGroup([a], { x: 80, y: 100 })
    const grouped = [...children, group]

    const result = removeNode(grouped, group.id)
    expect(result.some((n) => n.id === group.id)).toBe(false)
    const childA = result.find((n) => n.id === 'term-a')
    expect(childA?.position).toEqual({ x: 100, y: 120 })
    expect(childA?.parentId).toBeUndefined()
  })

  it('unknown id is a no-op', () => {
    const a = createTerminalNode('/tmp')
    a.id = 'term-a'
    expect(removeNode([a], 'ghost')).toHaveLength(1)
  })
})

describe('diff nodes', () => {
  it('creates a diff node with defaults', () => {
    const node = createDiffNode()
    expect(node.type).toBe('diff')
    expect(node.data.kind).toBe('diff')
    expect(node.data.path).toBeNull()
    expect(node.data.base).toBe('HEAD')
  })

  it('round-trips diff data through serialize/deserialize', () => {
    const node = createDiffNode()
    node.data.path = '/repo/src/app.ts'
    node.data.base = 'staged'

    const restored = deserializeNodes(serializeNodes([node]))[0]
    expect(restored.type).toBe('diff')
    if (restored.data.kind !== 'diff') throw new Error('expected diff node')
    expect(restored.data.path).toBe('/repo/src/app.ts')
    expect(restored.data.base).toBe('staged')
  })

  it('rehydrates legacy diff data with defaults when fields are missing', () => {
    const restored = deserializeNodes([
      { id: 'd1', type: 'diff', position: { x: 0, y: 0 }, data: { kind: 'diff' } }
    ])[0]
    if (restored.data.kind !== 'diff') throw new Error('expected diff node')
    expect(restored.data.path).toBeNull()
    expect(restored.data.base).toBe('HEAD')
  })

  it('titles diff nodes with the file basename, else "diff"', () => {
    const node = createDiffNode()
    expect(nodeTitle(node.data)).toBe('diff')
    node.data.path = '/repo/src/app.ts'
    expect(nodeTitle(node.data)).toBe('app.ts')
  })
})
