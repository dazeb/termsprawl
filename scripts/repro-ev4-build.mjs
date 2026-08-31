// Repro #4: FULL config from electron.vite.config.ts (externalizeDepsPlugin
// + alias) via electron-vite's own API — the exact production path.
import { build, externalizeDepsPlugin } from 'electron-vite'
import { fileURLToPath } from 'node:url'

const sharedAlias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
  '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
}

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: sharedAlias },
    },
  })
  console.log('REPRO4: OK')
} catch (e) {
  console.log('REPRO4: FAILED:', String(e?.message ?? e).slice(0, 400))
}
