// accent.test.ts — the never-purple palette guard.
//
// AGENTS.md rule: purple may never render anywhere in the project family.
// These tests pin the by-construction defense: the picker offers no purple,
// and any purple arriving from legacy data / hand-edited indexes / imported
// bundles resolves to "no override" at the render site.
import { describe, it, expect } from 'vitest'
import { ACCENT_PRESETS, DEFAULT_ACCENT, isPurple, isHexColor, resolveAccent } from './accent'

describe('accent palette guard', () => {
  it('offers no purple preset', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(isPurple(preset)).toBe(false)
    }
  })

  it('default accent is the brand lime and passes the guard', () => {
    expect(DEFAULT_ACCENT).toBe('#c6f135')
    expect(resolveAccent(DEFAULT_ACCENT)).toBe('#c6f135')
  })

  it('flags purple/violet hues with saturation', () => {
    expect(isPurple('#861dbf')).toBe(true) // the leak that started this
    expect(isPurple('#8000ff')).toBe(true)
    expect(isPurple('#e6a8ff')).toBe(true) // pale violet
    expect(isPurple('#f0f')).toBe(true) // magenta shorthand
    expect(isPurple('#7c3aed')).toBe(true) // tailwind violet-600
  })

  it('does not flag non-purple colors', () => {
    expect(isPurple('#c6f135')).toBe(false) // lime
    expect(isPurple('#02af3e')).toBe(false) // green
    expect(isPurple('#4aa8ff')).toBe(false) // sky is ~210deg
    expect(isPurple('#ff5d5d')).toBe(false) // coral
    expect(isPurple('#131313')).toBe(false) // neutral gray
    expect(isPurple('#0a0a0a')).toBe(false) // near-black tint
  })

  it('hex validation accepts 3/6-digit and rejects junk', () => {
    expect(isHexColor('#c6f135')).toBe(true)
    expect(isHexColor('#F0F')).toBe(true)
    expect(isPurple('#xyz')).toBe(false) // not hex at all -> not "purple"
    expect(isHexColor('purple')).toBe(false)
    expect(isHexColor('#c6f13')).toBe(false)
  })

  it('resolveAccent passes approved colors through (normalized)', () => {
    expect(resolveAccent('#02AF3E')).toBe('#02af3e')
    expect(resolveAccent('#4aa8ff')).toBe('#4aa8ff')
  })

  it('resolveAccent REFUSES purple: renders default lime instead', () => {
    expect(resolveAccent('#861dbf')).toBeUndefined()
    expect(resolveAccent('#861DBF')).toBeUndefined()
    expect(resolveAccent('#7c3aed')).toBeUndefined()
  })

  it('resolveAccent refuses non-hex junk and passes undefined through', () => {
    expect(resolveAccent('red')).toBeUndefined()
    expect(resolveAccent('')).toBeUndefined()
    expect(resolveAccent(undefined)).toBeUndefined()
  })
})
