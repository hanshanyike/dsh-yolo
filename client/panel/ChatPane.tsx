// YOLO chat surface (v0.3.0 A) — ONE component for both views of the resident
// thread: the full-width 对话 Tab and the kanban's 侧栏对话 (TA-2: same thread,
// two views). Anchored openings (聊一聊) prefix the first sent message with the
// card context so the thread knows what "它" refers to without extra plumbing.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

/** What a card's 聊一聊 anchors the conversation to. */
export interface ChatAnchor {
  title: string
  detail?: string | null
}

export interface ChatPaneProps {
  anchor?: ChatAnchor | null
  /** 'side' = the kanban side pane (compact); 'full' = the 对话 Tab. */
  variant?: 'side' | 'full'
}

const POLL_MS = 4_000

interface ChatState {
  loading: boolean
  error: string | null
  messages: ChatMessage[]
  sending: boolean
}

export function ChatPane({ anchor = null, variant = 'full' }: ChatPaneProps): JSX.Element {
  const [state, setState] = useState<ChatState>({ loading: false, error: null, messages: [], sending: false })
  const [draft, setDraft] = useState('')
  const anchorRef = useRef<ChatAnchor | null>(anchor)
  const sentWithContext = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    anchorRef.current = anchor
    sentWithContext.current = false
  }, [anchor])

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch('/yolo/session/messages', { headers: { accept: 'application/json' }, cache: 'no-store' })
      const body = (await r.json()) as { ok?: boolean; messages?: ChatMessage[]; error?: string }
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setState({ loading: false, error: null, messages: body.messages ?? [], sending: false })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  // keep the newest line visible when messages arrive
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages.length])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || state.sending) return
    let payload = text
    const a = anchorRef.current
    if (a && !sentWithContext.current) {
      payload = `【关于「${a.title}」${a.detail ? ` · ${a.detail}` : ''}】\n${text}`
      sentWithContext.current = true
    }
    setDraft('')
    setState((s) => ({ ...s, sending: true, messages: [...s.messages, { role: 'user', text }] }))
    try {
      const r = await fetch('/yolo/session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: payload }),
      })
      const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${r.status}`)
      await load()
      // the reply streams server-side; catch it on the next poll
      window.setTimeout(() => { void load() }, 2_500)
    } catch (e) {
      setState((s) => ({ ...s, sending: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [draft, load, state.sending])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {anchor && (
        <div
          style={{
            flex: 'none',
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--accent, #2f6fed)',
            background: 'rgba(47,111,237,0.08)',
            borderBottom: '1px solid var(--border, #eee)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          🔗 正在聊：{anchor.title}
        </div>
      )}

      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: variant === 'side' ? '10px 10px' : '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {state.error && <p style={{ color: '#c0392b', margin: 0 }}>连接失败：{state.error}</p>}
        {!state.error && !state.loading && state.messages.length === 0 && (
          <p style={{ opacity: 0.55, margin: 0, lineHeight: 1.8 }}>
            这是 YOLO 的常驻会话——可以问「我这周干了什么」、随手记事、改计划、解读简报。
            工作会话不受影响。
          </p>
        )}
        {state.messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '86%',
              padding: '7px 11px',
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: m.role === 'user' ? 'var(--accent, #2f6fed)' : 'var(--background-secondary, rgba(128,128,128,0.12))',
              color: m.role === 'user' ? '#fff' : 'inherit',
            }}
          >
            {m.text}
          </div>
        ))}
        {state.sending && <div style={{ fontSize: 11, opacity: 0.5, alignSelf: 'flex-start' }}>YOLO 正在处理…</div>}
      </div>

      <div style={{ flex: 'none', display: 'flex', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--border, #eee)' }}>
        <input
          value={draft}
          placeholder={anchor ? `就「${anchor.title}」追问…` : '对 YOLO 说点什么…'}
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid var(--border, #ddd)',
            background: 'var(--background, #fff)',
            color: 'inherit',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          type="button"
          disabled={!draft.trim() || state.sending}
          onClick={() => { void send() }}
          style={{
            padding: '7px 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent, #2f6fed)',
            color: '#fff',
            fontSize: 13,
            cursor: !draft.trim() || state.sending ? 'default' : 'pointer',
            opacity: !draft.trim() || state.sending ? 0.5 : 1,
          }}
        >
          发送
        </button>
      </div>
    </div>
  )
}
