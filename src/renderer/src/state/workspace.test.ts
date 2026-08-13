import { describe, expect, it } from 'vitest'
import {
  createStickyNode,
  createTerminalNode,
  deserializeNodes,
  nodeTitle,
  serializeNodes
} from './workspace'

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
