// Project accent palette (the "never purple" rule, enforced in code).
//
// A per-project accent may only come from the curated presets via the picker,
// and ANY purple/violet is refused at the apply site — even if it arrives
// through a hand-edited workspace.json, an imported bundle, or an old index.
// That is the by-construction defense for the AGENTS.md rule: the dev host's
// GTK accent is purple, and purple must never render anywhere.
//
// Pure module — no DOM, no Electron — per state/ rules (unit-testable).

/** The app's default accent: brand lime. */
export const DEFAULT_ACCENT = '#c6f135'

/** Approved swatches. Brand lime first (it is also the default).
 * Deliberately NO purple/violet: hues ~255-325 are banned outright. */
export const ACCENT_PRESETS: readonly string[] = [
  '#c6f135', // lime — the brand signal
  '#02af3e', // green — termsprawl.com lime
  '#37d4c0', // teal
  '#4aa8ff', // sky
  '#ffab2e', // amber
  '#ff5d5d' // coral
]

/** True when `v` is a hex color literal (#rgb or #rrggbb). */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
}

/** Hue (0-360) + saturation (0-1) of a hex color; null when not hex. */
export function hexHueSat(v: string): { h: number; s: number } | null {
  if (!isHexColor(v)) return null
  const hex = v.slice(1)
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const l = (max + min) / 2
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = 60 * (((g - b) / d) % 6)
  else if (max === g) h = 60 * ((b - r) / d + 2)
  else h = 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  return { h, s }
}

/** The hard rule: purple/violet (hue ~255-325 with visible saturation).
 * Grays and near-black/near-white tints are neutral, not purple. */
export function isPurple(v: unknown): boolean {
  const hs = typeof v === 'string' ? hexHueSat(v.trim()) : null
  return hs !== null && hs.s > 0.15 && hs.h >= 255 && hs.h <= 325
}

/** Normalize a stored accent for use as a CSS color, or undefined when the
 * app must fall back to the default: non-hex values and ANY purple resolve
 * to undefined (default lime). This is the render-time guard — legacy data
 * that predates the picker cannot paint purple. */
export function resolveAccent(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const norm = v.trim().toLowerCase()
  if (!isHexColor(norm) || isPurple(norm)) return undefined
  return norm
}
