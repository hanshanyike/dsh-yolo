import { describe, expect, it } from 'vitest'
import { chatEscapeAction, fullChatHeaderAction, isMediumChatLayout } from '../client/panel/chat/layout.ts'

describe('chat layout action model', () => {
  it('uses 960px as the exact side-chat boundary', () => {
    expect(isMediumChatLayout(959)).toBe(true)
    expect(isMediumChatLayout(960)).toBe(false)
  })

  it('makes the full header promise match the actual available layout', () => {
    expect(fullChatHeaderAction({ availableWidth: 959, sideChatOpen: true, chatFullscreen: false }))
      .toMatchObject({ action: 'show_board', label: '返回看板' })
    expect(fullChatHeaderAction({ availableWidth: 960, sideChatOpen: true, chatFullscreen: true }))
      .toMatchObject({ action: 'show_side', label: '侧栏' })
  })

  it('unwinds Esc consistently for wide and medium layouts', () => {
    expect(chatEscapeAction({ availableWidth: 1200, sideChatOpen: true, chatFullscreen: true })).toBe('show_side')
    expect(chatEscapeAction({ availableWidth: 1200, sideChatOpen: true, chatFullscreen: false })).toBe('close_panel')
    expect(chatEscapeAction({ availableWidth: 959, sideChatOpen: true, chatFullscreen: false })).toBe('show_board')
    expect(chatEscapeAction({ availableWidth: 959, sideChatOpen: false, chatFullscreen: false })).toBe('close_panel')
  })
})
