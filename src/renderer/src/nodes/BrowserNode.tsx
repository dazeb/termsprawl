import { useEffect, useRef, useState } from 'react'
import type { NodeProps } from 'reactflow'
import type { BrowserNodeData } from '../state/workspace'
import { browserTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import { HelpBadge } from '../components/HelpBadge'

// Minimal shape of the <webview> element we create (Electron's WebviewTag). We
// create it imperatively to sidestep JSX-intrinsic typing; the shell around it
// is plain HTML.
interface WebviewElement extends HTMLElement {
  src: string
  getURL(): string
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
}

// A browser node: a sandboxed <webview> guest rendered inline on the canvas.
// The guest is hardened in main (no preload / no nodeIntegration / sandbox on /
// nav policy), so it is a real browser the user can use OR an agent can drive
// via the exposed CDP endpoint. The body is nodrag only while unfocused;
// dragging happens via the header, exactly like the terminal node.
export function BrowserNode({ id, data }: NodeProps<BrowserNodeData>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const { closeNode, updateNodeData } = useCanvas()
  const [address, setAddress] = useState(data.url)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [crashed, setCrashed] = useState(false)
  const [guestId, setGuestId] = useState<number | null>(null)

  // Create the <webview> once per node mount; unregister + remove on unmount.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const webview = document.createElement('webview') as unknown as WebviewElement
    // Isolated persistent profile so cookies/logins survive app restarts; the
    // guest never sees a preload or Node because installBrowserSecurity() forces
    // those off at attach time.
    webview.setAttribute('partition', 'persist:termsprawl-browser')
    webview.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no')
    webview.setAttribute('src', data.url)
    webview.style.display = 'block'
    webview.style.width = '100%'
    webview.style.height = '100%'
    webviewRef.current = webview
    webview.dataset.nodeId = id
    host.appendChild(webview)

    let active = true

    const onDomReady = (): void => {
      if (!active) return
      try {
        const gid = webview.getWebContentsId()
        setGuestId(gid)
        void window.termsprawl.browser.register(id, gid)
      } catch {
        // Guest not ready yet; will re-fire on the next load.
      }
    }

    const onDidNavigate = (): void => {
      if (!active) return
      try {
        const url = webview.getURL()
        setAddress(url)
        updateNodeData(id, { url }, false)
        setCanBack(webview.canGoBack())
        setCanForward(webview.canGoForward())
      } catch {
        /* ignore transient reads during teardown */
      }
    }

    const onCrashed = (): void => {
      if (!active) return
      setCrashed(true)
    }

    webview.addEventListener('dom-ready', onDomReady)
    webview.addEventListener('did-navigate', onDidNavigate)
    webview.addEventListener('did-navigate-in-page', onDidNavigate)
    webview.addEventListener('page-title-updated', onDidNavigate)
    webview.addEventListener('render-process-gone', onCrashed)

    return () => {
      active = false
      webview.removeEventListener('dom-ready', onDomReady)
      webview.removeEventListener('did-navigate', onDidNavigate)
      webview.removeEventListener('did-navigate-in-page', onDidNavigate)
      webview.removeEventListener('page-title-updated', onDidNavigate)
      webview.removeEventListener('render-process-gone', onCrashed)
      void window.termsprawl.browser.unregister(id)
      host.removeChild(webview)
      webviewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Navigate: go through main so the URL policy is enforced in one place.
  const navigateTo = (): void => {
    const target = address.trim()
    if (!target) return
    void window.termsprawl.browser.navigate(id, target).then((res) => {
      if (!res.ok && res.reason === 'DENIED') {
        setAddress(data.url)
      }
    })
  }

  const goBack = (): void => webviewRef.current?.goBack()
  const goForward = (): void => webviewRef.current?.goForward()
  const reload = (): void => {
    setCrashed(false)
    webviewRef.current?.reload()
  }

  return (
    <div className="browser-node">
      <div className="browser-node-header nodrag">
        <span className="terminal-node-dot" />
        <span className="browser-node-title" title={data.url}>
          {browserTitle(data.url)}
        </span>
        <div className="browser-nav nodrag">
          <button className="browser-nav-btn" disabled={!canBack} onClick={goBack} title="Back">
            ←
          </button>
          <button
            className="browser-nav-btn"
            disabled={!canForward}
            onClick={goForward}
            title="Forward"
          >
            →
          </button>
          <button className="browser-nav-btn" onClick={reload} title="Reload">
            ⟳
          </button>
        </div>
        <input
          className="browser-address nodrag nowheel"
          value={address}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigateTo()
            if (e.key === 'Escape') setAddress(data.url)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="enter a URL (example.com → https)"
        />
        <HelpBadge label="about this browser" text={browserHelp} />
        <button
          className="node-close"
          title="Close browser"
          aria-label="Close browser"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>
      <div className="browser-node-host nodrag" ref={hostRef}>
        {crashed && (
          <div className="browser-crashed">
            <p>This page crashed.</p>
            <button className="browser-crashed-reload" onClick={reload}>
              Reload
            </button>
          </div>
        )}
        {guestId === null && !crashed && (
          <div className="browser-loading">
            <p>Loading…</p>
          </div>
        )}
      </div>
    </div>
  )
}

const browserHelp =
  'A real, sandboxed Chromium page embedded on the canvas. It is isolated from the rest of termsprawl (no Node, no preload). Drag the header to move it; the address bar navigates through a policy that blocks file:, devtools: and other privileged schemes. If an agent is attached, it drives this same page via a localhost-only CDP endpoint, so you watch exactly what it does. The × button closes the node.'
