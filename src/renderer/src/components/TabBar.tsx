import { useEffect, useRef, useState } from 'react'
import { useProjects } from '../state/projects'
import { projectNameFromPath } from '../state/workspace'
import { ACCENT_PRESETS, DEFAULT_ACCENT, resolveAccent } from '../state/accent'
import { normalizeRemote, remoteLabel } from '@shared/remote-project'
import type { CloudGithubFailure, CloudGithubRepo } from '@shared/types'
import { HelpBadge } from './HelpBadge'

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
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [remoteName, setRemoteName] = useState('')
  const [remoteHost, setRemoteHost] = useState('')
  const [remotePath, setRemotePath] = useState('')
  const [remoteUser, setRemoteUser] = useState('')
  const [remotePort, setRemotePort] = useState('')
  const [remoteError, setRemoteError] = useState<string | null>(null)
  // New-project "+" menu: two-item choice (folder vs GitHub import), styled
  // like the stored-projects dropdown (absolutely positioned under the button).
  const [newOpen, setNewOpen] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  // GitHub repo picker dialog state (`.confirm-overlay` pattern).
  const [ghOpen, setGhOpen] = useState(false)
  const [ghRepos, setGhRepos] = useState<CloudGithubRepo[] | null>(null)
  const [ghError, setGhError] = useState<string | null>(null)
  const [ghErrorCode, setGhErrorCode] = useState<string | null>(null)
  const [ghLoading, setGhLoading] = useState(false)
  const [ghBusyName, setGhBusyName] = useState<string | null>(null)
  const storedRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

  const openProjects = projects.filter((p) => !p.closed && !p.archived)
  const storedProjects = projects.filter((p) => p.closed || p.archived)
  const settingsProject = projects.find((p) => p.id === settingsId)

  const newProject = async (): Promise<void> => {
    setNewOpen(false)
    const cwd = await window.termsprawl.workspace.selectFolder()
    if (!cwd) return
    const name = projectNameFromPath(cwd, `project-${openProjects.length + 1}`)
    await create(name, cwd)
  }

  // ── GitHub repo picker (Task 4) ──────────────────────────────────────────
  // The renderer never sees a clone URL: repos() returns names only, and
  // import({ fullName, name }) lets MAIN mint the credential-bearing URL and
  // clone with it. On success the fresh path becomes the new project's cwd.

  const ghFail = (f: CloudGithubFailure): string => {
    setGhErrorCode(f.code)
    return f.code === 'github_not_connected' ? 'Connect GitHub in Settings first' : f.message
  }

  const loadGhRepos = async (): Promise<void> => {
    setGhLoading(true)
    setGhError(null)
    setGhErrorCode(null)
    try {
      const res = await window.termsprawl.github.repos()
      if (res.ok) {
        setGhRepos(res.repos)
      } else {
        setGhRepos(null)
        setGhError(ghFail(res))
      }
    } finally {
      setGhLoading(false)
    }
  }

  const openGhDialog = (): void => {
    setNewOpen(false)
    setGhRepos(null)
    setGhError(null)
    setGhErrorCode(null)
    setGhOpen(true)
    void loadGhRepos()
  }

  const importGhRepo = async (repo: CloudGithubRepo): Promise<void> => {
    if (ghBusyName) return
    setGhError(null)
    setGhErrorCode(null)
    setGhBusyName(repo.fullName)
    try {
      const res = await window.termsprawl.github.import({ fullName: repo.fullName, name: repo.name })
      if (!res.ok) {
        setGhError(ghFail(res))
        return
      }
      await create(repo.name, res.path)
      setGhOpen(false)
    } catch (error) {
      setGhError(error instanceof Error ? error.message : 'import failed')
    } finally {
      setGhBusyName(null)
    }
  }

  const openRemoteDialog = (): void => {
    setRemoteName(`remote-${openProjects.length + 1}`)
    setRemoteHost('')
    setRemotePath('')
    setRemoteUser('')
    setRemotePort('')
    setRemoteError(null)
    setRemoteOpen(true)
  }

  const submitRemote = async (): Promise<void> => {
    const remote = {
      host: remoteHost,
      path: remotePath,
      ...(remoteUser.trim() ? { user: remoteUser.trim() } : {}),
      ...(remotePort.trim() ? { port: Number(remotePort.trim()) } : {})
    }
    const normalized = normalizeRemote(remote)
    if (!normalized) {
      setRemoteError('host and path are required')
      return
    }
    const name = remoteName.trim() || `remote-${openProjects.length + 1}`
    await create(name, null, normalized)
    setRemoteOpen(false)
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
      if (newRef.current?.contains(t)) return
      setMenu(null)
      setStoredOpen(false)
      setNewOpen(false)
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
          title={p.cwd ?? (p.remote ? remoteLabel(p.remote) : p.name)}
        >
          <span className="tab-dot" style={p.settings?.accent ? { background: p.settings.accent } : undefined} />
          {p.name}
        </button>
      ))}
      <div className="tab-stored-wrap" ref={newRef}>
        <button
          className="tab tab-new"
          onClick={() => {
            setMenu(null)
            setSettingsId(null)
            setNewOpen((v) => !v)
          }}
          title="New project"
        >
          +
        </button>
        {newOpen && (
          <div className="stored-menu new-project-menu">
            <div className="stored-menu-title">New project</div>
            <button className="new-project-row" onClick={() => void newProject()}>
              New folder project…
            </button>
            <button className="new-project-row" onClick={openGhDialog}>
              Import from GitHub…
            </button>
          </div>
        )}
      </div>
      <button className="tab tab-new" onClick={openRemoteDialog} title="New remote (SSH) project">
        ssh
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
                    title={p.cwd ?? (p.remote ? remoteLabel(p.remote) : p.name)}
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
          <div className="project-settings-title">
            project settings
            <HelpBadge
              label="about project settings"
              text="Name and accent are stored in the workspace index, not in the folder. The accent tints this project's chrome. The path below is the project root — terminals, the file tree, and editor opens are rooted here. Close/archive keep tmux sessions; delete does not."
            />
          </div>
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
          <div className="project-settings-field">
            <span className="project-settings-label">accent</span>
            <div className="accent-swatches" role="radiogroup" aria-label="accent color">
              {ACCENT_PRESETS.map((preset, i) => {
                const current = resolveAccent(settingsProject.settings?.accent)
                const active = current ? current.toLowerCase() === preset.toLowerCase() : false
                return (
                  <button
                    key={preset}
                    type="button"
                    className={`accent-swatch${active ? ' active' : ''}`}
                    style={{ background: preset }}
                    title={preset}
                    aria-label={`accent ${preset}`}
                    aria-checked={active}
                    role="radio"
                    onClick={() => {
                      // The brand lime IS the default — picking it clears the
                      // override instead of storing a redundant copy.
                      void updateSettings(
                        settingsProject.id,
                        preset.toLowerCase() === DEFAULT_ACCENT ? { accent: undefined } : { accent: preset }
                      )
                    }}
                  />
                )
              })}
            </div>
            {settingsProject.settings?.accent && !resolveAccent(settingsProject.settings?.accent) && (
              <div className="project-settings-cwd" style={{ marginBottom: 4 }}>
                stored accent is not allowed — pick a swatch or reset
              </div>
            )}
          </div>
          {settingsProject.settings?.accent && resolveAccent(settingsProject.settings?.accent) && (
            <button
              className="project-settings-reset-accent"
              onClick={() => void updateSettings(settingsProject.id, { accent: undefined })}
              title="Remove this project's accent override and return to the default lime"
            >
              reset accent to default
            </button>
          )}
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
      {ghOpen && (
        <div className="confirm-overlay" onClick={() => setGhOpen(false)}>
          <div className="confirm-dialog gh-picker" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Import from GitHub</div>
            <div className="confirm-body">
              Clones a repo from your connected GitHub account into a new local
              project (shallow clone into ~/termsprawl). Connect GitHub in
              Settings → User &amp; cloud first.
            </div>
            <div className="gh-repo-list">
              {ghLoading && <div className="gh-repo-note">loading repositories…</div>}
              {!ghLoading && ghError && (
                <div className="gh-repo-note gh-repo-error">
                  {ghError}
                  {ghErrorCode !== 'github_not_connected' && (
                    <button className="gh-refresh" onClick={() => void loadGhRepos()}>
                      Retry
                    </button>
                  )}
                </div>
              )}
              {!ghLoading && !ghError && ghRepos && ghRepos.length === 0 && (
                <div className="gh-repo-note">no repositories found in the connected account</div>
              )}
              {!ghLoading && !ghError &&
                ghRepos?.map((repo) => (
                  <div key={repo.fullName} className="gh-repo-row">
                    <span className="gh-repo-name" title={repo.fullName}>
                      {repo.fullName}
                    </span>
                    {repo.private && <span className="gh-repo-badge">private</span>}
                    <button
                      className="gh-import-btn"
                      disabled={ghBusyName !== null}
                      onClick={() => void importGhRepo(repo)}
                    >
                      {ghBusyName === repo.fullName ? 'cloning…' : 'Import'}
                    </button>
                  </div>
                ))}
            </div>
            {ghError && ghErrorCode === 'github_not_connected' && (
              <div className="gh-repo-note">open Settings → User &amp; cloud to connect your GitHub account</div>
            )}
            <div className="confirm-actions">
              <button onClick={() => setGhOpen(false)}>Cancel</button>
              <button disabled={ghLoading} onClick={() => void loadGhRepos()}>
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      {remoteOpen && (
        <div className="confirm-overlay" onClick={() => setRemoteOpen(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">New remote (SSH) project</div>
            <div className="confirm-body">
              Terminals, git and the file tree run over ssh on the remote host.
              Open the project there with a private key already trusted by the
              host (e.g. forwarded via ssh-agent).
            </div>
            <label className="project-settings-field">
              name
              <input
                type="text"
                value={remoteName}
                onChange={(e) => setRemoteName(e.target.value)}
                placeholder="remote-1"
              />
            </label>
            <label className="project-settings-field">
              host
              <input
                type="text"
                value={remoteHost}
                onChange={(e) => setRemoteHost(e.target.value)}
                placeholder="box.example.com"
                autoFocus
              />
            </label>
            <label className="project-settings-field">
              path
              <input
                type="text"
                value={remotePath}
                onChange={(e) => setRemotePath(e.target.value)}
                placeholder="/home/user/project"
              />
            </label>
            <label className="project-settings-field">
              user (optional)
              <input
                type="text"
                value={remoteUser}
                onChange={(e) => setRemoteUser(e.target.value)}
                placeholder="user"
              />
            </label>
            <label className="project-settings-field">
              port (optional)
              <input
                type="text"
                value={remotePort}
                onChange={(e) => setRemotePort(e.target.value)}
                placeholder="22"
              />
            </label>
            {remoteError && <div className="confirm-body">{remoteError}</div>}
            <div className="confirm-actions">
              <button onClick={() => setRemoteOpen(false)}>Cancel</button>
              <button onClick={() => void submitRemote()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
