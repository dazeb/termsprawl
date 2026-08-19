import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest does not read electron-vite's tsconfig path resolution, so mirror the
// paths from tsconfig.web.json / tsconfig.node.json here. Type-only imports
// were erased before; value imports (e.g. @shared/agents/config) need this.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']
  }
})
