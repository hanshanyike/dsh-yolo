// Kanban filter logic tests (v0.3.0 E) — pin TE-1..TE-3 semantics: preset
// bases, focus buckets, AND-combined detail filters and the default ordering.
// Pure functions with an explicit `today` so results never depend on the
// machine clock.

import { describe, expect, it } from 'vitest'
import type { YoloTodoRow } from '../src/shared/dashboard.ts'
import {
  applyKanbanFilter,
  DEFAULT_FILTER,
  dueBucket,
  focusCounts,
  hasDetailFilter,
  matchRangePreset,
  partitionFocusRows,
  rangeLabel,
  rangeOfPreset,
  sortForKanban,
  type KanbanFilter,
} from '../src/shared/filters.ts'

const TODAY = '2026-08-22'
const NOW = new Date(2026, 7, 22, 12, 0, 0)

const row = (id: string, over: Partial<YoloTodoRow> = {}): YoloTodoRow => ({
  id,
  title: id,
  status: 'pending',
  ...over,
})

function filter(over: Partial<KanbanFilter>): KanbanFilter {
  return { ...DEFAULT_FILTER, ...over }
}

describe('preset tabs (TE-1)', () => {
  const todos = [
    row('overdue', { due_at: '2026-08-20' }),
    row('today', { due_at: '2026-08-22' }),
    row('tomorrow', { due_at: '2026-08-23' }),
    row('nextweek', { due_at: '2026-08-27' }),
    row('far', { due_at: '2026-12-01' }),
    row('undated'),
    row('done', { status: 'done' }),
    row('cancelled', { status: 'cancelled' }),
  ]

  it('今日 = overdue + today-due, never future items', () => {
    const ids = applyKanbanFilter(todos, filter({ preset: 'today' }), TODAY).map((t) => t.id)
    expect(ids).toEqual(['overdue', 'today'])
  })

  it('全部 = every open todo incl. future and undated', () => {
    const ids = applyKanbanFilter(todos, filter({ preset: 'all' }), TODAY).map((t) => t.id)
    expect(ids).toEqual(['overdue', 'today', 'tomorrow', 'nextweek', 'far', 'undated'])
  })

  it('已完成 excludes cancelled items', () => {
    const ids = applyKanbanFilter(todos, filter({ preset: 'done' }), TODAY).map((t) => t.id)
    expect(ids).toEqual(['done'])
  })
})

describe('focus buckets & pills (TE-2)', () => {
  const todos = [
    row('overdue', { due_at: '2026-08-20' }),
    row('today', { due_at: '2026-08-22' }),
    row('week', { due_at: '2026-08-25' }),
    row('far', { due_at: '2026-12-01' }),
    row('stale-overdue', { due_at: '2026-08-19', stale: true }),
    row('done', { status: 'done', due_at: '2026-08-22' }),
  ]

  it('dueBucket classifies one row', () => {
    expect(dueBucket(row('o', { due_at: '2026-08-21' }), TODAY)).toBe('overdue')
    expect(dueBucket(row('t', { due_at: TODAY }), TODAY)).toBe('today')
    expect(dueBucket(row('w', { due_at: '2026-08-29' }), TODAY)).toBe('week')
    expect(dueBucket(row('n', { due_at: '2026-12-01' }), TODAY)).toBe('none')
    expect(dueBucket(row('u'), TODAY)).toBe('none')
  })

  it('classifies same-day datetimes by exact time while date-only today stays today', () => {
    expect(dueBucket(row('past-time', { due_at: '2026-08-22T11:59:59' }), TODAY, NOW)).toBe('overdue')
    expect(dueBucket(row('future-time', { due_at: '2026-08-22T12:00:01' }), TODAY, NOW)).toBe('today')
    expect(dueBucket(row('date-only', { due_at: TODAY }), TODAY, NOW)).toBe('today')
    expect(applyKanbanFilter(
      [
        row('past-time', { due_at: '2026-08-22T11:59:59' }),
        row('future-time', { due_at: '2026-08-22T12:00:01' }),
      ],
      filter({ overdueOnly: true }),
      TODAY,
      NOW,
    ).map((item) => item.id)).toEqual(['past-time'])
  })

  it('counts pills over ALL todos; stale double-counts with its due bucket', () => {
    expect(focusCounts(todos, TODAY)).toEqual({ overdue: 2, today: 1, week: 1, stale: 1 })
  })

  it('focus pill filters to its bucket (stale = flag, not bucket)', () => {
    expect(applyKanbanFilter(todos, filter({ focus: 'stale' }), TODAY).map((t) => t.id)).toEqual(['stale-overdue'])
    expect(applyKanbanFilter(todos, filter({ focus: 'overdue' }), TODAY).map((t) => t.id)).toEqual(['overdue', 'stale-overdue'])
  })
})

