// TesseractSpinner.tsx — the boot screen's rotating tesseract.
//
// The product is named after this shape, so the boot screen draws a real one:
// 16 vertices in four dimensions, rotated in two planes at once and projected
// down twice (4D -> 3D -> 2D), with every edge shaded by how near it is.
//
// The math lives in tesseract-geometry.ts and the colors in
// tesseract-palette.ts — both pure, both unit-tested, because this repo's tests
// run without a DOM and so cannot observe a canvas. This file is the drawing
// and the animation loop only.
//
// Motion is driven by requestAnimationFrame rather than CSS, so
// prefers-reduced-motion is honoured here: the loop is never started and one
// fixed 3/4 view is drawn instead.

import React, { useEffect, useRef } from 'react'
import {
  STATIC_ANGLES,
  anglesAt,
  tesseractFrame,
  type Angles
} from './tesseract-geometry'
import { css, lerpColor, tesseractPalette } from './tesseract-palette'

/** Side of the drawing square, in CSS pixels. */
const SIZE = 132

/** Backing-store scale is capped: past 2x the extra pixels buy nothing here. */
const MAX_DPR = 2

/** Edge thickness at the nearest and farthest extremes. */
const WIDTH_NEAR = 1.7
const WIDTH_FAR = 0.5

/** Vertex dot radius at the nearest and farthest extremes. */
const DOT_NEAR = 1.9
const DOT_FAR = 0.7

/** Edges above this depth get the bloom, so only the near face glows. */
const GLOW_FROM = 0.78

/** Bloom radius: kept modest so the halo reads as depth, not a wash. */
const GLOW_BLUR = 6

export interface TesseractSpinnerProps {
  /** Project accent. Falls back to brand lime, and refuses purple. */
  accent?: string
  theme?: 'dark' | 'light'
}

export function TesseractSpinner({
  accent,
  theme = 'dark'
}: TesseractSpinnerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    canvas.width = Math.round(SIZE * dpr)
    canvas.height = Math.round(SIZE * dpr)

    // Theme is part of who is ON SCREEN, not a preference: the boot overlay
    // paints var(--bg), so the wireframe must match that surface, not the OS.
    const palette = tesseractPalette(accent, theme === 'light')

    const draw = (angles: Angles): void => {
      // Re-applied every frame: setTransform resets any state a previous frame
      // left behind, and the DPR scale must survive the clear.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.lineCap = 'round'

      const frame = tesseractFrame(angles, { size: SIZE })

      // Painter's order: far edges first so near edges land on top of them.
      const ordered = [...frame.edges].sort((a, b) => a.depth - b.depth)

      // Bloom pass for the near face only. Drawing the whole figure with a
      // shadow would halve the frame budget for a glow nobody can see on the
      // edges at the back.
      ctx.save()
      ctx.shadowColor = css(palette.glow)
      for (const edge of ordered) {
        if (edge.depth < GLOW_FROM) continue
        const a = frame.vertices[edge.a]
        const b = frame.vertices[edge.b]
        ctx.shadowBlur = GLOW_BLUR * edge.depth
        ctx.strokeStyle = css(lerpColor(palette.edgeFar, palette.edgeNear, edge.depth))
        ctx.lineWidth = WIDTH_FAR + (WIDTH_NEAR - WIDTH_FAR) * edge.depth
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.restore()

      // Crisp pass.
      for (const edge of ordered) {
        const a = frame.vertices[edge.a]
        const b = frame.vertices[edge.b]
        ctx.strokeStyle = css(lerpColor(palette.edgeFar, palette.edgeNear, edge.depth))
        ctx.lineWidth = WIDTH_FAR + (WIDTH_NEAR - WIDTH_FAR) * edge.depth
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }

      // Vertex dots, faint at the back. These are what make the double cube
      // read as sixteen points rather than a mesh, and they anchor the corners
      // where several edges meet.
      for (const vertex of frame.vertices) {
        ctx.fillStyle = css(
          lerpColor({ ...palette.vertex, a: 0.22 }, palette.vertex, vertex.depth)
        )
        ctx.beginPath()
        ctx.arc(vertex.x, vertex.y, DOT_FAR + (DOT_NEAR - DOT_FAR) * vertex.depth, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // The static view is a good 3/4 angle, and the animation starts from it, so
    // the very first frame already reads as a solid object rather than the flat
    // concentric squares that { xw: 0, yw: 0 } projects to.
    const tilted = (elapsed: number): Angles => {
      const spin = anglesAt(elapsed)
      return { xw: STATIC_ANGLES.xw + spin.xw, yw: STATIC_ANGLES.yw + spin.yw }
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = 0
    let startedAt = 0

    const tick = (now: number): void => {
      if (startedAt === 0) startedAt = now
      draw(tilted((now - startedAt) / 1000))
      frameId = requestAnimationFrame(tick)
    }

    const apply = (): void => {
      if (frameId !== 0) {
        cancelAnimationFrame(frameId)
        frameId = 0
      }
      startedAt = 0
      if (reduced.matches) draw(STATIC_ANGLES)
      else frameId = requestAnimationFrame(tick)
    }

    apply()
    // Listen for the preference changing mid-boot, so toggling the OS setting
    // does not leave a spinner running against the user's wishes.
    reduced.addEventListener('change', apply)

    return () => {
      if (frameId !== 0) cancelAnimationFrame(frameId)
      reduced.removeEventListener('change', apply)
    }
  }, [accent, theme])

  return (
    <div className="tesseract-spinner" role="status" aria-label="Loading">
      <canvas ref={canvasRef} className="tesseract-canvas" aria-hidden="true" />
      <span className="boot-wordmark" aria-hidden="true">
        termsprawl
      </span>
    </div>
  )
}
