// Chromium's ResizeObserver loop reporting, in both spellings it uses:
//  - the spec'd ErrorEvent: "ResizeObserver loop completed with undelivered
//    notifications." (fires when a same-frame style mutation defers the
//    observation to the next frame — benign, the measurement still lands)
//  - the older throwing variant: "ResizeObserver loop limit exceeded"
// React Flow's internal node-wrapper observer + NodeResizer's per-move style
// writes trip this on every drag resize. It carries zero failure semantics:
// nothing broke, nothing is lost. Matching is prefix-based and case-sensitive
// so real errors that merely mention ResizeObserver still surface.
const RO_NOISE_PREFIXES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded'
]

/** True when a message is the benign ResizeObserver loop report. */
export function isResizeObserverNoise(message: unknown): boolean {
  if (typeof message !== 'string') return false
  return RO_NOISE_PREFIXES.some((p) => message.startsWith(p))
}
