export type TreeSide = 'left' | 'right'

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
