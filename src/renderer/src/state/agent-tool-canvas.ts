import type { Node } from 'reactflow'
import type { ToolRequest } from '@shared/agent-tools'
import type { AgentId } from '@shared/agents/config'
import { createAgentNode, createBrowserNode, createDiffNode, createEditorNode, createGroup, createStickyNode, createTerminalNode, serializeNodes, topZ, type SprawlNodeData } from './workspace'

/** Pure operation planner; Canvas applies the result to its existing live state. */
export function applyCanvasTool(nodes: Node<SprawlNodeData>[], request: ToolRequest, cwd?: string): { nodes: Node<SprawlNodeData>[]; value: unknown } {
  const { operation, args } = request
  if (operation === 'canvas_list') return { nodes, value: serializeNodes(nodes) }
  const target = (): Node<SprawlNodeData> => {
    const node = nodes.find((n) => n.id === args.nodeId)
    if (!node) throw new Error('Node not found in the visible project')
    return node
  }
  if (operation === 'canvas_move') {
    target()
    return { nodes: nodes.map((n) => n.id === args.nodeId ? { ...n, position: { x: args.x as number, y: args.y as number } } : n), value: { nodeId: args.nodeId } }
  }
  if (operation === 'canvas_resize') {
    const node = target()
    const minimum = node.type === 'browser' ? [320, 240] : [240, 140]
    if (Number(args.width) < minimum[0] || Number(args.height) < minimum[1] || Number(args.width) > 8000 || Number(args.height) > 8000) throw new Error(`Size must be between ${minimum.join('×')} and 8000×8000`)
    return { nodes: nodes.map((n) => n.id === args.nodeId ? { ...n, width: Number(args.width), height: Number(args.height), style: { ...n.style, width: Number(args.width), height: Number(args.height) } } : n), value: { nodeId: node.id } }
  }
  if (operation === 'canvas_select' || operation === 'canvas_group') {
    const selected = new Set(args.nodeIds as string[])
    const members = nodes.filter((n) => selected.has(n.id))
    if (members.length !== selected.size) throw new Error('Selection contains an unknown node')
    if (operation === 'canvas_select') return { nodes: nodes.map((n) => ({ ...n, selected: selected.has(n.id) })), value: { nodeIds: [...selected] } }
    if (members.some((n) => n.parentId || n.type === 'group')) throw new Error('Group only top-level non-group nodes')
    const grouped = createGroup(members, { x: Math.min(...members.map((n) => n.position.x)) - 24, y: Math.min(...members.map((n) => n.position.y)) - 48 })
    grouped.group.data.title = String(args.title ?? 'group')
    return { nodes: [...nodes.filter((n) => !selected.has(n.id)), grouped.group, ...grouped.children], value: { nodeId: grouped.group.id, nodeIds: [...selected] } }
  }
  let node: Node<SprawlNodeData>
  switch (operation) {
    case 'terminal_open': {
      const terminal = createTerminalNode(cwd)
      terminal.data.title = String(args.title ?? 'shell')
      node = terminal
      break
    }
    case 'agent_launch': node = createAgentNode(args.agent as AgentId, cwd); break
    case 'browser_open': node = createBrowserNode(String(args.url)); break
    case 'sticky_open': { const sticky = createStickyNode(); sticky.data.text = String(args.text); node = sticky; break }
    case 'artifact_open': {
      if (args.view === 'diff') { const diff = createDiffNode(); diff.data.path = String(args.path); node = diff }
      else node = createEditorNode(String(args.path))
      break
    }
    default: throw new Error('Unsupported canvas operation')
  }
  const right = nodes.filter((n) => !n.parentId).reduce((x, n) => Math.max(x, n.position.x + Number(n.style?.width ?? n.width ?? 720)), 0)
  node.position = { x: right + 40, y: 60 }
  node.zIndex = topZ(nodes)
  node.selected = true
  return { nodes: [...nodes.map((n) => ({ ...n, selected: false })), node], value: { nodeId: node.id, ...(node.data.kind === 'browser' ? { tabId: node.data.activeTabId } : {}) } }
}
