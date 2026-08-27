import { useCallback, useEffect, useRef, useState } from 'react'
import type { NodeProps } from 'reactflow'
import { NodeResizer } from '@reactflow/node-resizer'
import type { BrowserNodeData, BrowserTab } from '../state/workspace'
import {
  activateBrowserTab,
  addBrowserTab,
  browserTitle,
  BROWSER_NODE_MAX,
  closeBrowserTab,
  DEFAULT_BROWSER_URL,
  nextBrowserTabId,
  pushBrowserHistory,
  resolveHomeUrl,
  setBrowserTabUrl
} from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import { useBrowserHome } from '../state/browser-home'
import { useSearxng } from '../state/searxng'
import { HelpBadge } from '../components/HelpBadge'

// Minimal shape of the <webview> element we create (Electron's WebviewTag). We
// create it imperatively to sidestep JSX-intrinsic typing; the shell around it
// is plain HTML.
interface WebviewElement extends HTMLElement {
  src: string
  getURL(): string
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  insertCSS(css: string): Promise<string>
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
}

// Hide the guest page's own scrollbars so the small mini-window shows clean
// content instead of a scrollbar eating half of it. The page still scrolls.
const HIDE_SCROLLBARS_CSS = `
::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
* { scrollbar-width: none !important; }
`

