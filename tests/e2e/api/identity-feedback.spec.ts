import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { connectApi, createFixtures, uid, waitForDashboard, withWorkspaceDatabase, type Api } from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('R2C-API: 错误自动关联保留原始证据、退出有效来源并安全撤销未被覆盖的改期', async () => {
  const created = await fx.todo(uid('把复盘材料发给产品组'), { due: '2026-09-01' })
  const dashboard = await waitForDashboard(api, (data) => data.todos.some((row: Record<string, unknown>) => row.id === created.id))
  const row = dashboard.todos.find((candidate: Record<string, unknown>) => candidate.id === created.id)
  const evidenceId = randomUUID()
  const operationId = `e2e-identity-${randomUUID()}`
  const resolutionId = withWorkspaceDatabase(row, (db) => {
    db.prepare('UPDATE todos SET due_at = ?, updated_at = ? WHERE id = ?').run('2026-09-05', Date.now(), row.id)
    db.prepare(`INSERT INTO todo_evidence(
      id,todo_id,source_scope_key,session_id,turn_seq,source_kind,relation,excerpt,occurred_at,source_fingerprint
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      evidenceId, row.id, row.ws.slug, 'e2e-r2c-session', 2, 'human', 'update',
      '蓝鲸验收批次改到九月五日', Date.now(), `${operationId}:${row.id}`,
    )
    const inserted = db.prepare(`INSERT INTO todo_resolution_log(
      scope_key,session_id,turn_seq,operation_id,input_fingerprint,input_excerpt,resolver_version,
      model_provider,model_name,status,candidates_json,resolutions_json,application_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.ws.slug, 'e2e-r2c-session', 2, operationId, `hash-${operationId}`, '蓝鲸验收批次改到九月五日', 'shadow-v2',
      'provider', 'model', 'ok',
      JSON.stringify([{ id: row.id, title: row.title, status: 'pending', due_at: '2026-09-01' }]),
      JSON.stringify([{ decision: 'UPDATE', candidate_ids: [row.id], confidence: 0.99 }]),
      JSON.stringify({
        plan: { decision: 'UPDATE', confidence: 0.99, reason: 'safe_single_update' },
        status: 'updated', todo_id: row.id, evidence_id: evidenceId,
        due_before: '2026-09-01', due_after: '2026-09-05',
      }),
      Date.now(),
    )
    return Number(inserted.lastInsertRowid)
  })

  const corrected = await api.action({
    action: 'identity_reject', kind: 'todo', id: row.id, scope_cwd: row.scope_cwd,
    resolution_id: resolutionId, identity_feedback_reason: 'wrong_change',
    client_action_id: `e2e-identity-reject-${randomUUID()}`,
  })
  expect(corrected).toMatchObject({
    ok: true,
    item: { id: row.id, due_at: '2026-09-01' },
    learning_receipt: { type: 'feedback_count', summary: '已记录关联反馈并撤销自动改期', reversible: false },
  })

  const persisted = withWorkspaceDatabase(row, (db) => ({
    feedback: db.prepare(`SELECT verdict,reason,undo_status,due_before,due_after
                          FROM todo_identity_feedback WHERE resolution_operation_id=?`).get(operationId),
    immutableEvidence: db.prepare('SELECT id FROM todo_evidence WHERE id=?').get(evidenceId),
    activeEvidence: db.prepare(`SELECT count(*) AS n FROM todo_evidence evidence
                                LEFT JOIN todo_identity_feedback feedback ON feedback.evidence_id=evidence.id
                                WHERE evidence.todo_id=? AND feedback.id IS NULL`).get(row.id),
    audit: db.prepare("SELECT count(*) AS n FROM events WHERE kind='todo_identity_corrected' AND subject_id=?").get(row.id),
    integrity: db.prepare('PRAGMA integrity_check').get(),
  }))
  expect(persisted).toEqual({
    feedback: { verdict: 'incorrect', reason: 'wrong_change', undo_status: 'applied', due_before: '2026-09-01', due_after: '2026-09-05' },
    immutableEvidence: { id: evidenceId },
    activeEvidence: { n: 1 }, // quick-add origin remains; rejected update is excluded
    audit: { n: 1 },
    integrity: { integrity_check: 'ok' },
  })
})
