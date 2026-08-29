// Window sizing + renderer UI zoom, derived from the display's work area.
//
// Bug this fixes (0.13.4): createWindow() hardcoded 1440x900. On a 1280x720
// display the window opened larger than the screen, so everything anchored to
// the canvas bottom — React Flow's zoom controls and the undo/redo
// history-bar — was cut off below the visible area.

/** Fallback work area when no real display metrics are available. */
export const FALLBACK_WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }

/** Hard floor from createWindow()'s minWidth/minHeight. */
export const MIN_WINDOW_WIDTH = 800
export const MIN_WINDOW_HEIGHT = 600

/** Breathing room kept between the window edge and the work-area edge. */
const FIT_MARGIN = 8

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Shrink `preferred` (when needed) so it fits inside `workArea`, honoring
 * the app minimums and keeping a small margin from the display edge. */
export function clampWindowBounds(
  preferred: { width: number; height: number },
  workArea: Rect
): { width: number; height: number } {
  if (!workArea || workArea.width <= 0 || workArea.height <= 0) return { ...preferred }
  const width = Math.min(preferred.width, workArea.width - FIT_MARGIN)
  const height = Math.min(preferred.height, workArea.height - FIT_HEIGHT(workArea))
  return {
    width: Math.max(MIN_WINDOW_WIDTH, width),
    height: Math.max(MIN_WINDOW_HEIGHT, height)
  }
}

/** The work area already excludes most panels/docks; only panel thickness
 * itself needs covering, and it scales with how much chrome the display has. */
function FIT_HEIGHT(workArea: Rect): number {
  // Dock/panel bands are typically ≤ 48px; reserve proportionally, capped.
  return Math.min(FIT_MARGIN + 24, Math.max(FIT_MARGIN, Math.round(workArea.height * 0.02)))
}

/** Renderer zoom factor so bottom-anchored chrome (zoom controls, undo bar)
 * stays comfortably inside short viewports. The default UI is laid out for a
 * ~760px-tall window (720p screens minus dock); anything shorter than that
 * gets scaled down proportionally, floored at 0.8. 1.0 on normal displays. */
export function desiredUiZoom(workArea: Rect): number {
  if (!workArea || workArea.height <= 0) return 1
  const UI_BASELINE_HEIGHT = 760
  if (workArea.height >= UI_BASELINE_HEIGHT) return 1
  const zoom = (workArea.height - FIT_MARGIN) / UI_BASELINE_HEIGHT
  return Math.round(Math.min(1, Math.max(0.8, zoom)) * 100) / 100
}
