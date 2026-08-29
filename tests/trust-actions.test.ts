import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDashboardData } from '../src/ui/dashboard.ts'
import Yolo from '../src/storage/index.ts'
import { applyYoloAction, hashYoloActionRequest, type YoloActionRequest } from '../src/shared/actions.ts'

function context(): never {
  return {
    logger: { info: () => {}, warn: () => {} },
    reflect: { provide: () => {} },
    effect: () => () => {},
  } as never
}

describe('attention trust actions and durable idempotency', () => {
  let cwd: string
  let yolo: Yolo

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yolo-trust-actions-'))
    yolo = new Yolo(context())
  })

  afterEach(() => {
    yolo.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  function createJudgment() {
    const { todo } = yolo.addTodo(cwd, {
      title: '确认发布窗口并通知研发',
      due_at: '2020-01-01',
      priority: 'high',
      source: 'manual',
    })
    const attention = buildDashboardData(yolo, cwd).attention?.[0]
    if (!attention) throw new Error('expected judgment')
    return { todo, attention }
  }

  function requestFor(
    action: 'seen' | 'suppress' | 'feedback',
    clientActionId: string,
    attention: NonNullable<ReturnType<typeof buildDashboardData>['attention']>[number],
    extra: Partial<YoloActionRequest> = {},
  ): YoloActionRequest {
    return {
      action,
      kind: 'attention',
      id: attention.todo_id,
      reason_version: attention.reason_version,
      evidence_fingerprint: attention.evidence_fingerprint,
      client_action_id: clientActionId,
      ...extra,
    }
  }

  it('persists seen state, returns a truthful receipt, and replays across restart without duplicate audit', () => {
    const { todo, attention } = createJudgment()
    const request = requestFor('seen', 'seen-once', attention)
    const first = applyYoloAction(yolo, cwd, request)
    expect(first).toMatchObject({
      ok: true,
      learning_receipt: { type: 'no_learning', scope: 'item', reversible: false },
    })
    expect(first.ok && first.learning_receipt?.summary).toContain('未改变提醒偏好')
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'attention_seen')).toHaveLength(1)
    expect(yolo.listEvents(cwd)[0]?.summary).toContain(todo.title)
    expect(buildDashboardData(yolo, cwd).attention?.[0]?.seen_at).toBeTypeOf('number')
    expect(buildDashboardData(yolo, cwd).capabilities?.notificationSeen).toBe(true)

    const sameProcess = applyYoloAction(yolo, cwd, request)
    expect(sameProcess).toEqual(first)
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'attention_seen')).toHaveLength(1)

    const newDeliveryId = applyYoloAction(yolo, cwd, { ...request, client_action_id: 'seen-again' })
    expect(newDeliveryId).toMatchObject({ ok: true, learning_receipt: { type: 'no_learning' } })
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'attention_seen')).toHaveLength(1)

    yolo.close()
    yolo = new Yolo(context())
    const afterRestart = applyYoloAction(yolo, cwd, request)
    expect(afterRestart).toEqual(first)
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'attention_seen')).toHaveLength(1)
  })

  it('rejects one client_action_id reused for a different request and handles an invalid cached outcome', () => {
    const { attention } = createJudgment()
    const seen = requestFor('seen', 'same-id', attention)
    expect(applyYoloAction(yolo, cwd, seen).ok).toBe(true)

    const conflict = applyYoloAction(yolo, cwd, requestFor('feedback', 'same-id', attention, { feedback_reason: 'wrong_time' }))
    expect(conflict).toEqual({
      ok: false,
      error: 'client_action_id was already used for a different request',
      code: 'idempotency_conflict',
      httpStatus: 409,
    })

    const corruptRequest: YoloActionRequest = { action: 'complete', kind: 'todo', id: attention.todo_id, client_action_id: 'corrupt' }
    yolo.saveClientAction(cwd, {
      client_action_id: 'corrupt',
      request_hash: hashYoloActionRequest(corruptRequest),
      outcome_json: '{not-json',
    })
    expect(applyYoloAction(yolo, cwd, corruptRequest)).toEqual({
      ok: false,
      error: 'stored action outcome is unreadable',
      code: 'idempotency_record_invalid',
      httpStatus: 409,
    })
  })

  it('records one panel-action evidence entry and replays it without duplication', () => {
    const created = applyYoloAction(yolo, cwd, {
      action: 'quick_add', kind: 'todo', title: '确认下周评审时间', client_action_id: 'panel-create-once',
    })
    expect(created.ok).toBe(true)
    const todoId = created.ok ? String(created.item?.id) : ''
    expect(yolo.listTodoEvidence(cwd, todoId)).toEqual([
      expect.objectContaining({ source_kind: 'panel_action', relation: 'origin' }),
    ])

    const complete = { action: 'complete', kind: 'todo', id: todoId, client_action_id: 'panel-complete-once' }
    expect(applyYoloAction(yolo, cwd, complete)).toMatchObject({ ok: true })
    expect(applyYoloAction(yolo, cwd, complete)).toMatchObject({ ok: true })
    expect(yolo.listTodoEvidence(cwd, todoId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'panel_action', relation: 'origin' }),
      expect.objectContaining({ source_kind: 'panel_action', relation: 'completion_claim' }),
    ]))
    expect(yolo.listTodoEvidence(cwd, todoId)).toHaveLength(2)
  })

  it('strictly binds feedback to the current judgment version and suppresses it from projection', () => {
    const { attention } = createJudgment()
    const stale = applyYoloAction(yolo, cwd, {
      ...requestFor('seen', 'stale', attention),
      evidence_fingerprint: 'outdated-fingerprint',
    })
    expect(stale).toMatchObject({ ok: false, code: 'stale_attention', httpStatus: 409 })

    const suppression = applyYoloAction(yolo, cwd, requestFor('suppress', 'suppress', attention, {
      suppressed_until: Date.now() + 60_000,
    }))
    expect(suppression).toMatchObject({ ok: true, learning_receipt: { type: 'no_learning' } })
    expect(buildDashboardData(yolo, cwd).attention).toEqual([])
  })

  it('stores a canonical reason feedback without silently changing preferences', () => {
    const { attention } = createJudgment()
    const result = applyYoloAction(yolo, cwd, requestFor('feedback', 'feedback', attention, {
      feedback_reason: 'stale_signal_unhelpful',
    }))
    expect(result).toMatchObject({
      ok: true,
      item: { feedback_reason: 'stale_signal_unhelpful' },
      learning_receipt: { type: 'feedback_count', reversible: false },
    })
    expect(buildDashboardData(yolo, cwd).attention?.[0]?.feedback_reason).toBe('stale_signal_unhelpful')
    expect(buildDashboardData(yolo, cwd).capabilities?.preferenceUndo).toBe(false)
    expect(yolo.listPreferences(cwd)).toHaveLength(0)
  })
})

