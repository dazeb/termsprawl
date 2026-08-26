// Pure browser-navigation policy. Electron-free so it is testable and can be
// reused by the Server Edition later. The security rule is: the embedded
// browser may only load ordinary web origins (http/https) and a blank start
// page. It must never reach privileged termsprawl schemes, device files, or
// code-execution contexts (`file:`, `termsprawl-file:`, `javascript:`,
// `data:`, `devtools:`, `chrome:`). This is the load-bearing guard for the
// browser node — see the process model in ../../AGENTS.md.

const BLOCKED_SCHEMES = [
  'file',
  'termsprawl-file',
  'javascript',
  'data',
  'devtools',
  'chrome',
  'vbscript',
  'about' // about:blank / about:srcdoc handled explicitly; anything else denied
]

export const ABOUT_BLANK = 'about:blank'

/** True when a URL may be loaded inside a browser-node guest. */
export function isAllowedNavUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'about:' && (raw === ABOUT_BLANK || raw === 'about:srcdoc')) {
    return true
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    // Only real web hosts — deny credentials-embedded URLs as a belt-and-braces
    // measure (a hijacked page should never hand the browser a user:pass@ url).
    if (url.username !== '' || url.password !== '') return false
    return true
  }
  return false
}

/** Whether a scheme is on the hard deny-list (used by the navigation filter). */
export function isDeniedScheme(protocol: string): boolean {
  return BLOCKED_SCHEMES.includes(protocol.toLowerCase())
}

/**
 * Turn a user/agent-entered address into a loadable URL, or null when it is
 * not something we will navigate to. Missing scheme → https. A bare hostname
 * (or hostname:port, or an IP) is treated as https. About blank passes
 * through. Anything that fails `isAllowedNavUrl` is rejected.
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed === 'about:blank' || trimmed === 'about:srcdoc') return trimmed
  if (trimmed === 'localhost' || trimmed.startsWith('localhost:')) {
    return 'http://' + trimmed
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : 'https://' + trimmed
  if (isAllowedNavUrl(withScheme)) return withScheme
  return null
}
