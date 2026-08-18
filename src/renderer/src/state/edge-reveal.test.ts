import { describe, expect, it } from 'vitest'
import { edgeHotZone, shouldKeepTreeOpen } from './edge-reveal'

describe('edgeHotZone', () => {
  it('returns left when the pointer is in the left strip', () => {
    expect(edgeHotZone(4, 800, 12)).toBe('left')
    expect(edgeHotZone(12, 800, 12)).toBe('left')
  })

  it('returns right when the pointer is in the right strip', () => {
    expect(edgeHotZone(790, 800, 12)).toBe('right')
    expect(edgeHotZone(788, 800, 12)).toBe('right')
  })

  it('returns null in the middle of the canvas', () => {
    expect(edgeHotZone(400, 800, 12)).toBeNull()
    expect(edgeHotZone(13, 800, 12)).toBeNull()
    expect(edgeHotZone(787, 800, 12)).toBeNull()
  })
})

describe('shouldKeepTreeOpen', () => {
  it('stays open while the pointer is over the left panel', () => {
    expect(
      shouldKeepTreeOpen({ x: 40, width: 800, side: 'left', panelWidth: 240 })
    ).toBe(true)
  })

  it('stays open while the pointer is over the right panel', () => {
    expect(
      shouldKeepTreeOpen({ x: 780, width: 800, side: 'right', panelWidth: 240 })
    ).toBe(true)
  })

  it('closes once the pointer leaves the open panel', () => {
    expect(
      shouldKeepTreeOpen({ x: 300, width: 800, side: 'left', panelWidth: 240 })
    ).toBe(false)
    expect(
      shouldKeepTreeOpen({ x: 400, width: 800, side: 'right', panelWidth: 240 })
    ).toBe(false)
  })
})
