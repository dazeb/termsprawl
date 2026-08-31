// Repro #6: the doc comment says 'creates projects (workspace:import/add)'.
// After rollup, the JSDoc becomes a comment INSIDE the chunk. But rollup
// STRIPS comments? With our vite config, comments are preserved (minify
// false + legalComments). The regex lookbehind accepts ' ' before 'import'
// — inside a /* */ or // comment! Try the EXACT comment text from the
// committed file including 'workspace:import/add':
const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\\s'](?=\s*'))\s*["'][\s;]*/gmu

const chunk = `import { shell } from 'electron'

// Compute the import plan for a parsed bundle. Pure: returns fresh project
// ids/names, remapped nodes, and remapped scrollback text -- the caller then
// creates projects (workspace:import/add), saves nodes, and feeds
// pendingScrollbacks to ScrollbackStore.importSnapshot.
function applyBundlePlan() {
  const fresh = typeof id === 'string' ? idMap.get(id) : undefined
}
`

const matches = [...chunk.matchAll(ESMStaticImportRe)]
console.log('matches:', matches.length)
for (const m of matches) {
  const startLine = chunk.slice(0, m.index).split('\n').length
  const endLine = chunk.slice(0, m.index + m[0].length).split('\n').length
  console.log(`  match lines ${startLine}..${endLine}:`, JSON.stringify(m[0].slice(0, 120)))
}
const last = matches[matches.length - 1]
const end = last.index + last[0].length
console.log('SHIM LANDS AT line', chunk.slice(0, end).split('\n').length, 'context:', JSON.stringify(chunk.slice(end - 50, end + 50)))
