// Guards for the code-theme registry: ids usable as settings values, both
// slots populated, and the house rule that NO palette color is purple
// (AGENTS.md — purple is treated as a bug wherever it shows up, syntax
// themes included).

import { describe, expect, it } from 'vitest'
import {
  CODE_THEMES,
  DEFAULT_CODE_THEME_DARK,
  DEFAULT_CODE_THEME_LIGHT,
  codeThemeById,
  codeThemesOfKind
} from './code-themes'

/** Hex (#rgb/#rrggbb) → hue 0-360, saturation 0-1, value 0-1. */
function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

describe('code-themes registry', () => {
  it('ids are unique and non-empty', () => {
    const ids = CODE_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.length).toBeGreaterThan(0)
  })

  it('both kind slots are populated and the defaults exist in the registry', () => {
    expect(codeThemesOfKind('light').length).toBeGreaterThanOrEqual(2)
    expect(codeThemesOfKind('dark').length).toBeGreaterThanOrEqual(2)
    expect(codeThemeById(DEFAULT_CODE_THEME_LIGHT)?.kind).toBe('light')
    expect(codeThemeById(DEFAULT_CODE_THEME_DARK)?.kind).toBe('dark')
  })

  it('every theme carries a full palette of 6-digit hex colors', () => {
    const hex = /^#[0-9a-f]{6}$/
    for (const t of CODE_THEMES) {
      for (const [key, value] of Object.entries(t.colors)) {
        expect(hex.test(value), `${t.id}.colors.${key} = ${value}`).toBe(true)
      }
      for (const [key, value] of Object.entries(t.tokens)) {
        expect(hex.test(value), `${t.id}.tokens.${key} = ${value}`).toBe(true)
      }
    }
  })

  it('no palette color is purple (house rule: violet hues never ship)', () => {
    // Violet range with real saturation/value — grays and near-grays pass.
    const isPurple = (hex: string): boolean => {
      const { h, s, v } = hexToHsv(hex)
      return h >= 250 && h <= 320 && s >= 0.2 && v >= 0.2
    }
    for (const t of CODE_THEMES) {
      for (const value of [...Object.values(t.colors), ...Object.values(t.tokens)]) {
        expect(isPurple(value), `${t.id}: ${value} reads as purple`).toBe(false)
      }
    }
  })
})
