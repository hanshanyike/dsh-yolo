import { describe, expect, it } from 'vitest'
import {
  IDLE_PENDING_REPLY,
  isReplyPending,
  mergeRemoteMessages,
  messagesBeforePendingReply,
  reducePendingReply,
  type ChatMessage,
} from '../client/panel/chat/pending.ts'

const oldTranscript: ChatMessage[] = [
  { role: 'user', text: '上一个问题' },
  { role: 'ai', text: '上一个回答' },
]

function start(): ReturnType<typeof reducePendingReply> {
  return reducePendingReply(IDLE_PENDING_REPLY, {
    type: 'send_started',
    messages: oldTranscript,
    userText: '把访谈纪要发给产品组',
  })
}

describe('pending chat reply state', () => {
  it('keeps processing after POST succeeds before an assistant reply exists', () => {
    const posting = start()
    const awaiting = reducePendingReply(posting, { type: 'post_succeeded' })

    expect(posting.phase).toBe('posting')
    expect(awaiting.phase).toBe('awaiting_reply')
    expect(isReplyPending(awaiting)).toBe(true)
  })

  it('does not mistake an old assistant message for the new reply', () => {
    const awaiting = reducePendingReply(start(), { type: 'post_succeeded' })
    const observed = reducePendingReply(awaiting, { type: 'messages_observed', messages: oldTranscript })

    expect(observed).toBe(awaiting)
    expect(isReplyPending(observed)).toBe(true)
    expect(mergeRemoteMessages(oldTranscript, observed)).toEqual([
      ...oldTranscript,
      { role: 'user', text: '把访谈纪要发给产品组' },
    ])
  })

  it('clears processing only when a new assistant message is observed', () => {
    const awaiting = reducePendingReply(start(), { type: 'post_succeeded' })
    const remote: ChatMessage[] = [
      ...oldTranscript,
      { role: 'user', text: '把访谈纪要发给产品组' },
      { role: 'ai', text: '已记下，明天下午三点提醒你。' },
    ]

    const observed = reducePendingReply(awaiting, { type: 'messages_observed', messages: remote })

    expect(observed).toEqual(IDLE_PENDING_REPLY)
    expect(isReplyPending(observed)).toBe(false)
  })

  it('clears processing on explicit failure and retains the rollback transcript', () => {
    const posting = start()

    expect(messagesBeforePendingReply(posting)).toEqual(oldTranscript)
    expect(reducePendingReply(posting, { type: 'failed' })).toEqual(IDLE_PENDING_REPLY)
  })
})
