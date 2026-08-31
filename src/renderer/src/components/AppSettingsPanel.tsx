import { useEffect, useState } from 'react'
import type { AgentAccount, A2APeer, ApiProviderConfig, AppSettings, CloudBackup, CloudDeviceStart, CloudSpace, CloudUser } from '@shared/types'
import { AGENT_REGISTRY } from '@shared/agents/config'
import { HelpBadge } from './HelpBadge'
import { useCanvasRequests } from '../state/canvas-requests'
import { useProjects } from '../state/projects'
import { applyTheme } from '../state/theme'

interface AppSettingsPanelProps {
  onClose: () => void
  /** Notify the parent (App) whenever settings change, so live-settings like
   * invert-wheel-zoom propagate without reopening the panel. */
  onSettingsChange?: (settings: AppSettings) => void
}

/** The primary agent CLIs the product is built around (shown first in the
 * agents section). Claude stays registered but is optional/secondary. */
const PRIMARY_AGENTS = ['codex', 'grok'] as const

// The two panel rows that make up the General tab's pref selects.
type PresetMode = 'standard' | 'fast' | 'full'
type PermissionMode = 'workspaceWrite' | 'readOnly' | 'fullAccess'
type EnterBehavior = 'queue' | 'send' | 'prompt'
type ThemeChoice = 'light' | 'dark' | 'system'

const PRESET_MODES: { value: PresetMode; label: string }[] = [
  { value: 'standard', label: 'Standard mode' },
  { value: 'fast', label: 'Fast mode' },
  { value: 'full', label: 'Full mode' }
]

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'workspaceWrite', label: 'Workspace Write' },
  { value: 'readOnly', label: 'Read Only' },
  { value: 'fullAccess', label: 'Full Access' }
]

const ENTER_BEHAVIORS: { value: EnterBehavior; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'send', label: 'Send' },
  { value: 'prompt', label: 'Prompt' }
]

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

/** A settings-panel section. Adding one to a tab's render array adds content
 * to that sidebar tab — the extension point for future settings. `editions`
 * omits the current edition → the section is dropped from the panel (the
 * canvas shows only what the Server Edition implements). */
interface SettingsSection {
  id: string
  title: string
  editions?: EditionKind[]
  render: (ctx: SectionCtx) => React.JSX.Element
}

interface SectionCtx {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>
  permissionSupported: boolean
  addAccount: () => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  setActive: (id: string | null) => Promise<void>
  setPermissionMode: (id: string, mode: AgentAccount['permissionMode']) => Promise<void>
  loginInto: (acc: AgentAccount) => Promise<void>
  newLabel: string
  setNewLabel: (v: string) => void
  confirmDelete: string | null
  setConfirmDelete: (v: string | null) => void
  cloudUser: CloudUser | null
  cloudBusy: boolean
  device: CloudDeviceStart | null
  lastBackup: CloudBackup | null
  space: CloudSpace | null
  spaceBusy: boolean
  spaceError: string | null
  /** Status line for the last space sync action (pulled project / pushed bytes / nothing online). */
  spaceNote: string | null
  /** False while the panel has not yet learned whether the user has a space. */
  spaceLoaded: boolean
  cloudSignIn: () => Promise<void>
  cloudSignOut: () => Promise<void>
  cloudBackupNow: () => Promise<void>
  cloudOpenSpace: () => Promise<void>
  /** GitHub connection row (Task 4): connected state + connect/disconnect. */
  ghConnected: boolean
  ghBusy: boolean
  ghNote: string | null
  ghConnect: () => Promise<void>
  ghDisconnect: () => Promise<void>
  /** D1 — pull the online snapshot into a NEW local project and open it. */
  cloudOpenSnapshot: () => Promise<void>
  /** D2 — push the active project's nodes + scrollbacks to the space. */
  cloudSyncProject: () => Promise<void>
  /** Phase 16 — save the ENTIRE workspace as ONE json file. */
  workspaceExportBundle: () => Promise<void>
  /** Phase 16 — open a saved bundle and land it as NEW local projects. */
  workspaceImportBundle: () => Promise<void>
}

type TabId = 'general' | 'user' | 'agents' | 'connections' | 'updates'

/** Which edition is rendering this panel: the desktop app (full surface) or
 * the Server Edition canvas in a browser (only what the server actually
 * implements — no auto-update, no native dialogs, no desktop-only
 * integrations). Read from the bridge's runtime hint. */
type EditionKind = 'desktop' | 'server'

interface SettingsTab {
  id: TabId
  title: string
  icon: React.JSX.Element
  /** Editions this tab applies to (undefined = both). */
  editions?: EditionKind[]
}

const TABS: SettingsTab[] = [
  {
    id: 'general',
    title: 'General',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  },
  {
    id: 'user',
    title: 'User',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
      </svg>
    )
  },
  {
    id: 'agents',
    title: 'Agents',
    /** Managed agent accounts + preset/permission machinery are desktop-main
     * features; the canvas has chat-model defaults instead (Connections). */
    editions: ['desktop'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3" />
        <path d="M13 15h4" />
      </svg>
    )
  },
  {
    id: 'connections',
    title: 'Connections',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="12" r="2.5" />
        <circle cx="18" cy="12" r="2.5" />
        <path d="M8.5 12h7" />
      </svg>
    )
  },
  {
    id: 'updates',
    title: 'Updates',
    /** Auto-update is an Electron/OS-level feature — a container's canvas has
     * nothing to update (the operator rebuilds the image). */
    editions: ['desktop'],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 4v5h-5" />
      </svg>
    )
  }
]

