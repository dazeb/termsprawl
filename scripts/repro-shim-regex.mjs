// Repro the electron-vite esm-shim regex against the actual chunk text.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

// Use the shipped plugin's own regex, extracted verbatim.
const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\\s'](?=\s*'))\s*["'][\s;]*/gmu

// Build a chunk replica: imports at top, then the string literals our modules
// contribute (workspace:import-bundle via ipc.ts, 'import' in the error
// message via workspace-bundle.ts), with our module code at the exact
// relative position (~3089).
const chunk = `
import { shell, app, ipcMain } from 'electron'
import { join } from 'node:path'
${'// padding\n'.repeat(2000)}
const channels = { workspaceImportBundle: 'workspace:import-bundle', workspaceExportBundle: 'workspace:export-bundle' }
async function importWorkspaceBundle() {
  throw new Error('The workspace bundle has no projects to import')
}
`

const matches = [...chunk.matchAll(ESMStaticImportRe)]
console.log('matches found:', matches.length)
for (const m of matches) console.log('  at', m.index, 'end', m.index + m[0].length, JSON.stringify(m[0].slice(0, 60)))

const last = matches[matches.length - 1]
if (last) {
  const indexToAppend = last.index + last[0].length
  console.log('append at char', indexToAppend, 'of', chunk.length)
  console.log('context around append point:', JSON.stringify(chunk.slice(indexToAppend - 60, indexToAppend + 60)))
}
void fs, void execSync
