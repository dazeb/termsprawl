// useBootOverlay.test.ts — the boot overlay's exit timing.
//
// The transition logic is a pure function so it can be tested here: the repo
// runs tests in a node environment with no DOM, so the hook itself is only a
// thin timer around this.
import { describe, it, expect } from 'vitest'
import { resolveBootPhase, BOOT_FADE_MS } from './useBootOverlay'

describe('resolveBootPhase', () => {
  it('stays in boot while the workspace is still loading', () => {
    expect(resolveBootPhase(false, false)).toBe('boot')
    expect(resolveBootPhase(false, true)).toBe('boot')
  })

  it('cross-fades once loading finishes, and only for the fade duration', () => {
    expect(resolveBootPhase(true, false)).toBe('leaving')
  })

  it('is done once the fade has run out', () => {
    expect(resolveBootPhase(true, true)).toBe('done')
  })

  it('does not begin leaving before loading completes', () => {
    // Guards against a future refactor that fades out on a timer alone: the
    // overlay must never disappear while the canvas is still empty.
    const phases = [false, true].map((fadeDone) => resolveBootPhase(false, fadeDone))
    expect(phases).not.toContain('leaving')
    expect(phases).not.toContain('done')
  })
})

describe('BOOT_FADE_MS', () => {
  it('is a short, perceptible fade — not a hold', () => {
    expect(BOOT_FADE_MS).toBeGreaterThan(80)
    expect(BOOT_FADE_MS).toBeLessThan(320)
  })
})
