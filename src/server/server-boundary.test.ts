import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { assertSafeServerBind, isLoopbackHost, resolveContainedPath } from './server-boundary'

describe('server boundary guards', () => {
  it('recognizes IPv4, IPv6 and localhost loopback binds', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('127.42.1.9')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('192.168.1.20')).toBe(false)
  })

  it('refuses a non-loopback plain Server Edition bind', () => {
    expect(() => assertSafeServerBind('0.0.0.0', false)).toThrow(/refusing non-loopback bind/i)
    expect(() => assertSafeServerBind('192.168.1.20', false)).toThrow(/refusing non-loopback bind/i)
  })

  it('allows loopback, and allows hosted-space binds behind the router gate', () => {
    expect(() => assertSafeServerBind('127.0.0.1', false)).not.toThrow()
    expect(() => assertSafeServerBind('::1', false)).not.toThrow()
    expect(() => assertSafeServerBind('0.0.0.0', true)).not.toThrow()
  })

  it('rejects traversal and sibling-prefix static paths', () => {
    const root = resolve('/tmp/termsprawl-renderer')
    expect(resolveContainedPath(root, 'assets/app.js')).toBe(join(root, 'assets/app.js'))
    expect(resolveContainedPath(root, '../termsprawl-renderer-evil/app.js')).toBeNull()
    expect(resolveContainedPath(root, '../../etc/passwd')).toBeNull()
  })
})
