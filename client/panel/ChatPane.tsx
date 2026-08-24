// YOLO chat surface — Mono design system (frontend-redesign.md 4.2⑧⑨). ONE
// component, two sizes of the same surface: the kanban's side dock (compact
// column, dock-input) and the full-screen expansion (720px column + capture-
// bar-spec input). Anchored openings (聊一聊) prefix the first sent message
// with the card context so the thread knows what "它" refers to.
// v0.3.2: when a `threadKey` is present the pane is a FRESH ephemeral
// conversation — it starts empty, never loads the resident thread's history.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  chatConversationController,
  chatWaitingText,
  isChatWaiting,
  type ChatConversationSnapshot,
} from './chat/controller.ts'
import type { ChatMessagesPayload, ChatRequestSnapshot } from '../../src/shared/chat.ts'
import { decideChatScroll, isNearChatBottom } from './chat/scroll.ts'

export type { ChatMessage } from '../../src/shared/chat.ts'

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

interface ChatState extends ChatConversationSnapshot {
  loading: boolean
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
export function chatSendBody(text: string, threadKey?: string, scopeCwd?: string, clientRequestId?: string): {
  text: string
  thread?: string
  cwd?: string
  client_request_id?: string
} {
  return {
    text,
    ...(threadKey ? { thread: threadKey } : {}),
    ...(threadKey && scopeCwd ? { cwd: scopeCwd } : {}),
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
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
  // Only the first request for a conversation is a blocking load. Background
  // polling must leave the transcript mounted; otherwise an empty conversation
  // briefly loses its welcome message every POLL_MS and visibly flashes.
  const [state, setState] = useState<ChatState>(() => ({
    loading: true,
    ...chatConversationController.get(conversationKey),
  }))
  const [draft, setDraft] = useState('')
  const [newerAvailable, setNewerAvailable] = useState(false)
  const anchorRef = useRef<ChatAnchor | null>(anchor)
  const sentWithContext = useRef(false)
  const scrollOwnerRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const layoutConversationRef = useRef<string | null>(null)
  const transcriptSignatureRef = useRef('')
  const suppressNextScrollDecisionRef = useRef(false)
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
    sendLockedRef.current = isChatWaiting(chatConversationController.get(conversationKey))
    nearBottomRef.current = true
    setNewerAvailable(false)
    if (replyRefreshTimerRef.current !== null) {
      window.clearTimeout(replyRefreshTimerRef.current)
      replyRefreshTimerRef.current = null
    }
    for (const controller of controllersRef.current) controller.abort()
    controllersRef.current.clear()
    const cached = chatConversationController.get(conversationKey)
    setState({ ...cached, loading: cached.messages.length === 0 })
  }, [conversationKey])

  // A new thread (or a jump between resident and anchored) must clear the
  // visible history — 聊一聊 always starts fresh. The [load] effect below
  // re-fetches when the thread/scope identity changes; here we drop old lines.
  useEffect(() => {
    if (prevConversation.current !== conversationKey) {
      prevConversation.current = conversationKey
      const cached = chatConversationController.get(conversationKey)
      setState({ ...cached, loading: cached.messages.length === 0 })
    }
  }, [conversationKey])

