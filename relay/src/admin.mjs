// Admin API: health, authenticated metrics, invite revocation, user removal.
// Everything except /healthz requires `Authorization: Bearer <adminToken>`.
import { StoreError, revokeInvite } from './store.mjs'

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function authorized(req, adminToken) {
  const header = req.headers.authorization ?? ''
  const m = /^Bearer\s+(.+)$/.exec(header)
  return Boolean(adminToken) && m && m[1] === adminToken
}

/**
 * createAdminHandler({ store, hub, adminToken }) → (req, res).
 * Routes:
 *   GET    /healthz                     → 200 {ok:true}            (no auth)
 *   GET    /admin/stats                 → hub.stats() + store counts
 *   POST   /admin/invites/:code/revoke  → revoke an invite
 *   DELETE /admin/users/:login          → remove user + their invites
 */
export function createAdminHandler({ store, hub, adminToken }) {
  return function adminHandler(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const p = url.pathname

    if (req.method === 'GET' && p === '/healthz') {
      return json(res, 200, { ok: true })
    }

    if (!p.startsWith('/admin/')) return json(res, 404, { error: 'NOT-FOUND' })

    if (!authorized(req, adminToken)) {
      return json(res, 401, { error: 'UNAUTHORIZED' })
    }

    if (req.method === 'GET' && p === '/admin/stats') {
      const stats = hub.stats()
      stats.users = store.users.length
      stats.invitesTotal = store.invites.length
      return json(res, 200, stats)
    }

    const revokeMatch = /^\/admin\/invites\/([^/]+)\/revoke$/.exec(p)
    if (req.method === 'POST' && revokeMatch) {
      const code = decodeURIComponent(revokeMatch[1])
      try {
        const invite = revokeInvite(store, code)
        return json(res, 200, { ok: true, code: invite.code, revoked: true })
      } catch (err) {
        if (err instanceof StoreError && err.code === 'UNKNOWN') {
          return json(res, 404, { error: 'UNKNOWN' })
        }
        throw err
      }
    }

    const userMatch = /^\/admin\/users\/([^/]+)$/.exec(p)
    if (req.method === 'DELETE' && userMatch) {
      const login = decodeURIComponent(userMatch[1])
      const idx = store.users.findIndex((u) => u.login === login)
      if (idx === -1) return json(res, 404, { error: 'UNKNOWN' })
      store.users.splice(idx, 1)
      let removedInvites = 0
      for (let i = store.invites.length - 1; i >= 0; i--) {
        if (store.invites[i].hostLogin === login) {
          store.invites.splice(i, 1)
          removedInvites++
        }
      }
      return json(res, 200, { ok: true, removed: login, removedInvites })
    }

    return json(res, 404, { error: 'NOT-FOUND' })
  }
}
