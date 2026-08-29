// TDD — the 0.13.4 window-fit fix. On small displays (e.g. 1280x720) the
// hardcoded 1440x900 default opened LARGER than the screen, so everything
// anchored to the canvas bottom (React Flow zoom controls, the undo/redo
// history-bar) was cut off. The window must open inside the display's work
// area, and the UI gets a slight zoom-out so nothing is clipped at the edges.
import { describe, it, expect } from 'vitest'
import { clampWindowBounds, desiredUiZoom } from './window-metrics'

describe('clampWindowBounds', () => {
  it('keeps the preferred size when it already fits the work area', () => {
    const out = clampWindowBounds({ width: 1440, height: 900 }, { x: 0, y: 0, width: 1920, height: 1080 })
    expect(out).toEqual({ width: 1440, height: 900 })
  })

  it('shrinks the height when the work area is shorter (1280x720 case)', () => {
    const out = clampWindowBounds({ width: 1440, height: 900 }, { x: 0, y: 0, width: 1280, height: 720 })
    expect(out.width).toBeLessThanOrEqual(1280)
    expect(out.height).toBeLessThanOrEqual(720)
    // never below the app's declared minimums
    expect(out.width).toBeGreaterThanOrEqual(800)
    expect(out.height).toBeGreaterThanOrEqual(600)
  })

  it('clamps to the minimums on absurdly small work areas', () => {
    const out = clampWindowBounds({ width: 1440, height: 900 }, { x: 0, y: 0, width: 500, height: 400 })
    expect(out).toEqual({ width: 800, height: 600 })
  })

  it('leaves a small margin below the work area instead of butting against the display edge', () => {
    // 1280x720 → window should not butt against the exact display edge
    const out = clampWindowBounds({ width: 1440, height: 900 }, { x: 0, y: 0, width: 1280, height: 720 })
    expect(out.width).toBeLessThan(1280)
    expect(out.height).toBeLessThan(720)
  })

  it('passes through a degenerate (zero) work area untouched', () => {
    const out = clampWindowBounds({ width: 1440, height: 900 }, { x: 0, y: 0, width: 0, height: 0 })
    expect(out).toEqual({ width: 1440, height: 900 })
  })
})

describe('desiredUiZoom', () => {
  it('leaves 1080p-and-taller displays at 1.0', () => {
    expect(desiredUiZoom({ x: 0, y: 0, width: 1920, height: 1080 })).toBe(1)
    expect(desiredUiZoom({ x: 0, y: 0, width: 1440, height: 900 })).toBe(1)
  })

  it('zooms out slightly on short displays so bottom chrome fits', () => {
    const z720 = desiredUiZoom({ x: 0, y: 0, width: 1280, height: 720 })
    expect(z720).toBeGreaterThan(0.8)
    expect(z720).toBeLessThan(1)
  })

  it('never goes below 0.8 or above 1', () => {
    expect(desiredUiZoom({ x: 0, y: 0, width: 800, height: 480 })).toBe(0.8)
    expect(desiredUiZoom({ x: 0, y: 0, width: 4000, height: 2000 })).toBe(1)
  })

  it('zooms out less on mid-size displays than on tiny ones (monotonic)', () => {
    const big = desiredUiZoom({ x: 0, y: 0, width: 1600, height: 900 })
    const mid = desiredUiZoom({ x: 0, y: 0, width: 1366, height: 768 })
    const tiny = desiredUiZoom({ x: 0, y: 0, width: 1280, height: 720 })
    expect(big).toBeGreaterThanOrEqual(mid)
    expect(mid).toBeGreaterThanOrEqual(tiny)
  })

  it('returns 1 for a degenerate (zero) work area', () => {
    expect(desiredUiZoom({ x: 0, y: 0, width: 0, height: 0 })).toBe(1)
  })
})
