// Toolbar "organize windows" button — no dropdown, one click per layout.
// Each click asks the Canvas to advance to the next layout: Cascade (stacked
// diagonal, stickies along the top) → Flat (all windows arranged inside the
// current view, stickies in a row above) → Restore (put windows back how they
// were before the cycle started) → back to Cascade. The cycle position and
// the actual layout math live in the Canvas / state/workspace.ts (pure,
// unit-tested); the Canvas applies positions and records one undo snapshot
// per action, so every organize is one Ctrl+Z.
//
// Canvas listens for the click through the one-shot canvas-requests store —
// the toolbar renders OUTSIDE the Canvas provider, same pattern the settings
// panel uses for spawning nodes.

import { useCanvasRequests } from '../state/canvas-requests'

interface OrganizeButtonProps {
  /** Disabled while no project is open (nothing to organize). */
  disabled?: boolean
}

export function OrganizeButton({ disabled = false }: OrganizeButtonProps): React.JSX.Element {
  return (
    <div className="cog-menu">
      <button
        type="button"
        className="cog-btn"
        disabled={disabled}
        onClick={() => useCanvasRequests.getState().spawn({ kind: 'organize' })}
        title="Organize windows — click again for the next layout (cascade → flat → restore)"
        aria-label="organize windows"
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
    </div>
  )
}
