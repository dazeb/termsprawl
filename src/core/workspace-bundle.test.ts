// Workspace bundle — TDD. The bundle is the ENTIRE workspace as one json
// file: buildBundle serializes (index + every project's nodes + terminal
// scrollback) and applyBundlePlan computes the import plan (fresh project
// ids, collision-safe names, remapped terminal ids — ids are load-bearing:
// pty session == tmux key == scrollback file). See
// .hermes/plans/2026-08-30_123805-workspace-bundle.md.
import { describe, it, expect } from 'vitest'
import { buildBundle, applyBundlePlan, isValidBundle, terminalIdsIn, BUNDLE_FORMAT, BUNDLE_VERSION, type BundleSourceDeps } from './workspace-bundle'
import type { SerializedNode } from './workspace-files'

const INDEX = {
  version: 1 as const,
  projects: [
    { id: 'p-1', name: 'main', cwd: null, closed: false, archived: false },
    { id: 'p-2', name: 'archived', cwd: null, closed: true, archived: true },
  ],
}
const NODES: Record<string, SerializedNode[]> = {
  'p-1': [
    { id: 'n-1', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 't1' } } as unknown as SerializedNode,
    { id: 'n-2', type: 'sticky', position: { x: 400, y: 0 }, data: { kind: 'sticky', title: 'note', text: 'x' } } as unknown as SerializedNode,
  ],
}
const SCROLLBACKS: Record<string, string> = { 'n-1': 'line1\nline2' }

function deps(overrides: Partial<BundleSourceDeps> = {}): BundleSourceDeps {
  return {
    index: INDEX,
    nodesFor: (id: string) => NODES[id] ?? [],
    revFor: () => 7,
    scrollbacksFor: (ids: readonly string[]) =>
      Object.fromEntries(ids.filter((i) => SCROLLBACKS[i] !== undefined).map((i) => [i, SCROLLBACKS[i]])),
    now: () => new Date('2026-08-30T12:00:00Z'),
    ...overrides,
  }
}

describe('terminalIdsIn', () => {
  it('collects only terminal-type node ids, in order', () => {
    expect(terminalIdsIn(NODES['p-1'])).toEqual(['n-1'])
  })
  it('skips nodes without ids', () => {
    expect(terminalIdsIn([{ type: 'terminal' }, { id: 'n-9', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'x' } }] as unknown as SerializedNode[])).toEqual(['n-9'])
  })
})

describe('buildBundle', () => {
  it('produces the bundle header + spaces-envelope body', () => {
    const b = buildBundle(deps())
    expect(b.bundle).toEqual({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, savedAt: '2026-08-30T12:00:00.000Z' })
    expect(b.workspace.index).toEqual(INDEX)
    expect(b.workspace.projects['p-1']).toEqual(NODES['p-1'])
    expect(b.workspace.projects['p-2']).toEqual([])
    expect(b.workspace.revs).toEqual({ 'p-1': 7, 'p-2': 7 })
    expect(b.scrollbacks).toEqual(SCROLLBACKS)
    expect(b.files).toEqual({})
  })
  it('serializes to parseable JSON with the bundle key first', () => {
    const parsed = JSON.parse(JSON.stringify(buildBundle(deps())))
    expect(Object.keys(parsed)[0]).toBe('bundle')
    expect(parsed.bundle.format).toBe(BUNDLE_FORMAT)
  })
  it('carries currentProjectId when the caller provides it', () => {
    const b = buildBundle(deps({ currentProjectId: 'p-1' }))
    expect(b.workspace.currentProjectId).toBe('p-1')
  })
  it('omits the revs entries for projects only when rev is 0? no — includes all, rev 0 stays', () => {
    const b = buildBundle(deps({ revFor: (id) => (id === 'p-1' ? 0 : 3) }))
    expect(b.workspace.revs).toEqual({ 'p-1': 0, 'p-2': 3 })
  })
})

describe('isValidBundle', () => {
  it('accepts a real bundle', () => {
    expect(isValidBundle(buildBundle(deps()))).toBe(true)
  })
  it('accepts an unknown-future version? NO — rejects newer, accepts same', () => {
    const b = buildBundle(deps())
    ;(b.bundle as { version: number }).version = BUNDLE_VERSION + 1
    expect(isValidBundle(b)).toBe(false)
  })
  it('rejects junk', () => {
    for (const junk of [null, undefined, 42, 'x', {}, { bundle: {} }, { bundle: { format: 'nope', version: 1 } }, { bundle: { format: BUNDLE_FORMAT, version: 1 } }, { bundle: { format: BUNDLE_FORMAT, version: BUNDLE_VERSION }, workspace: null }]) {
      expect(isValidBundle(junk)).toBe(false)
    }
  })
  it('rejects a bundle whose projects map is missing entries for index projects', () => {
    const b = buildBundle(deps())
    delete (b.workspace.projects as Record<string, unknown>)['p-1']
    expect(isValidBundle(b)).toBe(false)
  })
})

