// M8 extraction update-flow tests — state changes extracted by the LLM land on
// known items via the storage domain actions, milestones link by title, and
// hallucinated match titles are dropped silently.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import Yolo from '../src/storage/index.ts'
import { apply } from '../src/extract/index.ts'
import { validateExtraction } from '../src/extract/llm-extract.ts'

type Handler = (...args: any[]) => void

function chunkStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
    yield { type: 'text-delta', index: 0, text } as StreamChunk
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
  })()
}

function makeCtx(yolo: Yolo, llmText: string) {
  const handlers = new Map<string, Handler>()
  const stream = vi.fn((_opts: unknown) => chunkStream(llmText))
  const llm = { stream } as unknown as LlmRuntime
  const ctx = {
    yolo,
    llm,
    logger: { info: vi.fn(), warn: vi.fn() },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers, stream }
}

function sessionLike(id: string, cwd: string) {
  const message = { id: `${id}-human-1`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '对话内容' }] }
  return {
    id,
    header: { id, cwd },
    events: [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    deriveMessages: () => [message],
    message,
  }
}

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-updates-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

/** Run one turn with the given LLM JSON through the extract plugin. */
async function runTurn(llmJson: string, sessionId = 's1'): Promise<void> {
  const { ctx, handlers } = makeCtx(yolo, llmJson)
  apply(ctx as never)
  const session = sessionLike(sessionId, cwd)
  const agent = { id: session.id, session }
  await handlers.get('agent/pre-step')!(
    { agent, messages: [session.message], turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [session.message] }),
  )
  await handlers.get('agent/turn-stopping')!({ agent, turn: 1 })
}

describe('validateExtraction: updates array', () => {
  it('keeps well-formed updates and coerces progress', () => {
    const r = validateExtraction({
      updates: [
        { kind: 'todo', match_title: '写周报', status: 'done' },
        { kind: 'goal', match_title: '学会 Rust', progress: 45.6 },
        { kind: 'milestone', match_title: 'M8', status: 'done' },
      ],
    })
    expect(r.updates).toHaveLength(3)
    expect(r.updates[0]).toMatchObject({ kind: 'todo', match_title: '写周报', status: 'done' })
    expect(r.updates[1]).toMatchObject({ kind: 'goal', progress: 46 })
    expect(r.updates[2]).toMatchObject({ kind: 'milestone', status: 'done' })
  })

  it('drops malformed update entries instead of failing the batch', () => {
    const r = validateExtraction({
      updates: [
        { kind: 'preference', match_title: 'x' }, // wrong kind
        { match_title: 'no kind' }, // missing kind
        { kind: 'todo' }, // missing match_title
        { kind: 'todo', match_title: 'ok', status: 'done' },
      ],
    } as never)
    expect(r.updates).toHaveLength(1)
    expect(r.updates[0].match_title).toBe('ok')
  })
})

