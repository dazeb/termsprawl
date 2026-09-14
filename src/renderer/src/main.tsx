import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isResizeObserverNoise } from './ro-noise'
import './styles.css'
import './settings.css'

// Keep Chromium's benign ResizeObserver loop report out of the DevTools
// console (see ro-noise.ts for why it's benign and how it's matched). The
// App-level error banner filters the same messages itself — preventDefault
// here does NOT stop other 'error' listeners.
window.addEventListener('error', (event) => {
  if (isResizeObserverNoise(event.message)) {
    event.preventDefault()
  }
})
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as Error | undefined
  if (isResizeObserverNoise(reason?.message) || isResizeObserverNoise(String(event.reason))) {
    event.preventDefault()
  }
})

// StrictMode deliberately NOT used: double-mount would spawn two PTYs per
// terminal node once sessions land.
createRoot(document.getElementById('root')!).render(<App />)
