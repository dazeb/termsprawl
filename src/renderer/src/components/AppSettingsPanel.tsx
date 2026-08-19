import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
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

  useEffect(() => {
    void window.termsprawl.settings.get().then(setSettings)
  }, [])

  const toggleAutoDownload = async (checked: boolean): Promise<void> => {
    const next = await window.termsprawl.settings.set({ autoDownloadUpdates: checked })
    setSettings(next)
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
      <button className="project-settings-done" onClick={onClose}>
        done
      </button>
    </div>
  )
}
