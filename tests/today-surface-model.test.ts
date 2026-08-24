import { describe, expect, it } from 'vitest'
import type {
  WorkspaceTag,
  YoloAttentionRow,
  YoloDashboardData,
  YoloTodoRow,
} from '../src/shared/dashboard.ts'
import {
  buildTodaySurfaceModel,
  buildTodayTaskReason,
} from '../client/panel/v2/today-surface-model.ts'
import { todayTaskReasonText } from '../client/panel/v2/TodaySurface.tsx'

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

function secondaryReason(over: Partial<NonNullable<YoloTodoRow['attention_reason']>> = {}): NonNullable<YoloTodoRow['attention_reason']> {
  return {
    code: 'high_priority',
    short_reason: '优先级为紧急',
    explanation: '优先级为紧急。',
    evidence: [{ code: 'priority', label: '优先级为紧急', value: 'urgent' }],
    reason_version: 'attention-v1',
    evidence_fingerprint: 'secondary-fp',
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
    expect(model.openItemCount).toBe(2)
  })

  it('counts the deduplicated open-item union carried by Today', () => {
    const primary = todo('primary', { due_at: '2026-08-23T10:00:00', overdue: true })
    const secondary = todo('secondary', { attention_reason: secondaryReason() })
    const today = todo('today', { due_at: '2026-08-23' })
    const remindedFuture = todo('future-reminder', { due_at: '2026-08-30' })
    const terminal = todo('done-reminder', { status: 'done' })
    const data = dashboard({
      todos: [primary, secondary, today, remindedFuture, terminal],
      attention: [attention(primary.id)],
      notifications: [
        { id: 'n-primary', kind: 'reminder', title: '主判断提醒', todo_id: primary.id, created_at: 1, handled: false, scope_cwd: WS_A.cwd },
        { id: 'n-primary-copy', kind: 'reminder', title: '主判断重复提醒', todo_id: primary.id, created_at: 2, handled: false, scope_cwd: WS_A.cwd },
        { id: 'n-future', kind: 'reminder', title: '未来事项提醒', todo_id: remindedFuture.id, created_at: 3, handled: false, scope_cwd: WS_A.cwd },
        { id: 'n-done', kind: 'reminder', title: '终态旧提醒', todo_id: terminal.id, created_at: 4, handled: false, scope_cwd: WS_A.cwd },
        { id: 'n-brief', kind: 'brief', title: '早报', created_at: 5, handled: false, scope_cwd: WS_A.cwd },
      ],
    })

    const model = buildTodaySurfaceModel(data, { now: NOW })

    expect(model.judgment?.todo.id).toBe(primary.id)
    expect(model.attentionRows.map((row) => row.todo.id)).toEqual([secondary.id])
    expect(model.todayRows.map((row) => row.todo.id)).toEqual([today.id])
    expect(model.openItemCount).toBe(4)
  })

  it('keeps same todo ids from different workspaces distinct', () => {
    const data = dashboard({
      todos: [
        todo('same', { due_at: '2026-08-23' }),
        todo('same', { due_at: '2026-08-23', scope_cwd: WS_B.cwd, ws: WS_B }),
      ],
    })

    expect(buildTodaySurfaceModel(data, { now: NOW }).openItemCount).toBe(2)
  })

  it('keeps the tab surface count independent from natural-day dueToday facts', () => {
    const data = dashboard({
      todos: [todo('overdue', { due_at: '2026-08-22', overdue: true, attention_reason: secondaryReason({ code: 'overdue' }) })],
      summary: { open: 1, overdue: 1, dueToday: 0, completedToday: 0, changesToday: 0, partial: false },
    })
    const model = buildTodaySurfaceModel(data, { now: NOW })

    expect(model.openItemCount).toBe(1)
    expect(model.description).toContain('0 件今天到期')
  })

  it('shows an explicit partial-data message with failed workspace details', () => {
    const data = dashboard({
      summary: { open: 1, overdue: 0, dueToday: 1, completedToday: 0, changesToday: 0, partial: true },
      workspaceErrors: ['归档项目: database locked'],
    })

    expect(buildTodaySurfaceModel(data, { now: NOW }).partialMessage)
      .toBe('部分工作区暂不可用：归档项目: database locked。当前内容可能不完整。')
    expect(buildTodaySurfaceModel(data, { now: NOW }).partial).toBe(true)
    expect(buildTodaySurfaceModel(data, { now: NOW }).openItemCount).toBe(0)
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

  it('presents one structured fact once without an empty separator', () => {
    const reason = buildTodayTaskReason(secondaryReason())

    expect(reason).toEqual({ label: '优先级为紧急', evidence: [] })
    expect(todayTaskReasonText(reason)).toBe('优先级为紧急')
    expect(todayTaskReasonText(reason)).not.toContain('·')
  })

  it('keeps the primary label first and appends only the remaining server evidence', () => {
    const reason = buildTodayTaskReason(secondaryReason({
      short_reason: '已逾期 2 天',
      explanation: '已逾期 2 天，优先级为高，已推迟 3 次。',
      evidence: [
        { code: 'overdue', label: '已逾期 2 天', value: 2 },
        { code: 'priority', label: '优先级为高', value: 'high' },
        { code: 'postpone_count', label: '已推迟 3 次', value: 3 },
      ],
    }))

    expect(reason).toEqual({ label: '已逾期 2 天', evidence: ['优先级为高', '已推迟 3 次'] })
    expect(todayTaskReasonText(reason)).toBe('已逾期 2 天 · 优先级为高，已推迟 3 次')
  })

  it('defends against repeated and blank evidence without consuming explanation prose', () => {
    const reason = buildTodayTaskReason(secondaryReason({
      short_reason: '紧急。',
      explanation: '紧急。紧急。请立即处理。',
      evidence: [
        { code: 'primary', label: '紧急' },
        { code: 'primary-copy', label: '紧急。' },
        { code: 'blank', label: '  ' },
        { code: 'postpone_count', label: '已推迟 2 次', value: 2 },
        { code: 'postpone-copy', label: '已推迟 2 次。', value: 2 },
      ],
    }))

    expect(reason).toEqual({ label: '紧急。', evidence: ['已推迟 2 次'] })
    expect(todayTaskReasonText(reason)).toBe('紧急。 · 已推迟 2 次')
    expect(todayTaskReasonText(reason)).not.toContain('请立即处理')
    expect(todayTaskReasonText(reason)).not.toMatch(/·\s*(?:·|$)/u)
  })
})
