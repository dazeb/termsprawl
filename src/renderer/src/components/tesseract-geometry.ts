// tesseract-geometry.ts — pure 4D geometry for the boot tesseract.
//
// A tesseract cannot be faked with CSS 3D transforms: it has 16 vertices in
// four dimensions, so it needs a real 4D rotation projected down twice
// (4D -> 3D -> 2D). Keeping that math here, free of DOM and canvas, means it
// can be unit-tested directly — see tesseract-geometry.test.ts.
//
// The visual result is depth-shaded: each edge is stroked with a width and
// opacity taken from how near it is. Without that the 32 edges read as an
// undifferentiated hash of lines.

/** A point in four dimensions. */
export type Vec4 = readonly [number, number, number, number]

/** Rotation in the two planes that make a hypercube tumble inside out. */
export interface Angles {
  xw: number
  yw: number
}

/** The 16 sign combinations of (±1, ±1, ±1, ±1) — every vertex of the cube. */
export const TESSERACT_VERTICES: readonly Vec4[] = (() => {
  const vertices: Vec4[] = []
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        for (const w of [-1, 1]) vertices.push([x, y, z, w])
      }
    }
  }
  return vertices
})()

/** The 32 edges: every pair of vertices differing in exactly one coordinate. */
export const TESSERACT_EDGES: readonly (readonly [number, number])[] = (() => {
  const edges: [number, number][] = []
  for (let a = 0; a < TESSERACT_VERTICES.length; a++) {
    for (let b = a + 1; b < TESSERACT_VERTICES.length; b++) {
      let differing = 0
      for (let axis = 0; axis < 4; axis++) {
        if (TESSERACT_VERTICES[a][axis] !== TESSERACT_VERTICES[b][axis]) differing += 1
      }
      if (differing === 1) edges.push([a, b])
    }
  }
  return edges
})()

/**
 * Viewer distance along the w axis, in vertex units. Vertices sit at |w| <= 2
 * and rotation preserves that bound, so the perspective divisor can never
 * reach zero for any angle.
 */
const VIEWER_W = 4

/** Viewer distance along z, after the tilt. Safe because |z| stays under ~2.4. */
const VIEWER_Z = 8

/**
 * A fixed tilt applied in 3D after the 4D projection. Without it the two cubes
 * project concentrically and the whole thing reads as a flat target; the tilt
 * offsets them so it looks like the solid object it is.
 */
const TILT_X = 0.42
const TILT_Y = -0.26

/** How much of the square the drawing fills, leaving the rest as breathing room. */
export const TESSERACT_FILL = 0.86

/**
 * Radians per second in each plane. The two rates are deliberately unrelated,
 * so the tumble does not visibly settle into a short repeating loop.
 */
export const SPIN_RATES: Angles = { xw: 0.3, yw: 0.19 }

/** The fixed 3/4 view held when motion is not wanted (prefers-reduced-motion). */
export const STATIC_ANGLES: Angles = { xw: 0.7, yw: 0.35 }

/** A projected vertex, in the square's own coordinates, with 0..1 nearness. */
export interface ProjectedVertex {
  x: number
  y: number
  /** 1 = nearest the viewer, 0 = farthest. */
  depth: number
}

export interface FrameEdge {
  a: number
  b: number
  /** 1 = nearest the viewer, 0 = farthest. */
  depth: number
}

export interface Frame {
  vertices: ProjectedVertex[]
  edges: FrameEdge[]
}

/**
 * Rotate a point in the XW and YW planes. Both are true rotations, so the 4D
 * norm is preserved — which is what keeps the tesseract the same size in 4D
 * however far it is turned.
 */
export function rotate4(v: Vec4, angles: Angles): Vec4 {
  const [x, y, z, w] = v

  const cosXw = Math.cos(angles.xw)
  const sinXw = Math.sin(angles.xw)
  const xAfterXw = x * cosXw - w * sinXw
  const wAfterXw = x * sinXw + w * cosXw

  const cosYw = Math.cos(angles.yw)
  const sinYw = Math.sin(angles.yw)
  const yAfterYw = y * cosYw - wAfterXw * sinYw
  const wAfterYw = y * sinYw + wAfterXw * cosYw

  return [xAfterXw, yAfterYw, z, wAfterYw]
}

/** Where the spin has reached after a given elapsed time. */
export function anglesAt(seconds: number): Angles {
  return { xw: SPIN_RATES.xw * seconds, yw: SPIN_RATES.yw * seconds }
}

interface Projected {
  x: number
  y: number
  /** Product of the two perspective factors: larger means nearer. */
  near: number
}

function projectVertex(vertex: Vec4, angles: Angles): Projected {
  const [x, y, z, w] = rotate4(vertex, angles)

  // 4D -> 3D, viewed from w = VIEWER_W.
  const k4 = VIEWER_W / (VIEWER_W - w)
  const px = x * k4
  const py = y * k4
  const pz = z * k4

  const cosX = Math.cos(TILT_X)
  const sinX = Math.sin(TILT_X)
  const yTilted = py * cosX - pz * sinX
  const zTilted = py * sinX + pz * cosX

  const cosY = Math.cos(TILT_Y)
  const sinY = Math.sin(TILT_Y)
  const xTilted = px * cosY + zTilted * sinY
  const zFinal = -px * sinY + zTilted * cosY

  // 3D -> 2D, viewed from z = VIEWER_Z.
  const k3 = VIEWER_Z / (VIEWER_Z - zFinal)

  return { x: xTilted * k3, y: yTilted * k3, near: k4 * k3 }
}

/**
 * Project one frame of the tesseract into a `size` x `size` square.
 *
 * The drawing is re-fitted to the square every frame. Its projected extent
 * changes a lot as it turns, and a loading indicator must never clip or visibly
 * change size, so the bounding box is centred on the square and scaled to
 * TESSERACT_FILL of it.
 */
export function tesseractFrame(angles: Angles, opts: { size: number }): Frame {
  const { size } = opts
  const raw = TESSERACT_VERTICES.map((vertex) => projectVertex(vertex, angles))

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of raw) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  const centreX = (minX + maxX) / 2
  const centreY = (minY + maxY) / 2
  const halfSpan = Math.max(maxX - minX, maxY - minY) / 2
  const scale = halfSpan > 0 ? (size * TESSERACT_FILL) / 2 / halfSpan : 0
  const middle = size / 2

  // Depth is normalized per frame, separately for vertices and for edges. It is
  // a shading range rather than a measurement, so stretching each to its own
  // full 0..1 keeps the contrast at maximum in every orientation.
  const vertexNear = raw.map((point) => point.near)
  const vertexSpan = Math.max(...vertexNear) - Math.min(...vertexNear)
  const vertexFloor = Math.min(...vertexNear)

  const vertices = raw.map((point) => ({
    x: middle + (point.x - centreX) * scale,
    y: middle + (point.y - centreY) * scale,
    depth: vertexSpan > 0 ? (point.near - vertexFloor) / vertexSpan : 1
  }))

  const edgeNear = TESSERACT_EDGES.map(([a, b]) => (raw[a].near + raw[b].near) / 2)
  const edgeSpan = Math.max(...edgeNear) - Math.min(...edgeNear)
  const edgeFloor = Math.min(...edgeNear)

  const edges = TESSERACT_EDGES.map(([a, b], index) => ({
    a,
    b,
    depth: edgeSpan > 0 ? (edgeNear[index] - edgeFloor) / edgeSpan : 1
  }))

  return { vertices, edges }
}
