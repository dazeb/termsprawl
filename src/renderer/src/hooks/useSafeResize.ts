// useSafeResize — ResizeObserver without the "loop completed with undelivered
// notifications" warning (learned 2026-08-27, node-resize noise).
//
// Why the warning happens: Chromium warns when a ResizeObserver callback
// synchronously mutates an observed element's size inside the callback frame
// (xterm fit() writes element dimensions back into its observed host; Monaco's
// automaticLayout rounds fractional sizes and re-triggers its own observer).
// The notification then stays undelivered → "ResizeObserver loop completed
// with undelivered notifications" on every node resize.
//
// Fix: defer the layout work OUT of the observer callback via
// requestAnimationFrame (so the notification cycle completes before any
// mutation), and skip when the observed size hasn't actually changed. This
// keeps layout correct (runs on the next frame) while silencing the warning.

import { useEffect, useRef, type RefObject } from 'react'

export function useSafeResize<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onResize: () => void
): void {
  const lastSize = useRef({ w: 0, h: 0 })
  const frame = useRef<number | null>(null)
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // The observed element may MUTATE during the deferred work (xterm fit()
    // writes host dimensions; Monaco layout writes its container). If the
    // observer is live during that mutation, Chromium sees a callback that
    // changed the observed size → "ResizeObserver loop completed with
    // undelivered notifications". So we disconnect before the work, run it,
    // then re-observe — the mutation happens with NO active observer, and the
    // next observe() picks up the new size cleanly. (learned 2026-08-27)
    const schedule = (): void => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        observer.disconnect()
        try {
          onResizeRef.current()
        } finally {
          if (el.isConnected) observer.observe(el)
        }
      })
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (Math.abs(width - lastSize.current.w) < 1 && Math.abs(height - lastSize.current.h) < 1) {
          return
        }
        lastSize.current = { w: width, h: height }
        schedule()
      }
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [ref])
}
