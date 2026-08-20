// Source control panel (Phase 8, Task 8.2). Shows the active folder project's
// git status, lets the user stage/unstage/discard files, commit, manage
// branches, and push/pull/publish. Talks to core only via window.termsprawl.git.

import { useCallback, useEffect, useState } from 'react'
import type { GitFileChange, GitPanelSnapshot, GitResult, GitWorktree } from '@shared/types'
import { HelpBadge } from './HelpBadge'

interface SourceControlPanelProps {
  cwd: string
  onClose: () => void
}

export function SourceControlPanel({ cwd, onClose }: SourceControlPanelProps): React.JSX.Element {
  const [snap, setSnap] = useState<GitPanelSnapshot | null>(null)
  const [msg, setMsg] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [newWtName, setNewWtName] = useState('')
  const [newWtBranch, setNewWtBranch] = useState('')
  const [confirmRemoveWt, setConfirmRemoveWt] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [next, wt] = await Promise.all([
      window.termsprawl.git.snapshot(cwd),
      window.termsprawl.git.worktrees(cwd)
    ])
    setSnap(next)
    setWorktrees(wt)
  }, [cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (op: () => Promise<GitResult>, okMsg: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await op()
    setBusy(false)
    if (res.code !== 0) {
      setError(res.stderr.trim() || 'git command failed')
      return
    }
    setStatus(okMsg)
    void refresh()
  }

  const toggleStage = (change: GitFileChange): void => {
    void run(
      () => (change.staged ? window.termsprawl.git.unstage(cwd, [change.path]) : window.termsprawl.git.stage(cwd, [change.path])),
      change.staged ? 'unstaged' : 'staged'
    )
  }

  const discard = (path: string): void => {
    void run(() => window.termsprawl.git.discard(cwd, [path]), 'discarded')
    setConfirmDiscard(null)
  }

  const commit = (): void => {
    const text = msg.trim()
    if (!text) return
    void run(() => window.termsprawl.git.commit(cwd, text), 'committed')
    setMsg('')
  }

  const createWorktree = (): void => {
    const name = newWtName.trim()
    if (!name) return
    const branch = newWtBranch.trim() || undefined
    void run(() => window.termsprawl.git.worktreeAdd(cwd, name, branch), 'worktree created')
    setNewWtName('')
    setNewWtBranch('')
  }

  // Destructive: force-removes the worktree (and its uncommitted changes) after
  // the inline confirm.
  const removeWorktreeAt = (path: string): void => {
    void run(() => window.termsprawl.git.worktreeRemove(cwd, path, true), 'worktree removed')
    setConfirmRemoveWt(null)
  }

  const ghNeedsAuth = !!snap?.remote?.includes('github.com') && snap.ghAuthed === false

  return (
    <div className="source-control">
      <div className="source-control-head">
        <span className="source-control-title">
          source control
          <HelpBadge
            label="about source control"
            text="Shows the active folder project's git state. Stage/unstage files, discard working-tree edits, commit, switch branches, and push or pull. git runs via system git in the project folder — works with any remote, GitHub or Gitea."
          />
        </span>
        <button className="source-control-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {error && <p className="source-control-error">{error}</p>}
      {status && <p className="source-control-status">{status}</p>}
      {ghNeedsAuth && (
        <p className="source-control-gh">pushing to GitHub needs you logged in: run gh auth login</p>
      )}
      {busy && <p className="source-control-status">working…</p>}

      {!snap ? (
        <p className="source-control-empty">loading…</p>
      ) : snap.branch === '' ? (
        <p className="source-control-empty">not a git repository</p>
      ) : (
        <div className="source-control-body">
          <div className="source-control-branchbar">
            <span className="source-control-branch">
              {snap.branch}
              {snap.sync.upstream && (
                <span className="source-control-sync">
                  {snap.sync.ahead > 0 ? `↑${snap.sync.ahead}` : ''}
                  {snap.sync.behind > 0 ? `↓${snap.sync.behind}` : ''}
                </span>
              )}
            </span>
            <button onClick={() => void run(() => window.termsprawl.git.push(cwd), 'pushed')}>push</button>
            <button onClick={() => void run(() => window.termsprawl.git.pull(cwd), 'pulled')}>pull</button>
            {!snap.sync.upstream && (
              <button onClick={() => void run(() => window.termsprawl.git.publish(cwd), 'published')}>
                publish
              </button>
            )}
          </div>

          <div className="source-control-files">
            {snap.changes.length === 0 && <p className="source-control-empty">no changes</p>}
            {snap.changes.map((change) => (
              <div key={change.path} className={`git-file git-file-${change.status}`}>
                <span className="git-file-status">{statusLetter(change)}</span>
                <span className="git-file-path" title={change.path}>
                  {change.path}
                </span>
                <button
                  className="git-file-action"
                  onClick={() => toggleStage(change)}
                  title={change.staged ? 'unstage' : 'stage'}
                >
                  {change.staged ? '−' : '+'}
                </button>
                {confirmDiscard === change.path ? (
                  <span className="git-file-confirm">
                    <button className="danger" onClick={() => discard(change.path)}>
                      discard?
                    </button>
                    <button onClick={() => setConfirmDiscard(null)}>keep</button>
                  </span>
                ) : (
                  <button
                    className="git-file-action git-file-discard"
                    title="discard working-tree changes"
                    onClick={() => setConfirmDiscard(change.path)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="source-control-commit">
            <input
              className="source-control-msg"
              value={msg}
              placeholder="commit message"
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
              }}
            />
            <button disabled={!msg.trim()} onClick={commit}>
              commit
            </button>
          </div>

          <div className="source-control-branches">
            <div className="source-control-subtitle">branches</div>
            {snap.branches.map((b) => (
              <div key={b.name} className="source-control-branchrow">
                <button
                  className="source-control-branchpick"
                  disabled={b.current}
                  onClick={() => void run(() => window.termsprawl.git.checkout(cwd, b.name), 'switched')}
                >
                  {b.current ? '● ' : ''}
                  {b.name}
                </button>
              </div>
            ))}
            <div className="source-control-newbranch">
              <input
                className="source-control-msg"
                value={newBranch}
                placeholder="new branch name"
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newBranch.trim()) {
                    void run(() => window.termsprawl.git.createBranch(cwd, newBranch.trim()), 'branch created')
                    setNewBranch('')
                  }
                }}
              />
              <button
                disabled={!newBranch.trim()}
                onClick={() => {
                  void run(() => window.termsprawl.git.createBranch(cwd, newBranch.trim()), 'branch created')
                  setNewBranch('')
                }}
              >
                create
              </button>
                            </div>
                          </div>

                          <div className="source-control-worktrees">
                            <div className="source-control-subtitle">worktrees</div>
                            {worktrees.map((w) => (
                              <div key={w.path} className="source-control-wtrow">
                                <span className="source-control-wtpath" title={w.path}>
                                  {w.path === cwd ? '● ' : ''}
                                  {basenameOf(w.path)}
                                </span>
                                <span className="source-control-wtbranch">{w.branch ?? 'detached'}</span>
                                {w.path !== cwd &&
                                  (confirmRemoveWt === w.path ? (
                                    <span className="git-file-confirm">
                                      <span className="account-confirm-text">
                                        removes this worktree (discards its changes)
                                      </span>
                                      <button className="danger" onClick={() => removeWorktreeAt(w.path)}>
                                        confirm
                                      </button>
                                      <button onClick={() => setConfirmRemoveWt(null)}>keep</button>
                                    </span>
                                  ) : (
                                    <button
                                      className="git-file-action git-file-discard"
                                      title="remove worktree"
                                      onClick={() => setConfirmRemoveWt(w.path)}
                                    >
                                      ✕
                                    </button>
                                  ))}
                              </div>
                            ))}
                            <div className="source-control-commit">
                              <input
                                className="source-control-msg"
                                value={newWtName}
                                placeholder="worktree name"
                                onChange={(event) => setNewWtName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') createWorktree()
                                }}
                              />
                              <input
                                className="source-control-msg"
                                value={newWtBranch}
                                placeholder="branch (optional)"
                                onChange={(event) => setNewWtBranch(event.target.value)}
                              />
                              <button disabled={!newWtName.trim()} onClick={createWorktree}>
                                create
                              </button>
                            </div>
                          </div>
                        </div>
                    )}
    </div>
  )
}

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : path
}

function statusLetter(change: GitFileChange): string {
  switch (change.status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return '?'
    default:
      return 'M'
  }
}
