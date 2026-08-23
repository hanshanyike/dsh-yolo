import { describe, expect, it } from 'vitest'
import {
  ATTENTION_REASON_VERSION,
  buildDashboardSummary,
  rankAttentionCandidates,
  scoreAttentionCandidate,
  selectPrimaryAttention,
} from '../src/attention/index.ts'
import type { WorkspaceTag, YoloTodoRow } from '../src/shared/dashboard.ts'

const NOW = new Date(2026, 7, 23, 10, 0, 0)
const WS: WorkspaceTag = { slug: 'scope/main', label: 'dsh-yolo', cwd: 'D:\\Code\\dsh-yolo' }

function todo(id: string, over: Partial<YoloTodoRow> = {}): YoloTodoRow {
  return {
    id,
    title: `事项 ${id}`,
    status: 'pending',
    updated_at: NOW.getTime(),
    scope_cwd: WS.cwd,
    ws: WS,
    ...over,
  }
}

describe('deterministic attention domain', () => {
  it('scores only verifiable facts and chooses the strongest qualifying reason', () => {
    const row = todo('risk', {
      due_at: '2026-08-20',
      priority: 'urgent',
      stale: true,
      updated_at: new Date(2026, 7, 10).getTime(),
      postpone_count: 2,
      reminder: { id: 'n1', unhandled: true, unhandled_count: 2, last_fired_at: NOW.getTime() - 1_000 },
      milestone_id: 'm1',
      milestone_title: '发布准备',
      milestone_status: 'active',
      milestone_open_todo_count: 1,
    })

    const result = scoreAttentionCandidate(row, NOW)
    expect(result).toMatchObject({
      id: 'scope/main:risk',
      todo_id: 'risk',
      scope_cwd: WS.cwd,
      score: 143,
      level: 'critical',
      reason_code: 'reminder_due',
      short_reason: '有 2 条未处理提醒',
      reason_version: ATTENTION_REASON_VERSION,
    })
    expect(result?.evidence.map((item) => item.code)).toEqual([
      'unhandled_reminder',
      'overdue',
      'priority',
      'postpone_count',
      'stale_over_7d',
      'only_open_in_milestone',
    ])
    expect(result?.explanation).not.toContain('可能影响')
  })

  it('uses the documented candidate thresholds instead of priority alone', () => {
    expect(scoreAttentionCandidate(todo('high-only', { priority: 'high' }), NOW)).toBeNull()

    const urgentSoon = scoreAttentionCandidate(todo('urgent-soon', {
      priority: 'urgent',
      due_at: '2026-08-25T09:00:00',
    }), NOW)
    expect(urgentSoon).toMatchObject({ reason_code: 'high_priority', score: 20 })

    expect(scoreAttentionCandidate(todo('done', {
      status: 'done',
      reminder: { id: 'n2', unhandled: true },
    }), NOW)).toBeNull()
  })

  it('keeps ordering and fingerprints stable, then changes the fingerprint with evidence facts', () => {
    const later = todo('later', { due_at: '2026-08-23T13:00:00' })
    const earlier = todo('earlier', { due_at: '2026-08-23T12:00:00' })
    const first = rankAttentionCandidates([later, earlier], NOW)
    const second = rankAttentionCandidates([later, earlier], NOW)

    expect(first.map((item) => item.todo_id)).toEqual(['earlier', 'later'])
    expect(second).toEqual(first)

    const changed = scoreAttentionCandidate({ ...earlier, updated_at: earlier.updated_at! + 1 }, NOW)
    expect(changed?.evidence_fingerprint).not.toBe(first[0]?.evidence_fingerprint)
  })

  it('returns at most one judgment and removes it from the downstream remainder', () => {
    const top = todo('top', { reminder: { id: 'n1', unhandled: true } })
    const other = todo('other', { stale: true, updated_at: new Date(2026, 7, 1).getTime() })
    const ordinary = todo('ordinary')

    const selected = selectPrimaryAttention([other, top, ordinary], NOW)
    expect(selected.attention.map((item) => item.todo_id)).toEqual(['top'])
    expect(selected.remaining.map((item) => item.id)).toEqual(['other', 'ordinary'])
    expect(selectPrimaryAttention([ordinary], NOW)).toEqual({ attention: [], remaining: [ordinary] })
  })

  it('builds summary counts without mixing cancelled into completed', () => {
    const rows = [
      todo('open-overdue', { due_at: '2026-08-22', overdue: true }),
      todo('today', { due_at: '2026-08-23' }),
      todo('done', { status: 'done', completed_at: new Date(2026, 7, 23, 9).getTime() }),
      todo('cancelled', { status: 'cancelled', completed_at: new Date(2026, 7, 23, 9).getTime() }),
    ]
    expect(buildDashboardSummary(rows, '2026-08-23', 7, true)).toEqual({
      open: 2,
      overdue: 1,
      dueToday: 1,
      completedToday: 1,
      changesToday: 7,
      partial: true,
    })
  })
})
