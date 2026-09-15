import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LinkInspector, linkDefaultConfig } from './LinkInspector'
import type { LinkKind } from '@shared/types'

function markup(kind: LinkKind, sourceKind: string, targetKind: string): string {
  return renderToStaticMarkup(React.createElement(LinkInspector, {
    link: { id: 'link', source: 'source', target: 'target', kind, auto: false,
      config: linkDefaultConfig(kind), createdAt: 1 },
    sourceKind, targetKind,
    onChange() {}, onRun() {}, onDelete() {}, onClose() {}
  }))
}

describe('LinkInspector applicable options', () => {
  it('offers conversation payload selection only for chat sources', () => {
    const chat = markup('a2a-peer', 'chat', 'a2a-peer')
    expect(chat).toContain('latest assistant reply')
    expect(chat).toContain('full conversation')
    const terminal = markup('a2a-peer', 'terminal', 'a2a-peer')
    expect(terminal).not.toContain('value="full-capture"')
    expect(terminal).toContain('bounded capture of the current pane')
  })

  it('shows only context options used by the target', () => {
    const chat = markup('context-inject', 'sticky', 'chat')
    expect(chat).toContain('wrap with source title')
    expect(chat).not.toContain('paste pointer line into terminal')
    const terminal = markup('context-inject', 'sticky', 'terminal')
    expect(terminal).not.toContain('wrap with source title')
    expect(terminal).toContain('paste pointer line into terminal')
  })
})
