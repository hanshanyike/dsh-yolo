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
  sortForKanban,
  type KanbanFilter,
} from '../src/shared/filters.ts'

const TODAY = '2026-08-22'

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

  it('已完成 = terminal statuses only', () => {
    const ids = applyKanbanFilter(todos, filter({ preset: 'done' }), TODAY).map((t) => t.id)
    expect(ids).toEqual(['done', 'cancelled'])
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
