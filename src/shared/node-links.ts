// Node link (Phase 18) parse/normalize rules — shared by core (project file
// load), main, and the renderer. Lives in shared/ because the renderer imports
// it directly and core/workspace-files pulls node:fs (which must never reach
// the browser bundle). Electron-free, DOM-free, never throws.
import type { NodeLink } from './types'

const LINK_KINDS = ['file-output', 'context-inject', 'a2a-peer'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** True when `config` matches its declared kind's required shape. */
function isValidLinkConfig(config: unknown, kind: string): boolean {
  if (!isRecord(config) || config.kind !== kind) return false
  switch (kind) {
    case 'file-output':
      return (
        typeof config.path === 'string' &&
        (config.mode === 'overwrite' || config.mode === 'append') &&
        typeof config.header === 'boolean'
      )
    case 'context-inject':
      return typeof config.wrapper === 'boolean' && typeof config.pastePointer === 'boolean'
    case 'a2a-peer':
      return (
        (config.message === 'last-output' || config.message === 'full-capture') &&
        typeof config.deliverReply === 'boolean'
      )
    default:
      return false
  }
}

/**
 * Normalize one persisted link entry; null when it is junk (caller drops it).
 * Accepts any field order and tolerates a non-integer createdAt so future
 * versions don't strand user data; drops an absent/invalid lastRun silently.
 */
export function parseNodeLink(raw: unknown): NodeLink | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const source = asString(raw.source)
  const target = asString(raw.target)
  const kind = asString(raw.kind)
  if (!id || !source || !target || !kind) return null
  if (!(LINK_KINDS as readonly string[]).includes(kind)) return null
  if (source === target) return null
  if (typeof raw.auto !== 'boolean' || !isValidLinkConfig(raw.config, kind)) return null
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now()
  const link: NodeLink = {
    id,
    source,
    target,
    kind: kind as NodeLink['kind'],
    auto: raw.auto,
    config: raw.config as NodeLink['config'],
    createdAt
  }
  const lr = raw.lastRun
  if (isRecord(lr) && typeof lr.at === 'number' && typeof lr.ok === 'boolean' && typeof lr.summary === 'string') {
    link.lastRun = { at: lr.at, ok: lr.ok, summary: lr.summary }
  }
  return link
}

/** Normalize a persisted links array, dropping junk entries. */
export function parseNodeLinks(raw: unknown): NodeLink[] {
  if (!Array.isArray(raw)) return []
  return raw.map(parseNodeLink).filter((l): l is NodeLink => l !== null)
}
