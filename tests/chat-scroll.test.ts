import { describe, expect, it } from 'vitest'
import { decideChatScroll, isNearChatBottom } from '../client/panel/chat/scroll.ts'
import { YOLO_CSS } from '../client/design/tokens.ts'

describe('chat scroll policy', () => {
  it('detects the bottom threshold without requiring an exact pixel match', () => {
    expect(isNearChatBottom({ scrollTop: 450, scrollHeight: 1_000, clientHeight: 500 })).toBe(false)
    expect(isNearChatBottom({ scrollTop: 452, scrollHeight: 1_000, clientHeight: 500 })).toBe(true)
    expect(isNearChatBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })).toBe(true)
  })

  it('follows first load and additions seen from near-bottom', () => {
    expect(decideChatScroll({ initial: true, contentChanged: true, wasNearBottom: false })).toBe('follow')
    expect(decideChatScroll({ initial: false, contentChanged: true, wasNearBottom: true })).toBe('follow')
  })

  it('preserves an intentional scroll-up and only advertises newer content', () => {
    expect(decideChatScroll({ initial: false, contentChanged: true, wasNearBottom: false })).toBe('notify')
    expect(decideChatScroll({ initial: false, contentChanged: false, wasNearBottom: false })).toBe('none')
  })

  it('styles both real scroll owners and the non-modal newest control', () => {
    expect(YOLO_CSS).toMatch(/\.p-body\s*\{[^}]*overflow-y:\s*auto/u)
    expect(YOLO_CSS).toMatch(/\.dock-msgs\s*\{[^}]*overflow-y:\s*auto/u)
    expect(YOLO_CSS).toContain('.chat-newest')
  })
})
