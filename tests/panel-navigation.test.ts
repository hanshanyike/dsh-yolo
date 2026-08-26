import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_NAVIGATION,
  SPLIT_MIN_WIDTH,
  backFromForeground,
  derivePanelPresentation,
  escapePanel,
  navigateBoard,
  openForeground,
  samePanelItem,
  type PanelItemRef,
} from '../client/panel/navigation.ts'

const itemA: PanelItemRef = { id: 'same-id', scopeCwd: 'D:/work/a', title: '发送访谈纪要' }
const itemB: PanelItemRef = { id: 'same-id', scopeCwd: 'D:/work/b', title: '准备周会' }

describe('panel navigation state machine', () => {
  it('keeps board route independent from the one foreground surface', () => {
    const plan = navigateBoard(DEFAULT_PANEL_NAVIGATION, { page: 'plan', section: 'upcoming' })
    const detail = openForeground(plan, { kind: 'item_detail', item: itemA }, 'todo-a')
    const source = openForeground(detail, {
      kind: 'source_preview',
      item: itemA,
      source: { type: 'session', label: '客户跟进', session_id: 'session-a' },
      returnTo: detail.foreground.kind === 'item_detail' ? detail.foreground : undefined,
    })

    expect(source.route).toEqual({ page: 'plan', section: 'upcoming' })
    expect(source.foreground.kind).toBe('source_preview')
    expect(backFromForeground(source).foreground).toEqual({ kind: 'item_detail', item: itemA })
    expect(backFromForeground(backFromForeground(source)).foreground).toEqual({ kind: 'none' })
  })

  it('derives presentation from usable width without mutating navigation state', () => {
    const foreground = { kind: 'assistant_chat' } as const
    expect(derivePanelPresentation(SPLIT_MIN_WIDTH - 1, foreground, 'auto')).toBe('focus')
    expect(derivePanelPresentation(SPLIT_MIN_WIDTH, foreground, 'auto')).toBe('split')
    expect(derivePanelPresentation(SPLIT_MIN_WIDTH + 1, foreground, 'auto')).toBe('split')
    expect(derivePanelPresentation(2000, foreground, 'focus')).toBe('focus')
    expect(derivePanelPresentation(340, foreground, 'dock')).toBe('focus')
    expect(derivePanelPresentation(2000, { kind: 'none' }, 'dock')).toBe('board_only')
  })

  it('unwinds one context before closing the panel', () => {
    const discussion = openForeground(DEFAULT_PANEL_NAVIGATION, {
      kind: 'item_discussion', item: itemA, threadKey: 'thread-a',
    })
    const first = escapePanel(discussion)
    expect(first).toMatchObject({ action: 'state', state: { foreground: { kind: 'none' } } })
    if (first.action !== 'state') throw new Error('expected state transition')
    expect(escapePanel(first.state)).toEqual({ action: 'close_panel' })
  })

  it('uses scope and id together for cross-workspace identity', () => {
    expect(samePanelItem(itemA, { ...itemA })).toBe(true)
    expect(samePanelItem(itemA, itemB)).toBe(false)
  })
})
