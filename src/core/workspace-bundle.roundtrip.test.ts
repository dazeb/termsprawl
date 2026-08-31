// Workspace bundle round-trip (phase 16 A3): build a bundle from a seeded
// fake workspace, compute the import plan against SIMULATED existing state
// (a colliding project name AND a colliding terminal id), then land the
// plan's pending scrollbacks through the REAL ScrollbackStore and read them
// back — the remapped terminal id must carry the original text. Pure fs +
// the real store; no electron, no tmux, no PTY.
// See .hermes/plans/2026-08-30_123805-workspace-bundle.md (A3 test step).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScrollbackStore } from './scrollback-store'
import {
  applyBundlePlan,
  buildBundle,
  terminalIdsIn,
  type BundleSourceDeps
} from './workspace-bundle'
import type { SerializedNode } from './workspace-files'

const SCROLLBACK_TEXT = 'session restored\n$ cargo test\n...all 41 passed\n'

const SEED_INDEX = {
  version: 1 as const,
  projects: [
    { id: 'p-a', name: 'main', cwd: null, closed: false, archived: false },
    { id: 'p-b', name: 'side', cwd: null, closed: false, archived: false }
  ]
}

const SEED_NODES: Record<string, SerializedNode[]> = {
  'p-a': [
    { id: 'n-1', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 't1' } },
    { id: 'n-2', type: 'sticky', position: { x: 320, y: 0 }, data: { kind: 'sticky', title: 'note', text: 'hi' } }
  ] as unknown as SerializedNode[],
  'p-b': [
    { id: 'n-3', type: 'terminal', position: { x: 0, y: 0 }, data: { kind: 'terminal', title: 't2' } }
  ] as unknown as SerializedNode[]
}

const SEED_SCROLLBACKS: Record<string, string> = { 'n-1': SCROLLBACK_TEXT, 'n-3': 'second terminal\n' }

function seedDeps(overrides: Partial<BundleSourceDeps> = {}): BundleSourceDeps {
  return {
    index: SEED_INDEX,
    nodesFor: (id) => SEED_NODES[id] ?? [],
    revFor: (id) => (id === 'p-a' ? 4 : 0),
    scrollbacksFor: (ids) =>
      Object.fromEntries(
        ids.filter((id) => SEED_SCROLLBACKS[id] !== undefined).map((id) => [id, SEED_SCROLLBACKS[id]])
      ),
    ...overrides
  }
}

/** The fresh-id scheme the main-process import handler uses (deterministic
 * here so assertions stay readable; uniqueness is what matters). */
function makeIdFactories(prefix: string): { newProjectId: () => string; newTerminalId: (i: number) => string } {
  let projectCounter = 0
  return {
    newProjectId: () => {
      projectCounter += 1
      return `p-${prefix}-${projectCounter}`
    },
    newTerminalId: (i) => `nb-${prefix}-${i}`
  }
}

