import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { DirEntry, ProjectRemote } from '@shared/types'
import { remoteLabel } from '@shared/remote-project'
import {
  applyFileTreeChrome,
  initialFileTreeChrome,
  type SidebarSection,
  type TreeSide
} from '../state/edge-reveal'
import { useSidebarRequests } from '../state/sidebar-requests'
import { SourceControlPanel } from './SourceControlPanel'
import { HelpBadge } from './HelpBadge'

const PANEL_WIDTH = 264
const CLOSE_MS = 220

interface OpenEditorTab {
  id: string
  path: string
}

interface FileTreeProps {
  cwd?: string
  /** Remote project destination (Phase 9): the explorer + source control run
   * against the remote host at remote.path instead of the local cwd. */
  remote?: ProjectRemote
  onOpenFile: (path: string) => void
  /** Open editor nodes on the canvas (the sidebar's "tabs" section). */
  openEditors?: OpenEditorTab[]
}

// VS Code-style sidebar: an activity rail switches between the FILES (explorer
// with open tabs + tree), SOURCE CONTROL, and PLUGINS (coming soon) sections —
// all in the same edge-hover popout panel users already know.
export function FileTree({ cwd, remote, onOpenFile, openEditors = [] }: FileTreeProps): React.JSX.Element {
  const [chrome, dispatch] = useReducer(applyFileTreeChrome, undefined, initialFileTreeChrome)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ignoreLeave = useRef(false)

  // The tree root: for a remote project the explorer browses the REMOTE path.
  const root = remote ? remote.path : cwd
  const rootLabel = remote ? remoteLabel(remote) : (root ? root.replace(/\/+$/, '').split('/').pop() || root : null)

  // A section switch requested from outside the canvas (cog menu → source).
  const sidebarRequest = useSidebarRequests((s) => s.request)
  useEffect(() => {
    if (!sidebarRequest) return
    dispatch({ type: 'switchSection', section: sidebarRequest })
    useSidebarRequests.getState().consume()
  }, [sidebarRequest])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    if (chrome.pinned || ignoreLeave.current) {
      cancelClose()
      return
    }
    cancelClose()
    closeTimer.current = setTimeout(() => dispatch({ type: 'requestClose' }), CLOSE_MS)
  }, [cancelClose, chrome.pinned])

  const flipSide = useCallback(() => {
    ignoreLeave.current = true
    cancelClose()
    dispatch({ type: 'flipSide' })
    window.setTimeout(() => {
      ignoreLeave.current = false
    }, 400)
  }, [cancelClose])

  const reveal = useCallback(
    (next: TreeSide) => {
      cancelClose()
      dispatch({ type: 'reveal', side: next })
    },
    [cancelClose]
  )

  const switchSection = useCallback((section: SidebarSection) => {
    dispatch({ type: 'switchSection', section })
  }, [])

  useEffect(() => () => cancelClose(), [cancelClose])

  const { side, open, pinned, section } = chrome
  const otherSide = side === 'left' ? 'right' : 'left'

  return (
    <>
      {!open && (
        <>
          <div
            className="file-tree-hot file-tree-hot-left"
            onMouseEnter={() => reveal('left')}
            title="project sidebar"
          />
          <div
            className="file-tree-hot file-tree-hot-right"
            onMouseEnter={() => reveal('right')}
            title="project sidebar"
          />
        </>
      )}
      <aside
        className={`file-tree file-tree-${side}${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}
        style={{ width: PANEL_WIDTH }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="file-tree-main">
          <div className="file-tree-tabs" role="tablist" aria-label="sidebar sections">
            <button
              type="button"
              className={`file-tree-tab${section === 'files' ? ' is-active' : ''}`}
              title="Explorer — open tabs and files"
              aria-label="Explorer"
              role="tab"
              aria-selected={section === 'files'}
              onClick={() => switchSection('files')}
            >
              <FilesIcon />
              <span>Explorer</span>
            </button>
            <button
              type="button"
              className={`file-tree-tab${section === 'source' ? ' is-active' : ''}`}
              title="Source control"
              aria-label="Source control"
              role="tab"
              aria-selected={section === 'source'}
              onClick={() => switchSection('source')}
            >
              <SourceIcon />
              <span>Source</span>
            </button>
            <button
              type="button"
              className={`file-tree-tab${section === 'plugins' ? ' is-active' : ''}`}
              title="Plugins"
              aria-label="Plugins"
              role="tab"
              aria-selected={section === 'plugins'}
              onClick={() => switchSection('plugins')}
            >
              <PluginsIcon />
              <span>Plugins</span>
            </button>
          </div>

          <div className="file-tree-head">
            <span className="file-tree-title" title={root ?? 'no folder'}>
              {section === 'files' && (rootLabel ?? 'explorer')}
              {section === 'source' && 'source control'}
              {section === 'plugins' && 'plugins'}
            </span>
            {section === 'files' && (
              <HelpBadge
                label="about the sidebar"
                text="One sidebar for this project. Hover the left or right canvas edge to open it. The dock icon moves this same panel to the other side. Pin keeps it open. The tabs section lists the files open in editor nodes; click one to focus it. Dotfiles, .git, and node_modules are hidden. The tabs at the top switch between Explorer, Source control, and (soon) Plugins."
              />
            )}
            {open && (
              <div className="file-tree-actions">
                <button
                  type="button"
                  className="file-tree-icon"
                  title={`move to ${otherSide}`}
                  aria-label={`move sidebar to ${otherSide}`}
                  onClick={flipSide}
                >
                  {side === 'left' ? (
                    <DockRightIcon />
                  ) : (
                    <DockLeftIcon />
                  )}
                </button>
                <button
                  type="button"
                  className={`file-tree-icon${pinned ? ' is-active' : ''}`}
                  title={pinned ? 'unpin sidebar' : 'pin sidebar open'}
                  aria-label={pinned ? 'unpin sidebar' : 'pin sidebar open'}
                  aria-pressed={pinned}
                  onClick={() => dispatch({ type: 'togglePin' })}
                >
                  <PinIcon filled={pinned} />
                </button>
              </div>
            )}
          </div>

          <div className="file-tree-body">
            {section === 'files' && (
              <>
                {/* Tabs — open editor nodes, VS Code's OPEN EDITORS. */}
                <div className="sidebar-section-label">tabs</div>
                {openEditors.length === 0 ? (
                  <div className="file-tree-empty">no open tabs</div>
                ) : (
                  <ul className="sidebar-tabs">
                    {openEditors.map((tab) => (
                      <li key={tab.id}>
                        <button
                          type="button"
                          className="file-tree-row sidebar-tab"
                          onClick={() => onOpenFile(tab.path)}
                          title={tab.path}
                        >
                          <span className="file-tree-mark">·</span>
                          <span className="file-tree-name">{basenameOf(tab.path)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="sidebar-section-label">files</div>
                {!root ? (
                  <div className="file-tree-empty">this project has no folder</div>
                ) : (
                  <TreeBranch root={root} rel="." depth={0} onOpenFile={onOpenFile} remote={remote} />
                )}
              </>
            )}

            {section === 'source' &&
              (root ? (
                <SourceControlPanel cwd={root} remote={remote} embedded />
              ) : (
                <div className="file-tree-empty">this project has no folder</div>
              ))}

            {section === 'plugins' && (
              <div className="file-tree-empty">
                Sidebar extensions are not available yet. Manage agent CLI plugins
                in Settings → Plugins.
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

function TreeBranch({
  root,
  rel,
  depth,
  onOpenFile,
  remote
}: {
  root: string
  rel: string
  depth: number
  onOpenFile: (path: string) => void
  /** Remote project (Phase 9): directory listing runs over ssh. */
  remote?: ProjectRemote
}): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    void window.termsprawl.files.list(root, rel, remote).then((result) => {
      if (cancelled) return
      if ('error' in result) {
        setError(result.error.message)
        setEntries([])
        return
      }
      setError(null)
      setEntries(result.entries)
    })
    return () => {
      cancelled = true
    }
  }, [root, rel, remote])

  const toggle = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (error) return <div className="file-tree-empty">{error}</div>
  if (!entries) return <div className="file-tree-empty">loading…</div>
  if (entries.length === 0) return <div className="file-tree-empty">empty</div>

  return (
    <ul className="file-tree-list">
      {entries.map((entry) => {
        const open = expanded.has(entry.path)
        const childRel = relFrom(root, entry.path)
        return (
          <li key={entry.path}>
            <button
              type="button"
              className={`file-tree-row file-tree-${entry.kind}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => {
                if (entry.kind === 'dir') toggle(entry.path)
                else onOpenFile(entry.path)
              }}
              title={entry.path}
            >
              <span className="file-tree-mark">
                {entry.kind === 'dir' ? (open ? '▾' : '▸') : '·'}
              </span>
              <span className="file-tree-name">{entry.name}</span>
            </button>
            {entry.kind === 'dir' && open && (
              <TreeBranch root={root} rel={childRel} depth={depth + 1} onOpenFile={onOpenFile} remote={remote} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function relFrom(root: string, abs: string): string {
  if (abs === root) return '.'
  const prefix = root.endsWith('/') ? root : `${root}/`
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
}

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : path
}

function FilesIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M13 2v7h7" />
    </svg>
  )
}

function SourceIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5v7M8.5 6H14a3 3 0 0 1 3 3v0.5M8.5 18H14a3 3 0 0 0 3-3v-0.5" />
    </svg>
  )
}

function PluginsIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M9.5 3v2.5M9.5 18.5V21M14.5 3v2.5M14.5 18.5V21M5 8.5h2.5M5 15.5h2.5M16.5 8.5H19M16.5 15.5H19" />
      <rect x="4" y="8.5" width="5" height="7" rx="1" />
      <rect x="15" y="8.5" width="5" height="7" rx="1" />
    </svg>
  )
}

function DockRightIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1.25" y="1.75" width="9.5" height="8.5" rx="1" fill="none" stroke="currentColor" />
      <rect x="7.25" y="1.75" width="3.5" height="8.5" fill="currentColor" />
    </svg>
  )
}

function DockLeftIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1.25" y="1.75" width="9.5" height="8.5" rx="1" fill="none" stroke="currentColor" />
      <rect x="1.25" y="1.75" width="3.5" height="8.5" fill="currentColor" />
    </svg>
  )
}

function PinIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M4.2 1.6h3.6l-.4 2.6 1.5 1.3v1.1H6.2v3.2L6 10.4l-.2-.6V6.6H3.1V5.5l1.5-1.3-.4-2.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  )
}