describe('detail filters AND-combine (TE-3)', () => {
  const todos = [
    row('a-in-progress', { status: 'in_progress', title: '写周报', milestone_title: 'M1', due_at: '2026-08-20' }),
    row('b-pending', { status: 'pending', title: '写月报', milestone_title: 'M1' }),
    row('c-in-progress', { status: 'in_progress', title: '改bug', milestone_title: 'M2' }),
    row('d-stale', { status: 'pending', title: '写周报-旧', stale: true }),
    row('e-done', { status: 'done', title: '写周报-已', milestone_title: 'M1' }),
  ]

  it('keyword + inProgressOnly together narrow the base', () => {
    const ids = applyKanbanFilter(
      todos,
      filter({ inProgressOnly: true, keyword: '写' }),
      TODAY,
    ).map((t) => t.id)
    expect(ids).toEqual(['a-in-progress'])
  })

  it('milestoneTitle matches linked rows only (done rows included via preset done)', () => {
    expect(applyKanbanFilter(todos, filter({ milestoneTitle: 'M1' }), TODAY).map((t) => t.id)).toEqual(['a-in-progress', 'b-pending'])
    expect(applyKanbanFilter(todos, filter({ preset: 'done', milestoneTitle: 'M1' }), TODAY).map((t) => t.id)).toEqual(['e-done'])
  })

  it('overdueOnly keeps only past-due open rows', () => {
    expect(applyKanbanFilter(todos, filter({ overdueOnly: true }), TODAY).map((t) => t.id)).toEqual(['a-in-progress'])
  })

  it('staleOnly keeps flagged rows', () => {
    expect(applyKanbanFilter(todos, filter({ staleOnly: true }), TODAY).map((t) => t.id)).toEqual(['d-stale'])
  })

  it('hasDetailFilter flips on every non-default dimension', () => {
    expect(hasDetailFilter(DEFAULT_FILTER)).toBe(false)
    expect(hasDetailFilter(filter({ focus: 'today' }))).toBe(true)
    expect(hasDetailFilter(filter({ inProgressOnly: true }))).toBe(true)
    expect(hasDetailFilter(filter({ keyword: '' }))).toBe(false)
    expect(hasDetailFilter(filter({ keyword: 'x' }))).toBe(true)
  })
})

