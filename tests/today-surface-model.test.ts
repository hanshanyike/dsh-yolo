import { describe, expect, it } from 'vitest'
import type {
  WorkspaceTag,
  YoloAttentionRow,
  YoloDashboardData,
  YoloTodoRow,
} from '../src/shared/dashboard.ts'
import { buildTodaySurfaceModel } from '../client/panel/v2/today-surface-model.ts'

const NOW = new Date(2026, 7, 23, 12)
const WS_A: WorkspaceTag = { slug: 'a/main', label: '客户项目', cwd: 'D:/work/a' }
const WS_B: WorkspaceTag = { slug: 'b/main', label: '内部工具', cwd: 'D:/work/b' }

function todo(id: string, over: Partial<YoloTodoRow> = {}): YoloTodoRow {
  return { id, title: `事项 ${id}`, status: 'pending', scope_cwd: WS_A.cwd, ws: WS_A, ...over }
}

function attention(todoId: string, over: Partial<YoloAttentionRow> = {}): YoloAttentionRow {
  return {
    id: `attention-${todoId}`,
    todo_id: todoId,
    scope_cwd: WS_A.cwd!,
    ws: WS_A,
    score: 80,
    level: 'attention',
    reason_code: 'overdue',
    short_reason: '已经逾期',
    explanation: '原定昨天完成，目前仍未处理。',
    evidence: [{ code: 'due_at', label: '截止时间', value: '2026-08-22' }],
    reason_version: 'v1',
    evidence_fingerprint: 'fp-1',
    seen_at: null,
    ...over,
  }
}

function dashboard(over: Partial<YoloDashboardData> = {}): YoloDashboardData {
  return {
    scopeKey: 'aggregate',
    cwd: WS_A.cwd!,
    at: NOW.getTime(),
    todos: [],
    goals: [],
    milestones: [],
    events: [],
    preferences: [],
    ledger: [],
    ledgerDay: '2026-08-23',
    ledgerSessions: 0,
    notifications: [],
    unhandled: 0,
    ...over,
  }
}

describe('buildTodaySurfaceModel', () => {
  it('uses only attention[0] and removes that scoped todo from secondary lists', () => {
    const focus = todo('same', { due_at: '2026-08-22', overdue: true })
    const sameIdOtherWorkspace = todo('same', { scope_cwd: WS_B.cwd, ws: WS_B, due_at: '2026-08-23' })
    const data = dashboard({
      todos: [focus, sameIdOtherWorkspace],
      attention: [attention('same'), attention('same', { id: 'ignored-second', scope_cwd: WS_B.cwd!, ws: WS_B })],
    })

    const model = buildTodaySurfaceModel(data, { now: NOW })

    expect(model.judgment?.todo.id).toBe('same')
    expect(model.judgmentScopeCwd).toBe(WS_A.cwd)
    expect(model.attentionRows).toHaveLength(0)
    expect(model.todayRows.map((row) => row.todo.ws?.label)).toEqual(['内部工具'])
  })

  it('shows an explicit partial-data message with failed workspace details', () => {
    const data = dashboard({
      summary: { open: 1, overdue: 0, dueToday: 1, completedToday: 0, changesToday: 0, partial: true },
      workspaceErrors: ['归档项目: database locked'],
    })

    expect(buildTodaySurfaceModel(data, { now: NOW }).partialMessage)
      .toBe('部分工作区暂不可用：归档项目: database locked。当前内容可能不完整。')
  })

  it('counts done rows but never cancelled rows as completed progress', () => {
    const data = dashboard({
      todos: [
        todo('done', { status: 'done', completed_at: NOW.getTime() }),
        todo('cancelled', { status: 'cancelled', completed_at: NOW.getTime() }),
      ],
      summary: { open: 0, overdue: 0, dueToday: 0, completedToday: 2, changesToday: 1, partial: false },
    })

    expect(buildTodaySurfaceModel(data, { now: NOW }).progress.completed).toBe(1)
  })

  it('maps structured source session, workspace and scope for judgment and list rows', () => {
    const focus = todo('focus', {
      source: { type: 'session', label: '客户访谈会话', session_id: 'session-1', excerpt: '周一前发出', workspace: WS_A },
    })
    const today = todo('today', {
      due_at: '2026-08-23',
      scope_cwd: WS_B.cwd,
      ws: WS_B,
      source: { type: 'manual', label: '快速记一条', workspace: WS_B },
    })
    const data = dashboard({ todos: [focus, today], attention: [attention('focus', { source: focus.source })] })

    const model = buildTodaySurfaceModel(data, { now: NOW })

    expect(model.judgmentScopeCwd).toBe(WS_A.cwd)
    expect(model.judgment?.source).toMatchObject({ sessionId: 'session-1', label: '客户访谈会话', workspace: WS_A })
    expect(model.todayRows[0]).toMatchObject({ scopeCwd: WS_B.cwd, source: { type: 'manual', label: '快速记一条', workspace: WS_B } })
  })

  it('maps unseen judgments to full and seen judgments to compact wording', () => {
    const focus = todo('focus')
    const unseen = dashboard({ todos: [focus], attention: [attention('focus', { seen_at: null })] })
    const seen = dashboard({ todos: [focus], attention: [attention('focus', { seen_at: NOW.getTime() })] })

    expect(buildTodaySurfaceModel(unseen, { now: NOW }).judgment).toMatchObject({ presentation: 'full', reason: '原定昨天完成，目前仍未处理。' })
    expect(buildTodaySurfaceModel(seen, { now: NOW }).judgment).toMatchObject({ presentation: 'compact', reason: '已经逾期' })
  })
})
