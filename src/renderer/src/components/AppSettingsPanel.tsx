import { useEffect, useState } from 'react'
import type { AgentAccount, A2APeer, ApiProviderConfig, AppSettings, CloudBackup, CloudDeviceStart, CloudUser } from '@shared/types'
import { AGENT_REGISTRY } from '@shared/agents/config'
import { HelpBadge } from './HelpBadge'
import { useCanvasRequests } from '../state/canvas-requests'

interface AppSettingsPanelProps {
  onClose: () => void
}

/** The primary agent CLIs the product is built around (shown first in the
 * agents section). Claude stays registered but is optional/secondary. */
const PRIMARY_AGENTS = ['codex', 'grok'] as const

/** A settings-panel section. Add a new object to the registry to add a section
 * — this is the extension point for future settings ("space to add more"). */
interface SettingsSection {
  id: string
  title: string
  render: (ctx: SectionCtx) => React.JSX.Element
}

interface SectionCtx {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<void>
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

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    autoDownloadUpdates: false,
    accounts: [],
    activeAccountId: null,
    dismissedAnnouncementVersion: null,
    a2aPeers: [],
    apiProviders: []
  })
  const [permissionSupported, setPermissionSupported] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [device, setDevice] = useState<CloudDeviceStart | null>(null)
  const [lastBackup, setLastBackup] = useState<CloudBackup | null>(null)
  // Drafts for the A2A + API add forms.
  const [peerLabel, setPeerLabel] = useState('')
  const [peerEndpoint, setPeerEndpoint] = useState('')
  const [providerName, setProviderName] = useState('')
  const [providerBaseUrl, setProviderBaseUrl] = useState('')

  useEffect(() => {
    void window.termsprawl.settings.get().then(setSettings)
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

  const update = async (patch: Partial<AppSettings>): Promise<void> => {
    setSettings(await window.termsprawl.settings.set(patch))
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

  // The section registry — add a new object here to surface a new settings
  // section. Each section reads/writes only through ctx.
  const sections: SettingsSection[] = [
    { id: 'user', title: 'user', render: (c) => <UserSection ctx={c} /> },
    { id: 'agents', title: 'agents', render: () => <AgentsSection /> },
    {
      id: 'accounts',
      title: 'agent accounts',
      render: () => (
        <AccountsSection
          settings={settings}
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
    },
    {
      id: 'a2a',
      title: 'a2a peers',
      render: () => (
        <A2ASection
          peers={settings.a2aPeers ?? []}
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
      title: 'api providers',
      render: () => (
        <ApiSection
          providers={settings.apiProviders ?? []}
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
      id: 'updates',
      title: 'updates',
      render: () => (
        <div className="settings-section">
          <label className="app-settings-toggle">
            <input
              type="checkbox"
              checked={settings.autoDownloadUpdates}
              onChange={(e) => void toggleAutoDownload(e.target.checked)}
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
  ]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="app settings">
        <div className="settings-modal-head">
          <span className="settings-modal-title">
            app settings
            <HelpBadge
              label="about app settings"
              text="These apply to the whole app, not one project. Sections are extensible — new ones are added to a registry."
            />
          </span>
          <button className="settings-modal-close" onClick={onClose} title="Close settings">×</button>
        </div>

        <div className="settings-modal-body">
          {sections.map((section) => (
            <div key={section.id}>
              <div className="settings-section-title">{section.title}</div>
              {section.render(ctx)}
            </div>
          ))}
        </div>

        <div className="settings-modal-foot">
          <button className="settings-modal-done" onClick={onClose}>done</button>
        </div>
      </div>
    </div>
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
