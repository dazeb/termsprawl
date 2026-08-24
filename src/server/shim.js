// termsprawl Server Edition — browser shim.
// Served at /termsprawl-shim.js. Defines `window.termsprawl` over a WebSocket
// to the server's RPC endpoint, mirroring the desktop preload API. Methods the
// server does not implement (git, cloud writes, managed accounts, agent hooks)
// resolve/reject gracefully so the renderer boots and the unsupported feature
// panels show an error state instead of crashing.
(function () {
  'use strict'
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  var url = proto + '//' + location.host + '/ws'
  var ws = null
  var seq = 0
  var pending = new Map()
  var listeners = new Map()

  function ensure() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
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
      selectFolder: function () { return Promise.resolve(null) }
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
      info: function () {
        return Promise.resolve({ original: null, modified: null, error: { code: 'NO_REPO', message: 'not available in server edition' } })
      }
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

    git: {
      snapshot: notAvailable('source control'),
      stage: notAvailable('source control'),
      unstage: notAvailable('source control'),
      discard: notAvailable('source control'),
      commit: notAvailable('source control'),
      commitMessage: notAvailable('source control'),
      createBranch: notAvailable('source control'),
      checkout: notAvailable('source control'),
      push: notAvailable('source control'),
      pull: notAvailable('source control'),
      publish: notAvailable('source control'),
      worktrees: function () { return Promise.resolve([]) },
      worktreeAdd: notAvailable('source control'),
      worktreeRemove: notAvailable('source control')
    },

    cloud: {
      status: function () { return Promise.resolve(null) },
      deviceStart: notAvailable('cloud'),
      devicePoll: notAvailable('cloud'),
      signOut: function () { return Promise.resolve() },
      backupNow: notAvailable('cloud'),
      listBackups: function () { return Promise.resolve([]) }
    }
  }
})()