describe('applyBundlePlan', () => {
  const importOpts = (over: Record<string, unknown> = {}) => ({
    existingNames: [] as string[],
    existingTerminalIds: new Set<string>(),
    newProjectId: (() => 'p-new-1') as () => string,
    newTerminalId: (i: number) => `n-remap-${i}`,
    ...over,
  })

  it('imports every project (incl. archived) with fresh PROJECT ids; non-colliding terminal ids stay', () => {
    const bundle = buildBundle(deps())
    const plan = applyBundlePlan(bundle, importOpts())
    expect(plan.projects).toHaveLength(2)
    const main = plan.projects.find((p) => p.name === 'main')!
    expect(main.id).toBe('p-new-1') // fresh id, never the bundle's 'p-1'
    expect(main.cwd).toBeNull()
    expect(main.rev).toBe(7)
    const term = main.nodes.find((n) => (n as { type?: string }).type === 'terminal') as { id: string }
    const sticky = main.nodes.find((n) => (n as { type?: string }).type === 'sticky') as { id: string }
    expect(term.id).toBe('n-1') // no collision → keep (cheap path)
    expect(sticky.id).toBe('n-2')
    expect(plan.pendingScrollbacks.get('n-1')).toBe('line1\nline2')
  })

  it('collision-safe names with the shared suffix scheme', () => {
    const bundle = buildBundle(deps())
    const plan = applyBundlePlan(bundle, importOpts({ existingNames: ['main', 'other'] }))
    expect(plan.projects.find((p) => p.name.startsWith('main'))!.name).toBe('main 2')
    const again = applyBundlePlan(bundle, importOpts({ existingNames: ['main', 'main 2'] }))
    expect(again.projects.find((p) => p.name.startsWith('main'))!.name).toBe('main 3')
  })

  it('keeps non-colliding terminal ids as-is (cheap path)', () => {
    const bundle = buildBundle(deps())
    const plan = applyBundlePlan(bundle, importOpts())
    const main = plan.projects.find((p) => p.name === 'main')!
    const term = main.nodes.find((n) => (n as { type?: string }).type === 'terminal') as { id: string }
    expect(term.id).toBe('n-1')
    expect(plan.pendingScrollbacks.get('n-1')).toBe('line1\nline2')
  })

  it('remaps EVERY terminal when even one id collides (consistent, no mixed identity)', () => {
    const bundle = buildBundle(deps())
    const plan = applyBundlePlan(bundle, importOpts({ existingTerminalIds: new Set(['n-1']) }))
    const main = plan.projects.find((p) => p.name === 'main')!
    const term = main.nodes.find((n) => (n as { type?: string }).type === 'terminal') as { id: string }
    expect(term.id).toBe('n-remap-1')
    expect(plan.pendingScrollbacks.get('n-remap-1')).toBe('line1\nline2')
  })

  it('multi-terminal nodes keep pairwise distinct remapped ids', () => {
    const b = buildBundle(deps({
      nodesFor: (id) =>
        id === 'p-1'
          ? [
              { id: 'n-1', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 'a' } },
              { id: 'n-3', type: 'terminal', position: { x: 300, y: 0 }, data: { kind: 'terminal', title: 'b' } },
            ]
          : [],
      scrollbacksFor: (ids) => Object.fromEntries(ids.map((i) => [i, `text-${i}`])),
    }))
    const plan = applyBundlePlan(b, importOpts({ existingTerminalIds: new Set(['n-1']) }))
    const main = plan.projects[0]
    const termIds = main.nodes.filter((n) => (n as { type?: string }).type === 'terminal').map((n) => (n as { id: string }).id)
    expect(new Set(termIds).size).toBe(2)
    expect(plan.pendingScrollbacks.get(termIds[0])).toBe('text-n-1')
    expect(plan.pendingScrollbacks.get(termIds[1])).toBe('text-n-3')
  })

  it('throws on a bundle with no projects (invalid — empty index rejected by isValidBundle)', () => {
    const b = buildBundle(deps())
    ;(b.workspace.index.projects as unknown[]) = []
    expect(() => applyBundlePlan(b, importOpts())).toThrow(/invalid workspace bundle/i)
  })

  it('throws on an invalid bundle (wrong format/version)', () => {
    const b = buildBundle(deps())
    ;(b.bundle as { format: string }).format = 'nope'
    expect(() => applyBundlePlan(b, importOpts())).toThrow(/invalid workspace bundle/i)
  })
})
