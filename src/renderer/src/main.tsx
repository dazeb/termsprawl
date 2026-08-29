import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Suppress Chromium's benign ResizeObserver reporting noise (shown on every
// node resize — React Flow measures node wrappers with an internal
// ResizeObserver while NodeResizer writes wrapper styles per pointer-move):
//   - "ResizeObserver loop limit exceeded" (the throwing variant)
//   - "ResizeObserver loop completed with undelivered notifications"
// Both mean exactly one thing per spec: an observation triggered by a
// same-frame style mutation was deferred to the NEXT frame. Nothing failed —
// the notification arrives one frame later. This is the standard,
// Chromium-team-endorsed suppression (github.com/WICG/resize-observer#24);
// it is scoped to the exact message text so real errors still surface.
const RO_NOISE = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.'
]
window.addEventListener('error', (event) => {
  if (typeof event.message === 'string' && RO_NOISE.includes(event.message)) {
    event.preventDefault()
  }
})
window.addEventListener('unhandledrejection', (event) => {
  const msg = (event.reason as Error | undefined)?.message
  if (typeof msg === 'string' && RO_NOISE.includes(msg)) {
    event.preventDefault()
  }
})

// StrictMode deliberately NOT used: double-mount would spawn two PTYs per
// terminal node once sessions land.
createRoot(document.getElementById('root')!).render(<App />)
