import { isAbsolute, relative, resolve, sep } from 'node:path'

export function isLoopbackHost(host: string): boolean {
  const value = String(host ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (value === 'localhost' || value === '::1') return true
  const parts = value.split('.')
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false
  const nums = parts.map(Number)
  return nums[0] === 127 && nums.every((n) => n >= 0 && n <= 255)
}

/**
 * Plain Server Edition must not be reachable off-host because the browser boot
 * endpoint serves the WS token to same-origin clients. A non-loopback bind is
 * allowed only for hosted Spaces, where the router injects the shared header
 * and the app port is not the public trust boundary.
 */
export function assertSafeServerBind(host: string, hasSpaceRouter: boolean): void {
  if (!isLoopbackHost(host) && !hasSpaceRouter) {
    throw new Error(
      `refusing non-loopback bind (${host}) without the hosted-space router gate; ` +
      'use 127.0.0.1/::1 or run behind the configured space router'
    )
  }
}

/** Resolve a renderer asset and reject traversal/sibling-prefix escapes. */
export function resolveContainedPath(root: string, requestedPath: string): string | null {
  const rootPath = resolve(root)
  const candidate = resolve(rootPath, requestedPath)
  const rel = relative(rootPath, candidate)
  if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) {
    return candidate
  }
  return null
}
