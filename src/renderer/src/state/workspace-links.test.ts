import { describe, expect, it } from 'vitest'
import type { NodeLink } from '@shared/types'
import {
  deserializeLinks,
  linksFromSerialized,
  removeLinksForNode,
  serializeLinks
} from './workspace-links'

function link(overrides: Partial<NodeLink> = {}): NodeLink {
  return {
    id: 'lk-1',
    source: 'n1',
    target: 'n2',
    kind: 'file-output',
    auto: false,
    config: { kind: 'file-output', path: 'out/x.md', mode: 'overwrite', header: true },
    createdAt: 100,
    ...overrides
  }
}

describe('serializeLinks', () => {
  it('returns a plain JSON-safe copy with lastRun dropped (stale after restart)', () => {
    const out = serializeLinks([link({ lastRun: { at: 5, ok: true, summary: 'wrote' } })])
    expect(out).toEqual([link()])
    expect(out[0].lastRun).toBeUndefined()
  })

  it('keeps an explicit label', () => {
    const out = serializeLinks([link({ label: 'ship logs to notes' })])
    expect(out[0].label).toBe('ship logs to notes')
  })

  it('keeps the label key ABSENT when undefined (no "label":undefined on disk)', () => {
    const out = serializeLinks([link({ label: undefined })])
    expect('label' in out[0]).toBe(false)
    expect(JSON.stringify(out[0])).not.toContain('label')
  })
})

describe('deserializeLinks', () => {
  it('round-trips valid links', () => {
    const input = serializeLinks([link(), link({ id: 'lk-2', kind: 'context-inject', config: { kind: 'context-inject', wrapper: true, pastePointer: false } })])
    const out = deserializeLinks(JSON.parse(JSON.stringify(input)))
    expect(out).toEqual(input)
  })

  it('filters junk entries instead of failing the load', () => {
    const junk = [
      null,
      42,
      'a link',
      { id: '', source: 'n1', target: 'n2', kind: 'file-output', auto: false, config: {}, createdAt: 1 },
      { id: 'lk-3', source: 'n1', target: 'n1', kind: 'file-output', auto: false, config: { kind: 'file-output', path: '', mode: 'overwrite', header: true }, createdAt: 1 },
      { id: 'lk-4', source: 'n1', target: 'n2', kind: 'wat', auto: false, config: { kind: 'file-output', path: '', mode: 'overwrite', header: true }, createdAt: 1 },
      { id: 'lk-5', source: 'n1', target: 'n2', kind: 'file-output', auto: false, config: { kind: 'wrong', path: '' }, createdAt: 1 },
      { id: 'lk-6', source: 'n1', target: 'n2', kind: 'a2a-peer', auto: false, config: { kind: 'file-output', path: '', mode: 'overwrite', header: true }, createdAt: 1 },
      link({ id: 'lk-ok' })
    ]
    const out = deserializeLinks(junk)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('lk-ok')
  })

  it('accepts both link config orders and non-integer createdAt (forward compat)', () => {
    const out = deserializeLinks([
      { id: 'a', source: 's', target: 't', kind: 'context-inject', auto: true, createdAt: 1, config: { kind: 'context-inject', wrapper: false, pastePointer: true } },
      { id: 'b', source: 's', target: 't', kind: 'context-inject', config: { kind: 'context-inject', wrapper: false, pastePointer: true }, auto: true, createdAt: 2 }
    ])
    expect(out).toHaveLength(2)
    expect(out[0].config).toEqual({ kind: 'context-inject', wrapper: false, pastePointer: true })
  })

  it('round-trips a label through the parse whitelist', () => {
    const persisted = [{ id: 'a', source: 's', target: 't', kind: 'file-output', auto: false, createdAt: 1, config: { kind: 'file-output', path: '', mode: 'overwrite', header: true }, label: 'my named link' }]
    const out = deserializeLinks(persisted)
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('my named link')
  })

  it('drops a non-string label (junk tolerated, link kept)', () => {
    const persisted = [{ id: 'a', source: 's', target: 't', kind: 'file-output', auto: false, createdAt: 1, config: { kind: 'file-output', path: '', mode: 'overwrite', header: true }, label: 42 }]
    const out = deserializeLinks(persisted)
    expect(out).toHaveLength(1)
    expect('label' in out[0]).toBe(false)
  })
})

describe('linksFromSerialized', () => {
  it('builds React Flow edges with link ids', () => {
    const edges = linksFromSerialized([link(), link({ id: 'lk-2', source: 'n2', target: 'n3' })])
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ id: 'lk-1', source: 'n1', target: 'n2', type: 'nodelink' })
    expect(edges[0].data).toMatchObject({ kind: 'file-output', auto: false })
    expect(edges[1].id).toBe('lk-2')
  })
})

describe('removeLinksForNode', () => {
  it('drops every link touching the deleted node', () => {
    const links = [
      link({ id: 'a', source: 'n1', target: 'n2' }),
      link({ id: 'b', source: 'n3', target: 'n1' }),
      link({ id: 'c', source: 'n2', target: 'n3' })
    ]
    const out = removeLinksForNode(links, 'n1')
    expect(out.map((l) => l.id)).toEqual(['c'])
  })
})
