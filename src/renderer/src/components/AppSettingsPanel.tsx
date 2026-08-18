import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface AppSettingsPanelProps {
  onClose: () => void
}

export function AppSettingsPanel({ onClose }: AppSettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>({ autoDownloadUpdates: false })

  useEffect(() => {
    void window.termsprawl.settings.get().then(setSettings)
  }, [])

  const toggleAutoDownload = async (checked: boolean): Promise<void> => {
    const next = await window.termsprawl.settings.set({ autoDownloadUpdates: checked })
    setSettings(next)
  }

  return (
    <div className="app-settings">
      <div className="project-settings-title">app settings</div>
      <label className="app-settings-toggle">
        <input
          type="checkbox"
          checked={settings.autoDownloadUpdates}
          onChange={(event) => void toggleAutoDownload(event.target.checked)}
        />
        auto download updates when available
      </label>
      <p className="app-settings-hint">
        When off, you get a toast and choose when to download. When on, updates
        download in the background and you restart to install.
      </p>
      <button className="project-settings-done" onClick={onClose}>
        done
      </button>
    </div>
  )
}
