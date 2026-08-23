// M8 interaction-layer-B tests — POST /yolo/actions endpoint with a mocked
// Yolo service and a minimal fake IncomingMessage. The endpoint shares
// applyYoloAction with the yolo_action model tool, so these tests pin the
// HTTP contract (status codes + body shape), not the domain behavior.

import { describe, it, expect, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { registerActionsEndpoint } from '../src/ui/actions.ts'
import type { Todo, Goal, Milestone } from '../src/storage/types.ts'

function fakeReq(method: string, body: string): unknown {
  return {
    method,
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === 'data') queueMicrotask(() => cb(Buffer.from(body)))
      if (event === 'end') queueMicrotask(() => cb())
      return this
    },
  }
}

function mockYolo(overrides: Record<string, unknown> = {}): Yolo {
  const now = Date.now()
  const todo: Todo = { id: 't1', title: '写季度报告', status: 'pending', scope_key: 'k', created_at: now, updated_at: now }
  const goal: Goal = { id: 'g1', title: '学会 Rust', status: 'active', progress: 40, scope_key: 'k', created_at: now, updated_at: now }
  const milestone: Milestone = { id: 'm1', title: 'v0.3 发布', status: 'active', scope_key: 'k', created_at: now, updated_at: now }
  return {
    applyTodoAction: vi.fn(() => todo),
    applyGoalProgress: vi.fn(() => goal),
    applyMilestoneStatus: vi.fn(() => milestone),
    ...overrides,
  } as unknown as Yolo
}

async function call(server: { register: ReturnType<typeof vi.fn> }, method: string, body: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = { writeHead: vi.fn(), end: vi.fn() }
  const opts = server.register.mock.calls[0][0] as { handler: (req: unknown, res: unknown) => Promise<void> }
  await opts.handler(fakeReq(method, body), res)
  const status = res.writeHead.mock.calls[0][0] as number
  const json = JSON.parse(String(res.end.mock.calls[0][0])) as Record<string, unknown>
  return { status, body: json }
}

