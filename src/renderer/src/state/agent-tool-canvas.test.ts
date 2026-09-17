import { describe, expect, it } from 'vitest'
import { applyCanvasTool } from './agent-tool-canvas'
import { createTerminalNode, createAgentNode, isAgentNodeData, serializeNodes, deserializeNodes } from './workspace'

describe('canvas tool operations', () => {
  it('retains explicit custom agent identity for context linking after persistence', () => {
    const custom = createAgentNode('custom', '/tmp')
    const restored = deserializeNodes(serializeNodes([custom]))[0]
    expect(restored.data).toMatchObject({ agentId: 'custom' })
    expect(isAgentNodeData(restored.data as typeof custom.data)).toBe(true)
  })
  it('creates stable nodes using existing factories and persists their identities', () => {
    const existing = createTerminalNode('/tmp')
    const result = applyCanvasTool([existing], { operation: 'browser_open', args: { url: 'https://example.com' } })
    expect(result.nodes[0].id).toBe(existing.id)
    const browser = result.nodes[1]
    expect(browser.type).toBe('browser')
    expect(result.value).toMatchObject({ nodeId: browser.id })
    expect(deserializeNodes(serializeNodes(result.nodes))[1].id).toBe(browser.id)
    expect(result.nodes[1].position.x).toBeGreaterThan(existing.position.x + 720)
  })
  it('rejects unknown targets and invalid dimensions without changing the canvas', () => {
    const node = createTerminalNode()
    expect(() => applyCanvasTool([node], { operation: 'canvas_move', args: { nodeId: 'missing', x: 0, y: 0 } })).toThrow('not found')
    expect(() => applyCanvasTool([node], { operation: 'canvas_resize', args: { nodeId: node.id, width: 1, height: 1 } })).toThrow('Size')
    expect(node.style?.width).toBe(720)
  })
  it('groups without replacing terminal IDs and rejects nested groups', () => {
    const one = createTerminalNode(), two = createTerminalNode()
    const result = applyCanvasTool([one, two], { operation: 'canvas_group', args: { nodeIds: [one.id, two.id], title: 'Work' } })
    expect(result.nodes.map((n) => n.id)).toContain(one.id)
    expect(result.nodes[0].data).toMatchObject({ title: 'Work' })
    expect(() => applyCanvasTool(result.nodes, { operation: 'canvas_group', args: { nodeIds: [one.id] } })).toThrow('top-level')
  })
})
