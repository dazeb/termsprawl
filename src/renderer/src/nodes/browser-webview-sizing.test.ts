// Guards the browser node's webview display mode.
//
// A <webview> guest is laid out by Electron's own flex layout. Forcing
// `display: block` on the element makes the HOST honour height:100% while the
// guest view inside stays at Chromium's 150px default viewport — so an enlarged
// browser node paints only its top ~150px and the rest shows the host's black
// background (reported 0.26.0: "the browser isn't opening fully, most of it is
// black"). Only visible once nodes grew past 150px; the old 320x240 node hid it.
//
// Verified on Electron 43.4 with a minimal repro: the guest's own
// window.innerHeight reports 150 for every host height under `block`, and the
// true host height under `flex`. Both the stylesheet rule and the imperative
// toggles in BrowserNode must therefore stay non-block.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES_CSS = join(__dirname, '../styles.css')
const BROWSER_NODE = join(__dirname, 'BrowserNode.tsx')

describe('browser webview sizing', () => {
  it('styles the webview as a flex box, never block', () => {
    const css = readFileSync(STYLES_CSS, 'utf8')
    const rule = /\.browser-node-host webview\s*\{([^}]*)\}/.exec(css)
    expect(rule, '.browser-node-host webview rule must exist in styles.css').not.toBeNull()
    expect(rule![1]).toMatch(/display:\s*flex/)
    expect(rule![1]).not.toMatch(/display:\s*block/)
  })

  it('toggles the guest to a flex display when it becomes visible', () => {
    const source = readFileSync(BROWSER_NODE, 'utf8')
    // The shared constant is what the visible toggles use.
    expect(source).toMatch(/const WEBVIEW_VISIBLE_DISPLAY = 'flex'/)
    // No imperative path may pin the guest back to block.
    expect(source).not.toMatch(/setProperty\(\s*'display',\s*'block'/)
    expect(source).not.toMatch(/style\.display\s*=\s*hidden\s*\?\s*'none'\s*:\s*'block'/)
  })
})
