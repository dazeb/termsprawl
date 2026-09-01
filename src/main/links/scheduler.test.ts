import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkScheduler } from './scheduler'
import type { NodeLink } from '@shared/types'

function link(overrides: Partial<NodeLink> = {}): NodeLink {
  return {
    id: 'lk-1',
    source: 'src-1',
    target: 'tgt-1',
    kind: 'file-output',
    auto: true,
    config: { kind: 'file-output', path: 'out/x.md', mode: 'overwrite', header: true },
    createdAt: 1,
    ...overrides
  }
}

interface FakeDeps {
  runs: string[]
  onRun(linkId: string): Promise<void>
}

function makeDeps(): FakeDeps {
  const runs: string[] = []
  return {
    runs,
    onRun: async (linkId) => {
      runs.push(linkId)
    }
  }
}

describe('LinkScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs an auto link after the quiescence gap, coalescing bursts', async () => {
    const deps = makeDeps()
    const s = new LinkScheduler(deps.onRun, { gapMs: 1000 })
    s.setLinks([link()])
    s.markDirty('src-1')
    s.markDirty('src-1')
    s.markDirty('src-1')
    await vi.advanceTimersByTimeAsync(999)
    expect(deps.runs).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.runs).toEqual(['lk-1'])
    s.dispose()
  })

  it('ignores manual links', async () => {
    const deps = makeDeps()
    const s = new LinkScheduler(deps.onRun, { gapMs: 100 })
    s.setLinks([link({ auto: false })])
    s.markDirty('src-1')
    await vi.advanceTimersByTimeAsync(500)
    expect(deps.runs).toEqual([])
    s.dispose()
  })

  it('runs links whose metadata arrives after the dirty signal (boot race)', async () => {
    const deps = makeDeps()
    const s = new LinkScheduler(deps.onRun, { gapMs: 100 })
    s.markDirty('src-1')
    s.setLinks([link()])
    await vi.advanceTimersByTimeAsync(150)
    expect(deps.runs).toEqual(['lk-1'])
    s.dispose()
  })

  it('replaces links: a removed link no longer runs', async () => {
    const deps = makeDeps()
    const s = new LinkScheduler(deps.onRun, { gapMs: 100 })
    s.setLinks([link()])
    s.setLinks([])
    s.markDirty('lk-1')
    await vi.advanceTimersByTimeAsync(500)
    expect(deps.runs).toEqual([])
    s.dispose()
  })

  it('dispose cancels pending runs (project switch)', async () => {
    const deps = makeDeps()
    const s = new LinkScheduler(deps.onRun, { gapMs: 100 })
    s.setLinks([link()])
    s.markDirty('lk-1')
    s.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(deps.runs).toEqual([])
  })

  it('a failing run never rejects or breaks the scheduler', async () => {
    const runs: string[] = []
    const s = new LinkScheduler(async (id) => {
      runs.push(id)
      throw new Error('boom')
    }, { gapMs: 100 })
    s.setLinks([link()])
    s.markDirty('src-1')
    await vi.advanceTimersByTimeAsync(200)
    expect(runs).toEqual(['lk-1'])
    s.markDirty('src-1')
    await vi.advanceTimersByTimeAsync(200)
    expect(runs).toEqual(['lk-1', 'lk-1'])
    s.dispose()
  })

  it('does not double-run while a previous run is in flight', async () => {
    let resolveRun: () => void = () => {}
    const runs: string[] = []
    const s = new LinkScheduler(async (id) => {
      runs.push(id)
      await new Promise<void>((r) => {
        resolveRun = r
      })
    }, { gapMs: 100 })
    s.setLinks([link()])
    s.markDirty('src-1')
    await vi.advanceTimersByTimeAsync(150)
    s.markDirty('src-1') // arrives while the first run is still in flight
    await vi.advanceTimersByTimeAsync(500)
    resolveRun()
    await vi.advanceTimersByTimeAsync(200)
    expect(runs).toEqual(['lk-1', 'lk-1'])
    s.dispose()
  })
})
