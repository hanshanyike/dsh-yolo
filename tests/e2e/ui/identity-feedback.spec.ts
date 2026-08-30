import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import {
  connectApi, createFixtures, openYoloPanel, revealHomeItems, todayStr, uid,
  waitForDashboard, withWorkspaceDatabase, type Api,
} from '../helpers.ts'

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

test('R2C-UI: 事项详情展示自动关联回执并允许用户纠正错误关联', async ({ page }) => {
  const created = await fx.todo(uid('把访谈纪要发给产品组'), { due: todayStr() })
  const dashboard = await waitForDashboard(api, (data) => data.todos.some((row: Record<string, unknown>) => row.id === created.id))
  const row = dashboard.todos.find((candidate: Record<string, unknown>) => candidate.id === created.id)
  const operationId = `e2e-identity-ui-${randomUUID()}`
  const evidenceId = randomUUID()
  const sessionId = `${operationId}-session`

  withWorkspaceDatabase(row, (db) => {
    db.prepare(`INSERT INTO todo_evidence(
      id,todo_id,source_scope_key,session_id,turn_seq,source_kind,relation,excerpt,occurred_at,source_fingerprint
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      evidenceId, row.id, row.ws.slug, sessionId, 2, 'human', 'mention',
      '上次那份访谈纪要也一起发掉', Date.now(), `${operationId}:${row.id}`,
    )
    db.prepare(`INSERT INTO todo_resolution_log(
      scope_key,session_id,turn_seq,operation_id,input_fingerprint,input_excerpt,resolver_version,
      model_provider,model_name,status,candidates_json,resolutions_json,application_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.ws.slug, sessionId, 2, operationId, `hash-${operationId}`, '上次那份访谈纪要也一起发掉', 'shadow-v2',
      'provider', 'model', 'ok',
      JSON.stringify([{ id: row.id, title: row.title, status: 'pending', due_at: row.due_at }]),
      JSON.stringify([{ decision: 'LINK', candidate_ids: [row.id], confidence: 0.99, reason: '唯一开放候选' }]),
      JSON.stringify({
        plan: { decision: 'LINK', confidence: 0.99, reason: 'safe_single_link' },
        status: 'linked', todo_id: row.id, evidence_id: evidenceId,
      }),
      Date.now(),
    )
  })

  await openYoloPanel(page)
  await revealHomeItems(page)
  const todoRow = page.locator('.v2-judgment, .v2-today-row').filter({ hasText: row.title })
  await todoRow.getByRole('button', { name: '处理' }).click()

  const receipts = page.getByRole('region', { name: '自动关联记录' })
  await expect(receipts).toContainText('已关联为同一事项')
  await expect(receipts).toContainText('置信度 99%')
  await receipts.getByRole('button', { name: '关联错了' }).click()
  await receipts.getByRole('button', { name: '不是同一事项' }).click()
  await expect(receipts).toContainText('已纠正，并排除本次来源。')

  const feedback = withWorkspaceDatabase(row, (db) => db.prepare(
    'SELECT reason,undo_status FROM todo_identity_feedback WHERE resolution_operation_id=?',
  ).get(operationId))
  expect(feedback).toEqual({ reason: 'wrong_item', undo_status: 'not_needed' })
})
