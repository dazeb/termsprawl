// Node-link (Phase 18) pure helpers for the renderer: validation, React Flow
// edge mapping, and delete cascades. Persistence normalization that must be
// shared with core lives in core/workspace-files.ts (parseNodeLink); these
// helpers assume already-normalized links and stay React Flow–shaped.

import type { Edge } from 'reactflow'
import type { NodeLink } from '@shared/types'
import { parseNodeLinks } from '../../../core/workspace-files'

/** Normalize a persisted links array (junk dropped) — core owns the rules. */
export function deserializeLinks(raw: unknown): NodeLink[] {
  return parseNodeLinks(raw)
}

/**
 * Serialize live links for the project file: a plain JSON-safe copy with the
 * transient lastRun dropped (a stale result from a previous app run is noise).
 */
export function serializeLinks(links: NodeLink[]): NodeLink[] {
  return links.map((l) => {
    const { lastRun: _dropped, ...rest } = l
    return { ...rest }
  })
}

/** Build React Flow edges from persisted links (the canvas renders these). */
export function linksFromSerialized(links: NodeLink[]): Edge[] {
  return links.map((l) => ({
    id: l.id,
    source: l.source,
    target: l.target,
    type: 'nodelink',
    data: { kind: l.kind, auto: l.auto, lastRun: l.lastRun }
  }))
}

/** Drop every link that touches the deleted node (both directions). */
export function removeLinksForNode(links: NodeLink[], nodeId: string): NodeLink[] {
  return links.filter((l) => l.source !== nodeId && l.target !== nodeId)
}
