// M1/M5 memory tools integration tests — real Yolo service over a temp dir,
// driving all four model-visible tools through their execute() handlers.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Yolo from '../src/storage/index.ts'
import { registerYoloTools, type YoloContext } from '../src/memory/tools.ts'

interface CapturedTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>, exec?: unknown): Promise<unknown>
}

let cwd: string
let yolo: Yolo
let tools: CapturedTool[]

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-tools-'))
  // memory tools resolve scope via process.cwd(); pin it to the temp dir so
  // the writes land in the same scope the assertions read.
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    reflect: { provide: () => {} },
    effect: () => () => {},
  } as never
  yolo = new Yolo(ctx)
  tools = []
  const yctx = {
    logger: { info: () => {}, warn: () => {} },
    tools: { register: (t: CapturedTool) => tools.push(t) },
    yolo,
  } as unknown as YoloContext
  registerYoloTools(yctx)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function tool(name: string): CapturedTool {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool not registered: ${name}`)
  return t
}

describe('registerYoloTools', () => {
  it('registers the five model-visible tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['memory_forget', 'memory_search', 'memory_write', 'yolo_action', 'yolo_query'].sort(),
    )
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10)
      expect(t.parameters).toBeTruthy()
    }
  })
})

describe('memory_write + yolo_query', () => {
  it('writes a todo and lists it back with status filter', async () => {
    const written = await tool('memory_write').execute({
      kind: 'todo',
      title: '完成发布检查',
      due_at: '2026-08-30',
      priority: 'high',
    }) as { id: string; title: string; due_at: string; priority: string }
    expect(written.id).toBeTruthy()
    expect(written.title).toBe('完成发布检查')
    expect(written.due_at).toBe('2026-08-30')
    expect(written.priority).toBe('high')

    const todos = (await tool('yolo_query').execute({ view: 'todos' }) as { rows: Array<{ id: string; title: string }> }).rows
    expect(todos.some((t) => t.id === written.id && t.title === '完成发布检查')).toBe(true)
    // status filter excludes it
    const done = await tool('yolo_query').execute({ view: 'todos', status: 'done' }) as { rows: Array<{ id: string }> }
    expect(done.rows.some((t) => t.id === written.id)).toBe(false)
  })

  it('stamps the calling session on provisional tool-created todos', async () => {
    const written = await tool('memory_write').execute(
      { kind: 'todo', title: '同步客户访谈纪要' },
      { agent: { session: { header: { id: 'session-tool-origin', cwd } } } },
    ) as { id: string }
    const row = yolo.listTodos(cwd).find((todo) => todo.id === written.id)
    expect(row).toMatchObject({ source: 'tool', session_id: 'session-tool-origin' })
  })

  it('writes milestones, goals, preferences and events; reads each view', async () => {
    await tool('memory_write').execute({ kind: 'milestone', title: 'M5 完成', target_date: '2026-09-01' })
    await tool('memory_write').execute({ kind: 'goal', title: '发布 v0.1', detail: '让社区用上' })
    await tool('memory_write').execute({ kind: 'preference', title: '语言偏好', key: '语言', value: '简体中文' })
    await tool('memory_write').execute({ kind: 'event', title: '确定了发布计划' })

    const milestones = (await tool('yolo_query').execute({ view: 'milestones' }) as { rows: Array<{ title: string }> }).rows
    expect(milestones.some((m) => m.title === 'M5 完成')).toBe(true)
    const goals = (await tool('yolo_query').execute({ view: 'goals' }) as { rows: Array<{ title: string; progress: number }> }).rows
    const g = goals.find((x) => x.title === '发布 v0.1')
    expect(g).toBeTruthy()
    expect(g!.progress).toBe(0)
    const prefs = (await tool('yolo_query').execute({ view: 'preferences' }) as { rows: Array<{ key: string; value: string }> }).rows
    expect(prefs.some((p) => p.key === '语言' && p.value === '简体中文')).toBe(true)
    const timeline = (await tool('yolo_query').execute({ view: 'timeline' }) as { rows: Array<{ summary: string }> }).rows
    expect(timeline.some((e) => e.summary === '确定了发布计划')).toBe(true)
  })

  it('rejects unknown kind and unknown view', async () => {
    await expect(tool('memory_write').execute({ kind: 'nope', title: 'x' })).rejects.toThrow(/unknown memory kind/)
    await expect(tool('yolo_query').execute({ view: 'nope' })).rejects.toThrow(/unknown view/)
  })
})

describe('yolo_action', () => {
  it('completes a todo by id (the reminder-reply flow)', async () => {
    const { todo: t } = yolo.addTodo(cwd, { title: '写季度报告', source: 'llm' })
    const res = (await tool('yolo_action').execute({ action: 'complete', kind: 'todo', id: t.id })) as { ok: boolean; item: { status: string } }
    expect(res.ok).toBe(true)
    expect(res.item.status).toBe('done')
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'todo_completed')).toBe(true)
  })

  it('postpones by fuzzy title and moves the due date', async () => {
    yolo.addTodo(cwd, { title: '写季度报告初稿', due_at: '2026-08-22', source: 'llm' })
    const res = (await tool('yolo_action').execute({ action: 'postpone', kind: 'todo', title: '季度报告', due_at: '2026-08-25' })) as { ok: boolean; item: { due_at: string } }
    expect(res.ok).toBe(true)
    expect(res.item.due_at).toBe('2026-08-25')
    expect(yolo.listTodos(cwd)[0].due_at).toBe('2026-08-25')
  })

  it('start / cancel / remind_again work and set_goal progress flips achieved', async () => {
    const { todo: t } = yolo.addTodo(cwd, { title: '修登录', source: 'llm' })
    await tool('yolo_action').execute({ action: 'start', kind: 'todo', id: t.id })
    expect(yolo.listTodos(cwd)[0].status).toBe('in_progress')

    yolo.setTodoReminded(cwd, t.id)
    await tool('yolo_action').execute({ action: 'remind_again', kind: 'todo', id: t.id })
    expect(yolo.listTodos(cwd)[0].last_reminded_at ?? null).toBeNull()

    await tool('yolo_action').execute({ action: 'cancel', kind: 'todo', id: t.id })
    expect(yolo.listTodos(cwd)[0].status).toBe('cancelled')

    yolo.addGoal(cwd, { title: '学会 Rust' })
    const g = (await tool('yolo_action').execute({ action: 'set_progress', kind: 'goal', title: '学会 Rust', progress: 100 })) as { ok: boolean; item: { status: string } }
    expect(g.ok).toBe(true)
    expect(g.item.status).toBe('achieved')
  })

  it('set_status transitions a milestone', async () => {
    yolo.addMilestone(cwd, { title: 'v0.3 发布' })
    const res = (await tool('yolo_action').execute({ action: 'set_status', kind: 'milestone', title: 'v0.3 发布', status: 'done' })) as { ok: boolean; item: { status: string } }
    expect(res.ok).toBe(true)
    expect(res.item.status).toBe('done')
  })

  it('validates combos and unknown items', async () => {
    const noRef = (await tool('yolo_action').execute({ action: 'complete', kind: 'todo' })) as { ok: boolean }
    expect(noRef.ok).toBe(false)
    const badCombo = (await tool('yolo_action').execute({ action: 'complete', kind: 'goal', title: 'x' })) as { ok: boolean }
    expect(badCombo.ok).toBe(false)
    const noDue = (await tool('yolo_action').execute({ action: 'postpone', kind: 'todo', title: 'x' })) as { ok: boolean }
    expect(noDue.ok).toBe(false)
    const missing = (await tool('yolo_action').execute({ action: 'complete', kind: 'todo', title: '不存在的任务' })) as { ok: boolean }
    expect(missing.ok).toBe(false)
  })
})

describe('memory_search + memory_forget', () => {
  it('searches written items and soft-deletes a todo', async () => {
    await tool('memory_write').execute({ kind: 'todo', title: '准备路演材料' })
    const hits = (await tool('memory_search').execute({ query: '路演材料', topK: 5 }) as { hits: unknown[] }).hits
    expect(hits.length).toBeGreaterThanOrEqual(1)

    const todos = (await tool('yolo_query').execute({ view: 'todos' }) as { rows: Array<{ id: string; status: string; title: string }> }).rows
    const t = todos.find((x) => x.title === '准备路演材料') ?? todos[0]
    const res = await tool('memory_forget').execute({ kind: 'todo', id: t.id }) as { ok: boolean }
    expect(res.ok).toBe(true)
    const after = (await tool('yolo_query').execute({ view: 'todos' }) as { rows: Array<{ id: string; status: string }> }).rows
    expect(after.find((x) => x.id === t.id)?.status).toBe('cancelled')
    // P34: forget now lands on the audited action path — the timeline shows it
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'todo_cancelled')).toBe(true)
  })

  it('forgets a goal by abandoning it (not just clearing progress) and audits the transition', async () => {
    yolo.addGoal(cwd, { title: '跟运营对齐双周排期' })
    const g = yolo.listGoals(cwd).find((x) => x.title === '跟运营对齐双周排期')!
    const res = (await tool('memory_forget').execute({ kind: 'goal', id: g.id })) as { ok: boolean; item: { status: string } }
    expect(res.ok).toBe(true)
    expect(res.item.status).toBe('abandoned')
    expect(yolo.listGoals(cwd).find((x) => x.id === g.id)?.status).toBe('abandoned')
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'goal_status')).toBe(true)
  })

  it('forgets a milestone through the audited set_status path', async () => {
    yolo.addMilestone(cwd, { title: '把演示稿发给研发' })
    const m = yolo.listMilestones(cwd)[0]
    const res = (await tool('memory_forget').execute({ kind: 'milestone', id: m.id })) as { ok: boolean; item: { status: string } }
    expect(res.ok).toBe(true)
    expect(res.item.status).toBe('abandoned')
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'milestone_status')).toBe(true)
  })

  it('forget on unsupported kind returns ok:false', async () => {
    const res = await tool('memory_forget').execute({ kind: 'preference', id: 'x' }) as { ok: boolean }
    expect(res.ok).toBe(false)
  })
})

describe('storage service surface (via tools)', () => {
  it('supports todo status transitions and due listing', async () => {
    const t = await tool('memory_write').execute({
      kind: 'todo', title: '本周要完成的事', due_at: '2026-08-21',
    }) as { id: string }
    const due = yolo.listDueTodos(cwd, '2026-08-30T00:00:00.000Z')
    expect(due.some((x) => x.id === t.id)).toBe(true)
    yolo.setTodoStatus(cwd, t.id, 'done')
    const after = yolo.listDueTodos(cwd, '2026-08-30T00:00:00.000Z')
    expect(after.some((x) => x.id === t.id)).toBe(false)
  })

  it('writes a markdown snapshot and stamps the date', () => {
    yolo.addTodo(cwd, { title: '快照测试项', source: 'manual' })
    const p = yolo.writeSnapshot(cwd, '2026-08-20')
    expect(p).toContain('.md')
    const md = yolo.renderSnapshot(cwd, '/tmp/x')
    expect(md).toContain('# YOLO')
  })

  it('queues and lists pending reminders', () => {
    const { todo: carrier } = yolo.addTodo(cwd, { title: '提醒载体', source: 'manual' })
    yolo.queueReminder(cwd, { todo_id: carrier.id, fire_at: Date.now() - 1000, payload: '⏰ 提醒' })
    const pending = yolo.listPendingReminders(cwd)
    expect(pending.length).toBe(1)
    expect(pending[0].payload).toContain('提醒')
    yolo.deletePendingReminder(cwd, pending[0].id)
    expect(yolo.listPendingReminders(cwd)).toHaveLength(0)
  })
})
