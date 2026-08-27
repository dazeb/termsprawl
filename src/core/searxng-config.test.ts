import { describe, expect, it } from 'vitest'
import {
  generateSearxngSettings,
  generateSecretKey,
  pickFreePort,
  searxngHealthUrl,
  SEARXNG_PORT_RANGE
} from './searxng-config'
import { createServer } from 'node:net'

describe('searxng-config', () => {
  it('generates a settings.yml with the hardened loopback shape', () => {
    const yaml = generateSearxngSettings(54321, 'a'.repeat(64))
    expect(yaml).toContain('bind_address: 127.0.0.1')
    expect(yaml).toContain('port: 54321')
    expect(yaml).toContain('secret_key: "aaaaaaaa')
    expect(yaml).toContain('limiter: true')
    expect(yaml).toContain('public_instance: false')
    expect(yaml).toContain('use_default_settings: true')
    expect(yaml).toContain('formats:')
    expect(yaml).toContain('- html')
    expect(yaml).toContain('- json')
    expect(yaml).toContain('url: false')
    expect(yaml).not.toContain('undefined')
  })

  it('rejects out-of-range ports', () => {
    expect(() => generateSearxngSettings(1024, 'k')).toThrow(/port/i)
    expect(() => generateSearxngSettings(70000, 'k')).toThrow(/port/i)
    expect(() => generateSearxngSettings(12345.5, 'k')).toThrow(/port/i)
  })

  it('rejects a too-short secret key', () => {
    expect(() => generateSearxngSettings(54321, 'short')).toThrow(/secret/i)
  })

  it('generates a strong random hex secret key, unique per call', () => {
    const a = generateSecretKey()
    const b = generateSecretKey()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('picks a free high port within the range', async () => {
    const port = await pickFreePort()
    expect(port).toBeGreaterThanOrEqual(SEARXNG_PORT_RANGE.min)
    expect(port).toBeLessThanOrEqual(SEARXNG_PORT_RANGE.max)
    // The port must actually be bindable.
    await new Promise<void>((resolve, reject) => {
      const srv = createServer()
      srv.once('error', reject)
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve()))
    })
  })

  it('builds the health URL for the port', () => {
    expect(searxngHealthUrl(18888)).toBe('http://127.0.0.1:18888/healthz')
  })
})
