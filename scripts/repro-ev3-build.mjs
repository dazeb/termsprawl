// Repro #3: the REAL electron.vite.config.ts (externalizeDepsPlugin + shared
// alias + the actual entry resolution electron-vite uses for main).
import { build } from 'electron-vite'
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
      plugins: [(await import('electron-vite')).externalizeDepsPlugin()],
      resolve: { alias: sharedAlias },
    },
  })
  console.log('REPRO3: OK')
} catch (e) {
  console.log('REPRO3: FAILED:', String(e?.message ?? e).slice(0, 300))
}
