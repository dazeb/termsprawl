// Repro: vite ssr build of src/main/index.ts (what electron-vite does),
// minify:false, to catch the esbuild-transpile failure deterministically.
import { build } from 'vite'
import { resolve } from 'node:path'

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: resolve(process.cwd(), 'src/main/index.ts'),
      outDir: '/tmp/repro-main-out',
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rollupOptions: { external: [/node:/, 'electron', 'node-pty'] },
    },
  })
  console.log('REPRO: ssr build OK')
} catch (e) {
  console.log('REPRO: ssr build FAILED:', String(e?.message ?? e).slice(0, 300))
  if (e?.stdout) console.log(String(e.stdout).slice(0, 200))
}
