import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('turns a heading and a paragraph into HTML', () => {
    const html = renderMarkdown('# Hello\n\nworld')
    expect(html).toContain('<h1')
    expect(html).toContain('Hello')
    expect(html).toContain('<p>')
    expect(html).toContain('world')
  })

  it('does not execute raw script tags as HTML (escaped or stripped)', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html.toLowerCase()).not.toContain('<script>')
  })
})
