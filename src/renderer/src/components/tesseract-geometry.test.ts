// tesseract-geometry.test.ts — pure 4D math for the boot tesseract.
// No DOM: the math is deliberately separated from the canvas component so it
// can be checked here (the repo has no DOM-testing-library dependency).
import { describe, it, expect } from 'vitest'
import {
  TESSERACT_VERTICES,
  TESSERACT_EDGES,
  TESSERACT_FILL,
  STATIC_ANGLES,
  SPIN_RATES,
  anglesAt,
  rotate4,
  tesseractFrame,
  type Vec4
} from './tesseract-geometry'

const SIZE = 120

const norm4 = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2], v[3])

describe('tesseract vertex and edge tables', () => {
  it('lists the 16 vertices of a hypercube, all at radius 2', () => {
    expect(TESSERACT_VERTICES).toHaveLength(16)
    for (const v of TESSERACT_VERTICES) {
      for (const c of v) expect(Math.abs(c)).toBe(1)
      expect(norm4(v)).toBeCloseTo(2, 12)
    }
  })

  it('lists 32 distinct edges, each joining vertices one coordinate apart', () => {
    expect(TESSERACT_EDGES).toHaveLength(32)
    const seen = new Set<string>()
    for (const [a, b] of TESSERACT_EDGES) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(TESSERACT_VERTICES.length)
      expect(a).not.toBe(b)

      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)

      const va = TESSERACT_VERTICES[a]
      const vb = TESSERACT_VERTICES[b]
      const differing = [0, 1, 2, 3].filter((i) => va[i] !== vb[i])
      expect(differing).toHaveLength(1)
    }
  })

  it('gives every vertex degree 4', () => {
    const degree = new Array<number>(16).fill(0)
    for (const [a, b] of TESSERACT_EDGES) {
      degree[a] += 1
      degree[b] += 1
    }
    expect(degree).toEqual(new Array<number>(16).fill(4))
  })
})

describe('rotate4', () => {
  it('preserves the 4D norm (an orthogonal rotation, not a skew)', () => {
    for (const v of TESSERACT_VERTICES) {
      expect(norm4(rotate4(v, { xw: 0.7, yw: 1.3 }))).toBeCloseTo(norm4(v), 12)
      expect(norm4(rotate4(v, { xw: -2.1, yw: 3.4 }))).toBeCloseTo(norm4(v), 12)
    }
  })

  it('returns to the starting point after a full turn in both planes', () => {
    const v = TESSERACT_VERTICES[5]
    const back = rotate4(v, { xw: 2 * Math.PI, yw: 2 * Math.PI })
    for (let i = 0; i < 4; i++) expect(back[i]).toBeCloseTo(v[i], 9)
  })

  it('half a turn negates exactly the coordinates of the rotated plane', () => {
    const v: Vec4 = [1, 1, 1, 1]

    const xw = rotate4(v, { xw: Math.PI, yw: 0 })
    expect(xw[0]).toBeCloseTo(-1, 12)
    expect(xw[1]).toBeCloseTo(1, 12)
    expect(xw[2]).toBeCloseTo(1, 12)
    expect(xw[3]).toBeCloseTo(-1, 12)

    const yw = rotate4(v, { xw: 0, yw: Math.PI })
    expect(yw[0]).toBeCloseTo(1, 12)
    expect(yw[1]).toBeCloseTo(-1, 12)
    expect(yw[2]).toBeCloseTo(1, 12)
    expect(yw[3]).toBeCloseTo(-1, 12)
  })

  it('moves a vertex for a non-trivial angle', () => {
    const v: Vec4 = [1, 1, 1, 1]
    const r = rotate4(v, { xw: 0.9, yw: 0.4 })
    const delta: Vec4 = [r[0] - v[0], r[1] - v[1], r[2] - v[2], r[3] - v[3]]
    expect(norm4(delta)).toBeGreaterThan(0.2)
  })

  it('leaves a vertex alone when both planes are at rest', () => {
    const v = TESSERACT_VERTICES[9]
    const r = rotate4(v, { xw: 0, yw: 0 })
    for (let i = 0; i < 4; i++) expect(r[i]).toBeCloseTo(v[i], 12)
  })
})

describe('anglesAt', () => {
  it('starts at rest and advances in both planes', () => {
    expect(anglesAt(0)).toEqual({ xw: 0, yw: 0 })
    const a = anglesAt(2)
    expect(a.xw).toBeCloseTo(SPIN_RATES.xw * 2, 12)
    expect(a.yw).toBeCloseTo(SPIN_RATES.yw * 2, 12)
  })

  it('uses two different rates, so the motion does not visibly repeat', () => {
    expect(SPIN_RATES.xw).toBeGreaterThan(0)
    expect(SPIN_RATES.yw).toBeGreaterThan(0)
    expect(Math.abs(SPIN_RATES.xw - SPIN_RATES.yw)).toBeGreaterThan(0.05)
  })
})

describe('tesseractFrame', () => {
  const VIEWS = [STATIC_ANGLES, { xw: 0, yw: 0 }, { xw: 1.9, yw: 0.7 }, { xw: 4.4, yw: 2.2 }]

  it('projects all 16 vertices and 32 edges, finite and inside the square', () => {
    for (const angles of VIEWS) {
      const frame = tesseractFrame(angles, { size: SIZE })
      expect(frame.vertices).toHaveLength(16)
      expect(frame.edges).toHaveLength(32)

      for (const p of frame.vertices) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(SIZE)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(SIZE)
        expect(p.depth).toBeGreaterThanOrEqual(0)
        expect(p.depth).toBeLessThanOrEqual(1)
      }
    }
  })

  it('centres the drawing and fills the square without clipping', () => {
    for (const angles of VIEWS) {
      const frame = tesseractFrame(angles, { size: SIZE })
      const xs = frame.vertices.map((p) => p.x)
      const ys = frame.vertices.map((p) => p.y)
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]

      expect((minX + maxX) / 2).toBeCloseTo(SIZE / 2, 6)
      expect((minY + maxY) / 2).toBeCloseTo(SIZE / 2, 6)

      const span = Math.max(maxX - minX, maxY - minY)
      expect(span).toBeLessThanOrEqual(SIZE * TESSERACT_FILL + 1e-6)
      expect(span).toBeGreaterThan(SIZE * 0.5)
    }
  })

  it('gives edges the full spread of depths (near and far faces both present)', () => {
    const frame = tesseractFrame(STATIC_ANGLES, { size: SIZE })
    const depths = frame.edges.map((e) => e.depth)
    expect(Math.min(...depths)).toBeCloseTo(0, 6)
    expect(Math.max(...depths)).toBeCloseTo(1, 6)
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.5)
  })

  it('references only real vertices from its edges', () => {
    const frame = tesseractFrame(STATIC_ANGLES, { size: SIZE })
    for (const e of frame.edges) {
      expect(e.a).toBeGreaterThanOrEqual(0)
      expect(e.a).toBeLessThan(frame.vertices.length)
      expect(e.b).toBeGreaterThanOrEqual(0)
      expect(e.b).toBeLessThan(frame.vertices.length)
    }
  })

  it('draws a different frame for a different angle', () => {
    const rest = tesseractFrame({ xw: 0, yw: 0 }, { size: SIZE })
    const turned = tesseractFrame({ xw: 0.8, yw: 0.5 }, { size: SIZE })
    const moved = rest.vertices.some((p, i) => Math.abs(p.x - turned.vertices[i].x) > 0.5)
    expect(moved).toBe(true)
  })
})
