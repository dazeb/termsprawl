// tesseract-palette.ts — colors for the boot tesseract.
//
// The two themes cannot share a palette: brand lime on the light theme's
// near-white page is almost invisible, so on light the wireframe switches to
// dark ink and the accent is kept for the nearest vertices. On dark the whole
// figure is accent-tinted, as the rest of the app's chrome is.
//
// Colors are channels, not CSS strings, because the renderer interpolates
// between the near and far edge colors per edge on every frame — that ramp is
// what keeps 32 overlapping lines legible. Pure module, no DOM, no canvas.
import { DEFAULT_ACCENT, resolveAccent } from '../state/accent'

/** Dark ink for the light theme, matching --fg there. */
const LIGHT_INK = '#1c1c1a'

export interface TesseractColor {
  r: number
  g: number
  b: number
  a: number
}

export interface TesseractPalette {
  /** Farthest edges of the wireframe. */
  edgeFar: TesseractColor
  /** Nearest edges — these carry the shape's read. */
  edgeNear: TesseractColor
  /** Vertex dots. */
  vertex: TesseractColor
  /** Bloom drawn behind the nearest edges. */
  glow: TesseractColor
}

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.slice(1)
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

function color(hex: string, alpha: number): TesseractColor {
  const [r, g, b] = hexToRgb(hex)
  return { r, g, b, a: Number(alpha.toFixed(2)) }
}

/** Blend `amount` of `toward` into `from`, channel by channel. */
function mix(from: string, toward: string, amount: number): string {
  const [fr, fg, fb] = hexToRgb(from)
  const [tr, tg, tb] = hexToRgb(toward)
  const blend = (a: number, b: number): number => Math.round(a + (b - a) * amount)
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(blend(fr, tr))}${hex(blend(fg, tg))}${hex(blend(fb, tb))}`
}

/** CSS form of a palette color, for canvas fill/stroke and shadow styles. */
export function css(c: TesseractColor): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`
}

/** Interpolate two colors; `t` is clamped to 0..1. */
export function lerpColor(from: TesseractColor, to: TesseractColor, t: number): TesseractColor {
  const clamped = Math.max(0, Math.min(1, t))
  const lerp = (a: number, b: number): number => Math.round(a + (b - a) * clamped)
  return {
    r: lerp(from.r, to.r),
    g: lerp(from.g, to.g),
    b: lerp(from.b, to.b),
    a: Number((from.a + (to.a - from.a) * clamped).toFixed(2))
  }
}

/**
 * Colors for one frame. `accent` goes through resolveAccent, so a purple that
 * somehow reached the boot screen still falls back to brand lime.
 */
export function tesseractPalette(accent: string | undefined, light: boolean): TesseractPalette {
  const base = resolveAccent(accent) ?? DEFAULT_ACCENT

  if (light) {
    return {
      edgeFar: color(LIGHT_INK, 0.2),
      edgeNear: color(LIGHT_INK, 0.78),
      vertex: color(mix(base, LIGHT_INK, 0.45), 0.95),
      glow: color(base, 0.3)
    }
  }

  return {
    edgeFar: color(base, 0.26),
    edgeNear: color(base, 0.92),
    vertex: color(base, 0.95),
    glow: color(base, 0.45)
  }
}