describe('workspace bundle round-trip (build → plan → real ScrollbackStore)', () => {
  let userDataPath: string
  let store: ScrollbackStore

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'ts-bundle-roundtrip-'))
    store = new ScrollbackStore(userDataPath)
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('imports against colliding name + colliding terminal id: name suffixed, colliding project remapped, scrollback follows the new ids', () => {
    const bundle = buildBundle(seedDeps())
    // Simulate a file round-trip: the handler parses json off disk.
    const parsed = JSON.parse(JSON.stringify(bundle))

    // Simulated existing local state: a project named 'main' AND a terminal
    // with id 'n-1' already in use (both collide with the bundle).
    const plan = applyBundlePlan(parsed, {
      existingNames: ['main', 'other'],
      existingTerminalIds: new Set(['n-1']),
      ...makeIdFactories('test')
    })

    // Both seed projects are planned, with unique fresh ids.
    expect(plan.projects).toHaveLength(2)
    const ids = plan.projects.map((p) => p.id)
    expect(new Set(ids).size).toBe(2)

    // Name collision-safe: 'main' is taken → 'main 2'; 'side' is free.
    expect(plan.projects.map((p) => p.name)).toEqual(['main 2', 'side'])

    // The project whose terminal id collides gets ALL its terminals remapped;
    // its non-terminal ids are NOT load-bearing and stay. The other project
    // (no collision) keeps its ids.
    const [first, second] = plan.projects
    expect(first.nodes.map((n) => n.id)).toEqual(['nb-test-1', 'n-2'])
    expect(second.nodes.map((n) => n.id)).toEqual(['n-3'])

    // A bundle's cwd belonged to another machine — never adopted.
    expect(plan.projects.every((p) => p.cwd === null)).toBe(true)
    // Revs ride along for the restore-path guard.
    expect(plan.projects.map((p) => p.rev)).toEqual([4, 0])

    // Scrollback keys are the POST-remap ids (remapped where remapping happened).
    expect([...plan.pendingScrollbacks.keys()].sort()).toEqual(['n-3', 'nb-test-1'])
    expect(plan.pendingScrollbacks.get('nb-test-1')).toBe(SCROLLBACK_TEXT)
    expect(plan.pendingScrollbacks.get('n-3')).toBe('second terminal\n')

    // The REAL ScrollbackStore lands them (same call shape as the handler);
    // read back via the remapped id and assert the text carried over.
    const imported = store.importSnapshot(Object.fromEntries(plan.pendingScrollbacks))
    expect(imported).toBe(2)
    expect(store.read('nb-test-1')).toBe(SCROLLBACK_TEXT)
    expect(store.read('n-3')).toBe('second terminal\n')
    // The colliding LOCAL id was never written under — its store file stays
    // absent, so a live local terminal's history can't be clobbered.
    expect(store.read('n-1')).toBeNull()
  })

  it('keeps ids and names when nothing collides (same-machine reopen)', () => {
    const bundle = buildBundle(seedDeps())
    const plan = applyBundlePlan(bundle, {
      existingNames: ['unrelated'],
      existingTerminalIds: new Set(['zz-some-other-terminal']),
      ...makeIdFactories('fresh')
    })

    expect(plan.projects.map((p) => p.name)).toEqual(['main', 'side'])
    expect(plan.projects[0].nodes.map((n) => n.id)).toEqual(['n-1', 'n-2'])
    expect([...plan.pendingScrollbacks.keys()]).toEqual(['n-1', 'n-3'])

    expect(store.importSnapshot(Object.fromEntries(plan.pendingScrollbacks))).toBe(2)
    expect(store.read('n-1')).toBe(SCROLLBACK_TEXT)
  })

  it('caps oversized scrollback through the real store like every snapshot write', () => {
    const bundle = buildBundle(
      seedDeps({ scrollbacksFor: () => ({ 'n-1': 'x'.repeat(300 * 1024) }) })
    )
    const plan = applyBundlePlan(bundle, {
      existingNames: [],
      existingTerminalIds: new Set(),
      ...makeIdFactories('cap')
    })

    // No id collision here → terminals keep their ids; the store caps at
    // 256 KiB, keeping the TAIL (most recent output).
    store.importSnapshot(Object.fromEntries(plan.pendingScrollbacks))
    const stored = store.read('n-1') ?? ''
    expect(stored.length).toBeLessThanOrEqual(256 * 1024)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.endsWith('x')).toBe(true)
  })

  it('rejects a corrupt bundle with a clean message before anything lands', () => {
    expect(() =>
      applyBundlePlan(
        { bundle: { format: 'nope', version: 1, savedAt: '' } } as unknown as Parameters<typeof applyBundlePlan>[0],
        { existingNames: [], existingTerminalIds: new Set(), ...makeIdFactories('x') }
      )
    ).toThrowError(/Invalid workspace bundle/)
  })
})
