import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// StrictMode deliberately NOT used: double-mount would spawn two PTYs per
// terminal node once sessions land.
createRoot(document.getElementById('root')!).render(<App />)
