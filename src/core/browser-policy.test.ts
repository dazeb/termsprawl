import { describe, it, expect } from 'vitest'
import { isAllowedNavUrl, isDeniedScheme, normalizeAddress, ABOUT_BLANK } from './browser-policy'

describe('isAllowedNavUrl', () => {
  it('allows plain http and https web origins', () => {
    expect(isAllowedNavUrl('https://example.com/')).toBe(true)
    expect(isAllowedNavUrl('http://example.com/')).toBe(true)
    expect(isAllowedNavUrl('https://example.com/path?q=1#frag')).toBe(true)
  })

  it('denies every privileged/execution scheme', () => {
    expect(isAllowedNavUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedNavUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedNavUrl('data:text/html,hi')).toBe(false)
    expect(isAllowedNavUrl('devtools://...')).toBe(false)
    expect(isAllowedNavUrl('chrome://settings')).toBe(false)
    expect(isAllowedNavUrl('vbscript:msgbox(1)')).toBe(false)
  })

  it('denies termsprawl-file (the app private scheme)', () => {
    expect(isAllowedNavUrl('termsprawl-file://local/x.png')).toBe(false)
  })

  it('allows only the explicit about:blank / about:srcdoc, not arbitrary about:', () => {
    expect(isAllowedNavUrl(ABOUT_BLANK)).toBe(true)
    expect(isAllowedNavUrl('about:srcdoc')).toBe(true)
    expect(isAllowedNavUrl('about:config')).toBe(false)
  })

  it('denies malformed and credential-bearing URLs', () => {
    expect(isAllowedNavUrl('not a url')).toBe(false)
    expect(isAllowedNavUrl('https://user:secret@example.com/')).toBe(false)
    expect(isAllowedNavUrl('')).toBe(false)
  })
})

describe('isDeniedScheme', () => {
  it('flags the execution schemes case-insensitively', () => {
    expect(isDeniedScheme('FILE')).toBe(true)
    expect(isDeniedScheme('javascript')).toBe(true)
    expect(isDeniedScheme('data')).toBe(true)
    expect(isDeniedScheme('https')).toBe(false) // https is allowed, not denied
  })
})

describe('normalizeAddress', () => {
  it('adds https to a bare host', () => {
    expect(normalizeAddress('example.com')).toBe('https://example.com')
    expect(normalizeAddress('example.com/path')).toBe('https://example.com/path')
  })

  it('preserves an explicit scheme', () => {
    expect(normalizeAddress('http://example.com')).toBe('http://example.com')
    expect(normalizeAddress('https://example.com:8443/x')).toBe('https://example.com:8443/x')
  })

  it('treats localhost as http', () => {
    expect(normalizeAddress('localhost')).toBe('http://localhost')
    expect(normalizeAddress('localhost:3000')).toBe('http://localhost:3000')
  })

  it('passes about:blank through and rejects blocked addresses', () => {
    expect(normalizeAddress('about:blank')).toBe(ABOUT_BLANK)
    expect(normalizeAddress('file:///etc/passwd')).toBeNull()
    expect(normalizeAddress('')).toBeNull()
    expect(normalizeAddress('   ')).toBeNull()
    expect(normalizeAddress('javascript:alert(1)')).toBeNull()
  })
})
