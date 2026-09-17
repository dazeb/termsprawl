// tesseract-palette.test.ts — the boot tesseract's colors.
//
// The point of this module is that brand lime is nearly invisible on the light
// theme's near-white page, so the two themes cannot share one palette. Colors
// come back as channels rather than CSS strings so they can be interpolated
// per edge and compared numerically.
import { describe, it, expect } from 'vitest'
import { tesseractPalette, css, lerpColor, type TesseractColor } from './tesseract-palette'
import { DEFAULT_ACCENT } from '../state/accent'

const DARK_PAGE = '#0a0a0a'
const LIGHT_PAGE = '#f6f6f4'

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.slice(1)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ]
}

/** Sum of channels as the color lands on a given page background. */
function luminanceOn(color: TesseractColor, pageHex: string): number {
  const [pr, pg, pb] = hexToRgb(pageHex)
  return (
    color.r * color.a + pr * (1 - color.a) +
    color.g * color.a + pg * (1 - color.a) +
    color.b * color.a + pb * (1 - color.a)
  )
}

describe('tesseractPalette', () => {
  const dark = tesseractPalette(DEFAULT_ACCENT, false)
  const light = tesseractPalette(DEFAULT_ACCENT, true)

  it('returns drawable colors on both themes', () => {
    for (const palette of [dark, light]) {
      for (const color of [palette.edgeFar, palette.edgeNear, palette.vertex, palette.glow]) {
        for (const channel of [color.r, color.g, color.b]) {
          expect(Number.isInteger(channel)).toBe(true)
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(255)
        }
        expect(color.a).toBeGreaterThan(0)
        expect(color.a).toBeLessThanOrEqual(1)
      }
    }
  })

  it('draws near edges more opaque than far ones', () => {
    expect(dark.edgeNear.a).toBeGreaterThan(dark.edgeFar.a)
    expect(light.edgeNear.a).toBeGreaterThan(light.edgeFar.a)
  })

  it('stays legible on the dark theme: edges read brighter than the page', () => {
    const page = hexToRgb(DARK_PAGE).reduce((a, b) => a + b, 0)
    expect(luminanceOn(dark.edgeNear, DARK_PAGE)).toBeGreaterThan(page * 2)
    expect(luminanceOn(dark.edgeFar, DARK_PAGE)).toBeGreaterThan(page)
  })

  it('stays legible on the light theme: edges read darker than the page', () => {
    const page = hexToRgb(LIGHT_PAGE).reduce((a, b) => a + b, 0)
    expect(luminanceOn(light.edgeNear, LIGHT_PAGE)).toBeLessThan(page * 0.6)
    expect(luminanceOn(light.edgeFar, LIGHT_PAGE)).toBeLessThan(page * 0.85)
  })

  it('uses a different edge color per theme, so lime never washes out on light', () => {
    expect(light.edgeNear).not.toEqual(dark.edgeNear)
    expect(light.edgeFar).not.toEqual(dark.edgeFar)
  })

  it('honours a project accent override', () => {
    expect(tesseractPalette('#ff0000', false).edgeNear).toMatchObject({ r: 255, g: 0, b: 0 })
  })

  it('falls back to brand lime for a missing accent', () => {
    const [r, g, b] = hexToRgb(DEFAULT_ACCENT)
    expect(tesseractPalette(undefined, false).edgeNear).toMatchObject({ r, g, b })
  })

  it('refuses purple even if it reaches the boot screen', () => {
    const [r, g, b] = hexToRgb(DEFAULT_ACCENT)
    expect(tesseractPalette('#8b5cf6', false).edgeNear).toMatchObject({ r, g, b })
  })
})

describe('css', () => {
  it('formats a color as an rgba string', () => {
    expect(css({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)')
  })
})

describe('lerpColor', () => {
  const far: TesseractColor = { r: 0, g: 0, b: 0, a: 0 }
  const near: TesseractColor = { r: 100, g: 200, b: 40, a: 1 }

  it('returns each end at t=0 and t=1', () => {
    expect(lerpColor(far, near, 0)).toEqual(far)
    expect(lerpColor(far, near, 1)).toEqual(near)
  })

  it('moves every channel together in the middle', () => {
    const mid = lerpColor(far, near, 0.5)
    expect(mid).toEqual({ r: 50, g: 100, b: 20, a: 0.5 })
  })

  it('clamps outside 0..1 rather than overshooting', () => {
    expect(lerpColor(far, near, -1)).toEqual(far)
    expect(lerpColor(far, near, 2)).toEqual(near)
  })
})
