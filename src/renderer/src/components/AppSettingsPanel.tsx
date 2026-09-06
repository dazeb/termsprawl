import { useEffect, useState } from 'react'
import type { AgentAccount, A2APeer, ApiProviderConfig, AppSettings, CloudBackup, CloudDeviceStart, CloudSpace, CloudUser } from '@shared/types'
import { AGENT_REGISTRY } from '@shared/agents/config'
import { HelpBadge } from './HelpBadge'
import { discoverAgentCard } from '../../../core/a2a/client'
import { parseRelayTermFrame, type RelayTermFrame } from '../../../core/relay-term'
import { useCanvasRequests } from '../state/canvas-requests'
import { useProjects } from '../state/projects'
import { applyTheme } from '../state/theme'
import { trustState, type TrustState } from './relay-trust'
import { Button, Card, FieldRow, Hint, PrefRow, Row, Section, Select, Status, TextArea, TextInput, Toggle } from './ui/kit'

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
    agentPreset: 'standard',
    defaultPermission: 'workspaceWrite',
    enterBehavior: 'queue',
    agentBrowserControl: false,
    agentA2aServer: false
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
  // electron-updater is only real in a packaged build (dev = documented no-op);
  // the updates section hides its toggle there. Defaults true so a slow
  // runtimeInfo answer never flashes the toggle away after paint.
  const [isPackaged, setIsPackaged] = useState(true)
  useEffect(() => {
    void window.termsprawl.runtimeInfo?.().then((r) => setIsPackaged(r.packaged)).catch(() => {})
  }, [])
  // Drafts for the A2A + API add forms.
  const [peerLabel, setPeerLabel] = useState('')
  const [peerEndpoint, setPeerEndpoint] = useState('')
  const [peerToken, setPeerToken] = useState('')
  const [peerTestId, setPeerTestId] = useState<string | null>(null)
  const [peerTestNote, setPeerTestNote] = useState<string | null>(null)
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
    const token = peerToken.trim()
    await update({
      a2aPeers: [
        ...(settings.a2aPeers ?? []),
        { id: crypto.randomUUID(), label, endpoint, ...(token ? { token } : {}) }
      ]
    })
    setPeerLabel('')
    setPeerEndpoint('')
    setPeerToken('')
  }

  const testPeer = async (peer: A2APeer): Promise<void> => {
    setPeerTestId(peer.id)
    setPeerTestNote('testing…')
    const envToken = process.env[`TERMSPRAWL_A2A_PEER_TOKEN_${peer.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]
    try {
      const res = await discoverAgentCard(peer.endpoint, {
        token: envToken || peer.token,
        timeoutMs: 8000
      })
      if (res.ok) setPeerTestNote(`✓ ${res.card.name}`)
      else setPeerTestNote(`✗ ${res.error}`)
    } catch (err) {
      setPeerTestNote(`✗ ${err instanceof Error ? err.message : String(err)}`)
    }
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
              <PrefRow
                label="Agent preset"
                sub="Tuning for new agent sessions (standard / fast / full)"
              >
                <Select
                  value={c.settings.agentPreset ?? 'standard'}
                  aria-label="Agent preset"
                  onChange={(e) => void c.update({ agentPreset: e.target.value })}
                >
                  {PRESET_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </PrefRow>
            )}

            {isDesktop && (
              <PrefRow
                label="Permission"
                sub="Default permission mode for new agent sessions (when the CLI supports it)"
              >
                <Select
                  value={c.settings.defaultPermission ?? 'workspaceWrite'}
                  aria-label="Default permission mode"
                  onChange={(e) => void c.update({ defaultPermission: e.target.value })}
                >
                  {PERMISSION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </PrefRow>
            )}

            <div className="border-b border-edge py-3">
              <div className="mb-3 text-[13px] font-medium text-ink">Appearance</div>
              <div className="grid grid-cols-3 gap-2.5">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`flex flex-col items-center gap-2 rounded-[10px] border px-3 py-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                      (c.settings.theme ?? 'system') === t.value
                        ? 'border-ink text-ink ring-1 ring-inset ring-ink'
                        : 'border-edge bg-panel text-mute hover:text-ink'
                    }`}
                    onClick={() => void c.update({ theme: t.value })}
                  >
                    <span className="flex h-[22px] items-center justify-center">{themeIcon(t.value)}</span>
                    <span className="text-xs">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <PrefRow
              label="Enter behavior while busy"
              sub="In chat nodes: Enter sends; busy sessions queue, send, or prompt. Shift+Enter breaks the line"
            >
              <Select
                value={c.settings.enterBehavior ?? 'queue'}
                aria-label="Enter behavior while busy"
                onChange={(e) => void c.update({ enterBehavior: e.target.value })}
              >
                {ENTER_BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </Select>
            </PrefRow>

            {/* Browser nodes are Electron-only (sandboxed <webview> guests) —
                a browser-based canvas cannot render one, so the whole browser
                section (agent control + home page) is desktop-only. */}
            {isDesktop && (
              <>
                <PrefRow
                  label="Allow agents to control browser nodes"
                  sub="Off (default): embedded browsers work normally but no agent endpoint exists. On: an external agent can open and drive browser nodes over a localhost-only CDP endpoint"
                >
                  <Toggle
                    checked={c.settings.agentBrowserControl === true}
                    onChange={(v) => void c.update({ agentBrowserControl: v })}
                    ariaLabel="Allow agents to control browser nodes"
                  />
                </PrefRow>

                <PrefRow
                  label="Expose agent nodes to A2A peers"
                  sub="Off (default): no A2A endpoint exists. On: your live agent terminals are listed as agents at a localhost-only endpoint — peers send tasks via the Google A2A protocol (token in userData/a2a-agent.json)"
                >
                  <Toggle
                    checked={c.settings.agentA2aServer === true}
                    onChange={(v) => void c.update({ agentA2aServer: v })}
                    ariaLabel="Expose agent nodes to A2A peers"
                  />
                </PrefRow>

                <PrefRow
                  label="Search provider / browser home"
                  sub="URL opened when a browser node or new tab starts — point this at your own SearXNG (e.g. http://127.0.0.1:8080 or a LAN host) for private search. Empty = DuckDuckGo"
                >
                  <TextInput
                    placeholder="https://duckduckgo.com"
                    spellCheck={false}
                    value={c.settings.browserHomeUrl ?? ''}
                    onChange={(e) => void c.update({ browserHomeUrl: e.target.value })}
                  />
                </PrefRow>
              </>
            )}

            <PrefRow
              label="Show first-run guide again"
              sub="Replays the 3-step welcome (create a project, spawn a terminal, arrange) on the next launch with no projects — or right now if the canvas is empty"
            >
              <Button onClick={() => void c.update({ onboardedAt: undefined })}>reset</Button>
            </PrefRow>

            <PrefRow
              label="Invert mousewheel zoom"
              sub="Off (default): scroll up zooms in. On: scroll up zooms out"
            >
              <Toggle
                checked={c.settings.invertWheelZoom === true}
                onChange={(v) => void c.update({ invertWheelZoom: v })}
                ariaLabel="Invert mousewheel zoom"
              />
            </PrefRow>
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
            peerToken={peerToken}
            setPeerLabel={setPeerLabel}
            setPeerEndpoint={setPeerEndpoint}
            setPeerToken={setPeerToken}
            addPeer={addPeer}
            removePeer={removePeer}
            testPeer={testPeer}
            peerTestId={peerTestId}
            peerTestNote={peerTestNote}
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
      { id: 'updates', title: 'Updates', render: (c) => <UpdatesSection ctx={c} isPackaged={isPackaged} /> }
    ]
  }

  // Filter the visible tab list by edition, then each tab's sections.
  const visibleTabs = TABS.filter((t) => !t.editions || t.editions.includes(edition))
  const tabSections: Record<TabId, SettingsSection[]> = allSections
  // If the active tab vanished for this edition, snap back to General.
  const activeTab: TabId = visibleTabs.some((t) => t.id === tab) ? tab : 'general'

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="flex h-[min(640px,calc(100vh-48px))] w-[min(720px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-edge bg-page shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
        role="dialog"
        aria-modal="true"
        aria-label="settings"
      >
        <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
          <span className="mr-auto text-sm font-semibold tracking-[-0.01em] text-ink">Settings</span>
          <div className="flex items-center gap-2">
            <button
              className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border border-transparent text-[15px] leading-none text-mute transition-colors hover:border-edge hover:text-ink"
              onClick={onClose}
              title="Close settings"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[208px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-edge p-3" aria-label="settings sections">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={activeTab === t.id ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
                  activeTab === t.id
                    ? 'border-edge bg-panel text-ink'
                    : 'border-transparent text-mute hover:bg-hover hover:text-ink'
                }`}
                onClick={() => setTab(t.id)}
              >
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">{t.icon}</span>
                <span>{t.title}</span>
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-y-auto px-6 py-5">
            {tabSections[activeTab]
              .filter((s) => !s.editions || s.editions.includes(edition))
              .map((section) => (
                <Section key={section.id} title={section.title}>
                  {section.render(ctx)}
                </Section>
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
    <>
      {device && (
        <Hint>
          open <strong>{device.verification_uri}</strong> and enter code <strong>{device.user_code}</strong> to link this device.
        </Hint>
      )}
      {cloudUser ? (
        <>
          <Hint>
            signed in as {cloudUser.github_login} · {cloudUser.plan} plan. Backups are encrypted server-side with your key.
          </Hint>
          <Row>
            <Button variant="primary" onClick={() => void cloudBackupNow()}>back up now</Button>
            {lastBackup && <Status>backup {lastBackup.id.slice(0, 8)} · {lastBackup.size_bytes} bytes</Status>}
            <Button variant="danger" onClick={() => void cloudSignOut()}>sign out</Button>
          </Row>
          {isDesktop && (cloudUser.plan === 'pro' || cloudUser.plan === 'canvas') ? (
            <>
              <Row>
                <Button variant="primary" disabled={spaceBusy} onClick={() => void cloudOpenSpace()}>
                  {spaceBusy ? 'opening…' : 'open your online canvas'}
                </Button>
                {space && <Status>{spaceUrlLabel(space)} · {space.status}</Status>}
                {spaceError && <Status className="text-danger">{spaceError}</Status>}
                {spaceNote && <Status>{spaceNote}</Status>}
              </Row>
              <Row>
                {/* D1 — pull the online snapshot into a NEW local project and
                    switch to it. Disabled while busy; a space with nothing
                    online yet shows the note instead of failing. */}
                <Button
                  variant="primary"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudOpenSnapshot()}
                >
                  {spaceBusy ? 'working…' : 'open online snapshot'}
                </Button>
                {/* D2 — push the active project's nodes + scrollbacks. Provisions
                    the space first when the user has none. */}
                <Button
                  variant="primary"
                  disabled={spaceBusy || !spaceLoaded}
                  title={spaceLoaded ? undefined : 'checking your space…'}
                  onClick={() => void cloudSyncProject()}
                >
                  {spaceBusy ? 'working…' : 'sync this project online'}
                </Button>
              </Row>
              {/* Phase 16 — the whole workspace as ONE json file: save/open
                  dialogs live in main; the same busy/error/note surface as the
                  spaces rows above. Works signed-in or not. */}
              <Row>
                <Button
                  variant="primary"
                  disabled={spaceBusy}
                  onClick={() => void workspaceExportBundle()}
                >
                  {spaceBusy ? 'working…' : 'export workspace…'}
                </Button>
                <Button
                  variant="primary"
                  disabled={spaceBusy}
                  onClick={() => void workspaceImportBundle()}
                >
                  {spaceBusy ? 'working…' : 'open workspace…'}
                </Button>
              </Row>
            </>
          ) : !isDesktop ? null : (
            <Row>
              <Button variant="primary" onClick={openBilling}>upgrade to pro</Button>
              <Status>pro adds an online canvas space that syncs with this desktop</Status>
            </Row>
          )}
        </>
      ) : (
        <Row>
          <Button variant="primary" disabled={cloudBusy} onClick={() => void cloudSignIn()}>
            {cloudBusy ? 'waiting for github…' : 'sign in with github'}
          </Button>
          {!isDesktop && <Status>sign in to sync this canvas with your desktop</Status>}
        </Row>
      )}
      {cloudUser && isDesktop && (
        <Row>
          {ghConnected ? (
            <>
              <Status>GitHub connected</Status>
              <Button variant="danger" disabled={ghBusy} onClick={() => void ghDisconnect()}>
                {ghBusy ? 'working…' : 'disconnect'}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={ghBusy || cloudBusy} onClick={() => void ghConnect()}>
              {ghBusy || cloudBusy ? 'waiting for github…' : 'Connect GitHub'}
            </Button>
          )}
          {ghNote && <Status className="text-danger">{ghNote}</Status>}
        </Row>
      )}
      <PrefRow label="Display name" sub="your name on backups and cloud surfaces">
        <TextInput
          value={draft}
          placeholder="your name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = draft.trim()
            if (v && v !== settings.displayName) void update({ displayName: v })
          }}
        />
      </PrefRow>
      <Hint>
        {isDesktop
          ? 'Termsprawl Cloud account (sign in to back up projects) and a basic display name. Settings live in settings.json in the config directory.'
          : 'Sign in with the same GitHub account as your desktop to sync projects between them. Cloud settings for this canvas are managed here; everything else lives on your desktop.'}
      </Hint>
    </>
  )
}

