import { describe, expect, it } from 'vitest'
import {
  buildLearningReceiptView,
  partitionTodayTodos,
  tomorrowLocalDate,
  type LearningReceiptData,
  type YoloTodoRowV2,
} from '../client/panel/v2/model.ts'

function todo(id: string, over: Partial<YoloTodoRowV2> = {}): YoloTodoRowV2 {
  return { id, title: `事项 ${id}`, status: 'pending', ...over }
}

describe('partitionTodayTodos', () => {
  it('removes the highlighted item and partitions every remaining row once', () => {
    const rows = [
      todo('focus', { due_at: '2026-08-23', overdue: true }),
      todo('overdue', { due_at: '2026-08-22' }),
      todo('stale', { stale: true }),
      todo('today', { due_at: '2026-08-23' }),
      todo('future', { due_at: '2026-08-25' }),
      todo('undated'),
      todo('done', { status: 'done' }),
      todo('completed', { status: 'completed' }),
      todo('cancelled', { status: 'cancelled' }),
    ]

    const result = partitionTodayTodos(rows, 'focus', new Date(2026, 7, 23, 12))

    expect(result.attention.map((row) => row.id)).toEqual(['overdue', 'stale'])
    expect(result.today.map((row) => row.id)).toEqual(['today'])
    expect(result.upcoming.map((row) => row.id)).toEqual(['future', 'undated'])
    expect(result.completed.map((row) => row.id)).toEqual(['done', 'completed'])
    expect(result.cancelled.map((row) => row.id)).toEqual(['cancelled'])
    expect(Object.values(result).flat().some((row) => row.id === 'focus')).toBe(false)
  })

  it('uses exact local datetime instants instead of treating the whole day as current', () => {
    const rows = [
      todo('first', { due_at: '2026-08-23T23:30:00' }),
      todo('second', { due_at: '2026-08-23T08:00:00' }),
    ]

    const result = partitionTodayTodos(rows, null, new Date(2026, 7, 23, 9))
    expect(result.today.map((row) => row.id)).toEqual(['first'])
    expect(result.attention.map((row) => row.id)).toEqual(['second'])
  })
})

describe('tomorrowLocalDate', () => {
  it('rolls across month and leap-year boundaries using local calendar math', () => {
    expect(tomorrowLocalDate(new Date(2026, 0, 31, 23, 59))).toBe('2026-02-01')
    expect(tomorrowLocalDate(new Date(2028, 1, 28, 23, 59))).toBe('2028-02-29')
  })

  it('rolls across the year boundary', () => {
    expect(tomorrowLocalDate(new Date(2026, 11, 31, 12))).toBe('2027-01-01')
  })
})

describe('buildLearningReceiptView', () => {
  it('returns no view when the server did not return a receipt', () => {
    expect(buildLearningReceiptView(undefined)).toBeNull()
    expect(buildLearningReceiptView(null)).toBeNull()
  })

  it('preserves server wording and exposes scope, before/after and undo capability', () => {
    const receipt: LearningReceiptData = {
      type: 'preference_change',
      summary: '已将此类提醒改为工作日上午',
      scope: 'workspace',
      before: '每天晚上',
      after: '工作日上午',
      reversible: true,
      sourceAction: '确认偏好建议',
      occurredAt: 1_777_777_777_000,
    }

    expect(buildLearningReceiptView(receipt)).toEqual({
      summary: receipt.summary,
      scopeLabel: '本工作区',
      before: '每天晚上',
      after: '工作日上午',
      reversible: true,
      sourceAction: '确认偏好建议',
      occurredAt: receipt.occurredAt,
    })
  })

  it('does not turn a no-learning receipt into a preference claim', () => {
    const receipt: LearningReceiptData = {
      type: 'no_learning',
      summary: '已处理；未改变提醒偏好',
      scope: 'item',
      reversible: false,
    }

    expect(buildLearningReceiptView(receipt)?.summary).toBe('已处理；未改变提醒偏好')
  })
})
