import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ChatMessage, ChatRequestSnapshot } from '../../shared/chat.ts'

interface StoredRequest extends ChatRequestSnapshot {
  conversation: string
  baselineAssistantCount: number
}

export interface ChatRequestRegistryOptions {
  now?: () => number
  staleAfterMs?: number
  ttlMs?: number
  capacity?: number
}

export function chatConversationKey(cwd: string, thread?: string): string {
  return `${resolve(cwd)}\u0000${thread ?? 'resident'}`
}

function requestKey(conversation: string, clientRequestId: string): string {
  return `${conversation}\u0000${clientRequestId}`
}

function publicRequest(request: StoredRequest | undefined): ChatRequestSnapshot | null {
  if (!request) return null
  const { conversation: _conversation, baselineAssistantCount: _baseline, ...view } = request
  return { ...view }
}

function assistantCount(messages: readonly ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === 'ai' ? 1 : 0), 0)
}

function hasUserMessage(messages: readonly ChatMessage[], text: string): boolean {
  return messages.some((message) => message.role === 'user' && (
    message.text === text
    || (/^【关于「[^」]*」[^】]*】\n/u.test(message.text) && message.text.endsWith(`\n${text}`))
  ))
}

export class ChatRequestConflictError extends Error {
  constructor(readonly active: ChatRequestSnapshot) {
    super('conversation already has an active request')
  }
}

/** Host-lifecycle request ledger. It is intentionally bounded and in-memory. */
export class ChatRequestRegistry {
  private readonly records = new Map<string, StoredRequest>()
  private readonly latestByConversation = new Map<string, string>()
  private revisionValue = 0
  private readonly now: () => number
  private readonly staleAfterMs: number
  private readonly ttlMs: number
  private readonly capacity: number

  constructor(options: ChatRequestRegistryOptions = {}) {
    this.now = options.now ?? Date.now
    this.staleAfterMs = options.staleAfterMs ?? 30_000
    this.ttlMs = options.ttlMs ?? 30 * 60_000
    this.capacity = options.capacity ?? 256
  }

  get revision(): number { return this.revisionValue }

  find(conversation: string, clientRequestId: string): ChatRequestSnapshot | null {
    this.sweep()
    return publicRequest(this.records.get(requestKey(conversation, clientRequestId)))
  }

  latest(conversation: string): ChatRequestSnapshot | null {
    this.sweep()
    return publicRequest(this.latestStored(conversation))
  }

  accept(args: {
    conversation: string
    clientRequestId: string
    text: string
    baselineMessages: readonly ChatMessage[]
  }): ChatRequestSnapshot {
    this.sweep()
    const key = requestKey(args.conversation, args.clientRequestId)
    const duplicate = this.records.get(key)
    if (duplicate) return publicRequest(duplicate)!
    const active = this.latestStored(args.conversation)
    if (active && (active.status === 'accepted' || active.status === 'stale')) {
      throw new ChatRequestConflictError(publicRequest(active)!)
    }
    const now = this.now()
    const revision = this.nextRevision()
    const requestId = `req-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`
    const record: StoredRequest = {
      conversation: args.conversation,
      request_id: requestId,
      client_request_id: args.clientRequestId,
      status: 'accepted',
      text: args.text,
      accepted_at: now,
      updated_at: now,
      revision,
      baselineAssistantCount: assistantCount(args.baselineMessages),
    }
    this.records.set(key, record)
    this.latestByConversation.set(args.conversation, key)
    this.sweep()
    return publicRequest(record)!
  }

  fail(conversation: string, clientRequestId: string, error: string): ChatRequestSnapshot | null {
    const record = this.records.get(requestKey(conversation, clientRequestId))
    if (!record || record.status === 'completed') return publicRequest(record)
    record.status = 'failed'
    record.error = error
    record.updated_at = this.now()
    record.revision = this.nextRevision()
    return publicRequest(record)
  }

  observe(conversation: string, messages: readonly ChatMessage[]): ChatRequestSnapshot | null {
    this.sweep()
    const record = this.latestStored(conversation)
    if (!record) return null
    if ((record.status === 'accepted' || record.status === 'stale')
      && assistantCount(messages) > record.baselineAssistantCount) {
      record.status = 'completed'
      record.updated_at = this.now()
      record.revision = this.nextRevision()
    } else if (record.status === 'accepted' && this.now() - record.accepted_at >= this.staleAfterMs) {
      record.status = 'stale'
      record.updated_at = this.now()
      record.revision = this.nextRevision()
    }
    return publicRequest(record)
  }

  /** Ensure accepted/stale user text is visible before the agent log catches up. */
  mergeMessages(messages: readonly ChatMessage[], request: ChatRequestSnapshot | null): ChatMessage[] {
    if (!request || request.status === 'completed' || hasUserMessage(messages, request.text)) {
      return [...messages]
    }
    return [...messages, { role: 'user', text: request.text }]
  }

  private latestStored(conversation: string): StoredRequest | undefined {
    const key = this.latestByConversation.get(conversation)
    return key ? this.records.get(key) : undefined
  }

  private nextRevision(): number { return ++this.revisionValue }

  private sweep(): void {
    const now = this.now()
    for (const [key, record] of this.records) {
      if ((record.status === 'completed' || record.status === 'failed') && now - record.updated_at > this.ttlMs) {
        this.delete(key, record)
      }
    }
    if (this.records.size <= this.capacity) return
    const ordered = [...this.records.entries()].sort((a, b) => a[1].updated_at - b[1].updated_at)
    for (const [key, record] of ordered) {
      if (this.records.size <= this.capacity) break
      this.delete(key, record)
    }
  }

  private delete(key: string, record: StoredRequest): void {
    this.records.delete(key)
    if (this.latestByConversation.get(record.conversation) === key) this.latestByConversation.delete(record.conversation)
  }
}
