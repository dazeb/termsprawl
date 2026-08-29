// useSafeResize — ResizeObserver-driven layout without the two failure modes
// that have bitten us (learned 2026-08-27, node resize):
//
// 1. "ResizeObserver loop completed with undelivered notifications" — Chromium
//    warns when a callback synchronously mutates the observed element's size
//    in the same frame (xterm fit() writes host dimensions; Monaco layout
//    writes its container). Fix: defer the work to requestAnimationFrame so
//    the mutation lands in a LATER frame with no pending delivery, and skip
//    when the size hasn't actually changed (>=1px guard kills subpixel
//    feedback).
//
// 2. RENDERER CRASH / black screen — if a ResizeObserver callback ever
//    throws (e.g. Chromium's "ResizeObserver loop limit exceeded", which it
//    throws when an observer keeps rescheduling itself), the uncaught
//    exception can blank the whole page. Two hard rules here:
//      - NEVER disconnect/re-observe from inside the callback (that pattern
//        can re-trigger delivery and hit the loop limit).
//      - EVERY callback body is wrapped in try/catch; a failure degrades to a
//        no-op instead of killing the renderer.
//
// Do NOT "improve" this back into a synchronous fit or a disconnect/re-observe
// dance — both reintroduce the crash.

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

    const observer = new ResizeObserver((entries) => {
      try {
        // Two fixes over the naive loop (found while auditing the
        // "undelivered notifications" report):
        //  - judge only the LAST entry of the batch: ResizeObserver coalesces
        //    same-frame changes into one delivery, and the last entry always
        //    carries the newest size.
        //  - the >=1px guard compares against the last PROCESSED size. This
        //    kills subpixel feedback loops without ever dropping a real
        //    resize (the old `return`-inside-for could bail out of the whole
        //    entries list on a subpixel-only entry and permanently desync
        //    from the real size on drag resizes).
        const last = entries[entries.length - 1]
        if (!last) return
        const { width, height } = last.contentRect
        if (
          Math.abs(width - lastSize.current.w) < 1 &&
          Math.abs(height - lastSize.current.h) < 1
        ) {
          return
        }
        lastSize.current = { w: width, h: height }
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => {
          frame.current = null
          try {
            onResizeRef.current()
          } catch {
            // Never let layout work crash the renderer.
          }
        })
      } catch {
        // An RO callback must never throw — that can blank the page.
      }
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [ref])
}
