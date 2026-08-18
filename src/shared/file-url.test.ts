import { describe, expect, it } from 'vitest'
import { FILE_PROTOCOL, fromFilePreviewUrl, toFilePreviewUrl } from './file-url'

describe('file-url', () => {
  it('round-trips an absolute path through the custom protocol', () => {
    const path = '/home/dazeb/Pictures/shot.png'
    const url = toFilePreviewUrl(path)
    expect(url.startsWith(`${FILE_PROTOCOL}://`)).toBe(true)
    expect(fromFilePreviewUrl(url)).toBe(path)
  })

  it('encodes spaces and unicode so the URL stays a single token', () => {
    const path = '/tmp/my docs/foto café.png'
    expect(fromFilePreviewUrl(toFilePreviewUrl(path))).toBe(path)
    expect(toFilePreviewUrl(path)).not.toContain(' ')
  })

  it('rejects a foreign scheme', () => {
    expect(fromFilePreviewUrl('https://example.com/x')).toBeNull()
    expect(fromFilePreviewUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects a relative or empty payload', () => {
    expect(fromFilePreviewUrl(`${FILE_PROTOCOL}://`)).toBeNull()
    expect(fromFilePreviewUrl(`${FILE_PROTOCOL}://relative/path`)).toBeNull()
  })
})