describe('merge: state updates land on known items', () => {
  it('completes / starts / cancels / postpones todos by title', async () => {
    const { todo: a } = yolo.addTodo(cwd, { title: '写季度报告初稿', due_at: '2026-08-22' })
    const { todo: b } = yolo.addTodo(cwd, { title: '修登录bug' })
    const { todo: c } = yolo.addTodo(cwd, { title: '放弃的实验' })
    const { todo: d } = yolo.addTodo(cwd, { title: '改期的会议', due_at: '2026-08-22' })

    await runTurn(
      JSON.stringify({
        updates: [
          { kind: 'todo', match_title: '写季度报告初稿', status: 'done' },
          { kind: 'todo', match_title: '修 登录bug', status: 'in_progress' },
          { kind: 'todo', match_title: '放弃的实验', status: 'cancelled' },
          { kind: 'todo', match_title: '改期的会议', due_at: '2026-08-25' },
        ],
      }),
    )

    const todos = yolo.listTodos(cwd)
    expect(todos.find((t) => t.id === a.id)?.status).toBe('done')
    expect(todos.find((t) => t.id === b.id)?.status).toBe('in_progress')
    expect(todos.find((t) => t.id === c.id)?.status).toBe('cancelled')
    const moved = todos.find((t) => t.id === d.id)
    expect(moved?.due_at).toBe('2026-08-25')

    // every transition left an audit event
    const kinds = new Set(yolo.listEvents(cwd).map((e) => e.kind))
    expect(kinds).toContain('todo_completed')
    expect(kinds).toContain('todo_started')
    expect(kinds).toContain('todo_cancelled')
    expect(kinds).toContain('todo_postponed')
  })

  it('updates goal progress and flips achieved at 100', async () => {
    yolo.addGoal(cwd, { title: '学会 Rust' })
    await runTurn(JSON.stringify({ updates: [{ kind: 'goal', match_title: '学会 Rust', progress: 60 }] }))
    expect(yolo.listGoals(cwd)[0].progress).toBe(60)

    await runTurn(JSON.stringify({ updates: [{ kind: 'goal', match_title: '学会 Rust', progress: 100 }] }), 's2')
    const g = yolo.listGoals(cwd)[0]
    expect(g.progress).toBe(100)
    expect(g.status).toBe('achieved')
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'goal_progress' && e.summary.includes('100%'))).toBe(true)
  })

  it('transitions milestone status', async () => {
    yolo.addMilestone(cwd, { title: 'v0.3 发布' })
    await runTurn(JSON.stringify({ updates: [{ kind: 'milestone', match_title: 'v0.3 发布', status: 'done' }] }))
    expect(yolo.listMilestones(cwd)[0].status).toBe('done')
    expect(yolo.listEvents(cwd).some((e) => e.kind === 'milestone_status')).toBe(true)
  })

  it('drops updates whose match title hits nothing (hallucination tolerance)', async () => {
    yolo.addTodo(cwd, { title: '唯一的待办' })
    await runTurn(
      JSON.stringify({
        updates: [
          { kind: 'todo', match_title: '不存在的任务', status: 'done' },
          { kind: 'goal', match_title: '不存在的目标', progress: 50 },
          { kind: 'milestone', match_title: '不存在的里程碑', status: 'done' },
        ],
      }),
    )
    expect(yolo.listTodos(cwd)[0].status).toBe('pending')
    expect(yolo.listEvents(cwd).filter((e) => e.kind !== 'note')).toHaveLength(0)
  })

  it('handles create-then-complete within a single turn (updates run after upserts)', async () => {
    await runTurn(
      JSON.stringify({
        todos: [{ title: '一次性小任务', due_at: '2026-08-22' }],
        updates: [{ kind: 'todo', match_title: '一次性小任务', status: 'done' }],
      }),
    )
    const todos = yolo.listTodos(cwd)
    expect(todos).toHaveLength(1)
    expect(todos[0].status).toBe('done')
  })
})

describe('merge: milestone linking', () => {
  it('links extracted todos and goals to milestones by title', async () => {
    yolo.addMilestone(cwd, { title: 'M8 发布' })
    await runTurn(
      JSON.stringify({
        todos: [{ title: '写发布说明', milestone_title: 'M8 发布' }],
        goals: [{ title: '达成 0.3 稳定', milestone_title: 'M8 发布' }],
      }),
    )
    const ms = yolo.listMilestones(cwd)[0]
    expect(yolo.listTodos(cwd)[0].milestone_id).toBe(ms.id)
    expect(yolo.listGoals(cwd)[0].milestone_id).toBe(ms.id)
  })

  it('links to a milestone extracted in the same turn (order: milestones first)', async () => {
    await runTurn(
      JSON.stringify({
        milestones: [{ title: '新里程碑' }],
        todos: [{ title: '新里程碑下的任务', milestone_title: '新里程碑' }],
      }),
    )
    const ms = yolo.listMilestones(cwd)[0]
    expect(yolo.listTodos(cwd)[0].milestone_id).toBe(ms.id)
  })

  it('leaves milestone_id null when the referenced milestone does not exist', async () => {
    await runTurn(JSON.stringify({ todos: [{ title: '孤儿任务', milestone_title: '幽灵里程碑' }] }))
    expect(yolo.listTodos(cwd)[0].milestone_id ?? null).toBeNull()
  })
})

describe('known digest carries state for targeted updates', () => {
  it('feeds status/progress/due to the model', async () => {
    yolo.addTodo(cwd, { title: '写周报', due_at: '2026-08-25' })
    yolo.addGoal(cwd, { title: '发布插件' })
    yolo.applyGoalProgress(cwd, { title: '发布插件' }, 40)
    yolo.addMilestone(cwd, { title: 'M7' })
    yolo.applyMilestoneStatus(cwd, { title: 'M7' }, 'active')

    const { ctx, handlers, stream } = makeCtx(yolo, '{"todos":[]}')
    apply(ctx as never)
    const session = sessionLike('digest', cwd)
    const agent = { id: session.id, session }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [session.message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [session.message] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 1 })

    const call = stream.mock.calls[0]?.[0] as { messages: Array<{ content: Array<{ text: string }> }> }
    const userText = call.messages[0].content[0].text
    expect(userText).toContain('[pending] 写周报 (due 2026-08-25)')
    expect(userText).toContain('[40%] 发布插件')
    expect(userText).toContain('[active] M7')
  })
})
