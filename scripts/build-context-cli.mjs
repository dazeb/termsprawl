#!/usr/bin/env node
// Bundles the context CLI core into a single self-contained, plain-node-runnable
// mjs: scripts/termsprawl-context.mjs. Keeps ONE implementation (src/core TS),
// which the wrapper and the packaged-extracted copy both run. Uses Vite's
// programmatic lib build (Vite is already a devDependency) — no new dependency.
//
//   pnpm run build:cli
//
// Output is committed so `pnpm test` and packaged copies have a stable artifact.

import { build } from 'vite'
import { renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'context-cli-entry.js')
const TARGET = join(fileURLToPath(new URL('.', import.meta.url)), 'termsprawl-context.mjs')

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: true, // keep node: builtins external (real imports), not browser shims
    lib: {
      entry: 'src/core/context-cli-entry.ts',
      formats: ['es'],
      fileName: () => 'termsprawl-context'
    },
    outDir: 'scripts',
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: 'node22',
    rollupOptions: { external: [] } // inline everything except node: builtins
  }
})

// SSR lib build names the emit after the entry file; normalize to the plan name.
rmSync(TARGET, { force: true })
renameSync(OUT, TARGET)
console.log('built scripts/termsprawl-context.mjs')

