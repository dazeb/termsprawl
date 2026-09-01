// Node link registry (Phase 18) — which link kinds exist, which node kinds can
// source or target them, and how to extract content from a source node.
// Electron-free, pure, deps injected, never throws (fail-open like
// context-links.ts). The engine that runs links lives in ./engine.

import type { LinkConfig, LinkKind } from '@shared/types'

/** Node kinds a link can EXTRACT content from, per link kind. */
export const LINK_SOURCES: Record<LinkKind, readonly string[]> = {
  'file-output': ['terminal', 'sticky', 'editor', 'chat'],
  'context-inject': ['terminal', 'sticky', 'editor', 'chat'],
  'a2a-peer': ['terminal', 'chat']
}

/**
 * Node kinds a link can INJECT into, per link kind. 'file' and 'a2a-peer' are
 * pseudo-targets (a filesystem path and a configured A2A peer), not node kinds
 * — a `file-output` link connects to any node visually but writes a file, and
 * an `a2a-peer` link targets the configured peer, never a node.
 */
export const LINK_TARGETS: Record<LinkKind, readonly string[]> = {
  'file-output': ['file'],
  'context-inject': ['chat', 'terminal'],
  'a2a-peer': ['a2a-peer']
}

/** Content extracted from a link's source node. */
export type SourceContent =
  | { kind: 'text'; text: string; title: string }
  | { kind: 'conversation'; text: string; title: string }
  | { kind: 'empty' }

/** A node as the link engine sees it (no React Flow dependency). */
export interface NodeExtractInput {
  nodeId: string
  nodeKind: string
  data: Record<string, unknown>
}

export interface ExtractDeps {
  /** Terminal/agent pane capture (already exists on PtyManager). */
  capturePane(nodeId: string): Promise<string | null>
  /** Editor node: read the saved file at data.path (null on any error). */
  readFile(path: string): Promise<string | null>
}

/** Human-readable error when a link is invalid, or null when valid. */
export function validateLink(kind: LinkKind, sourceKind: string, targetKind: string): string | null {
  const sources = LINK_SOURCES[kind]
  const targets = LINK_TARGETS[kind]
  if (!sources || !targets) return `unknown link kind: ${String(kind)}`
  if (!sources.includes(sourceKind)) {
    return `a ${sourceKind} node cannot source a ${kind} link`
  }
  if (!targets.includes(targetKind)) {
    return `a ${kind} link cannot target a ${targetKind} node`
  }
  return null
}

/** Default per-kind options for a new link. */
export function linkDefaultConfig(kind: LinkKind): LinkConfig {
  switch (kind) {
    case 'file-output':
      return { kind: 'file-output', path: '', mode: 'overwrite', header: true }
    case 'context-inject':
      return { kind: 'context-inject', wrapper: true, pastePointer: true }
    case 'a2a-peer':
      return { kind: 'a2a-peer', message: 'last-output', deliverReply: false }
  }
}

/** Safe default output filename for a source title ("My Agent!" → "my-agent"). */
export function sanitizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'output'
  )
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function nonEmpty(s: string | null): string | null {
  if (s === null) return null
  const t = s.trim()
  return t.length > 0 ? s : null
}

/**
 * Extract link content from a source node. Never throws: every branch is
 * wrapped and a failing dep degrades to `{ kind: 'empty' }`.
 */
export async function extractContent(
  node: NodeExtractInput,
  deps: ExtractDeps
): Promise<SourceContent> {
  try {
    switch (node.nodeKind) {
      case 'sticky': {
        const text = nonEmpty(asString(node.data.text))
        return text ? { kind: 'text', text, title: 'sticky' } : { kind: 'empty' }
      }
      case 'terminal': {
        const text = nonEmpty(await deps.capturePane(node.nodeId))
        return text ? { kind: 'text', text, title: asString(node.data.title) ?? 'terminal' } : { kind: 'empty' }
      }
      case 'editor': {
        const path = asString(node.data.path)
        if (!path) return { kind: 'empty' }
        const text = nonEmpty(await deps.readFile(path))
        return text ? { kind: 'text', text, title: baseName(path) } : { kind: 'empty' }
      }
      case 'chat': {
        const messages = Array.isArray(node.data.messages) ? node.data.messages : []
        const lines: string[] = []
        for (const raw of messages) {
          if (!raw || typeof raw !== 'object') continue
          const m = raw as Record<string, unknown>
          const role = asString(m.role) ?? 'note'
          const content = asString(m.content) ?? ''
          if (content.trim().length === 0) continue
          lines.push(`${role}: ${content}`)
        }
        if (lines.length === 0) return { kind: 'empty' }
        const title = asString(node.data.title) ?? 'chat'
        return { kind: 'conversation', text: lines.join('\n\n'), title }
      }
      default:
        return { kind: 'empty' }
    }
  } catch {
    return { kind: 'empty' }
  }
}
