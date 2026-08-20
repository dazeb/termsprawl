// Epoch-guarded worktree store (Phase 8, Task 8.3). TDD.

import { describe, expect, it } from 'vitest'
import { WorktreeStore } from './worktree-store'

const WT: Record<string, { path: string; branch: string | null; head: string | null }> = {
  main: { path: '/repo', branch: 'main', head: 'aaa' },
  feat: { path: '/repo-wt', branch: 'feature/x', head: 'bbb' }
}

describe('WorktreeStore', () => {
  it('accepts the first poll and returns its list', () => {
    const store = new WorktreeStore()
    expect(store.get()).toEqual([])
    const r = store.reconcile([WT.main], 1)
    expect(r.accepted).toBe(true)
    expect(store.get()).toEqual([WT.main])
    expect(store.versionOf()).toBe(1)
  })

  it('drops a stale (out-of-order) poll', () => {
    const store = new WorktreeStore()
    store.reconcile([WT.main], 2)
    const stale = store.reconcile([], 1)
    expect(stale.accepted).toBe(false)
    expect(store.get()).toEqual([WT.main])
  })

  it('drops a poll at the same version (no-op re-read)', () => {
    const store = new WorktreeStore()
    store.reconcile([WT.main], 1)
    expect(store.reconcile([WT.feat], 1).accepted).toBe(false)
    expect(store.get()).toEqual([WT.main])
  })

  it('applies a newer poll and reconciles the list', () => {
    const store = new WorktreeStore()
    store.reconcile([WT.main], 1)
    expect(store.reconcile([WT.main, WT.feat], 3).accepted).toBe(true)
    expect(store.get()).toHaveLength(2)
  })

  it('tracks a worktree path (has/at)', () => {
    const store = new WorktreeStore()
    store.reconcile([WT.main, WT.feat], 1)
    expect(store.has('/repo')).toBe(true)
    expect(store.has('/repo-wt')).toBe(true)
    expect(store.has('/other')).toBe(false)
    expect(store.at('/repo-wt')).toEqual(WT.feat)
    expect(store.at('/other')).toBeUndefined()
  })
})