import { describe, expect, it } from 'vitest'
import {
  applyFileTreeChrome,
  edgeHotZone,
  initialFileTreeChrome,
  shouldKeepTreeOpen
} from './edge-reveal'

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

describe('file tree chrome', () => {
  it('starts closed on the left, unpinned, files section', () => {
    expect(initialFileTreeChrome()).toEqual({
      side: 'left',
      open: false,
      pinned: false,
      section: 'files'
    })
  })

  it('reveals on one side only', () => {
    const left = applyFileTreeChrome(initialFileTreeChrome(), { type: 'reveal', side: 'left' })
    expect(left).toEqual({ side: 'left', open: true, pinned: false, section: 'files' })
    expect(applyFileTreeChrome(left, { type: 'reveal', side: 'right' })).toEqual({
      side: 'right',
      open: true,
      pinned: false,
      section: 'files'
    })
  })

  it('flips the open panel to the other side', () => {
    const open = applyFileTreeChrome(initialFileTreeChrome(), { type: 'reveal', side: 'left' })
    expect(applyFileTreeChrome(open, { type: 'flipSide' }).side).toBe('right')
    expect(applyFileTreeChrome({ ...open, side: 'right' }, { type: 'flipSide' }).side).toBe('left')
  })

  it('stays open on mouse leave when pinned', () => {
    const pinned = applyFileTreeChrome(
      applyFileTreeChrome(initialFileTreeChrome(), { type: 'reveal', side: 'left' }),
      { type: 'togglePin' }
    )
    expect(pinned.pinned).toBe(true)
    expect(applyFileTreeChrome(pinned, { type: 'requestClose' }).open).toBe(true)
  })

  it('closes on mouse leave when unpinned', () => {
    const open = applyFileTreeChrome(initialFileTreeChrome(), { type: 'reveal', side: 'left' })
    expect(applyFileTreeChrome(open, { type: 'requestClose' }).open).toBe(false)
  })

  it('switches sections and keeps the panel open', () => {
    const open = applyFileTreeChrome(initialFileTreeChrome(), { type: 'reveal', side: 'left' })
    const source = applyFileTreeChrome(open, { type: 'switchSection', section: 'source' })
    expect(source.section).toBe('source')
    expect(source.open).toBe(true)
    // The section survives close/reopen.
    const closed = applyFileTreeChrome(source, { type: 'requestClose' })
    expect(closed.section).toBe('source')
    const reopened = applyFileTreeChrome(closed, { type: 'reveal', side: 'left' })
    expect(reopened.section).toBe('source')
    // Switching from a closed state opens the panel too.
    const fromClosed = applyFileTreeChrome(initialFileTreeChrome(), {
      type: 'switchSection',
      section: 'plugins'
    })
    expect(fromClosed.section).toBe('plugins')
    expect(fromClosed.open).toBe(true)
  })
})
