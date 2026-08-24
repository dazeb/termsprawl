// Phase 12.2 — announcements. Pure parsing of a GitHub release payload into the
// announcement the renderer shows. Electron-free (the fetch lives in main).
import type { Announcement } from '../shared/types'

/** Parse a GitHub `/releases/latest` JSON payload into an Announcement, or null
 * when it has no usable tag. `version` strips the leading 'v'. */
export function parseLatestRelease(payload: unknown): Announcement | null {
  const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  if (!obj || typeof obj.tag_name !== 'string' || obj.tag_name.length === 0) return null
  const version = obj.tag_name.replace(/^v/, '')
  const title = typeof obj.name === 'string' && obj.name.length > 0 ? obj.name : obj.tag_name
  const body = typeof obj.body === 'string' ? obj.body : ''
  return { version, title, body }
}