  const load = useCallback(async (showLoading = false): Promise<void> => {
    const keyForCall = conversationKey
    if (!mountedRef.current || conversationRef.current !== keyForCall) return
    const controller = new AbortController()
    controllersRef.current.add(controller)
    if (showLoading) setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch(chatMessagesUrl(threadKey, anchoredScopeCwd), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const body = (await r.json()) as Partial<ChatMessagesPayload>
      if (!mountedRef.current || conversationRef.current !== keyForCall) return // user switched threads/scopes or unmounted mid-flight
      if (!r.ok || !body.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      const snapshot = chatConversationController.applyMessages(keyForCall, {
        ok: true,
        messages: body.messages ?? [],
        request: body.request ?? null,
        revision: typeof body.revision === 'number'
          ? body.revision
          : chatConversationController.get(keyForCall).revision,
      })
      sendLockedRef.current = isChatWaiting(snapshot)
      setState({ ...snapshot, loading: false })
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

  const transcriptSignature = `${state.messages.map((message) => `${message.role}\u0000${message.text}`).join('\u0001')}\u0002${isChatWaiting(state) ? 'pending' : 'idle'}`

  const scrollToLatest = useCallback((): void => {
    const owner = scrollOwnerRef.current
    if (!owner) return
    owner.scrollTop = owner.scrollHeight
    nearBottomRef.current = true
    setNewerAvailable(false)
  }, [])

  const observeScroll = useCallback((): void => {
    const owner = scrollOwnerRef.current
    if (!owner) return
    const nearBottom = isNearChatBottom(owner)
    nearBottomRef.current = nearBottom
    if (nearBottom) setNewerAvailable(false)
  }, [])

  // First paint starts at the latest line. Later semantic additions follow
  // only while the user was already near the bottom; polling the same content
  // never changes scroll position.
  useLayoutEffect(() => {
    if (state.loading) return
    const initial = layoutConversationRef.current !== conversationKey
    const contentChanged = transcriptSignatureRef.current !== transcriptSignature
    layoutConversationRef.current = conversationKey
    transcriptSignatureRef.current = transcriptSignature
    const suppressed = suppressNextScrollDecisionRef.current
    suppressNextScrollDecisionRef.current = false
    const decision = suppressed
      ? 'none'
      : decideChatScroll({ initial, contentChanged, wasNearBottom: nearBottomRef.current })
    if (decision === 'follow') scrollToLatest()
    else if (decision === 'notify') setNewerAvailable(true)
  }, [conversationKey, scrollToLatest, state.loading, transcriptSignature])

  const send = useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sendLockedRef.current || isChatWaiting(state)) return
    let payload = text
    const a = anchorRef.current
    if (a && !sentWithContext.current) {
      payload = `【关于「${a.title}」${a.detail ? ` · ${a.detail}` : ''}】\n${text}`
      sentWithContext.current = true
    }
    const keyForCall = conversationKey
    const started = chatConversationController.begin(keyForCall, text, payload)
    if (!started?.local) return
    const clientRequestId = started.local.clientRequestId
    sendLockedRef.current = true
    setDraft('')
    setState({ ...started, loading: false })
    try {
      // Deliberately not tied to component AbortControllers: Esc/side↔full may
      // unmount this pane after the Host accepted the body. The controller owns
      // settlement and the remounted pane hydrates from GET; it never POSTs again.
      const r = await fetch('/yolo/session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatSendBody(payload, threadKey, anchoredScopeCwd, clientRequestId)),
      })
      const body = (await r.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        revision?: number
        request?: ChatRequestSnapshot | null
      } | null
      const settled = chatConversationController.applyPost(keyForCall, body ?? { error: `HTTP ${r.status}` })
      if (mountedRef.current && conversationRef.current === keyForCall) {
        sendLockedRef.current = isChatWaiting(settled)
        setState({ ...settled, loading: false })
        if (body?.request?.status === 'failed') setDraft(text)
      }
      if (!r.ok || !body?.ok) {
        if (body?.request) return // reliable Host status already rendered; never auto-resend
        throw new Error(body?.error ?? `HTTP ${r.status}`)
      }
      if (mountedRef.current && conversationRef.current === keyForCall) await load()
      // the reply streams server-side; catch it on the next poll
      if (mountedRef.current && conversationRef.current === keyForCall) {
        if (replyRefreshTimerRef.current !== null) window.clearTimeout(replyRefreshTimerRef.current)
        replyRefreshTimerRef.current = window.setTimeout(() => {
          replyRefreshTimerRef.current = null
          void load()
        }, 2_500)
      }
    } catch (e) {
      // A network error cannot tell us whether the Host accepted the request.
      // Keep the original bubble and lock out automatic/manual duplicate POSTs;
      // the next GET may still hydrate the authoritative accepted request.
      const uncertain = chatConversationController.markUncertain(
        keyForCall,
        clientRequestId,
        e instanceof Error ? e.message : String(e),
      )
      if (mountedRef.current && conversationRef.current === keyForCall) {
        sendLockedRef.current = true
        setState({ ...uncertain, loading: false })
      }
    }
  }, [anchoredScopeCwd, conversationKey, draft, load, state, threadKey])

  const input = (
    <input
      className={variant === 'full' ? 'cap-input' : undefined}
      value={draft}
      placeholder={anchor ? `就「${anchor.title}」追问…` : '和 YOLO 说…（Enter 发送）'}
      autoFocus
      aria-label="对 YOLO 说"
      disabled={isChatWaiting(state)}
      onChange={(e) => { setDraft(e.target.value) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
      }}
    />
  )
  const hint = <span className={`enter-hint mono${draft.trim() ? ' lit' : ''}`}>↵</span>
  const waitingText = chatWaitingText(state)
  const newestControl = newerAvailable ? (
    <button
      type="button"
      className={`chat-newest chat-newest--${variant}`}
      aria-label="有新消息，回到最新"
      onClick={scrollToLatest}
    >
      有新消息 · 回到最新
    </button>
  ) : null

  // shared message stream: assistant = plain prose, user = surface-2 bubble
  const stream = (
    <>
      {state.error && (
        <div className="err-line" role="alert">
          <span>{state.error}</span>
          <button type="button" className="nact" onClick={() => { void load(true) }}>重试</button>
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
      {waitingText && (
        <div className="msg ai">
          <div className="who">YOLO</div>
          {waitingText}
        </div>
      )}
    </>
  )

  if (variant === 'side') {
    return (
      <div className="chat-pane-shell chat-pane-shell--side" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="msgs dock-msgs" ref={scrollOwnerRef} onScroll={observeScroll} role="log" aria-live="polite" aria-label="对话记录">
          {stream}
        </div>
        {newestControl}
        <div className="dock-input">
          {input}
          {hint}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-pane-shell chat-pane-shell--full" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="p-body" ref={scrollOwnerRef} onScroll={observeScroll}>
        <div className="p-main p-main--chat">
          {anchor && (
            <div className="fs-anchor" title={anchor.detail ? `${anchor.title} · ${anchor.detail}` : anchor.title}>
              锚定 · {anchor.title}
            </div>
          )}
          <div className="msgs" role="log" aria-live="polite" aria-label="对话记录">
            {stream}
          </div>
        </div>
      </div>
      {newestControl}
      <footer className="capture capture--foot">
        {input}
        {hint}
      </footer>
    </div>
  )
}
