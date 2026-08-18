// Custom protocol used to preview local images in the renderer without
// granting the page a file:// hole. Main registers `termsprawl-file` and
// maps URLs produced here back to absolute paths.
//
// Shape: termsprawl-file://local/<absolute/path>  (each segment encoded)
// The dummy host `local` is required so Chromium treats this as a standard URL.

export const FILE_PROTOCOL = 'termsprawl-file'

/** Build a preview URL for an absolute filesystem path. */
export function toFilePreviewUrl(absPath: string): string {
  const encoded = absPath.split('/').map(encodeURIComponent).join('/')
  return `${FILE_PROTOCOL}://local${encoded}`
}

/** Recover the absolute path, or null if the URL is not ours / not absolute. */
export function fromFilePreviewUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${FILE_PROTOCOL}:`) return null
    if (parsed.hostname !== 'local') return null
    const path = decodeURIComponent(parsed.pathname)
    if (!path.startsWith('/')) return null
    return path
  } catch {
    return null
  }
}
