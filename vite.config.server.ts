// Server Edition build — bundles src/server/index.ts into out/server/index.js
// as a plain Node app (externalizes ws + node-pty + node builtins). The renderer
// bundle it serves comes from `pnpm run build` (electron-vite → out/renderer).
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(process.cwd(), 'src/shared') }
  },
  build: {
    ssr: resolve(process.cwd(), 'src/server/index.ts'),
    outDir: resolve(process.cwd(), 'out/server'),
    emptyOutDir: true
  }
})
