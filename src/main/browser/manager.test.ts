import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { secureBrowserContents } from './manager'

vi.mock('electron', () => ({ app: {}, webContents: {}, BrowserWindow: { fromWebContents: () => null } }))

function contents() {
  return Object.assign(new EventEmitter(), {
    session: { cookies: { flushStore: vi.fn(async () => {}) } },
    setWindowOpenHandler: vi.fn(),
  })
}

describe('browser sign-in popups', () => {
  it('allows web sign-in windows with the same session and sandbox, but rejects privileged URLs', () => {
    const guest = contents()
    secureBrowserContents(guest as unknown as WebContents)
    const open = guest.setWindowOpenHandler.mock.calls[0][0]
    expect(open({ url: 'https://accounts.example/login' })).toMatchObject({
      action: 'allow', overrideBrowserWindowOptions: { webPreferences: {
        session: guest.session, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webviewTag: false, webSecurity: true
      } }
    })
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'devtools://x']) {
      expect(open({ url })).toEqual({ action: 'deny' })
    }
  })

  it('guards popup redirects, prevents nested popups, and closes them with their parent', () => {
    const guest = contents()
    const child = contents()
    const popup = Object.assign(new EventEmitter(), { webContents: child, isDestroyed: () => false, close: vi.fn() })
    secureBrowserContents(guest as unknown as WebContents)
    guest.emit('did-create-window', popup)
    const event = { preventDefault: vi.fn() }
    child.emit('will-redirect', event, 'file:///etc/passwd')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(child.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    guest.emit('destroyed')
    expect(popup.close).toHaveBeenCalled()
    popup.emit('closed')
    expect(guest.session.cookies.flushStore).toHaveBeenCalled()
  })
})
