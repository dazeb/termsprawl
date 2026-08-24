// Phase 12.2 — announcements banner. Shows a dismissible "what's new" notice with
// the latest GitHub release notes (fetched in main on packaged boot). Dismissal
// is persisted per version so it only appears once per release.
import { useEffect, useState } from 'react'
import type { Announcement } from '@shared/types'

export function AnnouncementBanner(): React.JSX.Element | null {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    void window.termsprawl.announcements.get().then((a) => {
      if (a) setAnnouncement(a)
    })
  }, [])

  if (!announcement || hidden) return null

  const dismiss = (): void => {
    setHidden(true)
    void window.termsprawl.settings.set({ dismissedAnnouncementVersion: announcement.version })
  }

  return (
    <div className="announcement-banner" role="status">
      <span className="announcement-title">what{'’'}s new — v{announcement.version}</span>
      {announcement.body && <span className="announcement-body">{announcement.body}</span>}
      <button
        className="announcement-dismiss"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
