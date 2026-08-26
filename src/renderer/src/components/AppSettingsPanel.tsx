import { useEffect, useState } from 'react'
import type { AgentAccount, A2APeer, ApiProviderConfig, AppSettings, CloudBackup, CloudDeviceStart, CloudUser } from '@shared/types'
import { AGENT_REGISTRY } from '@shared/agents/config'
import { HelpBadge } from './HelpBadge'
import { useCanvasRequests } from '../state/canvas-requests'
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

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'ja', label: '日本語' }
]

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

/** A settings-panel section. Adding one to a tab's render array adds content
 * to that sidebar tab — the extension point for future settings. */
interface SettingsSection {
  id: string
  title: string
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
  cloudSignIn: () => Promise<void>
  cloudSignOut: () => Promise<void>
  cloudBackupNow: () => Promise<void>
}

type TabId = 'general' | 'user' | 'agents' | 'connections' | 'updates'

interface SettingsTab {
  id: TabId
  title: string
  icon: React.JSX.Element
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
  const [tab, setTab] = useState<TabId>('general')
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
  }

  const cloudBackupNow = async (): Promise<void> => {
    setLastBackup(await window.termsprawl.cloud.backupNow())
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
    cloudSignIn,
    cloudSignOut,
    cloudBackupNow
  }

  // Sidebar tabs, grouped by termsprawl domain. Each tab hosts the sections
  // that actually belong to it; adding one to a tab's array adds content there.
  const tabSections: Record<TabId, SettingsSection[]> = {
    general: [
      {
        id: 'prefs',
        title: 'Preferences',
        render: (c) => (
          <>
            <div className="settings-pref-row">
              <div className="settings-pref-copy">
                <span className="settings-pref-label">Agent preset</span>
                <span className="settings-pref-sub">Tuning for new agent sessions (standard / fast / full)</span>
              </div>
              <select
                className="settings-select"
                value={c.settings.agentPreset ?? 'standard'}
                onChange={(e) => void c.update({ agentPreset: e.target.value })}
              >
                {PRESET_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-pref-row">
              <div className="settings-pref-copy">
                <span className="settings-pref-label">Permission</span>
                <span className="settings-pref-sub">Choose the default permission mode for new sessions</span>
              </div>
              <select
                className="settings-select"
                value={c.settings.defaultPermission ?? 'workspaceWrite'}
                onChange={(e) => void c.update({ defaultPermission: e.target.value })}
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-pref-row">
              <div className="settings-pref-copy">
                <span className="settings-pref-label">Language</span>
              </div>
              <select
                className="settings-select"
                value={c.settings.language ?? 'en'}
                onChange={(e) => void c.update({ language: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>

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
                <span className="settings-pref-sub">Busy only. Cmd/Ctrl+Enter uses the other behavior</span>
              </div>
              <select
                className="settings-select"
                value={c.settings.enterBehavior ?? 'queue'}
                onChange={(e) => void c.update({ enterBehavior: e.target.value })}
              >
                {ENTER_BEHAVIORS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>

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
      { id: 'user', title: 'User & cloud', render: (c) => <UserSection ctx={c} /> }
    ],
    agents: [
      { id: 'agents', title: 'Agents', render: () => <AgentsSection /> },
      {
        id: 'accounts',
        title: 'Agent accounts',
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
      }
    ],
    updates: [
      { id: 'updates', title: 'Updates', render: (c) => <UpdatesSection ctx={c} /> }
    ]
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-sheet" role="dialog" aria-modal="true" aria-label="settings">
        <div className="settings-sheet-head">
          <span className="settings-sheet-title">Settings</span>
          <div className="settings-sheet-head-actions">
            <button className="settings-sheet-config" title="Open configuration file" onClick={onClose}>
              open config file
            </button>
            <button className="settings-modal-close" onClick={onClose} title="Close settings">×</button>
          </div>
        </div>

        <div className="settings-sheet-body">
          <nav className="settings-nav" aria-label="settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-nav-item${tab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span className="settings-nav-icon">{t.icon}</span>
                <span>{t.title}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tabSections[tab].map((section) => (
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

function UserSection({ ctx }: { ctx: SectionCtx }): React.JSX.Element {
  const { settings, update, cloudUser, cloudBusy, device, lastBackup, cloudSignIn, cloudSignOut, cloudBackupNow } = ctx
  const [draft, setDraft] = useState(settings.displayName ?? '')
  useEffect(() => setDraft(settings.displayName ?? ''), [settings.displayName])
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
        </>
      ) : (
        <div className="account-row">
          <button className="account-login" disabled={cloudBusy} onClick={() => void cloudSignIn()}>
            {cloudBusy ? 'waiting for github…' : 'sign in with github'}
          </button>
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
      <p className="app-settings-hint">Termsprawl Cloud account (sign in to back up projects) and a basic display name. More user controls are added here later.</p>
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