// A browser node: one sandboxed <webview> guest PER TAB, rendered inline on
// the canvas (13.4). The guests are hardened in main (no preload / no
// nodeIntegration / sandbox on / nav policy), so each tab is a real browser
// page the user can use OR an agent can drive via the exposed CDP endpoint
// (every tab shows up as its own `page` target). The body is nodrag only
// while unfocused; dragging happens via the header, exactly like the terminal
// node.
export function BrowserNode({ id, data, selected }: NodeProps<BrowserNodeData>): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const webviewsRef = useRef<Map<string, WebviewElement>>(new Map())
  const { closeNode, updateNodeData } = useCanvas()
  const historyRef = useRef<string[]>(data.history ?? [])

  // Legacy persisted nodes (pre-13.4) carry no tabs — treat them as one tab.
  const initialTabsRef = useRef<BrowserTab[]>(
    data.tabs && data.tabs.length > 0 ? data.tabs : [{ id: nextBrowserTabId(), url: data.url }]
  )
  const [tabs, setTabs] = useState<BrowserTab[]>(initialTabsRef.current)
  const [activeTabId, setActiveTabId] = useState<string>(
    data.activeTabId && initialTabsRef.current.some((t) => t.id === data.activeTabId)
      ? data.activeTabId
      : initialTabsRef.current[0].id
  )
  const [address, setAddress] = useState(data.url)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [crashed, setCrashed] = useState(false)
  const [guestId, setGuestId] = useState<number | null>(null)
  // Sidecar status for the header chip (live subscription → re-renders).
  const searxngStatus = useSearxng((s) => s.info.status)
  // Body drag layer: the webview swallows mouse events, so to move the node by
  // its page area we overlay a transparent layer that is ARMED (grabs pointer)
  // by default — press = drag the node. Hovering WITHOUT pressing for a short
  // dwell disarms it so the page becomes interactive (the terminal's
  // "drag = move, dwell = focus" pattern). Leaving the node re-arms it.
  const [bodyDragArmed, setBodyDragArmed] = useState(true)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const BODY_DWELL_MS = 350

  const armBodyDrag = useCallback(() => {
    if (dwellTimer.current) {
      clearTimeout(dwellTimer.current)
      dwellTimer.current = null
    }
    setBodyDragArmed(true)
  }, [])

  const startDwellDisarm = useCallback(() => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current)
    dwellTimer.current = setTimeout(() => setBodyDragArmed(false), BODY_DWELL_MS)
  }, [])

  const cancelDwell = useCallback(() => {
    if (dwellTimer.current) {
      clearTimeout(dwellTimer.current)
      dwellTimer.current = null
    }
  }, [])

  useEffect(() => () => cancelDwell(), [cancelDwell])

  // Refs mirroring the live state so event closures always read current values.
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  /** Persist the tab set + active tab + history through the workspace store
   * (the project file keeps them, so a reload restores the node's tabs). */
  const persist = (nextTabs: BrowserTab[], nextActive: string, url?: string): void => {
    updateNodeData(
      id,
      {
        url: url ?? nextTabs.find((t) => t.id === nextActive)?.url ?? '',
        tabs: nextTabs,
        activeTabId: nextActive,
        history: historyRef.current
      },
      false
    )
  }

  /** Read the toolbar state for a tab's webview (address/back/forward/guest). */
  const syncToolbar = (tabId: string): void => {
    const wv = webviewsRef.current.get(tabId)
    if (!wv) return
    try {
      setAddress(wv.getURL())
      setCanBack(wv.canGoBack())
      setCanForward(wv.canGoForward())
      setGuestId(wv.getWebContentsId())
    } catch {
      /* transient read during teardown */
    }
  }

  /** Create a hardened <webview> guest for a tab and wire its events. */
  const spawnWebview = (tab: BrowserTab, hidden: boolean): void => {
    const host = hostRef.current
    if (!host) return
    const webview = document.createElement('webview') as unknown as WebviewElement
    // Isolated persistent profile so cookies/logins survive app restarts; the
    // guest never sees a preload or Node because installBrowserSecurity()
    // forces those off at attach time.
    webview.setAttribute('partition', 'persist:termsprawl-browser')
    webview.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, nodeIntegration=no')
    webview.setAttribute('src', tab.url)
    webview.style.width = '100%'
    webview.style.height = '100%'
    webview.style.display = hidden ? 'none' : 'block'
    webview.dataset.nodeId = id
    webview.dataset.tabId = tab.id
    webviewsRef.current.set(tab.id, webview)
    host.appendChild(webview)

    const onDomReady = (): void => {
      try {
        const gid = webview.getWebContentsId()
        void window.termsprawl.browser.register(id, tab.id, gid)
        if (tab.id === activeTabIdRef.current) setGuestId(gid)
        // Mini-window: hide the guest page's scrollbars (they eat the small
        // viewport); the page still scrolls, just without the visible bar.
        void webview.insertCSS(HIDE_SCROLLBARS_CSS).catch(() => {
          /* best effort */
        })
      } catch {
        // Guest not ready yet; will re-fire on the next load.
      }
    }

    const onDidNavigate = (): void => {
      try {
        const url = webview.getURL()
        const prev = tabsRef.current.find((t) => t.id === tab.id)?.url
        if (prev === url) {
          // Title-only change (page-title-updated fires without a navigation) —
          // refresh back/forward cheaply, no tab rewrite or project write.
          if (tab.id === activeTabIdRef.current) {
            setCanBack(webview.canGoBack())
            setCanForward(webview.canGoForward())
          }
          return
        }
        // Update the tab's url + the node-level history (most recent first).
        const next = setBrowserTabUrl(tabsRef.current, tab.id, url)
        historyRef.current = pushBrowserHistory(historyRef.current, url)
        setTabs(next)
        const active = activeTabIdRef.current
        persist(next, active, next.find((t) => t.id === active)?.url ?? url)
        if (tab.id === active) {
          setAddress(url)
          setCanBack(webview.canGoBack())
          setCanForward(webview.canGoForward())
        }
      } catch {
        /* ignore transient reads during teardown */
      }
    }

    const onCrashed = (): void => {
      if (tab.id === activeTabIdRef.current) setCrashed(true)
    }

    webview.addEventListener('dom-ready', onDomReady)
    webview.addEventListener('did-navigate', onDidNavigate)
    webview.addEventListener('did-navigate-in-page', onDidNavigate)
    webview.addEventListener('page-title-updated', onDidNavigate)
    webview.addEventListener('render-process-gone', onCrashed)
  }

  // Create the webviews for the initial tabs once per node mount; unregister +
  // remove on unmount (removing the <webview> element destroys the guest).
  useEffect(() => {
    for (const tab of initialTabsRef.current) {
      spawnWebview(tab, tab.id !== activeTabIdRef.current)
    }
    return () => {
      for (const [tabId, webview] of webviewsRef.current) {
        void window.termsprawl.browser.unregister(id, tabId)
        webview.stop()
        webview.remove()
      }
      webviewsRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Lazy-start the local search sidecar while a browser node exists; when it
  // comes up, new tabs (and the node's home) resolve to it.
  useEffect(() => {
    void useSearxng.getState().ensure()
  }, [id])

  // Navigate the ACTIVE tab: go through main so the URL policy is enforced in
  // one place.
  const navigateTo = (): void => {
    const target = address.trim()
    if (!target) return
    const tabId = activeTabIdRef.current
    void window.termsprawl.browser.navigate(id, tabId, target).then((res) => {
      if (!res.ok && res.reason === 'DENIED') {
        setAddress(webviewsRef.current.get(tabId)?.getURL() ?? data.url)
      }
    })
  }

  const goBack = (): void => webviewsRef.current.get(activeTabIdRef.current)?.goBack()
  const goForward = (): void => webviewsRef.current.get(activeTabIdRef.current)?.goForward()
  const reload = (): void => {
    setCrashed(false)
    webviewsRef.current.get(activeTabIdRef.current)?.reload()
  }

  const openTab = (): void => {
    const homeUrl = resolveHomeUrl(useBrowserHome.getState().homeUrl, useSearxng.getState().info)
    const res = addBrowserTab(tabsRef.current, homeUrl)
    // Hide the previous active guest so the new tab is the only visible one
    // (activateTab does the same dance when switching back).
    webviewsRef.current.get(activeTabIdRef.current)?.style.setProperty('display', 'none')
    setTabs(res.tabs)
    setActiveTabId(res.activeTabId)
    setCrashed(false)
    setGuestId(null)
    spawnWebview({ id: res.activeTabId, url: homeUrl }, false)
    persist(res.tabs, res.activeTabId)
  }

  const closeTab = (tabId: string): void => {
    const res = closeBrowserTab(tabsRef.current, activeTabIdRef.current, tabId)
    if (!res) {
      // Closing the last tab closes the node (browser convention).
      closeNode(id)
      return
    }
    const wv = webviewsRef.current.get(tabId)
    if (wv) {
      void window.termsprawl.browser.unregister(id, tabId)
      wv.stop()
      wv.remove()
      webviewsRef.current.delete(tabId)
    }
    setTabs(res.tabs)
    setActiveTabId(res.activeTabId)
    setCrashed(false)
    setGuestId(null)
    // Show the newly-active neighbour (it was display:none while in the background).
    webviewsRef.current.get(res.activeTabId)?.style.setProperty('display', 'block')
    syncToolbar(res.activeTabId)
    persist(res.tabs, res.activeTabId)
  }

  const activateTab = (tabId: string): void => {
    const res = activateBrowserTab(tabsRef.current, tabId)
    if (!res || res.activeTabId === activeTabIdRef.current) return
    // Hide the old guest, show the new one.
    webviewsRef.current.get(activeTabIdRef.current)?.style.setProperty('display', 'none')
    const next = webviewsRef.current.get(tabId)
    if (next) next.style.setProperty('display', 'block')
    setTabs(res.tabs)
    setActiveTabId(res.activeTabId)
    setCrashed(false)
    syncToolbar(res.activeTabId)
    persist(res.tabs, res.activeTabId)
  }

  return (
    <div className="browser-node">
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={140}
        maxWidth={BROWSER_NODE_MAX.width}
        maxHeight={BROWSER_NODE_MAX.height}
      />
      <div className="browser-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`browser-tab nodrag${t.id === activeTabId ? ' is-active' : ''}`}
            title={t.url}
            onClick={() => activateTab(t.id)}
          >
            <span className="browser-tab-title">{browserTitle(t.url)}</span>
            <button
              className="browser-tab-close"
              title="Close tab"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(t.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="browser-tab-add nodrag" title="New tab" aria-label="New tab" onClick={openTab}>
          +
        </button>
      </div>
      <div className="browser-node-header">
        <span className="terminal-node-dot" />
        {searxngStatus !== 'ready' && searxngStatus !== 'idle' && (
          <span className="browser-search-chip" title="Local search status">
            {searxngStatus === 'failed' || searxngStatus === 'stopped'
              ? 'search unavailable — using fallback'
              : 'starting local search…'}
          </span>
        )}
        <span className="browser-node-title" title={activeTab?.url ?? data.url}>
          {browserTitle(activeTab?.url ?? data.url)}
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
            if (e.key === 'Escape')
              setAddress(webviewsRef.current.get(activeTabIdRef.current)?.getURL() ?? data.url)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="enter a URL (example.com → https)"
        />
        <HelpBadge label="about this browser" text={browserHelp} />
        <button
          className="node-close nodrag"
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
      <div
        className="browser-node-host"
        ref={hostRef}
        onPointerEnter={startDwellDisarm}
        onPointerLeave={armBodyDrag}
      >
        <div
          className={`browser-drag-layer${bodyDragArmed ? ' is-armed' : ''}`}
          onPointerDown={cancelDwell}
          title={bodyDragArmed ? 'drag to move · wait to interact' : undefined}
        />
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
  'A real, sandboxed Chromium page embedded on the canvas — one guest per tab. It is isolated from the rest of termsprawl (no Node, no preload). Drag the tab bar, the title, or the page itself to move the node (hover the page without pressing for a moment and it becomes interactive — the same "dwell" model as terminals). The address bar navigates through a policy that blocks file:, devtools: and other privileged schemes. Tabs share cookies (persistent profile) and each tab is its own CDP target if an agent is attached, so you watch exactly what it does. The × button closes the node.'