export function AppSettingsPanel({ onClose, onSettingsChange }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    autoDownloadUpdates: false,
    accounts: [],
    activeAccountId: null,
    dismissedAnnouncementVersion: null,
    a2aPeers: [],
    apiProviders: [],
    theme: 'system',
    language: 'en',
    agentPreset: 'standard',
    defaultPermission: 'workspaceWrite',
    enterBehavior: 'queue',
    agentBrowserControl: false
  })
  const [permissionSupported, setPermissionSupported] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [device, setDevice] = useState<CloudDeviceStart | null>(null)
  const [lastBackup, setLastBackup] = useState<CloudBackup | null>(null)
  const [space, setSpace] = useState<CloudSpace | null>(null)
  const [spaceBusy, setSpaceBusy] = useState(false)
  const [spaceError, setSpaceError] = useState<string | null>(null)
  const [spaceNote, setSpaceNote] = useState<string | null>(null)
  const [spaceLoaded, setSpaceLoaded] = useState(false)
  const [tab, setTab] = useState<TabId>('general')
  // Which edition is serving this renderer — the bridge carries the hint.
  const edition: EditionKind = window.termsprawl.runtime?.kind === 'server' ? 'server' : 'desktop'
  const isDesktop = edition === 'desktop'
  // Drafts for the A2A + API add forms.
  const [peerLabel, setPeerLabel] = useState('')
  const [peerEndpoint, setPeerEndpoint] = useState('')
  const [providerName, setProviderName] = useState('')
  const [providerBaseUrl, setProviderBaseUrl] = useState('')

  useEffect(() => {
    void window.termsprawl.settings.get().then((s) => {
      setSettings(s)
      applyTheme(s.theme ?? 'system')
    })
    void window.termsprawl.settings.permissionSupported().then(setPermissionSupported)
    void window.termsprawl.cloud.status().then(setCloudUser).catch(() => setCloudUser(null))
    void window.termsprawl.cloud
      .spaceStatus()
      .then(setSpace)
      .catch(() => setSpace(null))
      .finally(() => setSpaceLoaded(true))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await window.termsprawl.settings.set(patch)
    setSettings(next)
    onSettingsChange?.(next)
    if (patch.theme) applyTheme(patch.theme)
    return next
  }

  const toggleAutoDownload = async (checked: boolean): Promise<void> => {
    await update({ autoDownloadUpdates: checked })
  }

  const addAccount = async (): Promise<void> => {
    const next = await window.termsprawl.settings.createAccount(newLabel.trim() || 'account')
    setSettings(next)
    setNewLabel('')
  }

  const setActive = async (id: string | null): Promise<void> => {
    await update({ activeAccountId: id })
  }

  const setPermissionMode = async (id: string, mode: AgentAccount['permissionMode']): Promise<void> => {
    await update({ accounts: settings.accounts.map((a) => (a.id === id ? { ...a, permissionMode: mode } : a)) })
  }

  const loginInto = async (acc: AgentAccount): Promise<void> => {
    if (settings.activeAccountId !== acc.id) await update({ activeAccountId: acc.id })
    const command = await window.termsprawl.settings.loginCommand()
    useCanvasRequests.getState().spawn({ kind: 'agentLogin', command })
    onClose()
  }

  const deleteAccount = async (id: string): Promise<void> => {
    const next = await window.termsprawl.settings.deleteAccount(id)
    setSettings(next)
    setConfirmDelete(null)
  }

  const addPeer = async (): Promise<void> => {
    const label = peerLabel.trim()
    const endpoint = peerEndpoint.trim()
    if (!label || !endpoint) return
    await update({ a2aPeers: [...(settings.a2aPeers ?? []), { id: crypto.randomUUID(), label, endpoint }] })
    setPeerLabel('')
    setPeerEndpoint('')
  }

  const removePeer = async (id: string): Promise<void> => {
    await update({ a2aPeers: (settings.a2aPeers ?? []).filter((p) => p.id !== id) })
  }

  const addProvider = async (): Promise<void> => {
    const name = providerName.trim()
    const baseUrl = providerBaseUrl.trim()
    if (!name || !baseUrl) return
    await update({ apiProviders: [...(settings.apiProviders ?? []), { id: crypto.randomUUID(), name, baseUrl }] })
    setProviderName('')
    setProviderBaseUrl('')
  }

  const removeProvider = async (id: string): Promise<void> => {
    await update({ apiProviders: (settings.apiProviders ?? []).filter((p) => p.id !== id) })
  }

  // Termsprawl Cloud — GitHub device flow (from the cloud track): main opens the
  // verification page, we show the user_code and poll until the user approves.
  const cloudSignIn = async (): Promise<void> => {
    if (cloudBusy) return
    setCloudBusy(true)
    setDevice(null)
    try {
      const start = await window.termsprawl.cloud.deviceStart()
      setDevice(start)
      let user: CloudUser | null = null
      for (let i = 0; i < 120 && !user; i++) {
        await new Promise((r) => setTimeout(r, (start.interval || 5) * 1000))
        const p = await window.termsprawl.cloud.devicePoll(start.device_code)
        if (p.status === 'ok' && p.user) user = p.user
      }
      setDevice(null)
      setCloudUser(user)
    } finally {
      setCloudBusy(false)
    }
  }

  const cloudSignOut = async (): Promise<void> => {
    await window.termsprawl.cloud.signOut()
    setCloudUser(null)
    setLastBackup(null)
    setGhConnected(false)
  }

  // GitHub connection row (Task 4): the repo scope rides the existing device
  // flow, so "Connect GitHub" just runs the same sign-in; after a successful
  // sign-in we ask the cloud whether the vault holds a repo-scoped token by
  // probing the repo listing. Disconnect wipes the cloud vault token
  // (DELETE /github/connection).
  const [ghConnected, setGhConnected] = useState(false)
  const [ghBusy, setGhBusy] = useState(false)
  const [ghNote, setGhNote] = useState<string | null>(null)

  // GitHub is a CLOUD feature, not a desktop-local one: the space imports
  // repos too (the space container clones via the cloud broker). The
  // connection row shows on both editions when the cloud is reachable.
  const ghRelevant = isDesktop || cloudUser !== null

  const refreshGhConnected = async (): Promise<boolean> => {
    if (!cloudUser) {
      setGhConnected(false)
      return false
    }
    try {
      const res = await window.termsprawl.github.repos()
      setGhConnected(res.ok)
      return res.ok
    } catch {
      setGhConnected(false)
      return false
    }
  }

  useEffect(() => {
    void refreshGhConnected()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudUser])

  const ghConnect = async (): Promise<void> => {
    if (ghBusy) return
    setGhBusy(true)
    setGhNote(null)
    try {
      // Same device flow as the cloud sign-in — the repo scope rides it.
      await cloudSignIn()
      const connected = await refreshGhConnected()
      // A grant that predates repo scope needs a re-approval on the GitHub
      // side; surface it instead of claiming success.
      setGhNote(connected ? null : 'GitHub connected, but repo access is missing — disconnect, then connect again and approve the repo scope')
    } finally {
      setGhBusy(false)
    }
  }

  const ghDisconnect = async (): Promise<void> => {
    if (ghBusy) return
    setGhBusy(true)
    setGhNote(null)
    try {
      const res = await window.termsprawl.github.disconnect()
      if (res.ok) {
        setGhConnected(false)
        setGhNote('GitHub disconnected — the stored token was removed')
      } else {
        setGhNote(res.message)
      }
    } finally {
      setGhBusy(false)
    }
  }

  const cloudBackupNow = async (): Promise<void> => {
    setLastBackup(await window.termsprawl.cloud.backupNow())
  }

  // Online canvas spaces (Pro): main mints the short-lived access token and
  // opens the returned URL — which carries the auth — in the system browser.
  const cloudOpenSpace = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    try {
      await window.termsprawl.cloud.openSpace()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open your online canvas')
    } finally {
      setSpaceBusy(false)
    }
  }

  // D1 — "Open online snapshot": main pulls the space content and imports the
  // current project as a NEW local project (collision-safe name, scrollbacks
  // persisted for the cold-start replay). On success the canvas switches to
  // the fresh project via the one-shot canvas request store; the panel closes
  // so the user actually sees it.
  const cloudOpenSnapshot = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.cloud.pullSpace()
      if (result.empty) {
        setSpaceNote('No online snapshot yet — sync a project first')
        return
      }
      // Cache the raw persisted nodes (the store's serialized shape — Canvas
      // runs deserializeNodes on switch, the same path a boot load uses) and
      // make the new project active.
      useProjects.getState().adopt(result.project, result.nodes)
      useCanvasRequests.getState().spawn({ kind: 'switchProject', projectId: result.project.id })
      onClose()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open the online snapshot')
    } finally {
      setSpaceBusy(false)
    }
  }

  // D2 — "Sync this project online": push the ACTIVE project's nodes +
  // scrollbacks. Main provisions a space first when the user has none; free
  // plans surface 403 upgrade_required here like every other cloud error.
  const cloudSyncProject = async (): Promise<void> => {
    if (spaceBusy) return
    const activeId = useProjects.getState().activeProjectId
    if (!activeId) {
      setSpaceError('No active project to sync')
      return
    }
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.cloud.pushSpace(activeId)
      setSpaceNote(
        `Synced "${useProjects.getState().projects.find((p) => p.id === activeId)?.name ?? 'project'}" online${result.provisioned ? ' (space provisioned)' : ''}`
      )
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not sync the project online')
    } finally {
      setSpaceBusy(false)
    }
  }

  // Phase 16 — "Export workspace…": main gathers the ENTIRE workspace (index,
  // every project's nodes, every terminal's scrollback) into ONE json file via
  // the save dialog. Canceled dialog = silent no-op.
  const workspaceExportBundle = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.workspace.exportBundle()
      setSpaceNote(result.saved ? `Workspace saved to ${result.path}` : null)
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not export the workspace')
    } finally {
      setSpaceBusy(false)
    }
  }

  // Phase 16 — "Open workspace…": a saved bundle lands as NEW local projects
  // (collision-safe names, terminal ids remapped on collision, scrollbacks
  // persisted for replay). On success the canvas switches to the first
  // imported project the same way the online-snapshot flow does.
  const workspaceImportBundle = async (): Promise<void> => {
    if (spaceBusy) return
    setSpaceBusy(true)
    setSpaceError(null)
    setSpaceNote(null)
    try {
      const result = await window.termsprawl.workspace.importBundle()
      if (result.imported === 0 || !result.firstProjectId) {
        return // dialog canceled — nothing to report
      }
      // Refresh the projects store from disk (the import happened in main),
      // then switch the canvas to the first imported project via the one-shot
      // canvas request — the exact D1 sequence.
      await useProjects.getState().load()
      useCanvasRequests.getState().spawn({ kind: 'switchProject', projectId: result.firstProjectId })
      onClose()
    } catch (e) {
      setSpaceError(e instanceof Error ? e.message : 'could not open the workspace file')
    } finally {
      setSpaceBusy(false)
    }
  }

  const ctx: SectionCtx = {
    settings,
    update,
    permissionSupported,
    addAccount,
    deleteAccount,
    setActive,
    setPermissionMode,
    loginInto,
    newLabel,
    setNewLabel,
    confirmDelete,
    setConfirmDelete,
    cloudUser,
    cloudBusy,
    device,
    lastBackup,
    space,
    spaceBusy,
    spaceError,
    spaceNote,
    spaceLoaded,
    cloudSignIn,
    cloudSignOut,
    cloudBackupNow,
    cloudOpenSpace,
    ghConnected,
    ghBusy,
    ghNote,
    ghConnect,
    ghDisconnect,
    cloudOpenSnapshot,
    cloudSyncProject,
    workspaceExportBundle,
    workspaceImportBundle
  }

  // Sidebar tabs, grouped by termsprawl domain, filtered by edition. Each tab
  // hosts the sections that actually belong to it; a section whose `editions`
  // omits the current one is dropped — the canvas panel only shows controls
  // the Server Edition actually implements.
  const allSections: Record<TabId, SettingsSection[]> = {
    general: [
      {
        id: 'prefs',
        title: 'Preferences',
        render: (c) => (
          <>
            {/* Canvas: the agent preset + permission selects are desktop-side
                spawn defaults (they gate desktop agent-node launches); the
                server has no agent-node spawning UI, so they hide there. */}
            {isDesktop && (
              <div className="settings-pref-row">
                <div className="settings-pref-copy">
                  <span className="settings-pref-label">Agent preset</span>
                  <span className="settings-pref-sub">Tuning for new agent sessions (standard / fast / full)</span>
                </div>
                <select
                  className="settings-select"
                  value={c.settings.agentPreset ?? 'standard'}
                  aria-label="Agent preset"
                  onChange={(e) => void c.update({ agentPreset: e.target.value })}
                >
                  {PRESET_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}

            {isDesktop && (
              <div className="settings-pref-row">
                <div className="settings-pref-copy">
                  <span className="settings-pref-label">Permission</span>
                  <span className="settings-pref-sub">Default permission mode for new agent sessions (when the CLI supports it)</span>
                </div>
                <select
                  className="settings-select"
                  value={c.settings.defaultPermission ?? 'workspaceWrite'}
                  aria-label="Default permission mode"
                  onChange={(e) => void c.update({ defaultPermission: e.target.value })}
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="settings-group">
              <div className="settings-group-title">Appearance</div>
              <div className="settings-theme-cards">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`settings-theme-card${(c.settings.theme ?? 'system') === t.value ? ' is-active' : ''}`}
                    onClick={() => void c.update({ theme: t.value })}
                  >
                    <span className="settings-theme-icon">{themeIcon(t.value)}</span>
                    <span className="settings-theme-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-pref-row">
              <div className="settings-pref-copy">
                <span className="settings-pref-label">Enter behavior while busy</span>
                <span className="settings-pref-sub">In chat nodes: Enter sends; busy sessions queue, send, or prompt. Shift+Enter breaks the line</span>
              </div>
              <select
                className="settings-select"
                value={c.settings.enterBehavior ?? 'queue'}
                aria-label="Enter behavior while busy"
                onChange={(e) => void c.update({ enterBehavior: e.target.value })}
              >
                {ENTER_BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>

            {/* Browser nodes are Electron-only (sandboxed <webview> guests) —
                a browser-based canvas cannot render one, so the whole browser
                section (agent control + home page) is desktop-only. */}
            {isDesktop && (
              <>
                <div className="settings-pref-row">
                  <div className="settings-pref-copy">
                    <span className="settings-pref-label">Allow agents to control browser nodes</span>
                    <span className="settings-pref-sub">
                      Off (default): embedded browsers work normally but no agent endpoint exists. On: an external
                      agent can open and drive browser nodes over a localhost-only CDP endpoint
                    </span>
                  </div>
                  <label className="app-settings-toggle">
                    <input
                      type="checkbox"
                      checked={c.settings.agentBrowserControl === true}
                      onChange={(e) => void c.update({ agentBrowserControl: e.target.checked })}
                    />
                  </label>
                </div>

                <div className="settings-pref-row">
                  <div className="settings-pref-copy">
                    <span className="settings-pref-label">Search provider / browser home</span>
                    <span className="settings-pref-sub">
                      URL opened when a browser node or new tab starts — point this at
                      your own SearXNG (e.g. http://127.0.0.1:8080 or a LAN host) for
                      private search. Empty = DuckDuckGo
                    </span>
                  </div>
                  <input
                    type="text"
                    className="settings-text-input"
                    placeholder="https://duckduckgo.com"
                    spellCheck={false}
                    value={c.settings.browserHomeUrl ?? ''}
                    onChange={(e) => void c.update({ browserHomeUrl: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="settings-pref-row">
              <div className="settings-pref-copy">
                <span className="settings-pref-label">Invert mousewheel zoom</span>
                <span className="settings-pref-sub">
                  Off (default): scroll up zooms in. On: scroll up zooms out
                </span>
              </div>
              <label className="app-settings-toggle">
                <input
                  type="checkbox"
                  checked={c.settings.invertWheelZoom === true}
                  onChange={(e) => void c.update({ invertWheelZoom: e.target.checked })}
                />
              </label>
            </div>
          </>
        )
      }
    ],
    user: [
      {
        id: 'user',
        title: isDesktop ? 'User & cloud' : 'Cloud',
        render: (c) => <UserSection ctx={c} />
      }
    ],
    agents: [
      // Canvas: the agents tab carries the account/permission machinery which
      // is desktop-main-only — but chat-node defaults ARE server-relevant,
      // and they live in Connections → Chat models on both editions.
      { id: 'agents', title: 'Agents', editions: ['desktop'], render: () => <AgentsSection /> },
      {
        id: 'accounts',
        title: 'Agent accounts',
        editions: ['desktop'],
        render: (c) => (
          <AccountsSection
            settings={c.settings}
            permissionSupported={permissionSupported}
            addAccount={addAccount}
            deleteAccount={deleteAccount}
            setActive={setActive}
            setPermissionMode={setPermissionMode}
            loginInto={loginInto}
            newLabel={newLabel}
            setNewLabel={setNewLabel}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
          />
        )
      }
    ],
    connections: [
      {
        id: 'a2a',
        title: 'A2A peers',
        editions: ['desktop'],
        render: (c) => (
          <A2ASection
            peers={c.settings.a2aPeers ?? []}
            peerLabel={peerLabel}
            peerEndpoint={peerEndpoint}
            setPeerLabel={setPeerLabel}
            setPeerEndpoint={setPeerEndpoint}
            addPeer={addPeer}
            removePeer={removePeer}
          />
        )
      },
      {
        id: 'api',
        title: 'API providers',
        render: (c) => (
          <ApiSection
            providers={c.settings.apiProviders ?? []}
            providerName={providerName}
            providerBaseUrl={providerBaseUrl}
            setProviderName={setProviderName}
            setProviderBaseUrl={setProviderBaseUrl}
            addProvider={addProvider}
            removeProvider={removeProvider}
          />
        )
      },
      {
        id: 'telegram',
        title: 'Telegram bot',
        editions: ['desktop'],
        render: (c) => <TelegramSection ctx={c} />
      },
      {
        id: 'relay',
        title: 'Relay',
        editions: ['desktop'],
        render: (c) => <RelaySection ctx={c} />
      },
      {
        id: 'chat',
        title: 'Chat models',
        render: (c) => <ChatSection ctx={c} />
      }
    ],
    updates: [
      { id: 'updates', title: 'Updates', render: (c) => <UpdatesSection ctx={c} /> }
    ]
  }

  // Filter the visible tab list by edition, then each tab's sections.
  const visibleTabs = TABS.filter((t) => !t.editions || t.editions.includes(edition))
  const tabSections: Record<TabId, SettingsSection[]> = allSections
  // If the active tab vanished for this edition, snap back to General.
  const activeTab: TabId = visibleTabs.some((t) => t.id === tab) ? tab : 'general'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="settings">
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">Settings</span>
          <div className="settings-sheet-head-actions">
            <button className="settings-modal-close" onClick={onClose} title="Close settings">×</button>
          </div>
        </div>

        <div className="settings-sheet-body">
          <nav className="settings-nav" aria-label="settings sections">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-nav-item${activeTab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="settings-nav-icon">{t.icon}</span>
                <span>{t.title}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tabSections[activeTab]
              .filter((s) => !s.editions || s.editions.includes(edition))
              .map((section) => (
                <div key={section.id} className="settings-section">
                  <div className="settings-section-title">{section.title}</div>
                  {section.render(ctx)}
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function themeIcon(theme: ThemeChoice): React.JSX.Element {
  if (theme === 'light') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    )
  }
  if (theme === 'dark') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="18" x2="12" y2="21" />
    </svg>
  )
}

/** Short display label for a space URL from the API ("canvas.termsprawl.com/dazeb"). */
function spaceUrlLabel(space: CloudSpace): string {
  try {
    const u = new URL(space.url)
    return `${u.host}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return space.url
  }
}

function UserSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const {
    settings, update, cloudUser, cloudBusy, device, lastBackup,
    space, spaceBusy, spaceError, spaceNote, spaceLoaded,
    cloudSignIn, cloudSignOut, cloudBackupNow, cloudOpenSpace,
    ghConnected, ghBusy, ghNote, ghConnect, ghDisconnect,
    cloudOpenSnapshot, cloudSyncProject,
    workspaceExportBundle, workspaceImportBundle
  } = ctx
  // Edition: the space rows (open your online canvas / open snapshot / sync
  // this project) drive a DESKTOP↔space loop — from inside the space itself
  // they are meaningless (you ARE the space). Workspace export/import needs
  // native save dialogs — desktop-only. The GitHub connection row is a CLOUD
  // feature (the space imports repos via the broker) but the shim's github
  // stub rejects, so it only shows on desktop for now.
  const isDesktop = window.termsprawl.runtime?.kind !== 'server'
  const [draft, setDraft] = useState(settings.displayName ?? '')
  useEffect(() => setDraft(settings.displayName ?? ''), [settings.displayName])
  // The upsell lands on the web dashboard's billing page — the same surface the
  // Stripe checkout/portal flows live on.
  const openBilling = (): void => {
    void window.termsprawl.openExternal(`${(settings.cloudApiBase ?? 'https://termsprawl.com').replace(/\/$/, '')}/dashboard/billing`)
  }
  return (
    <div className="settings-section">
      {device && (
        <p className="app-settings-hint">
          open <strong>{device.verification_uri}</strong> and enter code <strong>{device.user_code}</strong> to link this device.
        </p>
      )}
      {cloudUser ? (
        <>
          <p className="app-settings-hint">
            signed in as {cloudUser.github_login} · {cloudUser.plan} plan. Backups are encrypted server-side with your key.
          </p>
          <div className="account-row">
            <button className="account-login" onClick={() => void cloudBackupNow()}>back up now</button>
            {lastBackup && <span className="account-id">backup {lastBackup.id.slice(0, 8)} · {lastBackup.size_bytes} bytes</span>}
            <button className="account-delete" onClick={() => void cloudSignOut()}>sign out</button>
          </div>
          {isDesktop && (cloudUser.plan === 'pro' || cloudUser.plan === 'canvas') ? (
            <>
              <div className="account-row">
                <button className="account-login" disabled={spaceBusy} onClick={() => void cloudOpenSpace()}>
                  {spaceBusy ? 'opening…' : 'open your online canvas'}
                </button>
                {space && <span className="account-id">{spaceUrlLabel(space)} · {space.status}</span>}
                {spaceError && <span className="account-confirm-text">{spaceError}</span>}
                {spaceNote && <span className="account-id">{spaceNote}</span>}
              </div>
              <div className="account-row">
                {/* D1 — pull the online snapshot into a NEW local project and
                    switch to it. Disabled while busy; a space with nothing
                    online yet shows the note instead of failing. */}
                <button
                  className="account-login"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudOpenSnapshot()}
                >
                  {spaceBusy ? 'working…' : 'open online snapshot'}
                </button>
                {/* D2 — push the active project's nodes + scrollbacks. Provisions
                    the space first when the user has none. */}
                <button
                  className="account-login"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudSyncProject()}
                >
                  {spaceBusy ? 'working…' : 'sync this project online'}
                </button>
              </div>
              {/* Phase 16 — the whole workspace as ONE json file: save/open
                  dialogs live in main; the same busy/error/note surface as the
                  spaces rows above. Works signed-in or not. */}
              <div className="account-row">
                <button
                  className="account-login"
                  disabled={spaceBusy}
                  onClick={() => void workspaceExportBundle()}
                >
                  {spaceBusy ? 'working…' : 'export workspace…'}
                </button>
                <button
                  className="account-login"
                  disabled={spaceBusy}
                  onClick={() => void workspaceImportBundle()}
                >
                  {spaceBusy ? 'working…' : 'open workspace…'}
                </button>
              </div>
            </>
          ) : !isDesktop ? null : (
            <div className="account-row">
              <button className="account-login" onClick={openBilling}>upgrade to pro</button>
              <span className="account-id">pro adds an online canvas space that syncs with this desktop</span>
            </div>
          )}
        </>
      ) : (
        <div className="account-row">
          <button className="account-login" disabled={cloudBusy} onClick={() => void cloudSignIn()}>
            {cloudBusy ? 'waiting for github…' : 'sign in with github'}
          </button>
          {!isDesktop && <span className="account-id">sign in to sync this canvas with your desktop</span>}
        </div>
      )}
      {cloudUser && isDesktop && (
        <div className="account-row">
          {ghConnected ? (
            <>
              <span className="account-id">GitHub connected</span>
              <button className="account-delete" disabled={ghBusy} onClick={() => void ghDisconnect()}>
                {ghBusy ? 'working…' : 'disconnect'}
              </button>
            </>
          ) : (
            <button className="account-login" disabled={ghBusy || cloudBusy} onClick={() => void ghConnect()}>
              {ghBusy || cloudBusy ? 'waiting for github…' : 'Connect GitHub'}
            </button>
          )}
          {ghNote && <span className="account-confirm-text">{ghNote}</span>}
        </div>
      )}
      <label className="app-settings-toggle">
        display name
        <input
          type="text"
          value={draft}
          placeholder="your name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = draft.trim()
            if (v && v !== settings.displayName) void update({ displayName: v })
          }}
        />
      </label>
      <p className="app-settings-hint">
        {isDesktop
          ? 'Termsprawl Cloud account (sign in to back up projects) and a basic display name. Settings live in settings.json in the config directory.'
          : 'Sign in with the same GitHub account as your desktop to sync projects between them. Cloud settings for this canvas are managed here; everything else lives on your desktop.'}
      </p>
    </div>
  )
}

function UpdatesSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  return (
    <div className="settings-section">
      <label className="app-settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoDownloadUpdates}
          onChange={(e) => void update({ autoDownloadUpdates: e.target.checked })}
        />
        auto download updates when available
        <HelpBadge
          label="about auto download"
          text="Off (default): a toast appears when a newer GitHub release exists; you choose when to download. On: the AppImage/.deb downloads in the background, then the toast asks you to restart."
        />
      </label>
      <p className="app-settings-hint">When off, you get a toast and choose when to download. When on, updates download in the background and you restart to install.</p>
    </div>
  )
}

function AgentsSection(): React.JSX.Element {
  return (
    <div className="settings-section">
      <p className="app-settings-hint">Primary agents: codex and grok. Open them from the canvas context menu (Open agent ▸). Claude stays registered but is optional.</p>
      {PRIMARY_AGENTS.map((id) => {
        const config = AGENT_REGISTRY[id]
        if (!config) return null
        return (
          <div key={id} className="account-row">
            <span className="account-label">{config.name}</span>
            <span className="account-id">{config.command}</span>
            <span className="account-id">{config.capabilities.hooks ? 'hooks' : 'no hooks'}</span>
          </div>
        )
      })}
    </div>
  )
}

function AccountsSection(props: {
  settings: AppSettings
  permissionSupported: boolean
  addAccount: () => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  setActive: (id: string | null) => Promise<void>
  setPermissionMode: (id: string, mode: AgentAccount['permissionMode']) => Promise<void>
  loginInto: (acc: AgentAccount) => Promise<void>
  newLabel: string
  setNewLabel: (v: string) => void
  confirmDelete: string | null
  setConfirmDelete: (v: string | null) => void
}): React.JSX.Element {
  const { settings, permissionSupported, addAccount, deleteAccount, setActive, setPermissionMode, loginInto, newLabel, setNewLabel, confirmDelete, setConfirmDelete } = props
  return (
    <div className="settings-section">
      <p className="app-settings-hint">Each account is its own local agent config directory. Pick the active account for new agents; none means the default. Inherited API keys are stripped from its spawns.</p>
      {settings.accounts.length === 0 && <p className="app-settings-hint">no accounts yet — add one below.</p>}
      {settings.accounts.map((acc) => (
        <div key={acc.id} className="account-row">
          <label className="account-radio">
            <input type="radio" name="activeAccount" checked={settings.activeAccountId === acc.id} onChange={() => void setActive(acc.id)} />
            <span className="account-label">{acc.label}</span>
            <span className="account-id">{acc.id}</span>
          </label>
          {permissionSupported && (
            <select className="account-permission" value={acc.permissionMode ?? 'default'} title="permission mode" onChange={(e) => void setPermissionMode(acc.id, e.target.value as AgentAccount['permissionMode'])}>
              <option value="default">default</option>
              <option value="acceptEdits">accept edits</option>
              <option value="bypassPermissions">bypass</option>
            </select>
          )}
          {!confirmDelete && <button className="account-login" title="open a login terminal for this account" onClick={() => void loginInto(acc)}>login</button>}
          {confirmDelete === acc.id ? (
            <span className="account-confirm">
              <span className="account-confirm-text">removes its local config dir</span>
              <button className="account-danger" onClick={() => void deleteAccount(acc.id)}>confirm delete</button>
              <button onClick={() => setConfirmDelete(null)}>keep</button>
            </span>
          ) : (
            <button className="account-delete" title="delete this account" onClick={() => setConfirmDelete(acc.id)}>delete</button>
          )}
        </div>
      ))}
      <div className="account-new">
        <input className="account-label-input" value={newLabel} placeholder="account label" onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addAccount() }} />
        <button onClick={() => void addAccount()}>add account</button>
      </div>
    </div>
  )
}

function A2ASection(props: { peers: A2APeer[]; peerLabel: string; peerEndpoint: string; setPeerLabel: (v: string) => void; setPeerEndpoint: (v: string) => void; addPeer: () => Promise<void>; removePeer: (id: string) => Promise<void> }): React.JSX.Element {
  const { peers, peerLabel, peerEndpoint, setPeerLabel, setPeerEndpoint, addPeer, removePeer } = props
  return (
    <div className="settings-section">
      <p className="app-settings-hint">Agent-to-agent peers you can route tasks to. Config only for now — orchestration is a later feature.</p>
      {peers.map((p) => (
        <div key={p.id} className="account-row">
          <span className="account-label">{p.label}</span>
          <span className="account-id">{p.endpoint}</span>
          <button className="account-delete" onClick={() => void removePeer(p.id)}>remove</button>
        </div>
      ))}
      <div className="account-new">
        <input className="account-label-input" value={peerLabel} placeholder="peer label" onChange={(e) => setPeerLabel(e.target.value)} />
        <input className="account-label-input" value={peerEndpoint} placeholder="http://127.0.0.1:8787" onChange={(e) => setPeerEndpoint(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPeer() }} />
        <button onClick={() => void addPeer()}>add peer</button>
      </div>
    </div>
  )
}

function ApiSection(props: { providers: ApiProviderConfig[]; providerName: string; providerBaseUrl: string; setProviderName: (v: string) => void; setProviderBaseUrl: (v: string) => void; addProvider: () => Promise<void>; removeProvider: (id: string) => Promise<void> }): React.JSX.Element {
  const { providers, providerName, providerBaseUrl, setProviderName, setProviderBaseUrl, addProvider, removeProvider } = props
  return (
    <div className="settings-section">
      <p className="app-settings-hint">OSS/provider API endpoints for the chat and agent drivers. API keys are NOT stored here — add a keychain-backed field later if needed.</p>
      {providers.map((p) => (
        <div key={p.id} className="account-row">
          <span className="account-label">{p.name}</span>
          <span className="account-id">{p.baseUrl}</span>
          <button className="account-delete" onClick={() => void removeProvider(p.id)}>remove</button>
        </div>
      ))}
      <div className="account-new">
        <input className="account-label-input" value={providerName} placeholder="provider (e.g. xAI)" onChange={(e) => setProviderName(e.target.value)} />
        <input className="account-label-input" value={providerBaseUrl} placeholder="https://api.x.ai/v1" onChange={(e) => setProviderBaseUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addProvider() }} />
        <button onClick={() => void addProvider()}>add provider</button>
      </div>
    </div>
  )
}

/** Telegram bot (Phase 11 Task 11.3). Local bot the user's phone pairs with.
 * The token is the user's own bot secret — stored in settings.json on this
 * machine only (env TERMSPRAWL_TELEGRAM_TOKEN overrides it in dev). The
 * allowlist is the paired phone(s); empty = first /start becomes the owner. */
function TelegramSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const tg = settings.telegram ?? { enabled: false, allowedChatIds: [] }
  const allowed = (tg.allowedChatIds ?? []).join('\n')
  const [draft, setDraft] = useState<{ token: string; allowed: string }>({
    token: tg.token ?? '',
    allowed
  })

  // Saves the whole telegram block; token only when the user typed a new one.
  const save = (patch: { enabled?: boolean; token?: string; allowedChatIds?: string[] }): void => {
    void update({
      telegram: {
        enabled: patch.enabled ?? tg.enabled === true,
        token: patch.token !== undefined ? patch.token : (tg.token ?? ''),
        allowedChatIds:
          patch.allowedChatIds !== undefined ? patch.allowedChatIds : (tg.allowedChatIds ?? [])
      }
    })
  }

  return (
    <div className="settings-section">
      <p className="app-settings-hint">
        Control termsprawl from your phone. Pair by messaging the bot with /start from
        the phone; the first chat becomes the owner unless you list chats below. The bot
        token is stored on this machine only — never committed to the repo (the
        TERMSPRAWL_TELEGRAM_TOKEN env var overrides it).
      </p>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Enable Telegram bot</span>
          <span className="settings-pref-sub">
            On: the bot starts and watches for messages. Off (default): nothing runs
          </span>
        </div>
        <label className="app-settings-toggle">
          <input
            type="checkbox"
            checked={tg.enabled === true}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
        </label>
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Bot token</span>
          <span className="settings-pref-sub">
            {tg.token ? `a token is set (${tg.token.slice(-4)})` : 'no token — get one from @BotFather'}
          </span>
        </div>
        <input
          type="password"
          className="settings-text-input"
          placeholder={tg.token ? '••••••••' : '123:bot-token'}
          spellCheck={false}
          value={draft.token}
          onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
          onBlur={() => {
            if (draft.token.trim() && draft.token !== (tg.token ?? '')) void save({ token: draft.token.trim() })
          }}
        />
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Allowed chat ids</span>
          <span className="settings-pref-sub">
            empty = the first chat to /start becomes the owner; otherwise only these chats
            may issue commands
          </span>
        </div>
        <textarea
          className="settings-text-input"
          rows={3}
          placeholder="one chat id per line"
          spellCheck={false}
          value={draft.allowed}
          onChange={(e) => setDraft((d) => ({ ...d, allowed: e.target.value }))}
          onBlur={() =>
            void save({
              allowedChatIds: draft.allowed
                .split(/\n|,/)
                .map((s) => s.trim())
                .filter(Boolean)
            })
          }
        />
      </div>
    </div>
  )
}

/** Relay (Phase 11 Task 11.2, surfaced by audit B7): dial target + role +
 * invite for the E2E-encrypted relay. Connect/disconnect live here too — the
 * runtime is idle unless explicitly dialed. The URL is non-secret config
 * (same class as apiProviders); invite codes are pair-once secrets stored on
 * this machine only. */
function RelaySection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const relay = settings.relay ?? { role: 'host' as const }
  const [draft, setDraft] = useState<{ url: string; invite: string }>({
    url: relay.url ?? '',
    invite: relay.invite ?? ''
  })
  const [conn, setConn] = useState<{ state: string; error: string | null }>({
    state: 'disconnected',
    error: null
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void window.termsprawl.relay.status().then((s) => {
      if (alive) setConn(s)
    })
    const off = window.termsprawl.relay.onStatus((s) => {
      if (alive) setConn(s)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const saveRelay = (patch: { url?: string; role?: 'host' | 'client'; invite?: string }): void => {
    void update({
      relay: {
        url: patch.url !== undefined ? patch.url : (relay.url ?? ''),
        role: patch.role ?? (relay.role === 'client' ? 'client' : 'host'),
        invite: patch.invite !== undefined ? patch.invite : relay.invite
      }
    })
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.termsprawl.relay.connect()
      if (!res.ok) setConn({ state: 'error', error: res.error ?? 'connect failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-section">
      <p className="app-settings-hint">
        Pair two termsprawl instances through the E2E-encrypted relay: the host dials in
        with role host, the peer joins with an invite code (role client). Traffic is
        end-to-end encrypted — the relay only routes ciphertext. Nothing dials until you
        press connect.
      </p>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Relay URL</span>
          <span className="settings-pref-sub">wss:// address of the relay service</span>
        </div>
        <input
          className="settings-text-input"
          placeholder="wss://relay.example.com"
          spellCheck={false}
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          onBlur={() => {
            if (draft.url.trim() !== (relay.url ?? '')) void saveRelay({ url: draft.url.trim() })
          }}
        />
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Role</span>
          <span className="settings-pref-sub">host exposes this machine; client connects out to a host</span>
        </div>
        <select
          className="settings-select"
          value={relay.role === 'client' ? 'client' : 'host'}
          aria-label="Relay role"
          onChange={(e) => void saveRelay({ role: e.target.value as 'host' | 'client' })}
        >
          <option value="host">host</option>
          <option value="client">client</option>
        </select>
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Invite code</span>
          <span className="settings-pref-sub">
            {relay.invite ? `an invite is set (${relay.invite.slice(-4)})` : 'client role: paste the invite from the host'}
          </span>
        </div>
        <input
          type="password"
          className="settings-text-input"
          placeholder={relay.invite ? '••••••••' : 'invite code'}
          spellCheck={false}
          value={draft.invite}
          onChange={(e) => setDraft((d) => ({ ...d, invite: e.target.value }))}
          onBlur={() => {
            if (draft.invite.trim() !== (relay.invite ?? '')) void saveRelay({ invite: draft.invite.trim() })
          }}
        />
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Connection</span>
          <span className="settings-pref-sub">
            {conn.state}
            {conn.error ? ` — ${conn.error}` : ''}
          </span>
        </div>
        {conn.state === 'paired' || conn.state === 'connecting' ? (
          <button
            className="account-login"
            disabled={busy}
            onClick={() => {
              void window.termsprawl.relay.disconnect()
              setConn({ state: 'disconnected', error: null })
            }}
          >
            disconnect
          </button>
        ) : (
          <button className="account-login" disabled={busy || !relay.url} onClick={() => void connect()}>
            connect
          </button>
        )}
      </div>
    </div>
  )
}

/** Chat models (Phase 11 Task 11.4). Default provider/model for new chats +
 * per-provider API keys. Keys are stored in settings.json on this machine
 * only (env TERMSPRAWL_PROVIDER_KEY_<ID> overrides per provider) — never
 * committed, never written into project files. */
function ChatSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update } = ctx
  const chat = settings.chat ?? {}
  const providers: ApiProviderConfig[] = settings.apiProviders ?? []
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const keyFor = (id: string): string => chat.keys?.find((k: { providerId: string }) => k.providerId === id)?.key ?? ''
  const envName = (id: string): string => `TERMSPRAWL_PROVIDER_KEY_${id.toUpperCase()}`

  const saveChat = (patch: Partial<NonNullable<typeof settings.chat>>): void => {
    void update({ chat: { ...chat, ...patch } })
  }

  const saveKey = (providerId: string, value: string): void => {
    const keys = (chat.keys ?? []).filter((k: { providerId: string }) => k.providerId !== providerId)
    if (value.trim()) keys.push({ providerId, key: value.trim() })
    saveChat({ keys })
  }

  return (
    <div className="settings-section">
      <p className="app-settings-hint">
        Chat nodes talk to an OpenAI-compatible or Anthropic endpoint. Add a provider under
        API providers, then paste its key below. Keys are stored on this machine only —
        never committed (the {providers.length > 0 ? envName(providers[0].id) : 'TERMSPRAWL_PROVIDER_KEY_<ID>'} env var overrides a stored key).
      </p>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Default provider</span>
          <span className="settings-pref-sub">which configured provider new chat nodes use</span>
        </div>
        <select
          className="settings-text-input"
          value={chat.defaultProvider ?? ''}
          onChange={(e) => void saveChat({ defaultProvider: e.target.value || undefined })}
        >
          <option value="">first configured</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Default model</span>
          <span className="settings-pref-sub">e.g. gpt-4o-mini, claude-sonnet-4-5, llama3 — /model overrides per chat</span>
        </div>
        <input
          className="settings-text-input"
          placeholder="model id"
          spellCheck={false}
          value={chat.defaultModel ?? ''}
          onChange={(e) => void saveChat({ defaultModel: e.target.value || undefined })}
        />
      </div>

      {providers.length === 0 ? (
        <p className="app-settings-hint">No providers configured yet — add one under “API providers” above.</p>
      ) : (
        providers.map((p) => {
          const stored = keyFor(p.id)
          const draft = drafts[p.id] ?? ''
          return (
            <div className="settings-pref-row" key={p.id}>
              <div className="settings-pref-copy">
                <span className="settings-pref-label">{p.name || p.id} API key</span>
                <span className="settings-pref-sub">
                  {stored ? `a key is set (…${stored.slice(-4)})` : `no key — or set ${envName(p.id)}`}
                </span>
              </div>
              <input
                type="password"
                className="settings-text-input"
                placeholder={stored ? '••••••••' : 'sk-…'}
                spellCheck={false}
                value={draft}
                onChange={(e) => setDrafts((d: Record<string, string>) => ({ ...d, [p.id]: e.target.value }))}
                onBlur={() => {
                  if (draft.trim() && draft !== stored) saveKey(p.id, draft)
                }}
              />
            </div>
          )
        })
      )}
    </div>
  )
}
