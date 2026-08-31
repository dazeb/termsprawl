// Prototype-pollution probe for the workspace-bundle import path (review
// follow-up). Payloads use __proto__/constructor keys at every position the
// import path walks: index projects, the projects map, and scrollback keys.
import { describe, it, expect } from 'vitest'
import { applyBundlePlan, isValidBundle, type WorkspaceBundle } from './workspace-bundle'

const terminalNode = { id: 'n-1', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'x' } }

const maliciousBundle = {
  bundle: { format: 'termsprawl-workspace', version: 1, savedAt: '2026-08-30T12:00:00.000Z' },
  workspace: {
    index: { projects: [{ id: 'p-1', name: '__proto__', cwd: null }] },
    projects: { 'p-1': [terminalNode] },
    revs: { 'p-1': 1 },
  },
  files: {},
  scrollbacks: { 'n-1': 'text' },
} as unknown as WorkspaceBundle

// TERMINAL_ID_PATTERN as shipped in pty-manager.ts (importSnapshot's gate).
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

describe('prototype-pollution resistance', () => {
  it('a __proto__ project NAME is treated as a plain string (data, not inheritance)', () => {
    const plan = applyBundlePlan(maliciousBundle, {
      existingNames: [],
      existingTerminalIds: new Set<string>(),
      newProjectId: () => 'p-x',
      newTerminalId: (i) => `nb-${i}`,
    })
    expect(plan.projects[0].name).toBe('__proto__')
  })

  it('lookup-smuggling is impossible: only index-listed project ids are ever read', () => {
    // JSON.parse makes __proto__ an OWN property (own-keys prove it), so the
    // projects map can carry one. applyBundlePlan iterates index.projects and
    // reads projects[meta.id] — a __proto__ KEY in the map is never accessed,
    // and a __proto__-NAMED project can only appear via the index (as data).
    const crafted = JSON.parse(
      '{"bundle":{"format":"termsprawl-workspace","version":1,"savedAt":"x"},"workspace":{"index":{"projects":[]},"projects":{"__proto__":{"x":1}}},"files":{},"scrollbacks":{}}'
    )
    expect(Object.keys(crafted.workspace.projects)).toEqual(['__proto__']) // own prop, not inherited
    expect(isValidBundle(crafted)).toBe(false) // empty index → rejected outright
    // And with a valid index, a __proto__ KEY in the projects map is simply
    // never accessed (access is projects[meta.id] for meta.id in the index).
    const withIndex = JSON.parse(
      '{"bundle":{"format":"termsprawl-workspace","version":1,"savedAt":"x"},"workspace":{"index":{"projects":[{"id":"p-1","name":"ok","cwd":null}]},"projects":{"p-1":[],"__proto__":{"x":1}}},"files":{},"scrollbacks":{}}'
    )
    expect(isValidBundle(withIndex)).toBe(true) // map has an extra proto key but index is consistent
    const plan = applyBundlePlan(withIndex, {
      existingNames: [],
      existingTerminalIds: new Set<string>(),
      newProjectId: () => 'p-x',
      newTerminalId: (i) => `nb-${i}`,
    })
    expect(plan.projects).toHaveLength(1) // only p-1 imported; __proto__ entry ignored
  })

  it('scrollback keys: __proto__ is REJECTED by TERMINAL_ID_PATTERN (leading alnum required)', () => {
    // The pattern's leading [A-Za-z0-9] rejects __proto__ (starts with '_'),
    // so ptyManager.importScrollback never even writes such a file. Belt and
    // braces: pendingScrollbacks is a real Map where '__proto__' is inert
    // anyway, and the disk write would be a plain filename regardless.
    expect(TERMINAL_ID_PATTERN.test('__proto__')).toBe(false)
    const plan = applyBundlePlan(
      {
        ...maliciousBundle,
        scrollbacks: JSON.parse('{"__proto__":{"polluted":true},"n-1":"text"}'),
      } as unknown as WorkspaceBundle,
      {
        existingNames: [],
        existingTerminalIds: new Set<string>(),
        newProjectId: () => 'p-x',
        newTerminalId: (i) => `nb-${i}`,
      }
    )
    // pendingScrollbacks: the __proto__ entry's value is an OBJECT (not a
    // string), so applyBundlePlan's typeof-string filter skips it — nothing
    // lands, and TERMINAL_ID_PATTERN in ptyManager.importScrollback would
    // reject the key anyway (leading alnum required).
    expect(plan.pendingScrollbacks.has('__proto__')).toBe(false)
    expect(plan.pendingScrollbacks.get('n-1')).toBe('text')
    // And the runtime is not polluted by any of the above:
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
