// termsprawl Server Edition — browser shim.
// Served at /termsprawl-shim.js. Defines `window.termsprawl` over a WebSocket
// to the server's RPC endpoint, mirroring the desktop preload API. Methods the
// server does not implement (git, cloud writes, managed accounts, agent hooks)
// resolve/reject gracefully so the renderer boots and the unsupported feature
// panels show an error state instead of crashing.
(function () {
  'use strict'
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  // Audit B1: the WS upgrade must carry the boot token (header when possible,
  // ?token= fallback). The token is bootstrapped into the served page by the
  // server itself and persisted so reconnects still authenticate.
  var TOKEN = (function () {
    try {
      if (window.__TERMPRAWL_WS_TOKEN) {
        localStorage.setItem('termsprawl-ws-token', window.__TERMPRAWL_WS_TOKEN)
        return window.__TERMPRAWL_WS_TOKEN
      }
      return localStorage.getItem('termsprawl-ws-token') || ''
    } catch (e) { return window.__TERMPRAWL_WS_TOKEN || '' }
  })()
  var url = proto + '//' + location.host + '/ws' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '')
  var ws = null
  var seq = 0
  var pending = new Map()
  var listeners = new Map()

  function ensure() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    // Browser WebSocket cannot set Authorization headers; the token rides on
    // the upgrade URL (?token=) — see server-auth.ts. Browsers do NOT leak
    // query strings for ws:// to servers' logs the way http proxies can, and
    // this is loopback by default.
    ws = new WebSocket(url)
    ws.addEventListener('message', function (ev) {
      var msg
      try { msg = JSON.parse(ev.data) } catch (e) { return }
      if (!msg || typeof msg !== 'object') return
      if (msg.t === 'res') {
        var p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error || 'rpc error'))
      } else if (msg.t === 'evt') {
        var arr = listeners.get(msg.channel)
        if (arr) for (var i = 0; i < arr.length; i++) arr[i](msg.payload)
      }
    })
    ws.addEventListener('close', function () {
      pending.forEach(function (p) { p.reject(new Error('disconnected')) })
      pending.clear()
      setTimeout(ensure, 500)
    })
  }

  function invoke(method, args) {
    ensure()
    return new Promise(function (resolve, reject) {
      var id = ++seq
      pending.set(id, { resolve: resolve, reject: reject })
      var payload = JSON.stringify({ t: 'req', id: id, method: method, args: args || [] })
      if (ws.readyState === WebSocket.OPEN) ws.send(payload)
      else ws.addEventListener('open', function () { ws.send(payload) }, { once: true })
    })
  }

  function send(method, args) {
    ensure()
    var payload = JSON.stringify({ t: 'send', method: method, args: args || [] })
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
    else ws.addEventListener('open', function () { ws.send(payload) }, { once: true })
  }

  function on(channel, cb) {
    var arr = listeners.get(channel)
    if (!arr) { arr = []; listeners.set(channel, arr) }
    arr.push(cb)
    return function () {
      var a = listeners.get(channel)
      if (a) { var i = a.indexOf(cb); if (i >= 0) a.splice(i, 1) }
    }
  }

  function notAvailable(what) {
    return function () { return Promise.reject(new Error(what + ' not available in server edition')) }
  }

  window.termsprawl = {
    appVersion: function () { return invoke('app:version') },
    openExternal: function (url) {
      window.open(url, '_blank')
      return Promise.resolve()
    },

    settings: {
      get: function () { return invoke('app:settings-get') },
      set: function (patch) { return invoke('app:settings-set', [patch]) },
      createAccount: notAvailable('managed accounts'),
      deleteAccount: notAvailable('managed accounts'),
      permissionSupported: function () { return Promise.resolve(false) },
      loginCommand: function () { return Promise.resolve('') }
    },

    updates: {
      check: function () { return invoke('update:check') },
      download: function () { return invoke('update:download') },
      install: function () { return invoke('update:install') },
      dismiss: function () { return invoke('update:dismiss') },
      onStatus: function (cb) { return on('update:status', cb) }
    },

    announcements: { get: function () { return invoke('announcement:get') } },

    workspace: {
      snapshot: function () { return invoke('workspace:snapshot') },
      saveNodes: function (id, nodes) { return invoke('workspace:save-nodes', [id, nodes]) },
      addProject: function (name, cwd, remote) { return invoke('project:add', [name, cwd, remote]) },
      closeProject: function (id) { return invoke('project:close', [id]) },
      archiveProject: function (id) { return invoke('project:archive', [id]) },
      reopenProject: function (id) { return invoke('project:reopen', [id]) },
      deleteProject: function (id) { return invoke('project:delete', [id]) },
      updateSettings: function (id, patch) { return invoke('project:update-settings', [id, patch]) },
      renameProject: function (id, name) { return invoke('project:rename', [id, name]) },
      // No native folder picker in a browser: show a small in-page modal to
      // enter the directory ON THE SERVER HOST where the project's terminals
      // will run. Returns the trimmed path, or null when cancelled.
      selectFolder: function () {
        return new Promise(function (resolve) {
          var overlay = document.createElement('div')
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999'
          var box = document.createElement('div')
          box.style.cssText = 'background:#0e0e10;border:1px solid #333;border-radius:8px;padding:16px;width:min(420px,90vw);color:#e6e6e6;font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif'
          var title = document.createElement('div')
          title.textContent = 'New folder project'
          title.style.cssText = 'font-weight:600;margin-bottom:8px'
          var hint = document.createElement('div')
          hint.textContent = 'Directory on the server host where this project\u2019s terminals will run.'
          hint.style.cssText = 'color:#8a8a8a;margin-bottom:10px;font-size:12px'
          var input = document.createElement('input')
          input.type = 'text'
          input.placeholder = '/home/user/project'
          input.style.cssText = 'width:100%;background:#161619;border:1px solid #333;border-radius:6px;color:#e6e6e6;padding:8px 10px;box-sizing:border-box'
          var row = document.createElement('div')
          row.style.cssText = 'margin-top:12px;display:flex;gap:8px;justify-content:flex-end'
          var cancel = document.createElement('button')
          cancel.textContent = 'Cancel'
          cancel.style.cssText = 'background:transparent;border:1px solid #333;color:#8a8a8a;border-radius:6px;padding:6px 12px;cursor:pointer'
          var open = document.createElement('button')
          open.textContent = 'Open'
          open.style.cssText = 'background:#c6f135;color:#0e0e10;font-weight:600;border:0;border-radius:6px;padding:6px 12px;cursor:pointer'
          function done(v) { if (overlay.parentNode) document.body.removeChild(overlay); resolve(v) }
          function submit() { done(input.value.trim() || null) }
          open.addEventListener('click', submit)
          cancel.addEventListener('click', function () { done(null) })
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit() })
          row.appendChild(cancel)
          row.appendChild(open)
          box.appendChild(title)
          box.appendChild(hint)
          box.appendChild(input)
          box.appendChild(row)
          overlay.appendChild(box)
          document.body.appendChild(overlay)
          input.focus()
        })
      }
    },

    pty: {
      create: function (req) { return invoke('pty:create', [req]) },
      write: function (id, data) { send('pty:write', [id, data]) },
      resize: function (id, cols, rows) { send('pty:resize', [id, cols, rows]) },
      destroy: function (id) { return invoke('pty:destroy', [id]) },
      closeNode: function (projectId, id) { return invoke('terminal:close', [projectId, id]) },
      readScrollback: function (id) { return invoke('pty:read-scrollback', [id]) },
      onData: function (id, cb) { return on('pty:data:' + id, cb) },
      onExit: function (id, cb) { return on('pty:exit:' + id, cb) }
    },

    diff: {
      info: function (path, base) { return invoke('diff:info', [path, base]) }
    },

    files: {
      openDialog: function () { return Promise.resolve(null) },
      read: function (path) { return invoke('file:read', [path]) },
      write: function (path, content) { return invoke('file:write', [path, content]) },
      list: function (root, rel) { return invoke('file:list', [root, rel]) }
    },

    agent: {
      onStatus: function (sid, cb) { return on('agent:status:' + sid, cb) },
      onSessionName: function (sid, cb) { return on('agent:session-name:' + sid, cb) }
    },

    contextLinks: {
      list: function () { return Promise.resolve({ ok: true, links: [] }) },
      add: function () { return Promise.resolve({ ok: false, error: 'NO_FOLDER' }) },
      remove: function () { return Promise.resolve({ ok: false, error: 'NO_FOLDER' }) }
    },

    // Browser nodes are Electron-only (<webview> guests) — the Server Edition
    // has no embedded browser, so every method is a safe no-op/rejection. The
    // desktop preload always exposes `browser`, so the renderer (Canvas.tsx
    // subscribes to browser.onAgentOpen on mount) would otherwise throw
    // "Cannot read properties of undefined (reading 'onAgentOpen')" and blank
    // the whole canvas. Provide the same top-level shape so the renderer boots.
    browser: {
      cdpInfo: function () { return Promise.reject(new Error('browser nodes not available in server edition')) },
      register: function () { return Promise.resolve() },
      unregister: function () { return Promise.resolve() },
      navigate: function () { return Promise.resolve({ ok: false, reason: 'DENIED' }) },
      // No agent-control server runs here, so this never fires; return a working
      // unsubscribe so Canvas's effect cleanup is valid.
      onAgentOpen: function () { return function () {} },
      offAgentOpen: function () { return function () {} }
    },

    // Chat driver v2 (Phase 11 Task 11.4): the server runs the same core chat
    // runtime (handlers.ts), so this is a real implementation, not a stub —
    // events stream on the chat:event:<nodeId> broadcast channel.
    chat: {
      send: function (req) { return invoke('chat:send', [req]) },
      stop: function (nodeId) { return invoke('chat:stop', [nodeId]) },
      approve: function (nodeId, callId, decision) { return invoke('chat:approve', [nodeId, callId, decision]) },
      onEvent: function (nodeId, cb) { return on('chat:event:' + nodeId, cb) }
    },
    // Relay seam (audit B7): the server routes relay:connect/disconnect/status
    // through the same RPC surface; frames stream on the relay:frame channel.
    relay: {
      status: function () { return invoke('relay:status') },
      connect: function () { return invoke('relay:connect') },
      disconnect: function () { return invoke('relay:disconnect') },
      onStatus: function (cb) { return on('relay:status', cb) },
      onFrame: function (cb) { return on('relay:frame', cb) }
    },

    git: {
      snapshot: function (target) { return invoke('git:snapshot', [target]) },
      stage: function (target, paths) { return invoke('git:stage', [target, paths]) },
      unstage: function (target, paths) { return invoke('git:unstage', [target, paths]) },
      discard: function (target, paths) { return invoke('git:discard', [target, paths]) },
      commit: function (target, message) { return invoke('git:commit', [target, message]) },
      commitMessage: function (target) { return invoke('git:commit-message', [target]) },
      createBranch: function (target, name) { return invoke('git:branch-create', [target, name]) },
      checkout: function (target, name) { return invoke('git:branch-checkout', [target, name]) },
      push: function (target) { return invoke('git:push', [target]) },
      pull: function (target) { return invoke('git:pull', [target]) },
      publish: function (target) { return invoke('git:publish', [target]) },
      worktrees: function (target) { return invoke('git:worktrees', [target]) },
      worktreeAdd: function (target, path, branch) { return invoke('git:worktree-add', [target, path, branch]) },
      worktreeRemove: function (target, path, force) { return invoke('git:worktree-remove', [target, path, force]) }
    },

    cloud: {
      status: function () { return Promise.resolve(null) },
      deviceStart: notAvailable('cloud'),
      devicePoll: notAvailable('cloud'),
      signOut: function () { return Promise.resolve() },
      backupNow: notAvailable('cloud'),
      listBackups: function () { return Promise.resolve([]) },
      spaceStatus: function () { return Promise.resolve(null) },
      openSpace: notAvailable('cloud')
    }
  }
})()
