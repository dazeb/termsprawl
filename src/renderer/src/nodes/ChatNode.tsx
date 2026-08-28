import { useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@reactflow/node-resizer'
import type { NodeProps } from 'reactflow'
import { nodeTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import type { ChatNodeData } from '../state/workspace'
import { HelpBadge } from '../components/HelpBadge'
import type { ChatEvent } from '../../../core/chat/types'

// Phase 11 Task 11.4 — SDK chat node (not a PTY): streaming replies with
// thinking blocks, a token chip, slash commands (/clear /model /system /cost),
// and a stop button. All streaming work happens in main via
// window.termsprawl.chat; this component is a thin transcript + input.
export function ChatNode({ id, data, selected }: NodeProps<ChatNodeData>): React.JSX.Element {
  const { updateNodeData, closeNode } = useCanvas()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const streamingMsgId = useRef<string | null>(null)

  /** Patch the streaming assistant message (create when absent). */
  const patchStreaming = (patch: { content?: string; thinking?: string; usage?: ChatNodeData['messages'][number]['usage']; model?: string }, record = false): void => {
    const mid = streamingMsgId.current
    if (!mid) return
    const msgs = data.messages.map((m) =>
      m.id === mid
        ? {
            ...m,
            ...(patch.content !== undefined ? { content: m.content + patch.content } : {}),
            ...(patch.thinking !== undefined ? { thinking: (m.thinking ?? '') + patch.thinking } : {}),
            ...(patch.usage ? { usage: patch.usage } : {}),
            ...(patch.model ? { model: patch.model } : {})
          }
        : m
    )
    updateNodeData(id, { messages: msgs }, record)
  }

  const ensureStreamingMessage = (): string => {
    if (streamingMsgId.current) return streamingMsgId.current
    const mid = crypto.randomUUID()
    streamingMsgId.current = mid
    updateNodeData(id, {
      messages: [
        ...data.messages,
        { id: mid, role: 'assistant' as const, content: '', ts: Date.now() }
      ]
    })
    return mid
  }

  // Subscribe to the per-node push channel while mounted.
  useEffect(() => {
    return window.termsprawl.chat.onEvent(id, (ev: ChatEvent) => {
      if (ev.kind === 'delta') {
        ensureStreamingMessage()
        patchStreaming({ content: ev.text })
      } else if (ev.kind === 'thinking') {
        ensureStreamingMessage()
        patchStreaming({ thinking: ev.text })
      } else if (ev.kind === 'usage') {
        ensureStreamingMessage()
        patchStreaming({
          usage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens },
          model: ev.model
        })
      } else if (ev.kind === 'toolCall') {
        // Tool calls (permission cards) are a follow-up — surface as text note.
        ensureStreamingMessage()
        patchStreaming({ content: `\n[tool: ${ev.call.name} → ${ev.call.result ?? ev.call.status}]` })
      } else if (ev.kind === 'done') {
        const stopped = ev.reason === 'stopped'
        const mid = streamingMsgId.current
        const msgs = mid
          ? data.messages.map((m) => (m.id === mid ? { ...m, stopped: stopped || undefined } : m))
          : data.messages
        updateNodeData(id, { messages: msgs, streaming: false }, true)
        streamingMsgId.current = null
        setBusy(false)
      }
    })
    // data is intentionally not a dependency: handlers close over the latest
    // render's data (the subscription is stable for the node's lifetime).
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
        updateNodeData(id, { system: arg }, true)
        setInput('')
        return
      }
      if (w === 'cost') {
        const total = data.messages.reduce(
          (acc, m) => acc + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0),
          0
        )
        updateNodeData(
          id,
          {
            messages: [
              ...data.messages,
              { id: crypto.randomUUID(), role: 'system' as const, content: `${total} tokens so far`, ts: Date.now() }
            ]
          },
          false
        )
        setInput('')
        return
      }
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content: text, ts: Date.now() }
    const messages = [...data.messages, userMsg]
    updateNodeData(id, { messages, streaming: true })
    setInput('')
    setBusy(true)
    streamingMsgId.current = null
    void window.termsprawl.chat
      .send({ nodeId: id, messages: messages.map((m) => ({ ...m })), model: data.model, provider: data.provider })
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

  const totalTokens = data.messages.reduce(
    (acc, m) => acc + (m.usage ? m.usage.inputTokens + m.usage.outputTokens : 0),
    0
  )

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

      <div className="chat-node-transcript nodrag nowheel" ref={scrollRef}>
        {data.system && <div className="chat-msg chat-system">{data.system}</div>}
        {data.messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.role}`}>
            {m.thinking && (
              <details className="chat-thinking">
                <summary>thinking</summary>
                <pre>{m.thinking}</pre>
              </details>
            )}
            <div className="chat-content">{m.content || (m.stopped ? '(stopped)' : '…')}</div>
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
