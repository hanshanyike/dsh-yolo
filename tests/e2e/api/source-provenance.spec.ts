import { test, expect } from '@playwright/test'
import {
  connectApi,
  createFixtures,
  uid,
  waitForDashboard,
  withWorkspaceDatabase,
  type Api,
} from '../helpers.ts'

interface DashboardTodo {
  id: string
  title: string
  scope_cwd: string
  ws: { slug: string; label: string; cwd?: string }
  source?: {
    type: 'session' | 'manual' | 'tool' | 'legacy'
    label: string
    session_id?: string | null
    excerpt?: string | null
    turn?: number | null
    created_at?: number | null
    workspace?: { slug: string; label: string; cwd?: string }
  }
}

let api: Api
let fx: ReturnType<typeof createFixtures>

test.beforeAll(async () => { api = await connectApi() })
test.afterAll(async () => { await api.close() })
test.beforeEach(() => { fx = createFixtures(api) })
test.afterEach(async () => { await fx.dispose() })

async function dashboardTodo(id: string): Promise<{ dashboard: Record<string, any>; row: DashboardTodo }> {
  const dashboard = await waitForDashboard(api, (data) => (
    (data.todos ?? []).some((row: Record<string, any>) => String(row.id) === id)
  ), { label: `todo ${id} to appear with its source projection` })
  const row = dashboard.todos.find((candidate: Record<string, any>) => String(candidate.id) === id) as DashboardTodo
  return { dashboard, row }
}

function seedSource(
  row: DashboardTodo,
  source: { type: 'llm' | 'tool'; sessionId?: string | null; excerpt?: string | null; turn?: number | null; sessionLabel?: string },
): void {
  withWorkspaceDatabase(row, (db) => {
    db.prepare('UPDATE todos SET source = ?, session_id = ?, source_excerpt = ?, source_turn = ? WHERE id = ?')
      .run(source.type, source.sessionId ?? null, source.excerpt ?? null, source.turn ?? null, row.id)
    if (source.sessionId) {
      db.prepare(`INSERT INTO session_summaries(session_id, summary, scope_key, updated_at)
                  VALUES(?, ?, ?, ?)
                  ON CONFLICT(session_id) DO UPDATE SET summary=excluded.summary, scope_key=excluded.scope_key, updated_at=excluded.updated_at`)
        .run(source.sessionId, source.sessionLabel ?? '来源会话', row.ws.slug, Date.now())
    }
  })
}

function deleteSessionSummary(row: DashboardTodo, sessionId: string): void {
  withWorkspaceDatabase(row, (db) => {
    db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(sessionId)
  })
}

test('SRC-01: 快速记录通过真实 HTTP/SQLite 保存为 manual，capability 不伪造摘录或会话跳转', async () => {
  const created = await fx.todo(uid('把出差报销单交给财务'))
  const { dashboard, row } = await dashboardTodo(String(created.id))

  expect(dashboard.capabilities).toMatchObject({ sourceExcerpt: true })
  expect(row.source).toMatchObject({
    type: 'manual',
    label: '快速记一条',
    session_id: null,
    workspace: { slug: row.ws.slug, cwd: row.scope_cwd },
  })
  expect(row.source?.excerpt ?? null).toBeNull()
  expect(row.source?.turn ?? null).toBeNull()

  const persisted = withWorkspaceDatabase(row, (db) => db.prepare(
    'SELECT source, session_id, source_excerpt, source_turn FROM todos WHERE id = ?',
  ).get(row.id) as Record<string, unknown>)
  expect(persisted).toEqual({ source: 'manual', session_id: null, source_excerpt: null, source_turn: null })
})

