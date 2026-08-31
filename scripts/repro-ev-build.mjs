// Repro #2: mimic electron-vite's MAIN build exactly (ssr + cjs shims +
// same externals) via its own build() API, to reproduce deterministically.
import { build } from 'electron-vite'

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: resolve(process.cwd(), 'src/main/index.ts'),
      outDir: '/tmp/repro-ev-out',
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
    },
  })
  console.log('REPRO2: electron-vite ssr build OK')
} catch (e) {
  console.log('REPRO2: FAILED:', String(e?.message ?? e).slice(0, 200))
}
import { resolve } from 'node:path'
