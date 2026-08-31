// Repro #7: hunt the bogus match in the REAL pre-shim chunk. Build the
// bundle with rollup directly (same as electron-vite main env), dump the
// pre-esbuild chunk to disk, run the plugin's regex on it, and report ALL
// matches with the LAST one's landing position.
import { rollup } from '/mnt/nvme1/workspace/projects/termsprawl/node_modules/.pnpm/rollup@4.62.4/node_modules/rollup/dist/es/rollup.js'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const sharedAlias = {
  '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
}

const bundle = await rollup({
  input: 'src/main/index.ts',
  external: [/node:/, 'electron', 'node-pty'],
  resolve: {
    alias: sharedAlias,
    extensions: ['.ts', '.js', '.mjs'],
  },
  plugins: [
    {
      name: 'ts-and-alias',
      resolveId(source, importer) {
        if (source.startsWith('@shared/')) {
          return fileURLToPath(new URL('./src/shared/' + source.slice('@shared/'.length), import.meta.url)) + '.ts'
        }
        if ((source.startsWith('./') || source.startsWith('../')) && importer?.includes('/src/')) {
          return fileURLToPath(new URL(source, 'file://' + importer)) + '.ts'
        }
        return null
      },
      transform(code, id) {
        if (!id.endsWith('.ts')) return null
        const esb = 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild'
        fs.writeFileSync('/tmp/ts-in.ts', code)
        const out = execFileSync(esb, ['/tmp/ts-in.ts', '--loader:.ts=ts', '--format=esm'], { encoding: 'utf8', maxBuffer: 20e6 })
        return { code: out, map: null }
      },
    },
  ],
})
const { output } = await bundle.generate({ format: 'es', entryFileNames: 'index.js' })
const chunk = output[0].code
fs.writeFileSync('/tmp/real-chunk.js', chunk)
console.log('chunk bytes:', chunk.length, 'lines:', chunk.split('\n').length)

const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\\s'](?=\s*'))\s*["'][\s;]*/gmu
const matches = [...chunk.matchAll(ESMStaticImportRe)]
console.log('regex import matches:', matches.length)
const last = matches[matches.length - 1]
const end = last.index + last[0].length
const line = chunk.slice(0, end).split('\n').length
console.log('LAST match ends line', line, JSON.stringify(last[0].slice(0, 120)))
console.log('SHIM WOULD LAND:', JSON.stringify(chunk.slice(end - 60, end + 40)))

function execFileSyncOut(cmd, args) {
  const { execFileSync } = require('node:child_process')
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 20e6 })
}
