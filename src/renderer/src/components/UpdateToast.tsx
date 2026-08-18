import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/update-status'

export function UpdateToast(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' })

  useEffect(() => {
    return window.termsprawl.updates.onStatus(setStatus)
  }, [])

  if (status.phase === 'idle') return null

  const version = status.version ? `v${status.version}` : 'an update'
  let body = `Update ${version} available`
  if (status.phase === 'downloading') {
    body = `Downloading ${version}… ${status.percent ?? 0}%`
  } else if (status.phase === 'ready') {
    body = `${version} is ready — restart to install`
  } else if (status.phase === 'error') {
    body = status.message ? `Update failed: ${status.message}` : 'Update check failed'
  }

  return (
    <div className="update-toast" role="status">
      <span>{body}</span>
      <div className="update-toast-actions">
        {status.phase === 'available' && (
          <button type="button" onClick={() => void window.termsprawl.updates.download()}>
            download
          </button>
        )}
        {status.phase === 'ready' && (
          <button type="button" onClick={() => void window.termsprawl.updates.install()}>
            restart
          </button>
        )}
        <button
          type="button"
          className="update-toast-dismiss"
          onClick={() => void window.termsprawl.updates.dismiss()}
          aria-label="Dismiss update notice"
        >
          ×
        </button>
      </div>
    </div>
  )
}
