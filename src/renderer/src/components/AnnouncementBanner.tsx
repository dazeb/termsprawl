// Phase 12.2 — announcements. A clickable "what's new" bar that opens a modal
// with the full release changelog (markdown, rendered with the same sanitised
// renderer as the editor preview). Dismissal is persisted per version so it
// only appears once per release. The modal is reachable any time the bar is
// shown — including right after an update — so the user can always read what
// changed.
import { useEffect, useState } from 'react'
import type { Announcement } from '@shared/types'
import { renderMarkdown } from '../markdown'

export function AnnouncementBanner(): React.JSX.Element | null {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void window.termsprawl.announcements.get().then((a) => {
      if (a) setAnnouncement(a)
    })
  }, [])

  // Escape closes the modal (matches the settings-sheet behaviour).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!announcement || hidden) return null

  const dismiss = (): void => {
    setHidden(true)
    setOpen(false)
    void window.termsprawl.settings.set({ dismissedAnnouncementVersion: announcement.version })
  }

  // Changelog links open in the system browser; never navigate the app window.
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute('href')
    if (href) void window.termsprawl.openExternal(href)
  }

  return (
    <>
      <div
        className="announcement-banner"
        role="button"
        tabIndex={0}
        title="Read what changed"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen(true)
        }}
      >
        <span className="announcement-title">what{'’'}s new — v{announcement.version}</span>
        <span className="announcement-body">click to read the changelog</span>
        <button
          className="announcement-dismiss"
          onClick={(e) => {
            e.stopPropagation()
            dismiss()
          }}
          aria-label="Dismiss announcement"
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div
            className="changelog-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`what's new in v${announcement.version}`}
          >
            <div className="changelog-modal-head">
              <span className="changelog-modal-title">what{'’'}s new — v{announcement.version}</span>
              <button
                className="settings-modal-close"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close changelog"
              >
                ×
              </button>
            </div>
            <div
              className="changelog-modal-body editor-preview"
              onClick={onBodyClick}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(announcement.body || `**${announcement.title}**`)
              }}
            />
            <div className="changelog-modal-foot">
              <button className="changelog-gotit" onClick={dismiss}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
