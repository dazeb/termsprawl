// Phase 12.2 — announcements. TDD: the failing tests drive parseLatestRelease.
import { describe, it, expect } from 'vitest'
import { parseLatestRelease } from './announcements'

describe('parseLatestRelease', () => {
  it('builds an announcement from a GitHub release payload, stripping the leading v', () => {
    const json = { tag_name: 'v0.5.3', name: 'v0.5.3', body: 'Wayland fix.' }
    expect(parseLatestRelease(json)).toEqual({
      version: '0.5.3',
      title: 'v0.5.3',
      body: 'Wayland fix.'
    })
  })

  it('returns null when the payload has no usable tag_name', () => {
    expect(parseLatestRelease({ name: 'x' })).toBeNull()
    expect(parseLatestRelease(null)).toBeNull()
    expect(parseLatestRelease('nope')).toBeNull()
  })

  it('tolerates a missing body and missing name', () => {
    expect(parseLatestRelease({ tag_name: 'v1.0.0' })).toEqual({
      version: '1.0.0',
      title: 'v1.0.0',
      body: ''
    })
  })
})
