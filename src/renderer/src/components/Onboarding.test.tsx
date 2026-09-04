// Onboarding.test.tsx — first-run overlay gating + dismissal semantics.
// The repo has no DOM-testing-library dependency, so the component is tested
// through its exported pure gate (ShouldShowOnboarding) and by asserting the
// rendered markup via react-dom/server (no browser needed).
import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Onboarding, ShouldShowOnboarding } from './Onboarding'

describe('ShouldShowOnboarding', () => {
  it('shows only when never onboarded AND no projects exist', () => {
    expect(ShouldShowOnboarding({}, 0)).toBe(true)
    expect(ShouldShowOnboarding({ onboardedAt: '2026-09-04T07:00:00.000Z' }, 0)).toBe(false)
    expect(ShouldShowOnboarding({}, 1)).toBe(false)
    expect(ShouldShowOnboarding({ onboardedAt: 'x' }, 3)).toBe(false)
  })
})

describe('Onboarding', () => {
  const html = (): string =>
    renderToStaticMarkup(React.createElement(Onboarding, { onDismiss: () => {} }))

  it('renders three shipped-behavior steps', () => {
    const markup = html()
    expect(markup).toContain('Create a project')
    expect(markup).toContain('Spawn a terminal')
    expect(markup).toContain('Arrange it your way')
  })

  it('labels itself a dialog and carries the skip affordance', () => {
    const markup = html()
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Skip — I know my way around')
  })

  it('renders no animation classes (reduced-motion friendly)', () => {
    expect(html()).not.toMatch(/animate-|chat-pulse/)
  })
})
