// YOLO chat surface — Mono design system (frontend-redesign.md 4.2⑧⑨). ONE
// component, two sizes of the same surface: the kanban's side dock (compact
// column, dock-input) and the full-screen expansion (720px column + capture-
// bar-spec input). Anchored openings (聊一聊) prefix the first sent message
// with the card context so the thread knows what "它" refers to.
// v0.3.2: when a `threadKey` is present the pane is a FRESH ephemeral
// conversation — it starts empty, never loads the resident thread's history.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IDLE_PENDING_REPLY,
  isReplyPending,
  mergeRemoteMessages,
  messagesBeforePendingReply,
  reducePendingReply,
  type ChatMessage,
  type PendingReplyState,
} from './chat/pending.ts'

export type { ChatMessage } from './chat/pending.ts'

/** What a card's 聊一聊 anchors the conversation to. */
export interface ChatAnchor {
  title: string
  detail?: string | null
  todoId?: string
  scopeCwd?: string
  source?: {
    type: 'session' | 'manual' | 'tool' | 'legacy'
    label: string
    sessionId?: string | null
    excerpt?: string | null
  }
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
  pending: PendingReplyState
}

/** Build the read URL for one chat surface. Anchored threads carry their
 * workspace explicitly; the resident thread deliberately keeps using the
 * server's current-workspace fallback. */
export function chatMessagesUrl(threadKey?: string, scopeCwd?: string): string {
  if (!threadKey) return '/yolo/session/messages'
  const params = new URLSearchParams({ thread: threadKey })
  if (scopeCwd) params.set('cwd', scopeCwd)
  return `/yolo/session/messages?${params.toString()}`
}

/** POST body paired with chatMessagesUrl(). Keeping this pure makes the
 * GET/POST workspace identity an executable client contract. */
export function chatSendBody(text: string, threadKey?: string, scopeCwd?: string): {
  text: string
  thread?: string
  cwd?: string
} {
  return {
    text,
    ...(threadKey ? { thread: threadKey } : {}),
    ...(threadKey && scopeCwd ? { cwd: scopeCwd } : {}),
  }
}

/** Strip the injected anchor context prefix from a user line (the server stores
 *  the prefixed payload; the UI should show the plain sentence the user typed). */
function stripAnchorPrefix(text: string): string {
  return text.replace(/^【关于「[^」]*」[^】]*】\n?/, '')
}

