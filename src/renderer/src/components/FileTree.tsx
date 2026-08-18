import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { DirEntry } from '@shared/types'
import { applyFileTreeChrome, initialFileTreeChrome, type TreeSide } from '../state/edge-reveal'
import { HelpBadge } from './HelpBadge'

const PANEL_WIDTH = 248
const CLOSE_MS = 220

interface FileTreeProps {
  cwd?: string
  onOpenFile: (path: string) => void
}

export function FileTree({ cwd, onOpenFile }: FileTreeProps): React.JSX.Element {
  const [chrome, dispatch] = useReducer(applyFileTreeChrome, undefined, initialFileTreeChrome)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ignoreLeave = useRef(false)

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

  useEffect(() => () => cancelClose(), [cancelClose])

  const rootName = cwd ? cwd.replace(/\/+$/, '').split('/').pop() || cwd : null
  const { side, open, pinned } = chrome
  const otherSide = side === 'left' ? 'right' : 'left'

  return (
    <>
      {!open && (
        <>
          <div
            className="file-tree-hot file-tree-hot-left"
            onMouseEnter={() => reveal('left')}
            title="project files"
          />
          <div
            className="file-tree-hot file-tree-hot-right"
            onMouseEnter={() => reveal('right')}
            title="project files"
          />
        </>
      )}
      <aside
        className={`file-tree file-tree-${side}${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}
        style={{ width: PANEL_WIDTH }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="file-tree-head">
          <span className="file-tree-title" title={cwd ?? 'no folder'}>
            {rootName ?? 'no folder'}
          </span>
          <HelpBadge
            label="about the file tree"
            text="One sidebar for this project's folder. Hover the left or right canvas edge to open it. The dock icon moves this same panel to the other side — it is never shown on both. Pin keeps it open; unpin and it closes when the pointer leaves. Click a file to open or focus an editor node. Dotfiles, .git, and node_modules are hidden."
          />
          {open && (
            <div className="file-tree-actions">
              <button
                type="button"
                className="file-tree-icon"
                title={`move to ${otherSide}`}
                aria-label={`move file tree to ${otherSide}`}
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
          {!cwd ? (
            <div className="file-tree-empty">this project has no folder</div>
          ) : (
            <TreeBranch root={cwd} rel="." depth={0} onOpenFile={onOpenFile} />
          )}
        </div>
      </aside>
    </>
  )
}

function TreeBranch({
  root,
  rel,
  depth,
  onOpenFile
}: {
  root: string
  rel: string
  depth: number
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    void window.termsprawl.files.list(root, rel).then((result) => {
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
  }, [root, rel])

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
              <TreeBranch root={root} rel={childRel} depth={depth + 1} onOpenFile={onOpenFile} />
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
