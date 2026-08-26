import { afterEach, describe, expect, it } from 'vitest'
import { readPanelState, writePanelState } from '../client/panel/state.ts'

afterEach(() => {
  writePanelState({
    sideChatOpen: false,
    activeChat: null,
    navigation: { route: { page: 'home' }, foreground: { kind: 'none' }, presentation: 'auto' },
    discussionThreads: {},
  })
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

  it('retains route and source preview without exposing mutable state', () => {
    writePanelState({
      navigation: {
        route: { page: 'history', section: 'changes', day: '2026-08-26' },
        presentation: 'auto',
        foreground: {
          kind: 'source_preview',
          item: { id: 'todo-a', scopeCwd: 'D:/ws/a', title: '发送纪要' },
          source: {
            type: 'session', label: '客户访谈', session_id: 'session-a', excerpt: '明天发送纪要',
            workspace: { slug: 'a/default', label: 'A', cwd: 'D:/ws/a' },
          },
        },
      },
    })

    const first = readPanelState()
    expect(first.navigation).toMatchObject({
      route: { page: 'history', section: 'changes' },
      foreground: { kind: 'source_preview', item: { id: 'todo-a' } },
    })
    if (first.navigation.foreground.kind !== 'source_preview') throw new Error('expected source preview')
    first.navigation.foreground.item.title = '外部修改'
    first.navigation.foreground.source.workspace!.label = '外部修改'
    expect(readPanelState().navigation.foreground).toMatchObject({
      item: { title: '发送纪要' }, source: { workspace: { label: 'A' } },
    })
  })

  it('retains discussion episodes defensively across panel remounts', () => {
    writePanelState({ discussionThreads: { 'D:/ws/a\u0000todo-a': 'thread-a' } })
    const first = readPanelState()
    first.discussionThreads['D:/ws/a\u0000todo-a'] = 'changed'
    expect(readPanelState().discussionThreads).toEqual({ 'D:/ws/a\u0000todo-a': 'thread-a' })
  })
})
