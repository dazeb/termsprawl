import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirEntry } from '@shared/types'
import { type TreeSide } from '../state/edge-reveal'

const PANEL_WIDTH = 248
const CLOSE_MS = 220

interface FileTreeProps {
  cwd?: string
  onOpenFile: (path: string) => void
}

export function FileTree({ cwd, onOpenFile }: FileTreeProps): React.JSX.Element {
  const [side, setSide] = useState<TreeSide>('left')
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_MS)
  }, [cancelClose])

  const reveal = useCallback(
    (next: TreeSide) => {
      cancelClose()
      setSide(next)
      setOpen(true)
    },
    [cancelClose]
  )

  useEffect(() => () => cancelClose(), [cancelClose])

  const rootName = cwd ? cwd.replace(/\/+$/, '').split('/').pop() || cwd : null

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
        className={`file-tree file-tree-${side}${open ? ' is-open' : ''}`}
        style={{ width: PANEL_WIDTH }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="file-tree-head" title={cwd ?? 'no folder'}>
          {rootName ?? 'no folder'}
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