function setup(overrides: Record<string, unknown> = {}) {
  const server = { register: vi.fn() }
  const yolo = mockYolo(overrides)
  registerActionsEndpoint({ webServer: server } as never, yolo, () => '/tmp/proj')
  expect(server.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prefix', path: '/yolo/actions' }))
  return { server, yolo }
}

describe('POST /yolo/actions', () => {
  it('completes a todo by id → 200 { ok, item }', async () => {
    const { server, yolo } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'complete', kind: 'todo', id: 't1' }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect((r.body.item as { title: string }).title).toBe('写季度报告')
    expect(yolo.applyTodoAction).toHaveBeenCalledWith('/tmp/proj', { id: 't1' }, 'complete', { session_id: null })
  })

  it('postpones with due_at → passes the args through', async () => {
    const { server, yolo } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'postpone', kind: 'todo', id: 't1', due_at: '2026-08-25' }))
    expect(r.status).toBe(200)
    expect(yolo.applyTodoAction).toHaveBeenCalledWith('/tmp/proj', { id: 't1' }, 'postpone', { due_at: '2026-08-25', session_id: null })
  })

  it('reopens a done todo (undo of complete) → 200 with the reopen action', async () => {
    const { server, yolo } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'reopen', kind: 'todo', id: 't1' }))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(yolo.applyTodoAction).toHaveBeenCalledWith('/tmp/proj', { id: 't1' }, 'reopen', { session_id: null })
  })

  it('goal set_progress and milestone set_status → 200', async () => {
    const { server, yolo } = setup()
    const g = await call(server, 'POST', JSON.stringify({ action: 'set_progress', kind: 'goal', title: '学会 Rust', progress: 60 }))
    expect(g.status).toBe(200)
    expect(yolo.applyGoalProgress).toHaveBeenCalledWith('/tmp/proj', { title: '学会 Rust' }, 60, undefined, undefined)
    const m = await call(server, 'POST', JSON.stringify({ action: 'set_status', kind: 'milestone', id: 'm1', status: 'done' }))
    expect(m.status).toBe(200)
    expect(yolo.applyMilestoneStatus).toHaveBeenCalledWith('/tmp/proj', { id: 'm1' }, 'done', undefined)
  })

  it('passes a session_id through to the audit trail when the body carries one', async () => {
    const { server, yolo } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'complete', kind: 'todo', id: 't1', session_id: 'session-chat-1' }))
    expect(r.status).toBe(200)
    expect(yolo.applyTodoAction).toHaveBeenCalledWith('/tmp/proj', { id: 't1' }, 'complete', { session_id: 'session-chat-1' })
  })

  it('bad JSON → 400 with JSON error', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', '{oops')
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
    expect(r.body.error).toContain('invalid JSON')
  })

  it('empty body → 400 (no id/title)', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', '')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('pass id or title')
  })

  it('unknown action → 400', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'explode', kind: 'todo', title: 'x' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('unsupported action')
  })

  it('author_notification surfaces a reminder card through addNotification', async () => {
    const addNotification = vi.fn((_cwd, data) => ({ id: 'n1', ...data }))
    const { server } = setup({ addNotification })
    const r = await call(
      server,
      'POST',
      JSON.stringify({ action: 'author_notification', kind: 'notification', title: '⏰ 提醒我去开会', note: '10 楼会议室', notif_kind: 'reminder' }),
    )
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(addNotification).toHaveBeenCalledWith('/tmp/proj', {
      kind: 'reminder',
      title: '⏰ 提醒我去开会',
      body: '10 楼会议室',
      todo_id: null,
      scope_cwd: '/tmp/proj',
    })
  })

  it('author_notification without title → 400', async () => {
    const addNotification = vi.fn()
    const { server } = setup({ addNotification })
    const r = await call(server, 'POST', JSON.stringify({ action: 'author_notification', kind: 'notification' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('title')
    expect(addNotification).not.toHaveBeenCalled()
  })

  it('postpone without due_at → 400', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', JSON.stringify({ action: 'postpone', kind: 'todo', title: 'x' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('due_at')
  })

  it('item not found → 404 { ok:false, error }', async () => {
    const { server } = setup({ applyTodoAction: vi.fn(() => null) })
    const r = await call(server, 'POST', JSON.stringify({ action: 'complete', kind: 'todo', title: '不存在的任务' }))
    expect(r.status).toBe(404)
    expect(r.body).toEqual({ ok: false, error: 'todo not found', code: 'not_found', httpStatus: 404 })
  })

  it('non-JSON-object body (array) → 400', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', '[1,2,3]')
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('JSON object')
  })

  it('non-POST method → 405', async () => {
    const { server } = setup()
    const r = await call(server, 'GET', '')
    expect(r.status).toBe(405)
    expect(r.body.error).toContain('method not allowed')
  })

  it('oversized payload (>64KB) → 400', async () => {
    const { server } = setup()
    const r = await call(server, 'POST', 'x'.repeat(70 * 1024))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('payload too large')
  })

  // v0.3.3 review fix: scope routing validates against the workspace registry.
  it('unknown scope_cwd → 400 without creating a ghost workspace or dispatching', async () => {
    const { server, yolo } = setup({
      listWorkspaceMeta: vi.fn(() => [{ cwd: '/ws/known', scopeKey: 'known/main' }]),
    })
    const r = await call(server, 'POST', JSON.stringify({ action: 'complete', kind: 'todo', id: 't1', scope_cwd: '/ws/ghost' }))
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('unknown workspace scope')
    expect(yolo.applyTodoAction).not.toHaveBeenCalled()
  })

  it('a known scope_cwd routes AND pins the registered scopeKey', async () => {
    const runInScope = vi.fn((_cwd: string, _scopeKey: string, fn: () => unknown) => fn())
    const listWorkspaceMeta = vi.fn(() => [{ cwd: '/ws/known', scopeKey: 'known/main' }])
    const { server, yolo } = setup({ runInScope, listWorkspaceMeta })
    const r = await call(server, 'POST', JSON.stringify({ action: 'complete', kind: 'todo', id: 't1', scope_cwd: '/ws/known' }))
    expect(r.status).toBe(200)
    expect(runInScope).toHaveBeenCalledWith('/ws/known', 'known/main', expect.any(Function))
    expect(yolo.applyTodoAction).toHaveBeenCalledWith('/ws/known', { id: 't1' }, 'complete', { session_id: null })
  })

  it('returns HTTP 409 with a stable code when a client action id conflicts', async () => {
    const runIdempotentAction = vi.fn(() => ({ status: 'conflict' as const }))
    const { server } = setup({ runIdempotentAction })
    const r = await call(server, 'POST', JSON.stringify({
      action: 'complete', kind: 'todo', id: 't1', client_action_id: 'duplicate-id',
    }))
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ ok: false, code: 'idempotency_conflict', httpStatus: 409 })
  })
})
