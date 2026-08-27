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

    const schedule = (): void => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        onResizeRef.current()
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
