import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Yolo from '../src/storage/index.ts'
import { applyYoloAction } from '../src/shared/actions.ts'

function context(): never {
  return {
    logger: { info: () => {}, warn: () => {} },
    reflect: { provide: () => {} },
    effect: () => () => {},
  } as never
}

describe('R2c todo identity receipts and corrections', () => {
  let cwd: string
  let yolo: Yolo
  let sequence: number

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'yolo-identity-feedback-'))
    yolo = new Yolo(context())
    sequence = 0
  })

  afterEach(() => {
    yolo.close()
    rmSync(cwd, { recursive: true, force: true })
  })

  function appliedResolution(options: {
    status: 'linked' | 'updated' | 'no_change'
    decision: 'LINK' | 'UPDATE'
    dueBefore?: string | null
    dueAfter?: string | null
    excerpt?: string
  }) {
    sequence += 1
    const { todo } = yolo.addTodo(cwd, {
      title: `把季度复盘材料发给产品组（${sequence}）`, due_at: options.dueBefore ?? null, source: 'manual',
    })
    if (options.status === 'updated' && options.dueAfter) {
      yolo.applyTodoAction(cwd, { id: todo.id }, 'postpone', { due_at: options.dueAfter, session_id: 'session-r2c' })
    }
    const operationId = `extract/session-r2c/${sequence}`
    const evidence = yolo.addTodoEvidence(cwd, todo.id, {
      session_id: 'session-r2c', turn_seq: 2, source_kind: 'human',
      relation: options.decision === 'LINK' ? 'mention' : 'update',
      excerpt: options.excerpt ?? '产品组那份季度复盘材料按刚才说的处理',
      occurred_at: 10,
      source_fingerprint: `${operationId}:${todo.id}`,
    }).evidence
    yolo.logTodoResolution(cwd, {
      session_id: 'session-r2c', turn_seq: sequence,
      operation_id: operationId, input_fingerprint: `hash-${sequence}`,
      input_excerpt: options.excerpt ?? '产品组那份季度复盘材料按刚才说的处理',
      resolver_version: 'shadow-v2', model_provider: 'provider', model_name: 'model', status: 'ok',
      candidates_json: JSON.stringify([{ id: todo.id, title: todo.title, status: 'pending' }]),
      resolutions_json: JSON.stringify([{ decision: options.decision, candidate_ids: [todo.id], confidence: 0.99 }]),
      application_json: JSON.stringify({
        plan: { policy_version: 'r2a-v1', mode: 'authorized', decision: options.decision, candidate_id: todo.id, confidence: 0.99, reason: 'safe_single' },
        status: options.status, todo_id: todo.id, evidence_created: true, evidence_id: evidence.id,
        ...(options.decision === 'UPDATE' ? { due_before: options.dueBefore ?? null, due_after: options.dueAfter ?? null } : {}),
      }),
    })
    const receipt = yolo.listTodoIdentityReceipts(cwd, todo.id)[0]
    if (!receipt) throw new Error('expected identity receipt')
    return { todo, evidence, receipt }
  }

  it('shows an applied LINK receipt and rejects its evidence without deleting the immutable row', () => {
    const { todo, evidence, receipt } = appliedResolution({ status: 'linked', decision: 'LINK', excerpt: '蓝鲸验收批次的那份材料' })
    expect(receipt).toMatchObject({
      todo_id: todo.id, decision: 'LINK', application_status: 'linked', confidence: 0.99, evidence_id: evidence.id, feedback: null,
    })
    expect(yolo.recallTodoIdentityCandidates(cwd, '蓝鲸验收批次')).toEqual([
      expect.objectContaining({ id: todo.id }),
    ])

    const outcome = applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: todo.id, resolution_id: receipt.resolution_id,
      identity_feedback_reason: 'wrong_item', client_action_id: 'reject-link-once',
    })
    expect(outcome).toMatchObject({ ok: true, learning_receipt: { type: 'feedback_count', reversible: false } })
    expect(yolo.listTodoEvidence(cwd, todo.id)).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: evidence.id })]))
    expect(yolo.resolve(cwd).db.prepare('SELECT id FROM todo_evidence WHERE id = ?').get(evidence.id)).toEqual({ id: evidence.id })
    expect(yolo.recallTodoIdentityCandidates(cwd, '蓝鲸验收批次')).toEqual([])
    expect(yolo.listTodoIdentityReceipts(cwd, todo.id)[0]?.feedback).toMatchObject({
      verdict: 'incorrect', reason: 'wrong_item', undo_status: 'not_needed',
    })
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'todo_identity_corrected')).toHaveLength(1)

    expect(applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: todo.id, resolution_id: receipt.resolution_id,
      identity_feedback_reason: 'wrong_item', client_action_id: 'reject-link-once',
    })).toEqual(outcome)
    expect(yolo.listEvents(cwd).filter((event) => event.kind === 'todo_identity_corrected')).toHaveLength(1)
  })

  it('undoes only the exact automatic due-date write and never overwrites a later edit', () => {
    const applied = appliedResolution({
      status: 'updated', decision: 'UPDATE', dueBefore: '2026-09-01', dueAfter: '2026-09-05',
    })
    expect(yolo.findTodo(cwd, { id: applied.todo.id })?.due_at).toBe('2026-09-05')
    expect(applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: applied.todo.id, resolution_id: applied.receipt.resolution_id,
      identity_feedback_reason: 'wrong_change', client_action_id: 'reject-update-applied',
    })).toMatchObject({ ok: true, learning_receipt: { summary: '已记录关联反馈并撤销自动改期' } })
    expect(yolo.findTodo(cwd, { id: applied.todo.id })?.due_at).toBe('2026-09-01')
    expect(yolo.listTodoIdentityReceipts(cwd, applied.todo.id)[0]?.feedback?.undo_status).toBe('applied')

    const conflict = appliedResolution({
      status: 'updated', decision: 'UPDATE', dueBefore: '2026-10-01', dueAfter: '2026-10-05', excerpt: '十月材料改到五号',
    })
    yolo.applyTodoUpdate(cwd, conflict.todo.id, { due_at: '2026-10-08' })
    expect(applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: conflict.todo.id, resolution_id: conflict.receipt.resolution_id,
      identity_feedback_reason: 'wrong_change', client_action_id: 'reject-update-conflict',
    })).toMatchObject({ ok: true, learning_receipt: { summary: '已记录关联反馈；保留你后来修改的截止时间' } })
    expect(yolo.findTodo(cwd, { id: conflict.todo.id })?.due_at).toBe('2026-10-08')
    expect(yolo.listTodoIdentityReceipts(cwd, conflict.todo.id)[0]?.feedback?.undo_status).toBe('conflict')
  })

  it('rejects mismatched or malformed feedback requests without changing the todo', () => {
    const { todo, receipt } = appliedResolution({ status: 'linked', decision: 'LINK' })
    const other = yolo.addTodo(cwd, { title: '准备发布说明', source: 'manual' }).todo
    expect(applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: other.id, resolution_id: receipt.resolution_id,
      identity_feedback_reason: 'wrong_item',
    })).toMatchObject({ ok: false, code: 'identity_feedback_mismatch', httpStatus: 409 })
    expect(applyYoloAction(yolo, cwd, {
      action: 'identity_reject', kind: 'todo', id: todo.id, resolution_id: receipt.resolution_id,
    })).toMatchObject({ ok: false, code: 'invalid_identity_feedback', httpStatus: 400 })
  })
})
