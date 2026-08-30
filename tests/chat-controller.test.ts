import { describe, expect, it } from 'vitest'
import { ChatConversationController, chatWaitingText, isChatWaiting } from '../client/panel/chat/controller.ts'
import type { ChatRequestSnapshot } from '../src/contracts/chat.ts'

function request(over: Partial<ChatRequestSnapshot> = {}): ChatRequestSnapshot {
  return {
    request_id: 'req-1', client_request_id: 'client-request-0001', status: 'accepted', text: '确认发布安排',
    accepted_at: 1, updated_at: 1, revision: 1, ...over,
  }
}

describe('ChatConversationController', () => {
  it('retains a posting request across component unmount/remount without creating another request', () => {
    const controller = new ChatConversationController()
    const started = controller.begin('scope-a\0thread-a', '确认发布安排', '确认发布安排', 'client-request-0001')
    expect(started?.local?.clientRequestId).toBe('client-request-0001')
    expect(controller.get('scope-a\0thread-a')).toEqual(started)
    expect(controller.begin('scope-a\0thread-a', '重复发送', '重复发送', 'client-request-0002')).toBeNull()
  })

  it('retains an unsent draft across side/full component remounts and isolates it by conversation', () => {
    const controller = new ChatConversationController()
    controller.setDraft('scope-a\0thread-a', '还没发送的补充说明')
    expect(controller.get('scope-a\0thread-a').draft).toBe('还没发送的补充说明')
    expect(controller.get('scope-a\0thread-b').draft).toBe('')
  })

  it('hydrates accepted, stale and completed host states with conservative wording', () => {
    const controller = new ChatConversationController()
    controller.begin('resident', '确认发布安排', '确认发布安排', 'client-request-0001')
    const accepted = controller.applyMessages('resident', { ok: true, messages: [{ role: 'user', text: '确认发布安排' }], request: request(), revision: 1 })
    expect(chatWaitingText(accepted)).toBe('已提交，等待助手回复')
    const stale = controller.applyMessages('resident', { ok: true, messages: accepted.messages, request: request({ status: 'stale', revision: 2, updated_at: 40_000 }), revision: 2 })
    expect(chatWaitingText(stale)).toBe('等待时间较长，回复可能仍在处理中')
    const completed = controller.applyMessages('resident', { ok: true, messages: [...stale.messages, { role: 'ai', text: '已经安排好了。' }], request: request({ status: 'completed', revision: 3 }), revision: 3 })
    expect(isChatWaiting(completed)).toBe(false)
    expect(chatWaitingText(completed)).toBeNull()
  })

  it('ignores an older poll so it cannot overwrite a newer request state', () => {
    const controller = new ChatConversationController()
    const completed = controller.applyMessages('resident', { ok: true, messages: [{ role: 'user', text: '确认发布安排' }, { role: 'ai', text: '完成' }], request: request({ status: 'completed', revision: 5 }), revision: 5 })
    const old = controller.applyMessages('resident', { ok: true, messages: [], request: request({ status: 'accepted', revision: 4 }), revision: 4 })
    expect(old).toBe(completed)
  })

  it('isolates temporary conversations and never reuses an active request across keys', () => {
    const controller = new ChatConversationController()
    const a = controller.begin('scope-a\0thread-a', 'A', 'A', 'client-request-a')
    const b = controller.begin('scope-a\0thread-b', 'B', 'B', 'client-request-b')
    expect(a?.local?.clientRequestId).toBe('client-request-a')
    expect(b?.local?.clientRequestId).toBe('client-request-b')
  })

  it('treats a network failure as uncertain and keeps the original text visible', () => {
    const controller = new ChatConversationController()
    controller.begin('resident', '确认发布安排', '确认发布安排', 'client-request-0001')
    const uncertain = controller.markUncertain('resident', 'client-request-0001', 'network reset')
    expect(isChatWaiting(uncertain)).toBe(true)
    expect(uncertain.messages).toContainEqual({ role: 'user', text: '确认发布安排' })
    expect(uncertain.error).toContain('提交状态暂时无法确认')
  })
})
