// Repro #5: prove the bogus match. Feed applyBundlePlan's ACTUAL doc comment
// (with the word ' import ') followed by code containing quotes into the
// plugin's verbatim regex — does a match END mid-string-literal?
const ESMStaticImportRe = /(?<=\s|^|;)import\s*([\s"']*(?<imports>[\p{L}\p{M}\w\t\n\r $*,/{}@.]+)from\s*)?["']\s*(?<specifier>(?<="\s*)[^"]*[^\s"](?=\s*")|(?<='\s*)[^']*[^\\s'](?=\s*'))\s*["'][\s;]*/gmu

const chunk = `import { shell } from 'electron'

// Compute the import plan for a parsed bundle. Pure: returns fresh project
// ids/names, remapped nodes, and remapped scrollback text -- the caller then
// creates projects, saves nodes, and feeds
// pendingScrollbacks to ScrollbackStore.importSnapshot.
function applyBundlePlan() {
  const fresh = typeof id === 'string' ? idMap.get(id) : undefined
}
`

const matches = [...chunk.matchAll(ESMStaticImportRe)]
console.log('matches:', matches.length)
for (const m of matches) {
  const line = chunk.slice(0, m.index).split('\n').length
  const endLine = chunk.slice(0, m.index + m[0].length).split('\n').length
  console.log(`  match lines ${line}..${endLine}:`, JSON.stringify(m[0].slice(0, 90)))
}
const last = matches[matches.length - 1]
if (last) {
  const end = last.index + last[0].length
  console.log('SHIM WOULD LAND AT (line', chunk.slice(0, end).split('\n').length + '):', JSON.stringify(chunk.slice(end - 40, end + 40)))
}