test('SRC-01/SRC-03: session 来源保留 Unicode 有界摘录、可选 turn、精确 workspace owner，并与 SQLite 一致', async () => {
  const created = await fx.todo(uid('把客户访谈纪要发给产品组'))
  const initial = await dashboardTodo(String(created.id))
  const sessionId = `e2e-source-${Date.now()}`
  const sessionLabel = uid('客户访谈后的交付讨论')
  const excerpt = '明天下午三点提醒我把客户访谈纪要发给产品组，并在发送前确认附件中的中文标点与 emoji 🙂。'
  seedSource(initial.row, { type: 'llm', sessionId, excerpt, turn: 7, sessionLabel })

  try {
    const dashboard = await waitForDashboard(api, (data) => {
      const candidate = (data.todos ?? []).find((row: Record<string, any>) => String(row.id) === String(created.id))
      return candidate?.source?.session_id === sessionId && candidate?.source?.excerpt === excerpt
    }, { label: 'session provenance written in SQLite to reach the real HTTP projection' })
    const row = dashboard.todos.find((candidate: Record<string, any>) => String(candidate.id) === String(created.id)) as DashboardTodo

    expect(dashboard.capabilities).toMatchObject({ sourceExcerpt: true })
    expect(row.source).toMatchObject({
      type: 'session',
      label: sessionLabel,
      session_id: sessionId,
      excerpt,
      turn: 7,
      workspace: row.ws,
    })
    expect(row.source?.created_at).toEqual(expect.any(Number))
    expect(Array.from(row.source?.excerpt ?? '')).toHaveLength(Array.from(excerpt).length)
    expect(Array.from(row.source?.excerpt ?? '').length).toBeLessThanOrEqual(400)

    const persisted = withWorkspaceDatabase(row, (db) => db.prepare(
      'SELECT source, session_id, source_excerpt, source_turn FROM todos WHERE id = ?',
    ).get(row.id) as Record<string, unknown>)
    expect(persisted).toEqual({ source: 'llm', session_id: sessionId, source_excerpt: excerpt, source_turn: 7 })
  } finally {
    deleteSessionSummary(initial.row, sessionId)
  }
})

test('SRC-01: old session、legacy 与 tool 行通过真实 SQLite 状态明确降级，不因 capability 伪造 excerpt', async () => {
  const oldSession = await fx.todo(uid('确认旧会话里的体检预约'))
  const legacy = await fx.todo(uid('整理早期记录里的旅行安排'))
  const tool = await fx.todo(uid('核对助手创建的发布提醒'))
  const oldInitial = await dashboardTodo(String(oldSession.id))
  const legacyInitial = await dashboardTodo(String(legacy.id))
  const toolInitial = await dashboardTodo(String(tool.id))
  const sessionId = `e2e-old-source-${Date.now()}`
  const sessionLabel = uid('旧版体检安排讨论')

  seedSource(oldInitial.row, { type: 'llm', sessionId, excerpt: null, turn: null, sessionLabel })
  seedSource(legacyInitial.row, { type: 'llm' })
  seedSource(toolInitial.row, { type: 'tool' })

  try {
    const expectedIds = new Set([String(oldSession.id), String(legacy.id), String(tool.id)])
    const dashboard = await waitForDashboard(api, (data) => {
      const rows = (data.todos ?? []).filter((row: Record<string, any>) => expectedIds.has(String(row.id)))
      return rows.length === 3
        && rows.find((row: Record<string, any>) => String(row.id) === String(oldSession.id))?.source?.session_id === sessionId
        && rows.find((row: Record<string, any>) => String(row.id) === String(legacy.id))?.source?.type === 'legacy'
        && rows.find((row: Record<string, any>) => String(row.id) === String(tool.id))?.source?.type === 'tool'
    }, { label: 'legacy source variants to reach the real HTTP projection' })
    const byId = new Map((dashboard.todos as DashboardTodo[]).map((row) => [String(row.id), row]))

    expect(dashboard.capabilities).toMatchObject({ sourceExcerpt: true })
    expect(byId.get(String(oldSession.id))?.source).toMatchObject({
      type: 'session', label: sessionLabel, session_id: sessionId, excerpt: null, turn: null,
    })
    expect(byId.get(String(legacy.id))?.source).toMatchObject({
      type: 'legacy', label: '会话记录', session_id: null,
    })
    expect(byId.get(String(tool.id))?.source).toMatchObject({
      type: 'tool', label: '助手操作', session_id: null,
    })
    expect(byId.get(String(legacy.id))?.source?.excerpt ?? null).toBeNull()
    expect(byId.get(String(tool.id))?.source?.excerpt ?? null).toBeNull()
  } finally {
    deleteSessionSummary(oldInitial.row, sessionId)
  }
})
