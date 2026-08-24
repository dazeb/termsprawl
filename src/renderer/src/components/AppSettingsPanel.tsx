import { useEffect, useState } from 'react'
import type { AgentAccount, AppSettings, CloudBackup, CloudDeviceStart, CloudUser } from '@shared/types'
import { HelpBadge } from './HelpBadge'
import { useCanvasRequests } from '../state/canvas-requests'

interface AppSettingsPanelProps {
  onClose: () => void
}

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    autoDownloadUpdates: false,
    accounts: [],
    activeAccountId: null,
    dismissedAnnouncementVersion: null
  })
  const [permissionSupported, setPermissionSupported] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [device, setDevice] = useState<CloudDeviceStart | null>(null)
  const [lastBackup, setLastBackup] = useState<CloudBackup | null>(null)

  useEffect(() => {
    void window.termsprawl.settings.get().then(setSettings)
    void window.termsprawl.settings.permissionSupported().then(setPermissionSupported)
    void window.termsprawl.cloud.status().then(setCloudUser)
  }, [])

  // Escape closes the modal; backdrop click closes it too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleAutoDownload = async (checked: boolean): Promise<void> => {
    setSettings(await window.termsprawl.settings.set({ autoDownloadUpdates: checked }))
  }

  const addAccount = async (): Promise<void> => {
    setSettings(await window.termsprawl.settings.createAccount(newLabel.trim() || 'account'))
    setNewLabel('')
  }

  const setActive = async (id: string | null): Promise<void> => {
    setSettings(await window.termsprawl.settings.set({ activeAccountId: id }))
  }

  const setPermissionMode = async (
    id: string,
    mode: AgentAccount['permissionMode']
  ): Promise<void> => {
    const accounts = settings.accounts.map((a) => (a.id === id ? { ...a, permissionMode: mode } : a))
    setSettings(await window.termsprawl.settings.set({ accounts }))
  }

  // Make the account active, then open a login terminal for it. The canvas
  // consumes the spawn request; main injects that account's CLAUDE_CONFIG_DIR.
  const loginInto = async (acc: AgentAccount): Promise<void> => {
    if (settings.activeAccountId !== acc.id) {
      setSettings(await window.termsprawl.settings.set({ activeAccountId: acc.id }))
    }
    const command = await window.termsprawl.settings.loginCommand()
    useCanvasRequests.getState().spawn({ kind: 'agentLogin', command })
    onClose()
  }

  const deleteAccount = async (id: string): Promise<void> => {
    setSettings(await window.termsprawl.settings.deleteAccount(id))
    setConfirmDelete(null)
  }

  // Termsprawl Cloud — GitHub device flow: main opens the verification page,
  // we show the user_code and poll until the user approves in the browser.
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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="app settings">
        <div className="settings-modal-head">
          <span className="settings-modal-title">
            app settings
            <HelpBadge
              label="about app settings"
              text="These apply to the whole app, not one project. Updates check GitHub Releases a few seconds after a packaged launch. Dev builds skip the check. Restart is always required to install."
            />
          </span>
          <button className="settings-modal-close" onClick={onClose} title="Close settings">
            ×
          </button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-section">
            <div className="settings-section-title">updates</div>
            <label className="app-settings-toggle">
              <input
                type="checkbox"
                checked={settings.autoDownloadUpdates}
                onChange={(event) => void toggleAutoDownload(event.target.checked)}
              />
              auto download updates when available
              <HelpBadge
                label="about auto download"
                text="Off (default): a toast appears when a newer GitHub release exists; you choose when to download. On: the AppImage/.deb downloads in the background, then the toast asks you to restart. The current build cannot update itself — this becomes the baseline for the next version. Releases must include latest-linux.yml."
              />
            </label>
            <p className="app-settings-hint">
              When off, you get a toast and choose when to download. When on, updates
              download in the background and you restart to install.
            </p>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">termsprawl cloud</div>
            {device && (
              <p className="app-settings-hint">
                open <strong>{device.verification_uri}</strong> and enter code{' '}
                <strong>{device.user_code}</strong> to link this device.
              </p>
            )}
            {cloudUser ? (
              <>
                <p className="app-settings-hint">
                  signed in as {cloudUser.github_login} · {cloudUser.plan} plan. Backups are encrypted
                  server-side with your key — the app sends the workspace, the API encrypts at rest.
                </p>
                <div className="account-row">
                  <button className="account-login" onClick={() => void cloudBackupNow()}>
                    back up now
                  </button>
                  {lastBackup && (
                    <span className="account-id">
                      backup {lastBackup.id.slice(0, 8)} · {lastBackup.size_bytes} bytes
                    </span>
                  )}
                  <button className="account-delete" onClick={() => void cloudSignOut()}>
                    sign out
                  </button>
                </div>
              </>
            ) : (
              <div className="account-row">
                <button className="account-login" disabled={cloudBusy} onClick={() => void cloudSignIn()}>
                  {cloudBusy ? 'waiting for github…' : 'sign in with github'}
                </button>
              </div>
            )}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">agent accounts</div>
            <p className="app-settings-hint">
              Each account is its own local Claude config directory. Pick the active account
              for new Claude agents; none means the default ~/.claude. The active account's dir
              is the only credential source — inherited API keys are stripped from its spawns.
            </p>
            {settings.accounts.length === 0 && (
              <p className="app-settings-hint">no accounts yet — add one below.</p>
            )}
            {settings.accounts.map((acc) => (
              <div key={acc.id} className="account-row">
                <label className="account-radio">
                  <input
                    type="radio"
                    name="activeAccount"
                    checked={settings.activeAccountId === acc.id}
                    onChange={() => void setActive(acc.id)}
                  />
                  <span className="account-label">{acc.label}</span>
                  <span className="account-id">{acc.id}</span>
                </label>
                {permissionSupported && (
                  <select
                    className="account-permission"
                    value={acc.permissionMode ?? 'default'}
                    title="permission mode (claude --permission-mode; hidden if your CLI doesn't support it)"
                    onChange={(event) =>
                      void setPermissionMode(acc.id, event.target.value as AgentAccount['permissionMode'])
                    }
                  >
                    <option value="default">default</option>
                    <option value="acceptEdits">accept edits</option>
                    <option value="bypassPermissions">bypass</option>
                  </select>
                )}
                {!confirmDelete && (
                  <button
                    className="account-login"
                    title="open a login terminal for this account (uses its config dir)"
                    onClick={() => void loginInto(acc)}
                  >
                    login
                  </button>
                )}
                {confirmDelete === acc.id ? (
                  <span className="account-confirm">
                    <span className="account-confirm-text">removes its local Claude config dir</span>
                    <button className="account-danger" onClick={() => void deleteAccount(acc.id)}>
                      confirm delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>keep</button>
                  </span>
                ) : (
                  <button
                    className="account-delete"
                    title="delete this account and its local Claude config dir"
                    onClick={() => setConfirmDelete(acc.id)}
                  >
                    delete
                  </button>
                )}
              </div>
            ))}
            <div className="account-new">
              <input
                className="account-label-input"
                value={newLabel}
                placeholder="account label"
                onChange={(event) => setNewLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addAccount()
                }}
              />
              <button onClick={() => void addAccount()}>add account</button>
            </div>
          </div>
        </div>

        <div className="settings-modal-foot">
          <button className="settings-modal-done" onClick={onClose}>
            done
          </button>
        </div>
      </div>
    </div>
  )
}
