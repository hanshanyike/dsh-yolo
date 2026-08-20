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
  execute(args: Record<string, unknown>): Promise<unknown>
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
  it('registers the four model-visible tools', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['memory_forget', 'memory_search', 'memory_write', 'yolo_query'].sort(),
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

    const todos = await tool('yolo_query').execute({ view: 'todos' }) as Array<{ id: string; title: string }>
    expect(todos.some((t) => t.id === written.id && t.title === '完成发布检查')).toBe(true)
    // status filter excludes it
    const done = await tool('yolo_query').execute({ view: 'todos', status: 'done' }) as unknown[]
    expect((done as Array<{ id: string }>).some((t) => t.id === written.id)).toBe(false)
  })

  it('writes milestones, goals, preferences and events; reads each view', async () => {
    await tool('memory_write').execute({ kind: 'milestone', title: 'M5 完成', target_date: '2026-09-01' })
    await tool('memory_write').execute({ kind: 'goal', title: '发布 v0.1', detail: '让社区用上' })
    await tool('memory_write').execute({ kind: 'preference', title: '语言偏好', key: '语言', value: '简体中文' })
    await tool('memory_write').execute({ kind: 'event', title: '确定了发布计划' })

    const milestones = await tool('yolo_query').execute({ view: 'milestones' }) as Array<{ title: string }>
    expect(milestones.some((m) => m.title === 'M5 完成')).toBe(true)
    const goals = await tool('yolo_query').execute({ view: 'goals' }) as Array<{ title: string; progress: number }>
    const g = goals.find((x) => x.title === '发布 v0.1')
    expect(g).toBeTruthy()
    expect(g!.progress).toBe(0)
    const prefs = await tool('yolo_query').execute({ view: 'preferences' }) as Array<{ key: string; value: string }>
    expect(prefs.some((p) => p.key === '语言' && p.value === '简体中文')).toBe(true)
    const timeline = await tool('yolo_query').execute({ view: 'timeline' }) as Array<{ summary: string }>
    expect(timeline.some((e) => e.summary === '确定了发布计划')).toBe(true)
  })

  it('rejects unknown kind and unknown view', async () => {
    await expect(tool('memory_write').execute({ kind: 'nope', title: 'x' })).rejects.toThrow(/unknown memory kind/)
    await expect(tool('yolo_query').execute({ view: 'nope' })).rejects.toThrow(/unknown view/)
  })
})

describe('memory_search + memory_forget', () => {
  it('searches written items and soft-deletes a todo', async () => {
    await tool('memory_write').execute({ kind: 'todo', title: '准备路演材料' })
    const hits = await tool('memory_search').execute({ query: '路演材料', topK: 5 }) as unknown[]
    expect(hits.length).toBeGreaterThanOrEqual(1)

    const todos = await tool('yolo_query').execute({ view: 'todos' }) as Array<{ id: string; status: string; title: string }>
    const t = todos.find((x) => x.title === '准备路演材料') ?? todos[0]
    const res = await tool('memory_forget').execute({ kind: 'todo', id: t.id }) as { ok: boolean }
    expect(res.ok).toBe(true)
    const after = await tool('yolo_query').execute({ view: 'todos' }) as Array<{ id: string; status: string }>
    expect(after.find((x) => x.id === t.id)?.status).toBe('cancelled')
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
    const todo = yolo.addTodo(cwd, { title: '提醒载体', source: 'manual' })
    yolo.queueReminder(cwd, { todo_id: todo.id, fire_at: Date.now() - 1000, payload: '⏰ 提醒' })
    const pending = yolo.listPendingReminders(cwd)
    expect(pending.length).toBe(1)
    expect(pending[0].payload).toContain('提醒')
    yolo.deletePendingReminder(cwd, pending[0].id)
    expect(yolo.listPendingReminders(cwd)).toHaveLength(0)
  })
})
