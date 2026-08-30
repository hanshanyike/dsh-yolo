import type { ChatMessage, ChatMessagesPayload, ChatRequestSnapshot } from '../../../src/contracts/chat.ts'
import { isActiveChatRequest } from '../../../src/shared/chat.ts'

export interface LocalChatRequest {
  clientRequestId: string
  userText: string
  payloadText: string
  phase: 'posting' | 'uncertain'
}

export interface ChatConversationSnapshot {
  revision: number
  messages: ChatMessage[]
  request: ChatRequestSnapshot | null
  local: LocalChatRequest | null
  error: string | null
  draft: string
}

function hasUser(messages: readonly ChatMessage[], text: string): boolean {
  return messages.some((message) => message.role === 'user' && (
    message.text === text
    || (/^【关于「[^」]*」[^】]*】\n/u.test(message.text) && message.text.endsWith(`\n${text}`))
  ))
}

function withOptimistic(messages: readonly ChatMessage[], local: LocalChatRequest | null): ChatMessage[] {
  if (!local || hasUser(messages, local.userText)) return [...messages]
  return [...messages, { role: 'user', text: local.userText }]
}

export function isChatWaiting(snapshot: ChatConversationSnapshot): boolean {
  return snapshot.local !== null || isActiveChatRequest(snapshot.request)
}

export function chatWaitingText(snapshot: ChatConversationSnapshot): string | null {
  if (snapshot.local?.phase === 'posting') return '正在提交…'
  if (snapshot.local?.phase === 'uncertain') return '等待时间较长，回复可能仍在处理中'
  if (snapshot.request?.status === 'accepted') return '已提交，等待助手回复'
  if (snapshot.request?.status === 'stale') return '等待时间较长，回复可能仍在处理中'
  return null
}

function empty(): ChatConversationSnapshot {
  return { revision: 0, messages: [], request: null, local: null, error: null, draft: '' }
}

export class ChatConversationController {
  private readonly conversations = new Map<string, ChatConversationSnapshot>()

  constructor(private readonly capacity = 32) {}

  get(key: string): ChatConversationSnapshot {
    return this.conversations.get(key) ?? empty()
  }

  begin(key: string, userText: string, payloadText: string, clientRequestId = createClientRequestId()): ChatConversationSnapshot | null {
    const current = this.get(key)
    if (isChatWaiting(current)) return null
    const local: LocalChatRequest = { clientRequestId, userText, payloadText, phase: 'posting' }
    return this.publish(key, { ...current, messages: withOptimistic(current.messages, local), local, error: null, draft: '' })
  }

  setDraft(key: string, draft: string): ChatConversationSnapshot {
    return this.publish(key, { ...this.get(key), draft })
  }

  applyMessages(key: string, payload: ChatMessagesPayload): ChatConversationSnapshot {
    const current = this.get(key)
    if (payload.revision < current.revision) return current
    const serverOwnsLocal = !!current.local && payload.request?.client_request_id === current.local.clientRequestId
    const local = serverOwnsLocal || payload.request?.status === 'completed' || payload.request?.status === 'failed'
      ? null
      : current.local
    const error = payload.request?.status === 'failed'
      ? payload.request.error ?? '助手未能接收这条消息。'
      : current.error
    return this.publish(key, {
      revision: payload.revision,
      messages: withOptimistic(payload.messages ?? [], local),
      request: payload.request,
      local,
      error,
      draft: current.draft,
    })
  }

  applyPost(key: string, payload: { revision?: number; request?: ChatRequestSnapshot | null; error?: string }): ChatConversationSnapshot {
    const current = this.get(key)
    const revision = payload.revision ?? current.revision
    if (revision < current.revision) return current
    const request = payload.request ?? current.request
    const local = current.local && request?.client_request_id === current.local.clientRequestId ? null : current.local
    return this.publish(key, {
      ...current,
      revision,
      request,
      local,
      error: request?.status === 'failed' ? request.error ?? payload.error ?? '发送失败。' : current.error,
    })
  }

  markUncertain(key: string, clientRequestId: string, error: string): ChatConversationSnapshot {
    const current = this.get(key)
    if (current.local?.clientRequestId !== clientRequestId) return current
    return this.publish(key, {
      ...current,
      local: { ...current.local, phase: 'uncertain' },
      error: `提交状态暂时无法确认：${error}`,
    })
  }

  private publish(key: string, snapshot: ChatConversationSnapshot): ChatConversationSnapshot {
    this.conversations.delete(key)
    this.conversations.set(key, snapshot)
    while (this.conversations.size > this.capacity) {
      const oldest = this.conversations.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.conversations.delete(oldest)
    }
    return snapshot
  }
}

export function createClientRequestId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `client-${random}`
}

export const chatConversationController = new ChatConversationController()
