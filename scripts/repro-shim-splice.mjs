// Repro the EXACT failing pipeline: take the real esm bundle of main (esbuild
// output), run electron-vite's shim splice (their regex verbatim), then run
// esbuild-transpile on the result — print where the shim landed.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const esb = 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild'
execSync(`${esb} src/main/index.ts --loader:.ts=ts --format=esm --target=node22 > /tmp/chunk.js 2>/dev/null`)
const code = fs.readFileSync('/tmp/chunk.js', 'utf8')

const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\\s'](?=\s*'))\s*["'][\s;]*/gmu
const CJSShim_node_20_11 = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`

const matches = [...code.matchAll(ESMStaticImportRe)]
console.log('import matches:', matches.length)
const last = matches[matches.length - 1]
const indexToAppend = last.index + last[0].length
console.log('last match:', JSON.stringify(last[0].slice(0, 70)))
console.log('append index:', indexToAppend, 'chunk length:', code.length)
console.log('context BEFORE:', JSON.stringify(code.slice(indexToAppend - 80, indexToAppend)))
console.log('context AFTER:', JSON.stringify(code.slice(indexToAppend, indexToAppend + 60)))

const spliced = code.slice(0, indexToAppend) + CJSShim_node_20_11 + code.slice(indexToAppend)
fs.writeFileSync('/tmp/spliced.js', spliced)

// Now esbuild-transpile the spliced chunk (vite:esbuild-transpile does
// transform with format esm, target node22):
try {
  execSync(`${esb} /tmp/spliced.js --loader:.js=js --format=esm --target=node22 > /tmp/spliced-out.js 2>/tmp/spliced-err.log`)
  console.log('transpile of spliced: OK')
} catch {
  console.log('transpile of spliced FAILED:', fs.readFileSync('/tmp/spliced-err.log', 'utf8').slice(0, 400))
}