describe('due-date windows (v0.3.1 D)', () => {
  it('rangeOfPreset resolves today / this week (Mon..Sun) / this month', () => {
    expect(rangeOfPreset('today', TODAY)).toEqual({ rangeFrom: TODAY, rangeTo: TODAY })
    // 2026-08-22 is a Saturday → week = 8/17..8/23
    expect(rangeOfPreset('thisWeek', TODAY)).toEqual({ rangeFrom: '2026-08-17', rangeTo: '2026-08-23' })
    expect(rangeOfPreset('thisMonth', TODAY)).toEqual({ rangeFrom: '2026-08-01', rangeTo: '2026-08-31' })
  })

  it('matchRangePreset maps a window back to its preset, custom, or null', () => {
    expect(matchRangePreset(null, null, TODAY)).toBeNull()
    const w = rangeOfPreset('thisWeek', TODAY)
    expect(matchRangePreset(w.rangeFrom, w.rangeTo, TODAY)).toBe('thisWeek')
    expect(matchRangePreset('2026-08-20', '2026-08-25', TODAY)).toBe('custom')
    expect(matchRangePreset('2026-08-20', null, TODAY)).toBe('custom')
  })

  it('rangeLabel renders a compact chip for closed / open-ended windows', () => {
    expect(rangeLabel('2026-08-17', '2026-08-23')).toBe('8/17~8/23')
    expect(rangeLabel('2026-08-17', null)).toBe('8/17 起')
    expect(rangeLabel(null, '2026-08-23')).toBe('至 8/23')
    expect(rangeLabel(null, null)).toBe('')
  })

  it('window filters due dates inclusively on both ends', () => {
    const todos = [
      row('before', { due_at: '2026-08-19' }),
      row('from', { due_at: '2026-08-20' }),
      row('inside', { due_at: '2026-08-22' }),
      row('to', { due_at: '2026-08-24' }),
      row('after', { due_at: '2026-08-25' }),
    ]
    const ids = applyKanbanFilter(todos, filter({ rangeFrom: '2026-08-20', rangeTo: '2026-08-24' }), TODAY).map((t) => t.id)
    expect(ids).toEqual(['from', 'inside', 'to'])
  })

  it('open-ended windows keep one side unbounded; undated todos drop out while a window is active', () => {
    const todos = [
      row('early', { due_at: '2026-08-01' }),
      row('late', { due_at: '2026-09-15' }),
      row('undated'),
    ]
    expect(applyKanbanFilter(todos, filter({ rangeFrom: '2026-08-20' }), TODAY).map((t) => t.id)).toEqual(['late'])
    expect(applyKanbanFilter(todos, filter({ rangeTo: '2026-08-20' }), TODAY).map((t) => t.id)).toEqual(['early'])
    // no window → undated stays (preset 全部)
    expect(applyKanbanFilter(todos, DEFAULT_FILTER, TODAY).map((t) => t.id)).toEqual(['early', 'late', 'undated'])
  })

  it('window AND-combines with other detail filters and flags the 筛选 chip', () => {
    const todos = [
      row('hit', { status: 'in_progress', title: '联调', due_at: '2026-08-23' }),
      row('wrong-status', { status: 'pending', title: '联调', due_at: '2026-08-23' }),
      row('wrong-week', { status: 'in_progress', title: '联调', due_at: '2026-09-23' }),
    ]
    expect(
      applyKanbanFilter(todos, filter({ inProgressOnly: true, keyword: '联调', rangeFrom: '2026-08-17', rangeTo: '2026-08-23' }), TODAY).map((t) => t.id),
    ).toEqual(['hit'])
    expect(hasDetailFilter(filter({ rangeFrom: '2026-08-01' }))).toBe(true)
    expect(hasDetailFilter(filter({ rangeTo: '2026-08-31' }))).toBe(true)
  })
})

describe('default kanban ordering', () => {
  it('overdue first, then dated by due date, undated last, terminal at the end', () => {
    const ordered = sortForKanban([
      row('undated'),
      row('done', { status: 'done' }),
      row('far', { due_at: '2026-09-01' }),
      row('soon', { due_at: '2026-08-23' }),
      row('overdue', { due_at: '2026-08-20' }),
    ])
    expect(ordered.map((t) => t.id)).toEqual(['overdue', 'soon', 'far', 'undated', 'done'])
  })
})

describe('partitionFocusRows (R9 focus cap)', () => {
  const todos = [
    row('overdue', { due_at: '2026-08-20' }),
    row('today-normal', { due_at: '2026-08-22' }),
    row('today-urgent', { due_at: '2026-08-22', priority: 'urgent' }),
    row('week', { due_at: '2026-08-25' }),
    row('undated'),
    row('done', { status: 'done', due_at: '2026-08-22' }),
  ]

  it('returns all rows when defaultCount is 0 (cap disabled)', () => {
    const { focus, folded } = partitionFocusRows(todos, 0, TODAY)
    expect(focus).toHaveLength(todos.length)
    expect(folded).toEqual([])
  })

  it('surfaces top-N most important rows and folds the rest', () => {
    const { focus, folded } = partitionFocusRows(todos, 3, TODAY)
    // overdue first, then today (urgent before normal), then the next today/week
    expect(focus.map((t) => t.id)).toEqual(['overdue', 'today-urgent', 'today-normal'])
    expect(folded.length).toBeGreaterThan(0)
    expect(folded.some((t) => t.id === 'undated')).toBe(true)
  })

  it('folds nothing when the list is at or under the cap', () => {
    const { focus, folded } = partitionFocusRows(todos, 10, TODAY)
    expect(focus).toHaveLength(todos.length)
    expect(folded).toEqual([])
  })
})
