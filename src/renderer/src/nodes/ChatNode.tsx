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
  // Per-model price overrides for the cost chip (audit B4) — settings are
  // local-only and cheap to read once per node mount.
  const [prices, setPrices] = useState<Record<string, ModelPrice>>({})
  useEffect(() => {
    let alive = true
    void window.termsprawl.settings.get().then((s) => {
      if (alive && s.chat?.priceOverrides) setPrices(s.chat.priceOverrides)
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

  // Keep the transcript pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  })

  const send = (): void => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)

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
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-node-input nodrag">
        <textarea
          className="nowheel"
          rows={2}
          placeholder={busy ? 'streaming…' : 'message — /clear /model /system /cost'}
          value={input}
          spellCheck={false}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
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
