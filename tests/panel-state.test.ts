import { afterEach, describe, expect, it } from 'vitest'
import { readPanelState, writePanelState } from '../client/panel/state.ts'

afterEach(() => {
  writePanelState({ sideChatOpen: false, activeChat: null })
})

describe('panel chat state', () => {
  it('retains one anchored conversation identity across panel unmount/remount', () => {
    writePanelState({
      sideChatOpen: true,
      activeChat: {
        threadKey: 'thread-item-a',
        anchor: { title: '确认客户回访', scopeCwd: 'D:/ws/a', todoId: 'todo-a' },
      },
    })
    expect(readPanelState()).toMatchObject({
      sideChatOpen: true,
      activeChat: { threadKey: 'thread-item-a', anchor: { todoId: 'todo-a', scopeCwd: 'D:/ws/a' } },
    })
  })

  it('returns defensive copies and clears an old temporary thread before reuse', () => {
    writePanelState({ activeChat: { threadKey: 'thread-old', anchor: { title: '旧事项' } } })
    const read = readPanelState()
    read.activeChat!.anchor.title = '被外部修改'
    expect(readPanelState().activeChat?.anchor.title).toBe('旧事项')
    writePanelState({ activeChat: null })
    expect(readPanelState().activeChat).toBeNull()
  })
})