function UpdatesSection({ ctx, isPackaged }: { ctx: SectionCtx; isPackaged: boolean }): React.JSX.Element {
  // electron-updater only runs in a packaged build (dev is a documented
  // no-op) — hide the dead control instead of rendering a toggle that does
  // nothing. The Updates TAB itself is already desktop-only.
  if (!isPackaged) {
    return (
      <Hint>
        Updates come from GitHub Releases. This build is unpackaged (dev), so the
        updater is inactive — launch the installed AppImage/.deb to manage updates.
      </Hint>
    )
  }
  return (
    <PrefRow
      label={
        <span className="inline-flex items-center gap-1.5">
          Auto download updates when available
          <HelpBadge
            label="about auto download"
            text="Off (default): a toast appears when a newer GitHub release exists; you choose when to download. On: the AppImage/.deb downloads in the background, then the toast asks you to restart."
          />
        </span>
      }
      sub="When off, you get a toast and choose when to download. When on, updates download in the background and you restart to install."
    >
      <Toggle
        checked={ctx.settings.autoDownloadUpdates}
        onChange={(v) => void ctx.update({ autoDownloadUpdates: v })}
        ariaLabel="auto download updates when available"
      />
    </PrefRow>
  )
}

function AgentsSection(): React.JSX.Element {
  return (
    <>
      <Hint>Primary agents: codex and grok. Open them from the canvas context menu (Open agent ▸). Claude stays registered but is optional.</Hint>
      {PRIMARY_AGENTS.map((id) => {
        const config = AGENT_REGISTRY[id]
        if (!config) return null
        return (
          <Row key={id}>
            <span className="text-ink">{config.name}</span>
            <Status>{config.command}</Status>
            <Status>{config.capabilities.hooks ? 'hooks' : 'no hooks'}</Status>
          </Row>
        )
      })}
    </>
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
    <>
      <Hint>Each account is its own local agent config directory. Pick the active account for new agents; none means the default. Inherited API keys are stripped from its spawns.</Hint>
      {settings.accounts.length === 0 && <Hint>no accounts yet — add one below.</Hint>}
      {settings.accounts.map((acc) => (
        <Row key={acc.id}>
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="activeAccount"
              className="accent-ink"
              checked={settings.activeAccountId === acc.id}
              onChange={() => void setActive(acc.id)}
            />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-ink">{acc.label}</span>
            <Status>{acc.id}</Status>
          </label>
          {permissionSupported && (
            <Select
              selectClassName="max-w-[130px]"
              value={acc.permissionMode ?? 'default'}
              title="permission mode"
              onChange={(e) => void setPermissionMode(acc.id, e.target.value as AgentAccount['permissionMode'])}
            >
              <option value="default">default</option>
              <option value="acceptEdits">accept edits</option>
              <option value="bypassPermissions">bypass</option>
            </Select>
          )}
          {!confirmDelete && <Button variant="primary" title="open a login terminal for this account" onClick={() => void loginInto(acc)}>login</Button>}
          {confirmDelete === acc.id ? (
            <span className="flex items-center gap-2">
              <Status className="text-danger">removes its local config dir</Status>
              <Button variant="danger" armed onClick={() => void deleteAccount(acc.id)}>confirm delete</Button>
              <button className="text-xs text-mute transition-colors hover:text-ink" onClick={() => setConfirmDelete(null)}>keep</button>
            </span>
          ) : (
            <Button variant="danger" title="delete this account" onClick={() => setConfirmDelete(acc.id)}>delete</Button>
          )}
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={newLabel} placeholder="account label" onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addAccount() }} />
        <Button variant="primary" onClick={() => void addAccount()}>add account</Button>
      </FieldRow>
    </>
  )
}

function A2ASection(props: {
  peers: A2APeer[]
  peerLabel: string
  peerEndpoint: string
  peerToken: string
  setPeerLabel: (v: string) => void
  setPeerEndpoint: (v: string) => void
  setPeerToken: (v: string) => void
  addPeer: () => Promise<void>
  removePeer: (id: string) => Promise<void>
  testPeer: (peer: A2APeer) => Promise<void>
  peerTestId: string | null
  peerTestNote: string | null
}): React.JSX.Element {
  const {
    peers, peerLabel, peerEndpoint, peerToken, setPeerLabel, setPeerEndpoint, setPeerToken,
    addPeer, removePeer, testPeer, peerTestId, peerTestNote
  } = props
  return (
    <>
      <Hint>Agent-to-agent peers you can route tasks to (canvas right-click → “A2A send to peer”). Peers speak the Google A2A protocol (JSON-RPC over HTTP).</Hint>
      {peers.map((p) => (
        <Row key={p.id}>
          <span className="text-ink">{p.label}</span>
          <Status>{p.endpoint}</Status>
          <Button title="discover the peer's agent card" onClick={() => void testPeer(p)}>test</Button>
          <Button variant="danger" onClick={() => void removePeer(p.id)}>remove</Button>
          {peerTestId === p.id && peerTestNote && (
            <Status className={peerTestNote.startsWith('✓') ? '' : 'text-danger'}>{peerTestNote}</Status>
          )}
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={peerLabel} placeholder="peer label" onChange={(e) => setPeerLabel(e.target.value)} />
        <TextInput grow value={peerEndpoint} placeholder="http://127.0.0.1:8787" onChange={(e) => setPeerEndpoint(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPeer() }} />
        <TextInput grow value={peerToken} placeholder="bearer token (optional)" onChange={(e) => setPeerToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addPeer() }} />
        <Button variant="primary" onClick={() => void addPeer()}>add peer</Button>
      </FieldRow>
    </>
  )
}

function ApiSection(props: { providers: ApiProviderConfig[]; providerName: string; providerBaseUrl: string; setProviderName: (v: string) => void; setProviderBaseUrl: (v: string) => void; addProvider: () => Promise<void>; removeProvider: (id: string) => Promise<void> }): React.JSX.Element {
  const { providers, providerName, providerBaseUrl, setProviderName, setProviderBaseUrl, addProvider, removeProvider } = props
  return (
    <>
      <Hint>OSS/provider API endpoints for the chat and agent drivers. API keys are NOT stored here — add a keychain-backed field later if needed.</Hint>
      {providers.map((p) => (
        <Row key={p.id}>
          <span className="text-ink">{p.name}</span>
          <Status>{p.baseUrl}</Status>
          <Button variant="danger" onClick={() => void removeProvider(p.id)}>remove</Button>
        </Row>
      ))}
      <FieldRow>
        <TextInput grow value={providerName} placeholder="provider (e.g. xAI)" onChange={(e) => setProviderName(e.target.value)} />
        <TextInput grow value={providerBaseUrl} placeholder="https://api.x.ai/v1" onChange={(e) => setProviderBaseUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addProvider() }} />
        <Button variant="primary" onClick={() => void addProvider()}>add provider</Button>
      </FieldRow>
    </>
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
    <>
      <Hint>
        Control termsprawl from your phone. Pair by messaging the bot with /start from
        the phone; the first chat becomes the owner unless you list chats below. The bot
        token is stored on this machine only — never committed to the repo (the
        TERMSPRAWL_TELEGRAM_TOKEN env var overrides it).
      </Hint>

      <PrefRow
        label="Enable Telegram bot"
        sub="On: the bot starts and watches for messages. Off (default): nothing runs"
      >
        <Toggle checked={tg.enabled === true} onChange={(v) => void save({ enabled: v })} ariaLabel="Enable Telegram bot" />
      </PrefRow>

      <PrefRow
        label="Bot token"
        sub={tg.token ? `a token is set (${tg.token.slice(-4)})` : 'no token — get one from @BotFather'}
      >
        <TextInput
          type="password"
          placeholder={tg.token ? '••••••••' : '123:bot-token'}
          spellCheck={false}
          value={draft.token}
          onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
          onBlur={() => {
            if (draft.token.trim() && draft.token !== (tg.token ?? '')) void save({ token: draft.token.trim() })
          }}
        />
      </PrefRow>

      <PrefRow
        label="Allowed chat ids"
        sub="empty = the first chat to /start becomes the owner; otherwise only these chats may issue commands"
      >
        <TextArea
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
      </PrefRow>
    </>
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
  const isHost = relay.role !== 'client'
  const [draft, setDraft] = useState<{ url: string; invite: string }>({
    url: relay.url ?? '',
    invite: relay.invite ?? ''
  })
  const [conn, setConn] = useState<{ state: string; error: string | null }>({
    state: 'disconnected',
    error: null
  })
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState<{
    peerLogin: string | null
    fingerprint: string
    decision: TrustState
  } | null>(null)
  const [mint, setMint] = useState<{ busy: boolean; code: string | null; error: string | null }>({
    busy: false,
    code: null,
    error: null
  })
  const [copied, setCopied] = useState(false)

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

  const trusted = relay.trustedFingerprint
  const paired = conn.state === 'paired'
  const deciding = pairing !== null

  const saveRelay = (patch: {
    url?: string
    role?: 'host' | 'client'
    invite?: string
    /** string = set, null = clear, undefined = leave as-is. */
    trusted?: string | null
  }): void => {
    void update({
      relay: {
        url: patch.url !== undefined ? patch.url : (relay.url ?? ''),
        role: patch.role ?? (relay.role === 'client' ? 'client' : 'host'),
        invite: patch.invite !== undefined ? patch.invite : relay.invite,
        trustedFingerprint:
          patch.trusted !== undefined ? patch.trusted ?? undefined : relay.trustedFingerprint
      }
    })
  }

  /** Tear down any session and clear the ephemeral surfaces (invite code,
   * confirm card, copy flag) that only make sense while connected. */
  const teardown = (): void => {
    void window.termsprawl.relay.disconnect()
    setConn({ state: 'disconnected', error: null })
    setPairing(null)
    setCopied(false)
    setMint({ busy: false, code: null, error: null })
  }

  const connect = async (): Promise<void> => {
    setBusy(true)
    setCopied(false)
    setMint({ busy: false, code: null, error: null })
    try {
      const res = await window.termsprawl.relay.connect()
      if (!res.ok) {
        setConn({ state: 'error', error: res.error ?? 'connect failed' })
        return
      }
      // The runtime pairs automatically; a peer key is only surfaced once a
      // peer is actually present. Gate trust on the user's explicit confirm.
      const p = res.pairing
      if (p?.fingerprint) {
        const decision = trustState(relay.trustedFingerprint, p.fingerprint)
        if (decision === 'confirm' || decision === 'mismatch') {
          setPairing({ peerLogin: p.peerLogin, fingerprint: p.fingerprint, decision })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const trustPeer = (): void => {
    if (!pairing) return
    // Persist the freshly eyeballed fingerprint — trust survives restarts.
    void saveRelay({ trusted: pairing.fingerprint })
    setPairing(null)
  }

  const forget = (): void => {
    teardown()
    void saveRelay({ trusted: null })
  }

  const mintInvite = async (): Promise<void> => {
    if (mint.busy) return
    setMint({ busy: true, code: null, error: null })
    setCopied(false)
    try {
      const res = await window.termsprawl.relay.mintInvite()
      if (res.ok && res.code) setMint({ busy: false, code: res.code, error: null })
      else setMint({ busy: false, code: null, error: res.error ?? 'could not mint an invite' })
    } catch (e) {
      setMint({ busy: false, code: null, error: e instanceof Error ? e.message : 'could not mint an invite' })
    }
  }

  const copyInvite = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setMint((m) => ({ ...m, error: 'could not copy the invite code' }))
    }
  }

  /** A short preview of a stored fingerprint for labels ("…last groups"). */
  const shortFp = (fp: string): string => {
    const groups = fp.trim().split(/\s+/).filter(Boolean)
    return groups.length > 2 ? `…${groups.slice(-2).join(' ')}` : fp
  }

  const peerName = pairing?.peerLogin ?? 'peer'

  return (
    <>
      <Hint>
        Pair two termsprawl instances through the E2E-encrypted relay. A host mints a
        single-use invite once the peers are paired; the other instance joins with that
        code as a client. Traffic is end-to-end encrypted — the relay only routes
        ciphertext. Both sides confirm the peer&apos;s key fingerprint before trusting it.
      </Hint>

      <PrefRow
        label="Relay URL"
        sub="wss:// address of the relay service"
      >
        <TextInput
          placeholder="wss://relay.example.com"
          spellCheck={false}
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          onBlur={() => {
            if (draft.url.trim() !== (relay.url ?? '')) void saveRelay({ url: draft.url.trim() })
          }}
        />
      </PrefRow>

      <PrefRow
        label="Role"
        sub="host exposes this machine; client connects out to a host"
      >
        <Select
          value={relay.role === 'client' ? 'client' : 'host'}
          aria-label="Relay role"
          onChange={(e) => void saveRelay({ role: e.target.value as 'host' | 'client' })}
        >
          <option value="host">host</option>
          <option value="client">client</option>
        </Select>
      </PrefRow>

      {isHost ? (
        <>
          <PrefRow
            label="Invite a peer"
            sub={
              paired && !deciding
                ? 'pairing ready — generate a single-use invite to share'
                : paired && deciding
                  ? 'confirm the peer’s fingerprint above before inviting'
                  : 'a peer must pair with this host before an invite can be minted'
            }
          >
            <Button
              variant="primary"
              disabled={!paired || deciding || mint.busy || busy}
              onClick={() => void mintInvite()}
            >
              {mint.busy ? 'Generating…' : 'Generate invite'}
            </Button>
          </PrefRow>
          {mint.error && <Hint className="text-danger">{mint.error}</Hint>}
          {mint.code && (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-raised px-3 py-2 font-mono text-[15px] tracking-[0.08em] text-ink">
                <span>{mint.code}</span>
                <Button onClick={() => void copyInvite(mint.code as string)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <Hint>Single-use, expires in 7 days. Share it out of band with the peer.</Hint>
            </>
          )}
        </>
      ) : (
        <PrefRow
          label="Invite code"
          sub={
            relay.invite ? `an invite is set (${relay.invite.slice(-4)})` : 'paste the invite code the host shared'
          }
        >
          <TextInput
            type="password"
            placeholder={relay.invite ? '••••••••' : 'invite code'}
            spellCheck={false}
            value={draft.invite}
            onChange={(e) => setDraft((d) => ({ ...d, invite: e.target.value }))}
            onBlur={() => {
              if (draft.invite.trim() !== (relay.invite ?? '')) void saveRelay({ invite: draft.invite.trim() })
            }}
          />
        </PrefRow>
      )}

      {!isHost && paired && !!trusted && !deciding && !busy && (
        // B3 — client side can open terminals the trusted host is serving. Only
        // once we are paired AND the peer fingerprint is trusted (relay-trust)
        // AND no confirm/mismatch card is pending.
        <RelayTerminalList />
      )}

      {pairing && pairing.decision === 'confirm' && (
        <Card
          title="Confirm this peer"
          sub={<>{peerName} — fingerprint:</>}
        >
          <span className="break-all font-mono text-xs text-ink">{pairing.fingerprint}</span>
          <div className="flex justify-end gap-2">
            <Button onClick={teardown}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={trustPeer}>
              Trust this peer
            </Button>
          </div>
        </Card>
      )}

      {pairing && pairing.decision === 'mismatch' && (
        <Card
          title="Peer key changed — not trusted"
          danger
          sub={
            <>
              {peerName} now presents a different key than the fingerprint this machine
              trusted ({trusted ? shortFp(trusted) : 'none'}). You may be talking to a
              different machine. Re-trust only if you are certain.
            </>
          }
        >
          <span className="break-all font-mono text-xs text-ink">{pairing.fingerprint}</span>
          <div className="flex justify-end gap-2">
            <Button variant="danger" onClick={teardown}>
              Disconnect
            </Button>
            <Button variant="primary" onClick={trustPeer}>
              Trust this peer
            </Button>
          </div>
        </Card>
      )}

      <PrefRow
        label="Connection"
        sub={
          <>
            {conn.state}
            {paired && trusted ? ` — trusted peer (${shortFp(trusted)})` : ''}
            {conn.error ? ` — ${conn.error}` : ''}
          </>
        }
      >
        {trusted && (
          <Button variant="danger" onClick={forget} title="Forget the trusted peer and disconnect">
            Forget
          </Button>
        )}
        {paired || conn.state === 'connecting' ? (
          <Button variant="primary" disabled={busy} onClick={teardown}>
            Disconnect
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !relay.url} onClick={() => void connect()}>
            Connect
          </Button>
        )}
      </PrefRow>
    </>
  )
}

/**
 * B3 — "Remote terminals" list for the relay CLIENT: list the terminals a
 * trusted host is serving and open each as a remote terminal node on the
 * active project canvas. It subscribes to the frame stream only while mounted
 * (returned unsubscribe runs on unmount, so it never steals frames meant for
 * a remote terminal node — every listener receives every frame and filters by
 * kind/term). The term-list reply is matched by kind, not by a request id,
 * which is safe here because only this block ever sends a 'list' frame.
 */
function RelayTerminalList(): React.JSX.Element {
  const [terms, setTerms] = useState<Array<{ id: string; title: string }>>([])
  const [listing, setListing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const off = window.termsprawl.relay.onFrame((frame) => {
      const parsed = parseRelayTermFrame(frame.text)
      if (parsed && parsed.k === 'term-list') setTerms(parsed.terms)
    })
    return () => off()
  }, [])

  const list = (): void => {
    if (listing) return
    setListing(true)
    setNote(null)
    void window.termsprawl.relay
      .sendFrame(JSON.stringify({ v: 1, k: 'list' } satisfies RelayTermFrame))
      .then((res) => {
        setListing(false)
        if (!res.ok) setNote(res.error ?? 'could not list host terminals')
      })
      .catch(() => {
        setListing(false)
        setNote('could not list host terminals')
      })
  }

  const open = (term: { id: string; title: string }): void => {
    // Spawn through the same one-shot store the settings panel uses for
    // agent-login nodes: Canvas adds a remote terminal node to the active
    // project on its next render. The settings sheet stays open behind it.
    useCanvasRequests.getState().spawn({ kind: 'relayTerm', term: term.id, title: term.title })
    setNote(`opened ${term.title || term.id} from the host`)
  }

  return (
    <Card
      title="Remote terminals"
      sub="terminals the trusted host is currently serving"
    >
      <div className="flex justify-end gap-2">
        <Button disabled={listing} onClick={list}>
          {listing ? 'Listing…' : 'List host terminals'}
        </Button>
      </div>
      {note && <Hint className="text-danger">{note}</Hint>}
      {terms.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {terms.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 border-b border-edge py-1.5 last:border-b-0">
              <span className="truncate font-mono text-xs text-ink" title={t.id}>
                {t.title || t.id}
              </span>
              <Button variant="primary" onClick={() => open(t)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
    <>
      <Hint>
        Chat nodes talk to an OpenAI-compatible or Anthropic endpoint. Add a provider under
        API providers, then paste its key below. Keys are stored on this machine only —
        never committed (the {providers.length > 0 ? envName(providers[0].id) : 'TERMSPRAWL_PROVIDER_KEY_<ID>'} env var overrides a stored key).
      </Hint>

      <PrefRow
        label="Default provider"
        sub="which configured provider new chat nodes use"
      >
        <Select
          className="w-[200px]"
          selectClassName="w-full"
          value={chat.defaultProvider ?? ''}
          onChange={(e) => void saveChat({ defaultProvider: e.target.value || undefined })}
        >
          <option value="">first configured</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </Select>
      </PrefRow>

      <PrefRow
        label="Default model"
        sub="e.g. gpt-4o-mini, claude-sonnet-4-5, llama3 — /model overrides per chat"
      >
        <TextInput
          placeholder="model id"
          spellCheck={false}
          value={chat.defaultModel ?? ''}
          onChange={(e) => void saveChat({ defaultModel: e.target.value || undefined })}
        />
      </PrefRow>

      {providers.length === 0 ? (
        <Hint>No providers configured yet — add one under “API providers” above.</Hint>
      ) : (
        providers.map((p) => {
          const stored = keyFor(p.id)
          const draft = drafts[p.id] ?? ''
          return (
            <PrefRow
              key={p.id}
              label={`${p.name || p.id} API key`}
              sub={stored ? `a key is set (…${stored.slice(-4)})` : `no key — or set ${envName(p.id)}`}
            >
              <TextInput
                type="password"
                placeholder={stored ? '••••••••' : 'sk-…'}
                spellCheck={false}
                value={draft}
                onChange={(e) => setDrafts((d: Record<string, string>) => ({ ...d, [p.id]: e.target.value }))}
                onBlur={() => {
                  if (draft.trim() && draft !== stored) saveKey(p.id, draft)
                }}
              />
            </PrefRow>
          )
        })
      )}
    </>
  )
}
