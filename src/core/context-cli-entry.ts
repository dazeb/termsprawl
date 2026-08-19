// CLI entry (Task 7.5). Thin binding: argv -> core logic -> exit code.
// Bundled into scripts/termsprawl-context.mjs by scripts/build-context-cli.mjs
// so the shipped wrapper is exactly this one implementation, runnable by plain node.
// Never used by the app; only by the standalone `termsprawl-context` host command.

import { parseContextArgs, runContextCli, createRealContextIO } from './context-cli'

const argv = process.argv.slice(2)
const parsed = parseContextArgs(argv)
if ('error' in parsed) {
  console.error(`termsprawl-context: ${parsed.error}`)
  process.exit(2)
}
process.exit(runContextCli(parsed, createRealContextIO(parsed.cwd)))
