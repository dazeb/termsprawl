import { useEffect, useState } from 'react'
import type { AgentAccount, AppSettings } from '@shared/types'
import { HelpBadge } from './HelpBadge'

interface AppSettingsPanelProps {
  onClose: () => void
}

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({
    autoDownloadUpdates: false,
    accounts: [],
    activeAccountId: null
  })
  const [permissionSupported, setPermissionSupported] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    void window.termsprawl.settings.get().then(setSettings)
    void window.termsprawl.settings.permissionSupported().then(setPermissionSupported)
  }, [])

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

  const deleteAccount = async (id: string): Promise<void> => {
    setSettings(await window.termsprawl.settings.deleteAccount(id))
    setConfirmDelete(null)
  }

  return (
    <div className="app-settings">
      <div className="project-settings-title">
        app settings
        <HelpBadge
          label="about app settings"
          text="These apply to the whole app, not one project. Updates check GitHub Releases a few seconds after a packaged launch. Dev builds skip the check. Restart is always required to install."
        />
      </div>
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

      <div className="agent-accounts">
        <div className="project-settings-title account-section-title">agent accounts</div>
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

      <button className="project-settings-done" onClick={onClose}>
        done
      </button>
    </div>
  )
}
