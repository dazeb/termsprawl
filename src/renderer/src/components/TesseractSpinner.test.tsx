// TesseractSpinner.test.tsx — markup smoke test (react-dom/server, no DOM lib).
//
// The repo has no DOM-testing-library dependency, so effects never run here:
// nothing is drawn to the canvas by this test. That is exactly why the geometry
// and the palette are separate pure modules with their own tests — this file
// only proves the element tree and its accessibility contract.
import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TesseractSpinner } from './TesseractSpinner'

const html = (props: Parameters<typeof TesseractSpinner>[0] = {}): string =>
  renderToStaticMarkup(React.createElement(TesseractSpinner, props))

describe('TesseractSpinner', () => {
  it('renders a canvas for the tesseract, not a raster logo', () => {
    const markup = html()
    expect(markup).toContain('tesseract-spinner')
    expect(markup).toContain('<canvas')
    expect(markup).not.toContain('<img')
  })

  it('carries the termsprawl wordmark', () => {
    const markup = html()
    expect(markup).toContain('boot-wordmark')
    expect(markup).toContain('termsprawl')
  })

  it('hides the decorative layers from assistive tech', () => {
    expect(html()).toContain('aria-hidden="true"')
  })

  it('announces loading to assistive tech', () => {
    const markup = html()
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="Loading"')
  })
})
