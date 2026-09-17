// useBootOverlay — when the boot overlay is on screen, and when it leaves.
//
// The overlay used to unmount the instant the workspace finished loading. That
// is usually well under a second, which made the boot screen a hard flicker.
// Now the canvas mounts at exactly the same moment as before (so startup costs
// no added latency) and the overlay cross-fades out on top of it instead of
// cutting away.
//
// The transition itself is the pure `resolveBootPhase` below, kept separate so
// it is testable without a DOM; the hook is only the timer that drives it.

import { useEffect, useState } from 'react'

/** How long the overlay takes to fade out. Matches the CSS transition. */
export const BOOT_FADE_MS = 180

export type BootPhase = 'boot' | 'leaving' | 'done'

/**
 * 'boot'    — still loading, overlay fully opaque and showing the tesseract.
 * 'leaving' — loaded; overlay is fading out over the canvas.
 * 'done'    — fade finished; the overlay is gone for good.
 */
export function resolveBootPhase(loaded: boolean, fadeDone: boolean): BootPhase {
  if (!loaded) return 'boot'
  return fadeDone ? 'done' : 'leaving'
}

export interface BootOverlay {
  phase: BootPhase
  /** Whether to render the overlay at all. */
  visible: boolean
  /** True while fading out, so the caller can add the leaving class. */
  leaving: boolean
}

export function useBootOverlay(loaded: boolean, fadeMs: number = BOOT_FADE_MS): BootOverlay {
  const [fadeDone, setFadeDone] = useState(false)

  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => setFadeDone(true), fadeMs)
    return () => window.clearTimeout(timer)
  }, [loaded, fadeMs])

  const phase = resolveBootPhase(loaded, fadeDone)

  return {
    phase,
    visible: phase !== 'done',
    // The fade only applies on the way out; during boot the overlay is opaque
    // so the canvas never shows through behind a half-transparent tesseract.
    leaving: phase === 'leaving'
  }
}
