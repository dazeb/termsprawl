// Generates build/icon.png (1024x1024) — the termsprawl mark: a black
// rounded square with lime node dots sprawled across it, hinting at the
// infinite canvas. Run via `pnpm run make-icon`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createCanvas } from 'canvas'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'build', 'icon.png')

const SIZE = 1024
const canvas = createCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d')

// Background: black rounded square with a subtle radial glow.
ctx.fillStyle = '#0a0a0a'
roundRect(ctx, 0, 0, SIZE, SIZE, 224)
ctx.fill()

const glow = ctx.createRadialGradient(SIZE / 2, SIZE * 0.42, 0, SIZE / 2, SIZE * 0.42, SIZE * 0.72)
glow.addColorStop(0, 'rgba(198, 241, 53, 0.10)')
glow.addColorStop(1, 'rgba(198, 241, 53, 0)')
ctx.fillStyle = glow
ctx.fillRect(0, 0, SIZE, SIZE)

// A sparse dot grid — the canvas.
const spacing = 128
const dotR = 7
ctx.fillStyle = 'rgba(232, 232, 230, 0.10)'
for (let y = spacing; y < SIZE; y += spacing) {
  for (let x = spacing; x < SIZE; x += spacing) {
    ctx.beginPath()
    ctx.arc(x, y, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
}

// Lime node dots — the "sprawl": terminals scattered, one bigger and focused.
const nodes = [
  { x: 300, y: 300, r: 34, alpha: 0.95 },
  { x: 620, y: 230, r: 22, alpha: 0.75 },
  { x: 740, y: 480, r: 26, alpha: 0.85 },
  { x: 420, y: 600, r: 18, alpha: 0.7 },
  { x: 200, y: 700, r: 24, alpha: 0.8 },
  { x: 560, y: 760, r: 15, alpha: 0.65 }
]
for (const n of nodes) {
  ctx.beginPath()
  ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(198, 241, 53, ${n.alpha})`
  ctx.fill()
}

// Connecting lines — a loose web, like edges on the canvas.
ctx.strokeStyle = 'rgba(198, 241, 53, 0.35)'
ctx.lineWidth = 10
ctx.lineCap = 'round'
for (let i = 1; i < nodes.length; i++) {
  ctx.beginPath()
  ctx.moveTo(nodes[i - 1].x, nodes[i - 1].y)
  ctx.lineTo(nodes[i].x, nodes[i].y)
  ctx.stroke()
}

mkdirSync(dirname(OUT), { recursive: true })
const buf = canvas.toBuffer('image/png')
writeFileSync(OUT, buf)
console.log(`icon written: ${OUT} (${buf.length} bytes)`)
console.log('NOTE: package.json build.linux.icon points at build/icon.png')

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
