// YOLO chat surface — Mono design system (frontend-redesign.md 4.2⑧⑨). ONE
// component, two sizes of the same surface: the kanban's side dock (compact
// column, dock-input) and the full-screen expansion (720px column + capture-
// bar-spec input). Anchored openings (聊一聊) prefix the first sent message
// with the card context so the thread knows what "它" refers to.
// v0.3.2: when a `threadKey` is present the pane is a FRESH ephemeral
// conversation — it starts empty, never loads the resident thread's history.

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
  /** 'side' = the kanban side dock (compact); 'full' = the expanded surface. */
  variant?: 'side' | 'full'
  /** Anchored (聊一聊) thread key; a fresh value starts a brand-new conversation. */
  threadKey?: string
}

const POLL_MS = 4_000

interface ChatState {
  loading: boolean
  error: string | null
  messages: ChatMessage[]
  sending: boolean
}

/** Strip the injected anchor context prefix from a user line (the server stores
 *  the prefixed payload; the UI should show the plain sentence the user typed). */
function stripAnchorPrefix(text: string): string {
  return text.replace(/^【关于「[^」]*」[^】]*】\n?/, '')
}

export function ChatPane({ anchor = null, variant = 'full', threadKey }: ChatPaneProps): JSX.Element {
  const [state, setState] = useState<ChatState>({ loading: false, error: null, messages: [], sending: false })
  const [draft, setDraft] = useState('')
  const anchorRef = useRef<ChatAnchor | null>(anchor)
  const sentWithContext = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const prevThread = useRef(threadKey)

  useEffect(() => {
    anchorRef.current = anchor
    sentWithContext.current = false
  }, [anchor])

  // A new thread (or a jump between resident and anchored) must clear the
  // visible history — 聊一聊 always starts fresh. The [load] effect below
  // re-fetches when threadKey changes; here we only drop the old lines.
  useEffect(() => {
    if (prevThread.current !== threadKey) {
      prevThread.current = threadKey
      setState((s) => ({ ...s, messages: [], error: null, sending: false }))
    }
  }, [threadKey])

  const load = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const q = threadKey ? `?thread=${encodeURIComponent(threadKey)}` : ''
      const r = await fetch(`/yolo/session/messages${q}`, { headers: { accept: 'application/json' }, cache: 'no-store' })
      const body = (await r.json()) as { ok?: boolean; messages?: ChatMessage[]; error?: string }
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setState({ loading: false, error: null, messages: body.messages ?? [], sending: false })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [threadKey])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  // keep the newest line visible when messages arrive
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages.length, state.sending])

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
        body: JSON.stringify({ text: payload, thread: threadKey ?? undefined }),
      })
      const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${r.status}`)
      await load()
      // the reply streams server-side; catch it on the next poll
      window.setTimeout(() => { void load() }, 2_500)
    } catch (e) {
      setState((s) => ({ ...s, sending: false, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [draft, load, state.sending, threadKey])

  const input = (
    <input
      className={variant === 'full' ? 'cap-input' : undefined}
      value={draft}
      placeholder={anchor ? `就「${anchor.title}」追问…` : '和 YOLO 说…（Enter 发送）'}
      autoFocus
      aria-label="对 YOLO 说"
      onChange={(e) => { setDraft(e.target.value) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
      }}
    />
  )
  const hint = <span className={`enter-hint mono${draft.trim() ? ' lit' : ''}`}>↵</span>

  // shared message stream: assistant = plain prose, user = surface-2 bubble
  const stream = (
    <>
      {state.error && (
        <div className="err-line" role="alert">
          <span>连接失败：{state.error}</span>
          <button type="button" className="nact" onClick={() => { void load() }}>重试</button>
        </div>
      )}
      {!state.error && !state.loading && state.messages.length === 0 && (
        <div className="msg ai">
          <div className="who">YOLO</div>
          {anchor
            ? `这是关于「${anchor.title}」的全新对话——就它追问、改计划、做安排。工作会话与常驻会话都不受影响。`
            : '这是 YOLO 的常驻会话——可以问「我这周干了什么」、随手记事、改计划、解读简报。工作会话不受影响。'}
        </div>
      )}
      {state.messages.map((m, i) =>
        m.role === 'ai' ? (
          <div key={i} className="msg ai">
            <div className="who">YOLO</div>
            {m.text}
          </div>
        ) : (
          <div key={i} className="msg me">{stripAnchorPrefix(m.text)}</div>
        ),
      )}
      {state.sending && (
        <div className="msg ai">
          <div className="who">YOLO</div>
          正在处理…
        </div>
      )}
    </>
  )

  if (variant === 'side') {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="msgs dock-msgs" ref={listRef} role="log" aria-live="polite" aria-label="对话记录">
          {stream}
        </div>
        <div className="dock-input">
          {input}
          {hint}
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="p-body">
        <div className="p-main p-main--chat">
          {anchor && (
            <div className="fs-anchor" title={anchor.detail ? `${anchor.title} · ${anchor.detail}` : anchor.title}>
              锚定 · {anchor.title}
            </div>
          )}
          <div className="msgs" ref={listRef} role="log" aria-live="polite" aria-label="对话记录">
            {stream}
          </div>
        </div>
      </div>
      <footer className="capture capture--foot">
        {input}
        {hint}
      </footer>
    </div>
  )
}
