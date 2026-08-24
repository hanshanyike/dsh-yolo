import { describe, expect, it } from 'vitest'
import { ChatRequestConflictError, ChatRequestRegistry, chatConversationKey } from '../src/ui/chat-requests.ts'
import type { ChatMessage } from '../src/shared/chat.ts'

describe('ChatRequestRegistry', () => {
  it('deduplicates one client request and rejects a second active request in the same conversation', () => {
    const registry = new ChatRequestRegistry()
    const conversation = chatConversationKey('/ws/a', 'thread-a')
    const first = registry.accept({ conversation, clientRequestId: 'client-0001', text: '继续跟进', baselineMessages: [] })
    const duplicate = registry.accept({ conversation, clientRequestId: 'client-0001', text: '继续跟进', baselineMessages: [] })

    expect(duplicate).toEqual(first)
    expect(() => registry.accept({ conversation, clientRequestId: 'client-0002', text: '重复发送', baselineMessages: [] }))
      .toThrow(ChatRequestConflictError)
  })

  it('keys the same client id independently by normalized scope and thread', () => {
    const registry = new ChatRequestRegistry()
    const a = registry.accept({ conversation: chatConversationKey('/ws/a', 'one'), clientRequestId: 'client-same', text: 'A', baselineMessages: [] })
    const b = registry.accept({ conversation: chatConversationKey('/ws/a', 'two'), clientRequestId: 'client-same', text: 'B', baselineMessages: [] })
    const c = registry.accept({ conversation: chatConversationKey('/ws/b', 'one'), clientRequestId: 'client-same', text: 'C', baselineMessages: [] })

    expect(new Set([a.request_id, b.request_id, c.request_id]).size).toBe(3)
  })

  it('stays accepted without an observation signal, becomes stale conservatively, and completes only on a new assistant line', () => {
    let now = 1_000
    const registry = new ChatRequestRegistry({ now: () => now, staleAfterMs: 5_000 })
    const conversation = chatConversationKey('/ws/a')
    const baseline: ChatMessage[] = [{ role: 'ai', text: '旧回答' }]
    registry.accept({ conversation, clientRequestId: 'client-0001', text: '新问题', baselineMessages: baseline })

    expect(registry.observe(conversation, [...baseline, { role: 'user', text: '新问题' }])?.status).toBe('accepted')
    now = 6_000
    const stale = registry.observe(conversation, [...baseline, { role: 'user', text: '新问题' }])
    expect(stale?.status).toBe('stale')
    expect(stale?.revision).toBeGreaterThan(1)

    now = 7_000
    expect(registry.observe(conversation, [...baseline, { role: 'user', text: '新问题' }, { role: 'ai', text: '新回答' }])?.status)
      .toBe('completed')
  })

  it('shows accepted user text optimistically and removes the duplicate once transcript catches up', () => {
    const registry = new ChatRequestRegistry()
    const conversation = chatConversationKey('/ws/a')
    const request = registry.accept({ conversation, clientRequestId: 'client-0001', text: '安排明天的回访', baselineMessages: [] })

    expect(registry.mergeMessages([], request)).toEqual([{ role: 'user', text: '安排明天的回访' }])
    expect(registry.mergeMessages([{ role: 'user', text: '安排明天的回访' }], request))
      .toEqual([{ role: 'user', text: '安排明天的回访' }])
  })

  it('bounds completed history by TTL and capacity while retaining visible stale requests until capacity pressure', () => {
    let now = 0
    const registry = new ChatRequestRegistry({ now: () => now, staleAfterMs: 10, ttlMs: 20, capacity: 2 })
    for (let index = 0; index < 3; index++) {
      const conversation = chatConversationKey(`/ws/${index}`)
      registry.accept({ conversation, clientRequestId: `client-000${index}`, text: `问题${index}`, baselineMessages: [] })
      registry.observe(conversation, [{ role: 'ai', text: '回答' }])
      now++
    }
    expect(registry.latest(chatConversationKey('/ws/0'))).toBeNull()
    now = 100
    expect(registry.latest(chatConversationKey('/ws/2'))).toBeNull()
  })
})
