import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@reactflow/node-resizer'
import type { NodeProps } from 'reactflow'
import { nodeTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import type { ChatNodeData } from '../state/workspace'
import { HelpBadge } from '../components/HelpBadge'
import type { ChatEvent, ChatToolCall } from '../../../core/chat/types'
import { conversationCost, type ModelPrice } from '../../../core/chat/cost'

type ChatMsg = ChatNodeData['messages'][number]

// Phase 11 Task 11.4 — SDK chat node (not a PTY): streaming replies with
// thinking blocks, a token chip, slash commands (/clear /model /system /cost),
// and a stop button. Streaming accumulates in LOCAL state (functional updates
// — stream events can outrun React Flow re-renders); the transcript is written
// into node data when a turn completes, so it persists with the project file.
// All provider work happens in main via window.termsprawl.chat.
export function ChatNode({ id, data, selected }: NodeProps<ChatNodeData>): React.JSX.Element {
  const { updateNodeData, closeNode } = useCanvas()
  const [messages, setMessages] = useState<ChatMsg[]>(data.messages ?? [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const streamingMsgId = useRef<string | null>(null)
  const systemRef = useRef(data.system)
  /** Text of the last non-slash send, for the error retry button (audit F4). */
  const lastSendRef = useRef<string | null>(null)
  // Per-model price overrides for the cost chip (audit B4) — settings are
  // local-only and cheap to read once per node mount.
  const [prices, setPrices] = useState<Record<string, ModelPrice>>({})
  // Enter behavior while busy (General → Preferences): what Enter does when a
  // turn is already streaming — queue it, send immediately (stop+send), or
  // do nothing until the turn ends. Default 'queue'.
  const [enterBehavior, setEnterBehavior] = useState<'queue' | 'send' | 'prompt'>('queue')
  useEffect(() => {
    let alive = true
    void window.termsprawl.settings.get().then((s) => {
      if (!alive) return
      if (s.chat?.priceOverrides) setPrices(s.chat.priceOverrides)
      if (s.enterBehavior === 'queue' || s.enterBehavior === 'send' || s.enterBehavior === 'prompt') {
        setEnterBehavior(s.enterBehavior)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  /** Push the current local transcript into node data (persistence). */
  const commitMessages = (msgs: ChatMsg[], record = false): void => {
    updateNodeData(id, { messages: msgs }, record)
  }

  // Subscribe to the per-node push channel while mounted. Functional updates
  // keep every event applying to the latest transcript.
  useEffect(() => {
    return window.termsprawl.chat.onEvent(id, (ev: ChatEvent) => {
      setMessages((prev) => {
        let next = prev
        const ensureAssistant = (): ChatMsg[] => {
          if (streamingMsgId.current) return next
          const mid = crypto.randomUUID()
          streamingMsgId.current = mid
          next = [...next, { id: mid, role: 'assistant', content: '', ts: Date.now() }]
          return next
        }
        if (ev.kind === 'delta' || ev.kind === 'thinking') {
          ensureAssistant()
          const mid = streamingMsgId.current as string
          next = next.map((m) => {
            if (m.id !== mid) return m
            if (ev.kind === 'delta') return { ...m, content: m.content + ev.text }
            return { ...m, thinking: (m.thinking ?? '') + ev.text }
          })
        } else if (ev.kind === 'usage') {
          ensureAssistant()
          const mid = streamingMsgId.current as string
          next = next.map((m) =>
            m.id === mid
              ? {
                  ...m,
                  usage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens },
                  ...(ev.model ? { model: ev.model } : {})
                }
              : m
          )
        } else if (ev.kind === 'toolCall') {
          ensureAssistant()
          const mid = streamingMsgId.current as string
          next = next.map((m) => {
            if (m.id !== mid) return m
            // Dedupe re-broadcasts (the approval hook re-emits the same call).
            const calls = m.toolCalls ?? []
            if (calls.some((c) => c.id === ev.call.id)) return m
            return { ...m, toolCalls: [...calls, { ...ev.call, status: 'running' }] }
          })
        } else if (ev.kind === 'toolResult') {
          // The loop executed the tool (approved + run). Resolve the card.
          next = next.map((m) => {
            if (!m.toolCalls?.some((c) => c.id === ev.call.id)) return m
            return {
              ...m,
              toolCalls: m.toolCalls.map((c) =>
                c.id === ev.call.id
                  ? { ...c, result: ev.call.result, isError: ev.call.isError, status: ev.call.status }
                  : c
              )
            }
          })
        } else if (ev.kind === 'context-added') {
          // A node link (Phase 18) injected context. Commit it straight to node
          // data (no streaming assistant involved) so it persists with history.
          if (!next.some((m) => m.id === ev.messageId)) {
            next = [...next, { id: ev.messageId, role: ev.role, content: ev.content, ts: Date.now() }]
            commitMessages(next, false)
            // The conversation changed — schedule auto links sourcing this node.
            void window.termsprawl.links.markDirty(id).catch(() => {})
          }
        } else if (ev.kind === 'done') {
          const stopped = ev.reason === 'stopped'
          const mid = streamingMsgId.current
          if (mid) {
            next = next.map((m) => (m.id === mid ? { ...m, stopped: stopped || undefined } : m))
          }
          streamingMsgId.current = null
          setBusy(false)
          // persist the completed transcript (one undo record per turn)
          commitMessages(next, true)
        }
        return next
      })
    })
    // subscribe once per node; handlers read no stale props (all state via
    // functional updates + refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Scroll-follow (audit F4): pin to the bottom ONLY while the user is
  // already there. Scrolling up to read history is no longer yanked back on
  // the next token; any scroll back to the bottom re-arms following.
  const followRef = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = (): void => {
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  })

  const send = (): void => {
    // Enter behavior while busy (settings → General): the setting governs what
    // Enter does when a turn is already streaming. 'send' stops the current
    // turn first so the new message goes immediately; 'prompt' refuses until
    // the turn ends (a note tells the user why); 'queue' (default) keeps the
    // current behavior — the message is sent and the runtime serializes turns.
    if (busy) {
      if (enterBehavior === 'prompt') {
        setError('waiting for the current reply — press stop to interrupt')
        return
      }
      if (enterBehavior === 'send') {
        void window.termsprawl.chat.stop(id)
      }
      // 'queue': fall through and send now.
    }
    sendText(input.trim())
  }

  /** Core send path (audit F4): takes the text explicitly so retry can call
   * it without waiting for React state to round-trip through the textarea. */
  const sendText = (text: string): void => {
    if (!text || busy) return
    setError(null)
    lastSendRef.current = text

    // Slash commands are local-only.
    if (text.startsWith('/')) {
      const [word, ...rest] = text.slice(1).split(/\s+/)
      const arg = rest.join(' ')
      const w = word.toLowerCase()
      if (w === 'clear') {
        setMessages([])
        updateNodeData(id, { messages: [], cost: undefined, streaming: false }, true)
        setInput('')
        return
      }
      if (w === 'model' && arg) {
        updateNodeData(id, { model: arg }, true)
        setInput('')
        return
      }
      if (w === 'system' && arg) {
        systemRef.current = arg
        updateNodeData(id, { system: arg }, true)
        setInput('')
        return
      }
      if (w === 'cost') {
        // Local-only note role (audit B4): persists in the transcript but is
        // never sent to providers (system notes vanished from Anthropic).
        const msgs = messages.map((m) => ({ ...m, toolCalls: undefined }))
        const c = conversationCost(msgs, data.model ?? '', prices)
        const total = messages.reduce(
          (acc, m) => acc + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0),
          0
        )
        const usd = c.estimated ? 'n/a (no price for this model)' : `$${c.usd.toFixed(4)}`
        const note: ChatMsg = {
          id: crypto.randomUUID(),
          role: 'note',
          content: `${total} tokens so far — ${usd}`,
          ts: Date.now()
        }
        const next = [...messages, note]
        setMessages(next)
        commitMessages(next)
        setInput('')
        return
      }
      // unknown slash → fall through as a normal message
    }

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() }
    const messagesForSend = [...messages, userMsg]
    setMessages(messagesForSend)
    updateNodeData(id, { streaming: true })
    setInput('')
    setBusy(true)
    streamingMsgId.current = null
    void window.termsprawl.chat
      .send({
        nodeId: id,
        messages: messagesForSend.map((m) => ({ ...m })),
        model: data.model,
        provider: data.provider
      })
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'send failed')
          setBusy(false)
          updateNodeData(id, { streaming: false }, true)
        }
      })
  }

  const stop = (): void => {
    void window.termsprawl.chat.stop(id)
  }

  // Error retry (audit F4): a failed send re-sends the user's last message —
  // it was left stranded in the transcript with no way to resend before.
  const retry = (): void => {
    const text = lastSendRef.current
    if (!text || busy) return
    // Drop the stranded user message + any partial assistant reply, then resend.
    const dropped = [...messages]
    while (dropped.length > 0) {
      const last = dropped[dropped.length - 1]
      if (last.role === 'assistant' || last.role === 'user') dropped.pop()
      else break
    }
    setMessages(dropped)
    commitMessages(dropped)
    setError(null)
    sendText(text)
  }

  const totalTokens = messages.reduce(
    (acc, m) => acc + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0),
    0
  )
  // Cost chip (audit B4): computed from assistant usage samples + price table
  // (settings overrides first). Estimated (no price known) shows ~.
  const cost = conversationCost(
    messages.map((m) => ({ ...m, toolCalls: undefined })),
    data.model ?? '',
    prices
  )
  const costLabel = cost.estimated
    ? totalTokens > 0
      ? `~$? (${totalTokens} tok)`
      : null
    : `$${cost.usd.toFixed(4)}`

  /** Approve/deny a pending tool call (audit B3 permission cards). */
  const decide = (callId: string, decision: 'approve' | 'deny'): void => {
    void window.termsprawl.chat.approve(id, callId, decision)
  }

  // Slash autocomplete (audit F4 — the plan promised "minimal autocomplete").
  const SLASH_COMMANDS: Array<{ cmd: string; desc: string }> = [
    { cmd: 'clear', desc: 'clear the transcript' },
    { cmd: 'model <id>', desc: 'switch model' },
    { cmd: 'system <text>', desc: 'set the system preamble' },
    { cmd: 'cost', desc: 'tokens + estimated cost so far' }
  ]
  const slashQuery = /^\/(\S*)$/.exec(input)
  const slashMatches = slashQuery
    ? SLASH_COMMANDS.filter((s) => s.cmd.startsWith(slashQuery[1].toLowerCase()))
    : []
  /** Complete the query to the first match (kept as a command word for
   * parameterized commands like /model). */
  const applySlash = (cmd: string): void => {
    const word = cmd.split(' ')[0]
    setInput(`/${word} `)
  }

  return (
    <div className="chat-node">
      <NodeResizer isVisible={selected} minWidth={280} minHeight={220} />
      <div className="chat-node-header">
        <span className="chat-node-title">{nodeTitle(data)}</span>
        <span className="chat-node-chip">{data.model ?? 'no model'}</span>
        {totalTokens > 0 && (
          <span className="chat-node-chip" title="tokens in+out so far">
            {totalTokens} tok
          </span>
        )}
        {costLabel && (
          <span className="chat-node-chip" title="estimated cost of this conversation">
            {costLabel}
          </span>
        )}
        <HelpBadge
          label="about this chat"
          text="SDK chat with any OpenAI-compatible or Anthropic endpoint. Streams replies, shows thinking blocks, tracks token usage. Slash commands: /clear /model <id> /system <text> /cost. Configure provider + key in Settings → Chat models."
        />
        <button
          className="node-close"
          title="Close chat"
          aria-label="Close chat"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>

      <div
        className="chat-node-transcript nodrag nowheel"
        ref={scrollRef}
        role="log"
        aria-label="chat transcript"
        aria-live="polite"
      >
        {data.system && <div className="chat-msg chat-system">{data.system}</div>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.role}`}>
            {m.thinking && (
              <details className="chat-thinking">
                <summary>thinking</summary>
                <pre>{m.thinking}</pre>
              </details>
            )}
            <div className="chat-content">{m.content || (m.stopped ? '(stopped)' : '…')}</div>
            {m.toolCalls?.map((c) => (
              <div key={c.id} className={`chat-tool ${c.status === 'error' ? 'chat-tool-error' : ''}`}>
                <span className="chat-tool-name">
                  {c.status === 'running' ? '◌' : c.isError ? '✗' : '✓'} {c.name}
                </span>
                {c.status === 'running' ? (
                  <div className="chat-tool-approve">
                    <span className="chat-tool-args">{c.argsJson}</span>
                    <button
                      className="chat-approve"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        decide(c.id, 'approve')
                      }}
                    >
                      approve
                    </button>
                    <button
                      className="chat-deny"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        decide(c.id, 'deny')
                      }}
                    >
                      deny
                    </button>
                  </div>
                ) : (
                  c.result && <pre className="chat-tool-result">{c.result}</pre>
                )}
              </div>
            ))}
            {m.usage && (
              <span className="chat-usage">
                {m.usage.inputTokens}→{m.usage.outputTokens} tok
              </span>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-msg chat-assistant chat-streaming">
            <div className="chat-content">▌</div>
          </div>
        )}
        {error && (
          <div className="chat-error">
            <span>{error}</span>
            <button className="chat-retry" onClick={retry} disabled={busy} title="Resend the last message">
              retry
            </button>
          </div>
        )}
      </div>

      <div className="chat-node-input nodrag">
        {slashMatches.length > 0 && (
          <div className="chat-slash-menu" role="listbox" aria-label="slash commands">
            {slashMatches.map((s) => (
              <button
                key={s.cmd}
                role="option"
                aria-selected={s.cmd === slashMatches[0].cmd}
                className="chat-slash-item"
                onMouseDown={(e) => {
                  e.preventDefault() // keep textarea focus
                  applySlash(s.cmd)
                }}
              >
                <span className="chat-slash-cmd">/{s.cmd}</span>
                <span className="chat-slash-desc">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          className="nowheel"
          rows={2}
          placeholder={busy ? 'streaming…' : 'message — /clear /model /system /cost'}
          value={input}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && slashMatches.length > 0) {
              e.preventDefault()
              setInput(input.replace(/\/\S*$/, ''))
              return
            }
            if (e.key === 'Tab' && slashMatches.length > 0) {
              e.preventDefault()
              applySlash(slashMatches[0].cmd)
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button className="chat-stop" onClick={stop} title="Stop streaming">
            ■ stop
          </button>
        ) : (
          <button className="chat-send" onClick={send} title="Send (Enter)">
            send
          </button>
        )}
      </div>
    </div>
  )
}
