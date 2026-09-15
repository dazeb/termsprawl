// Node-link (Phase 18) pure helpers for the renderer: validation, React Flow
// edge mapping, and delete cascades. Persistence normalization that must be
// shared with core lives in core/workspace-files.ts (parseNodeLink); these
// helpers assume already-normalized links and stay React Flow–shaped.

import type { Edge } from 'reactflow'
import type { NodeLink } from '@shared/types'
import { parseNodeLinks } from '@shared/node-links'

/** Normalize a persisted links array (junk dropped) — core owns the rules. */
export function deserializeLinks(raw: unknown): NodeLink[] {
  return parseNodeLinks(raw)
}

/**
 * Serialize live links for the project file: a plain JSON-safe copy with the
 * transient lastRun dropped (a stale result from a previous app run is noise)
 * and undefined-valued optional fields (label) removed so the in-memory copy
 * matches what JSON.stringify puts on disk.
 */
export function serializeLinks(links: NodeLink[]): NodeLink[] {
  return links.map((l) => {
    const { lastRun: _dropped, label, ...rest } = l
    const out: NodeLink = { ...rest }
    if (typeof label === 'string' && label.trim().length > 0) {
      out.label = label.trim().slice(0, 60)
    }
    return out
  })
}

/** Build React Flow edges from persisted links (the canvas renders these). */
export function linksFromSerialized(links: NodeLink[]): Edge[] {
  return links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    type: 'nodelink',
    data: { kind: l.kind, auto: l.auto, lastRun: l.lastRun, label: l.label }
  }))
}

/** Rebuild link data without discarding React Flow's current selection. */
export function reconcileLinkEdges(links: NodeLink[], previous: Edge[]): Edge[] {
  const selected = new Map(previous.map((edge) => [edge.id, edge.selected]))
  return linksFromSerialized(links).map((edge) => ({ ...edge, selected: selected.get(edge.id) }))
}

export type LinkPatch = Partial<Pick<NodeLink, 'kind' | 'auto' | 'config' | 'label'>>

/** Missing label means unchanged; an explicit undefined removes it. */
export function patchLink(link: NodeLink, patch: LinkPatch): NodeLink {
  const next = {
    ...link,
    ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
    ...(patch.auto !== undefined ? { auto: patch.auto } : {}),
    ...(patch.config !== undefined ? { config: patch.config } : {})
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
    if (patch.label === undefined) delete next.label
    else next.label = patch.label
  }
  return next
}

/** Drop every link that touches the deleted node (both directions). */
export function removeLinksForNode(links: NodeLink[], nodeId: string): NodeLink[] {
  return links.filter((l) => l.source !== nodeId && l.target !== nodeId)
}
