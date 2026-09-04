// canvas-knav.ts — keyboard navigation order for the canvas (pure helpers).
//
// Keyboard-only users need a predictable focus path across nodes. The order
// is a stable reading order (top-to-bottom, left-to-right) rather than
// z-order or creation order, so Tab always walks the canvas the way the eye
// does. Exclusions mirror isOrganizable (state/workspace.ts): group frames
// stay put and parented children are positioned relative to their parent, so
// neither participates in the cycle.
//
// Pure module — no DOM, no reactflow, no electron (state/ rule).

export interface NavNode {
  id: string
  type?: string | null
  parentId?: string
  position: { x: number; y: number }
}

/** Reading order: y asc, then x asc, then id asc (stable, deterministic).
 * Group frames and parented children are excluded. Input is not mutated. */
export function NAV_ORDER<T extends NavNode>(nodes: T[]): T[] {
  return nodes
    .filter((n) => n.type !== 'group' && !n.parentId)
    .slice()
    .sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y
      if (a.position.x !== b.position.x) return a.position.x - b.position.x
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/** Next node id in nav order (dir=1) or previous (dir=-1), wrapping at the
 * ends. null currentId (or an id that is no longer on the canvas) starts at
 * the first/last node; a single node always resolves to itself. */
export function nextSelection(
  nodes: NavNode[],
  currentId: string | null,
  dir: 1 | -1
): string | null {
  const order = NAV_ORDER(nodes)
  if (order.length === 0) return null
  if (order.length === 1) return order[0].id
  const index = order.findIndex((n) => n.id === currentId)
  if (index === -1) return dir === 1 ? order[0].id : order[order.length - 1].id
  const next = (index + dir + order.length) % order.length
  return order[next].id
}
