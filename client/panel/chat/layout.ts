export const SIDE_CHAT_BREAKPOINT = 960

export type ChatLayoutAction = 'show_side' | 'show_board' | 'close_panel'

export interface ChatLayoutState {
  availableWidth: number
  sideChatOpen: boolean
  chatFullscreen: boolean
}

export function isMediumChatLayout(availableWidth: number): boolean {
  return availableWidth < SIDE_CHAT_BREAKPOINT
}

export function fullChatHeaderAction(state: ChatLayoutState): {
  action: Exclude<ChatLayoutAction, 'close_panel'>
  label: '侧栏' | '返回看板'
  title: string
} {
  return isMediumChatLayout(state.availableWidth)
    ? { action: 'show_board', label: '返回看板', title: '返回看板 (Esc)' }
    : { action: 'show_side', label: '侧栏', title: '收起为侧栏 (Esc)' }
}

/** Esc is one step per visible surface; panel close never masquerades as chat back. */
export function chatEscapeAction(state: ChatLayoutState): ChatLayoutAction {
  if (isMediumChatLayout(state.availableWidth)) {
    return state.sideChatOpen || state.chatFullscreen ? 'show_board' : 'close_panel'
  }
  if (state.chatFullscreen) return 'show_side'
  return 'close_panel'
}
