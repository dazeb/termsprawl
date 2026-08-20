// Cog dropdown menu (toolbar). App-level actions: source control panel and
// app settings. Anchor renders the cog button; the menu appears below it.
// Closes on Escape, outside click, or selecting an item.

import { useEffect, useRef, useState } from 'react'

interface CogMenuProps {
  hasActiveProject: boolean
  onOpenSourceControl: () => void
  onOpenSettings: () => void
}

export function CogMenu({ hasActiveProject, onOpenSourceControl, onOpenSettings }: CogMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const pick = (fn: () => void): void => {
    setOpen(false)
    fn()
  }

  return (
    <div className="cog-menu" ref={rootRef}>
      <button
        type="button"
        className="cog-btn"
        onClick={() => setOpen((o) => !o)}
        title="Menu"
        aria-label="menu"
        aria-expanded={open}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="cog-menu-pop">
          <button
            type="button"
            className="cog-menu-item"
            disabled={!hasActiveProject}
            title={hasActiveProject ? 'Git panel for the active project' : 'Open a folder project to use source control'}
            onClick={() => pick(onOpenSourceControl)}
          >
            source control
          </button>
          <button type="button" className="cog-menu-item" onClick={() => pick(onOpenSettings)}>
            settings
          </button>
        </div>
      )}
    </div>
  )
}
