export type TreeSide = 'left' | 'right'

/** The VS Code-style sidebar sections. Plugins is a placeholder for the
 * future extension area. */
export type SidebarSection = 'files' | 'source' | 'plugins'

export interface FileTreeChrome {
  side: TreeSide
  open: boolean
  pinned: boolean
  /** Active sidebar section; survives close/reopen. */
  section: SidebarSection
}

export type FileTreeChromeAction =
  | { type: 'reveal'; side: TreeSide }
  | { type: 'flipSide' }
  | { type: 'togglePin' }
  | { type: 'requestClose' }
  | { type: 'switchSection'; section: SidebarSection }

export function initialFileTreeChrome(): FileTreeChrome {
  return { side: 'left', open: false, pinned: false, section: 'files' }
}

export function applyFileTreeChrome(
  state: FileTreeChrome,
  action: FileTreeChromeAction
): FileTreeChrome {
  switch (action.type) {
    case 'reveal':
      return { ...state, side: action.side, open: true }
    case 'flipSide':
      return { ...state, side: state.side === 'left' ? 'right' : 'left', open: true }
    case 'togglePin':
      return { ...state, pinned: !state.pinned, open: true }
    case 'requestClose':
      return state.pinned ? state : { ...state, open: false }
    case 'switchSection':
      return { ...state, section: action.section, open: true }
  }
}

/** Which canvas edge the pointer is hugging, or null if it is in the middle. */
export function edgeHotZone(x: number, width: number, zone = 12): TreeSide | null {
  if (width <= 0) return null
  if (x <= zone) return 'left'
  if (x >= width - zone) return 'right'
  return null
}

/** True while the pointer is still over the open panel (including its hot strip). */
export function shouldKeepTreeOpen(args: {
  x: number
  width: number
  side: TreeSide
  panelWidth: number
}): boolean {
  if (args.side === 'left') return args.x <= args.panelWidth
  return args.x >= args.width - args.panelWidth
}
