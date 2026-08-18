import { useEffect, useRef, useState } from 'react'
import { useProjects } from '../state/projects'
import { projectNameFromPath } from '../state/workspace'

// Project tabs — the app's window chrome drag region. Right-click a tab for
// Close / Archive / Delete / Settings; the ▾ menu lists closed/archived
// projects to reopen (their tmux sessions survive close/archive — delete is
// permanent and drops the project from the workspace index).
export function TabBar(): React.JSX.Element {
  const projects = useProjects((s) => s.projects)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const select = useProjects((s) => s.select)
  const create = useProjects((s) => s.create)
  const close = useProjects((s) => s.close)
  const archive = useProjects((s) => s.archive)
  const reopen = useProjects((s) => s.reopen)
  const del = useProjects((s) => s.delete)
  const rename = useProjects((s) => s.rename)
  const updateSettings = useProjects((s) => s.updateSettings)

  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [storedOpen, setStoredOpen] = useState(false)
  const storedRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

  const openProjects = projects.filter((p) => !p.closed && !p.archived)
  const storedProjects = projects.filter((p) => p.closed || p.archived)
  const settingsProject = projects.find((p) => p.id === settingsId)

  const newProject = async (): Promise<void> => {
    const cwd = await window.termsprawl.workspace.selectFolder()
    if (!cwd) return
    const name = projectNameFromPath(cwd, `project-${openProjects.length + 1}`)
    await create(name, cwd)
  }

  const onTabContextMenu = (event: React.MouseEvent, id: string): void => {
    event.preventDefault()
    setStoredOpen(false)
    setSettingsId(null)
    setMenu({ x: event.clientX, y: event.clientY, id })
  }

  const closeMenu = (): void => setMenu(null)

  const doClose = async (id: string): Promise<void> => {
    await close(id)
    closeMenu()
  }

  const doArchive = async (id: string): Promise<void> => {
    await archive(id)
    closeMenu()
  }

  // window.confirm() is not implemented in Electron (it silently returns
  // false), so delete uses an in-app confirm dialog instead.
  const requestDelete = (id: string): void => {
    closeMenu()
    setDeleteError(null)
    setConfirmId(id)
  }

  const doDelete = async (id: string): Promise<void> => {
    setDeleteError(null)
    try {
      const result = await del(id)
      setConfirmId(null)
      if (settingsId === id) setSettingsId(null)
      if (result.cleanupPendingIds.length > 0) {
        setDeleteError(
          `Project deleted. Terminal cleanup will retry: ${result.cleanupPendingIds.join(', ')}`
        )
      }
    } catch (error) {
      setDeleteError(String(error))
    }
  }

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (storedRef.current?.contains(t)) return
      if (settingsRef.current?.contains(t)) return
      setMenu(null)
      setStoredOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div className="tab-bar">
      {openProjects.map((p) => (
        <button
          key={p.id}
          className={`tab ${p.id === activeProjectId ? 'tab-active' : ''}`}
          onClick={() => select(p.id)}
          onContextMenu={(e) => onTabContextMenu(e, p.id)}
          title={p.cwd ?? p.name}
        >
          <span className="tab-dot" style={p.settings?.accent ? { background: p.settings.accent } : undefined} />
          {p.name}
        </button>
      ))}
      <button className="tab tab-new" onClick={() => void newProject()} title="New project (folder)">
        +
      </button>
      {storedProjects.length > 0 && (
        <div className="tab-stored-wrap" ref={storedRef}>
          <button
            className="tab tab-stored"
            onClick={() => {
              setMenu(null)
              setSettingsId(null)
              setStoredOpen((v) => !v)
            }}
            title="Closed / archived projects"
          >
            ▾
          </button>
          {storedOpen && (
            <div className="stored-menu">
              <div className="stored-menu-title">Closed / archived</div>
              {storedProjects.map((p) => (
                <div key={p.id} className="stored-row">
                  <button
                    className="stored-reopen"
                    onClick={() => {
                      void reopen(p.id)
                      setStoredOpen(false)
                    }}
                    title={p.cwd ?? p.name}
                  >
                    {p.archived ? 'archived' : 'closed'} · {p.name}
                  </button>
                  <button
                    className="stored-delete"
                    onClick={() => void requestDelete(p.id)}
                    title="Delete permanently"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {menu && (
        <div
          className="tab-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => void doClose(menu.id)}>Close</button>
          <button onClick={() => void doArchive(menu.id)}>Archive</button>
          <button
            onClick={() => {
              setSettingsId(menu.id)
              closeMenu()
            }}
          >
            Settings
          </button>
          <button className="danger" onClick={() => void requestDelete(menu.id)}>
            Delete…
          </button>
        </div>
      )}

      {settingsProject && (
        <div className="project-settings" ref={settingsRef}>
          <div className="project-settings-title">project settings</div>
          <label className="project-settings-field">
            name
            <input
              type="text"
              defaultValue={settingsProject.name}
              key={settingsProject.id + settingsProject.name}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next && next !== settingsProject.name) void rename(settingsProject.id, next)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </label>
          <label className="project-settings-field">
            accent
            <input
              type="color"
              value={settingsProject.settings?.accent ?? '#c6f135'}
              onChange={(e) => void updateSettings(settingsProject.id, { accent: e.target.value })}
            />
          </label>
          <div className="project-settings-cwd" title={settingsProject.cwd ?? 'no folder'}>
            {settingsProject.cwd ?? 'no folder'}
          </div>
          <button className="project-settings-done" onClick={() => setSettingsId(null)}>
            done
          </button>
        </div>
      )}

      {deleteError && !confirmId && (
        <div className="tab-delete-notice" role="status">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      {confirmId && (
        <div className="confirm-overlay" onClick={() => setConfirmId(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete project?</div>
            <div className="confirm-body">
              <span className="confirm-name">
                {projects.find((p) => p.id === confirmId)?.name ?? 'project'}
              </span>
              will be removed permanently. Terminals inside it are destroyed.
            </div>
            {deleteError && <div className="confirm-body">Delete failed: {deleteError}</div>}
            <div className="confirm-actions">
              <button onClick={() => setConfirmId(null)}>Cancel</button>
              <button className="danger" onClick={() => void doDelete(confirmId)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
