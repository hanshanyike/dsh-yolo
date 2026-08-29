import { afterEach, describe, expect, it } from 'vitest'
import { readPanelState, writePanelState } from '../client/panel/state.ts'

afterEach(() => {
  writePanelState({
    navigation: { route: { page: 'home' }, foreground: { kind: 'none' }, presentation: 'auto' },
    discussionThreads: {},
  })
})

describe('panel state', () => {
  it('retains route and source preview without exposing mutable state', () => {
    writePanelState({
      navigation: {
        route: { page: 'history', section: 'timeline', day: '2026-08-26' },
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
      route: { page: 'history', section: 'timeline' },
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

  it('clones notification-log return state defensively', () => {
    writePanelState({
      navigation: {
        route: { page: 'home' }, presentation: 'auto',
        foreground: {
          kind: 'notification_log', targetId: 'notice-a',
          returnTo: { kind: 'item_detail', item: { id: 'todo-a', scopeCwd: 'D:/ws/a', title: '发送纪要' } },
        },
      },
    })
    const first = readPanelState()
    if (first.navigation.foreground.kind !== 'notification_log' || first.navigation.foreground.returnTo?.kind !== 'item_detail') {
      throw new Error('expected notification log return state')
    }
    first.navigation.foreground.returnTo.item.title = '外部修改'
    expect(readPanelState().navigation.foreground).toMatchObject({
      kind: 'notification_log', returnTo: { kind: 'item_detail', item: { title: '发送纪要' } },
    })
  })
})