describe('todo action v2 receipts', () => {
  let cwd: string
  let yolo: Yolo

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yolo-action-receipts-'))
    yolo = new Yolo(context())
  })

  afterEach(() => {
    yolo.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('returns server-authored receipts and safe undo descriptors for supported todo actions', () => {
    const completeTodo = yolo.addTodo(cwd, { title: '发送发布确认' }).todo
    const completed = applyYoloAction(yolo, cwd, { action: 'complete', kind: 'todo', id: completeTodo.id })
    expect(completed).toMatchObject({
      ok: true,
      undo: { action: 'reopen', kind: 'todo', id: completeTodo.id },
      learning_receipt: { type: 'state_change', summary: '已标记完成', reversible: true },
    })

    const reopened = applyYoloAction(yolo, cwd, { action: 'reopen', kind: 'todo', id: completeTodo.id })
    expect(reopened).toMatchObject({ ok: true, learning_receipt: { type: 'state_change', summary: '已重新打开事项', reversible: false } })

    const postponed = applyYoloAction(yolo, cwd, {
      action: 'postpone', kind: 'todo', id: completeTodo.id, due_at: '2026-08-30',
    })
    expect(postponed).toMatchObject({
      ok: true,
      undo: { action: 'update', kind: 'todo', id: completeTodo.id, due_at: null },
      learning_receipt: { type: 'schedule_change', before: null, after: '2026-08-30', reversible: true },
    })

    yolo.setTodoReminded(cwd, completeTodo.id, Date.now())
    const reminded = applyYoloAction(yolo, cwd, { action: 'remind_again', kind: 'todo', id: completeTodo.id })
    expect(reminded).toMatchObject({ ok: true, learning_receipt: { type: 'reminder_reset', reversible: false } })

    const cancelTodo = yolo.addTodo(cwd, { title: '不再跟进旧方案' }).todo
    const cancelled = applyYoloAction(yolo, cwd, { action: 'cancel', kind: 'todo', id: cancelTodo.id })
    expect(cancelled).toMatchObject({ ok: true, learning_receipt: { type: 'feedback_count', reversible: false } })
  })

  it('bulk-cancels only open todos in the inclusive due-date range', () => {
    const inRange = yolo.addTodo(cwd, { title: '向客户发送确认邮件', due_at: '2026-08-29' }).todo
    const done = yolo.addTodo(cwd, { title: '归档已经签署的合同', due_at: '2026-08-29' }).todo
    const outside = yolo.addTodo(cwd, { title: '下周确认新需求', due_at: '2026-09-02' }).todo
    applyYoloAction(yolo, cwd, { action: 'complete', kind: 'todo', id: done.id })

    const result = applyYoloAction(yolo, cwd, {
      action: 'bulk_cancel', kind: 'todo', range_field: 'due_at', range_from: '2026-08-29', range_to: '2026-08-29',
    })

    expect(result).toMatchObject({ ok: true, item: { affected: 1, ids: [inRange.id] }, learning_receipt: { reversible: true } })
    expect(yolo.findTodo(cwd, { id: inRange.id })?.status).toBe('cancelled')
    expect(yolo.findTodo(cwd, { id: done.id })?.status).toBe('done')
    expect(yolo.findTodo(cwd, { id: outside.id })?.status).toBe('pending')
  })

  it('requires explicit confirmation and permanently deletes all statuses in a range', () => {
    const open = yolo.addTodo(cwd, { title: '清理旧供应商联系人', due_at: '2026-08-29' }).todo
    const done = yolo.addTodo(cwd, { title: '确认旧供应商尾款', due_at: '2026-08-29' }).todo
    applyYoloAction(yolo, cwd, { action: 'complete', kind: 'todo', id: done.id })

    const refused = applyYoloAction(yolo, cwd, {
      action: 'bulk_delete', kind: 'todo', range_field: 'due_at', range_from: '2026-08-29', range_to: '2026-08-29',
    })
    expect(refused).toMatchObject({ ok: false, code: 'permanent_delete_confirmation_required' })

    const request: YoloActionRequest = {
      action: 'bulk_delete', kind: 'todo', range_field: 'due_at', range_from: '2026-08-29', range_to: '2026-08-29',
      confirmation: 'PERMANENT_DELETE', client_action_id: 'delete-range-once',
    }
    const deleted = applyYoloAction(yolo, cwd, request)
    expect(deleted).toMatchObject({ ok: true, item: { affected: 2 }, learning_receipt: { reversible: false } })
    expect(yolo.listTodos(cwd)).toHaveLength(0)
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'todo_deleted')).toHaveLength(1)
    expect(applyYoloAction(yolo, cwd, request)).toEqual(deleted)
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'todo_deleted')).toHaveLength(1)
    expect(yolo.listTodoEvidence(cwd, open.id)).toHaveLength(0)
  })

  it('permanently deletes one todo only after the confirmation literal', () => {
    const todo = yolo.addTodo(cwd, { title: '删除重复导入的安排' }).todo
    expect(applyYoloAction(yolo, cwd, { action: 'delete', kind: 'todo', id: todo.id })).toMatchObject({
      ok: false, code: 'permanent_delete_confirmation_required',
    })
    expect(applyYoloAction(yolo, cwd, {
      action: 'delete', kind: 'todo', id: todo.id, confirmation: 'PERMANENT_DELETE', client_action_id: 'delete-one',
    })).toMatchObject({ ok: true, item: { id: todo.id, deleted: true } })
    expect(yolo.findTodo(cwd, { id: todo.id })).toBeNull()
  })
})
