// TesseractSpinner.test.tsx — markup smoke test (react-dom/server, no DOM lib).
import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TesseractSpinner } from './TesseractSpinner'

describe('TesseractSpinner', () => {
  const html = (): string => renderToStaticMarkup(React.createElement(TesseractSpinner))

  it('renders the tesseract logo inside a spinning container', () => {
    const markup = html()
    expect(markup).toContain('tesseract-spinner')
    expect(markup).toContain('<img')
    expect(markup).toContain('draggable="false"')
  })

  it('announces loading to assistive tech', () => {
    const markup = html()
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-label="Loading"')
  })
})
