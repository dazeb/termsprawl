// Toolbar "organize windows" button — one button, three modes via a small
// dropdown: Cascade (stacked diagonal, stickies along the top), Flat (all
// windows side by side, stickies in a row above), and Restore (put windows
// back how they were before the last organize). The actual layout math lives
// in state/workspace.ts (pure, unit-tested); the Canvas applies positions and
// records one undo snapshot per action, so every organize is one Ctrl+Z.
//
// Canvas listens for the chosen mode through the one-shot canvas-requests
// store — the toolbar renders OUTSIDE the Canvas provider, same pattern the
// settings panel uses for spawning nodes.

import { useEffect, useRef, useState } from 'react'
import { useCanvasRequests } from '../state/canvas-requests'

interface OrganizeButtonProps {
  /** Disabled while no project is open (nothing to organize). */
  disabled?: boolean
}

type OrganizeMode = 'cascade' | 'flat' | 'restore'

export function OrganizeButton({ disabled = false }: OrganizeButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on any outside click or Escape (same behaviour as the canvas
  // context menu's dismiss paths).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const organize = (mode: OrganizeMode): void => {
    setOpen(false)
    useCanvasRequests.getState().spawn({ kind: 'organize', mode })
  }

  return (
    <div className="cog-menu" ref={rootRef}>
      <button
        type="button"
        className="cog-btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Organize windows"
        aria-label="organize windows"
        aria-expanded={open}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* overlapping window stack: two offset panes + a third behind */}
          <rect x="3" y="8" width="13" height="10" rx="1.5" />
          <path d="M7 8V5.5A1.5 1.5 0 0 1 8.5 4H19a1.5 1.5 0 0 1 1.5 1.5V15a1.5 1.5 0 0 1-1.5 1.5h-2" />
        </svg>
      </button>
      {open && (
        <div className="cog-menu-pop" role="menu" aria-label="organize layout">
          <button className="cog-menu-item" role="menuitem" onClick={() => organize('cascade')}>
            Cascade — stacked diagonal
          </button>
          <button className="cog-menu-item" role="menuitem" onClick={() => organize('flat')}>
            Flat — side by side
          </button>
          <button className="cog-menu-item" role="menuitem" onClick={() => organize('restore')}>
            Restore — undo the last layout
          </button>
        </div>
      )}
    </div>
  )
}
