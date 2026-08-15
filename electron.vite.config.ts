import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// tsconfig paths (@shared/*) are used by type-checking, but electron-vite does
// not apply them at bundle time — type-only imports were erased before; value
// imports (e.g. @shared/agents/config) need the alias here.
const sharedAlias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: sharedAlias }
  }
})