export function ChatPane({ anchor = null, variant = 'full', threadKey }: ChatPaneProps): JSX.Element {
  const anchoredScopeCwd = threadKey ? anchor?.scopeCwd : undefined
  const conversationKey = threadKey ? `${anchoredScopeCwd ?? ''}\u0000${threadKey}` : ''
  const [state, setState] = useState<ChatState>({ loading: false, error: null, messages: [], pending: IDLE_PENDING_REPLY })
  const [draft, setDraft] = useState('')
  const anchorRef = useRef<ChatAnchor | null>(anchor)
  const sentWithContext = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const prevConversation = useRef(conversationKey)
  const mountedRef = useRef(false)
  const sendLockedRef = useRef(false)
  const controllersRef = useRef(new Set<AbortController>())
  const replyRefreshTimerRef = useRef<number | null>(null)
  // Live mirror of the anchored thread + workspace identity: async callbacks
  // compare against it so a response from a conversation the user already left
  // can never overwrite the new view (v0.3.3: cross-thread/scope bleed).
  const conversationRef = useRef(conversationKey)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sendLockedRef.current = false
      if (replyRefreshTimerRef.current !== null) window.clearTimeout(replyRefreshTimerRef.current)
      for (const controller of controllersRef.current) controller.abort()
      controllersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    anchorRef.current = anchor
    sentWithContext.current = false
  }, [anchor])

  useEffect(() => {
    conversationRef.current = conversationKey
    sendLockedRef.current = false
    if (replyRefreshTimerRef.current !== null) {
      window.clearTimeout(replyRefreshTimerRef.current)
      replyRefreshTimerRef.current = null
    }
    for (const controller of controllersRef.current) controller.abort()
    controllersRef.current.clear()
  }, [conversationKey])

  // A new thread (or a jump between resident and anchored) must clear the
  // visible history — 聊一聊 always starts fresh. The [load] effect below
  // re-fetches when the thread/scope identity changes; here we drop old lines.
  useEffect(() => {
    if (prevConversation.current !== conversationKey) {
      prevConversation.current = conversationKey
      setState((s) => ({ ...s, messages: [], error: null, pending: reducePendingReply(s.pending, { type: 'reset' }) }))
    }
  }, [conversationKey])

  const load = useCallback(async (): Promise<void> => {
    const keyForCall = conversationKey
    if (!mountedRef.current || conversationRef.current !== keyForCall) return
    const controller = new AbortController()
    controllersRef.current.add(controller)
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch(chatMessagesUrl(threadKey, anchoredScopeCwd), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = (await r.json()) as { ok?: boolean; messages?: ChatMessage[]; error?: string }
      if (!mountedRef.current || conversationRef.current !== keyForCall) return // user switched threads/scopes or unmounted mid-flight
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      const remote = body.messages ?? []
      setState((current) => {
        const pending = reducePendingReply(current.pending, { type: 'messages_observed', messages: remote })
        if (!isReplyPending(pending)) sendLockedRef.current = false
        return {
          loading: false,
          error: null,
          messages: mergeRemoteMessages(remote, current.pending),
          pending,
        }
      })
    } catch (e) {
      if (!mountedRef.current || conversationRef.current !== keyForCall || controller.signal.aborted) return
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }))
    } finally {
      controllersRef.current.delete(controller)
    }
  }, [anchoredScopeCwd, conversationKey, threadKey])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [load])

  // keep the newest line visible when messages arrive
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages.length, state.pending])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sendLockedRef.current || isReplyPending(state.pending)) return
    let payload = text
    const a = anchorRef.current
    if (a && !sentWithContext.current) {
      payload = `【关于「${a.title}」${a.detail ? ` · ${a.detail}` : ''}】\n${text}`
      sentWithContext.current = true
    }
    const keyForCall = conversationKey
    sendLockedRef.current = true
    setDraft('')
    setState((current) => ({
      ...current,
      error: null,
      pending: reducePendingReply(current.pending, { type: 'send_started', messages: current.messages, userText: text }),
      messages: [...current.messages, { role: 'user', text }],
    }))
    const controller = new AbortController()
    controllersRef.current.add(controller)
    try {
      const r = await fetch('/yolo/session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatSendBody(payload, threadKey, anchoredScopeCwd)),
        signal: controller.signal,
      })
      const body = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!r.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${r.status}`)
      if (!mountedRef.current || conversationRef.current !== keyForCall) return
      setState((current) => ({
        ...current,
        pending: reducePendingReply(current.pending, { type: 'post_succeeded' }),
      }))
      await load()
      // the reply streams server-side; catch it on the next poll
      if (mountedRef.current && conversationRef.current === keyForCall) {
        if (replyRefreshTimerRef.current !== null) window.clearTimeout(replyRefreshTimerRef.current)
        replyRefreshTimerRef.current = window.setTimeout(() => {
          replyRefreshTimerRef.current = null
          void load()
        }, 2_500)
      }
    } catch (e) {
      // v0.3.3 review fix: a failed send must not leave a phantom「已发出」
      // bubble — restore the pre-send transcript and hand the text back to
      // the input so the user can retry instead of losing it.
      if (mountedRef.current && conversationRef.current === keyForCall && !controller.signal.aborted) {
        sendLockedRef.current = false
        setState((current) => ({
          ...current,
          pending: reducePendingReply(current.pending, { type: 'failed' }),
          error: e instanceof Error ? e.message : String(e),
          messages: messagesBeforePendingReply(current.pending) ?? current.messages,
        }))
        setDraft(text)
      }
    } finally {
      controllersRef.current.delete(controller)
    }
  }, [anchoredScopeCwd, conversationKey, draft, load, state.pending, threadKey])

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
      {isReplyPending(state.pending) && (
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
