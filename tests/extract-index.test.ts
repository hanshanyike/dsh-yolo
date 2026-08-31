// M7 extract plugin wiring tests — LLM semantic extraction is the only
// strategy. Exercises apply() registrations end to end: turn-end extraction,
// throttling, config gating, dedup context, and failure isolation.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import Yolo from '../src/storage/index.ts'
import { apply, sourceExcerptFromMessages } from '../src/extract/index.ts'
import { TODO_RESOLVER_VERSION } from '../src/extract/todo-resolver.ts'

type Handler = (...args: any[]) => void

const EMPTY_JSON = '{"todos":[],"milestones":[],"goals":[],"preferences":[],"events":[]}'

function chunkStream(text: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' } as StreamChunk
    yield { type: 'text-delta', index: 0, text } as StreamChunk
    yield { type: 'block-end', index: 0, block: { type: 'text', text } } as StreamChunk
  })()
}

interface SettingsStub {
  get(ns: unknown): {
    extraction?: {
      enableLLM?: boolean
      model?: string
      minIntervalSec?: number
      minTurnChars?: number
      maxRunsPerDay?: number
      todoIdentityR2Enabled?: boolean
      todoIdentityR3Enabled?: boolean
    }
  } | undefined
}

function makeCtx(
  yolo: Yolo,
  llmText: string,
  settings?: SettingsStub,
  resolverText = '{"resolutions":[]}',
) {
  const handlers = new Map<string, Handler>()
  const stream = vi.fn((opts: { system?: string }) => chunkStream(
    opts.system?.includes('shadow identity resolver') ? resolverText : llmText,
  ))
  const llm = { stream } as unknown as LlmRuntime
  const ctx = {
    yolo,
    llm,
    settings,
    logger: { info: vi.fn(), warn: vi.fn() },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers, stream }
}

function sessionLike(id: string, cwd: string) {
  const messages: Array<{ id: string; role: string; source: { kind: string }; content: Array<{ type: string; text: string }> }> = []
  return {
    id,
    header: { id, cwd },
    deriveMessages: () => messages,
    push(role: string, text: string) {
      messages.push({ id: `${id}-${messages.length}`, role, source: { kind: role === 'user' ? 'user' : 'model' }, content: [{ type: 'text', text }] })
    },
  }
}

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-extract-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('extract apply: LLM semantic extraction (only path)', () => {
  it('builds a bounded Unicode-safe excerpt from direct user input only', () => {
    const messages = [
      { source: { kind: 'system' }, content: [{ type: 'text', text: '系统秘密' }] },
      { source: { kind: 'tool' }, content: [{ type: 'text', text: '工具输出' }] },
      { source: { kind: 'user' }, content: [{ type: 'text', text: `  用户决定  ${'😀'.repeat(410)}` }] },
    ] as never
    const excerpt = sourceExcerptFromMessages(messages)
    expect(excerpt).not.toContain('系统秘密')
    expect(excerpt).not.toContain('工具输出')
    expect(Array.from(excerpt ?? '')).toHaveLength(400)
    expect(excerpt?.endsWith('\ud83d')).toBe(false)
  })

  it('registers pre-step capture plus deferred turn scheduling — the regex path is gone', () => {
    const { ctx, handlers } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    expect([...handlers.keys()]).toEqual(['agent/pre-step', 'session/event', 'agent/turn-stopping'])
  })

  it('merges an LLM extraction into storage and logs it', async () => {
    const llmJson = JSON.stringify({
      todos: [{ title: 'LLM 提取的任务', due_at: '2026-09-10' }, { title: '非法优先级任务', priority: 'super-duper' }],
      goals: [{ title: 'LLM 目标' }],
      milestones: [],
      preferences: [{ key: '主题', value: '极简' }],
      events: [{ kind: 'decision', summary: 'LLM 决策', occurred_at: '2026-08-20' }],
    })
    const { ctx, handlers } = makeCtx(yolo, llmJson)
    apply(ctx as never)
    const session = sessionLike('s1', cwd)
    session.push('user', '记住：下个月完成 LLM 抽取验证')

    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })

    const fallbackTodo = yolo.listTodos(cwd).find((t) => t.title === 'LLM 提取的任务')
    expect(fallbackTodo).toMatchObject({ session_id: 's1', source_excerpt: null, source_turn: null })
    // invalid LLM priority strings are dropped, not stored
    const bad = yolo.listTodos(cwd).find((t) => t.title === '非法优先级任务')
    expect(bad?.priority ?? null).toBeNull()
    expect(yolo.listGoals(cwd).some((g) => g.title === 'LLM 目标')).toBe(true)
    expect(yolo.listPreferences(cwd).some((p) => p.key === '主题' && p.value === '极简')).toBe(true)
    expect(yolo.listEvents(cwd).some((e) => e.summary === 'LLM 决策')).toBe(true)
  })

  it('keeps ambiguous goals as candidates and activates only explicit tracking intent', async () => {
    const llmJson = JSON.stringify({
      goals: [
        { title: '持续推进产品发布', management_intent: 'explicit', completion_hint: '生产环境稳定运行', target_date: '2026-09-30' },
        { title: '以后学会摄影', management_intent: 'unclear' },
      ],
      milestones: [], todos: [], preferences: [], events: [], updates: [],
    })
    const { ctx, handlers } = makeCtx(yolo, llmJson)
    apply(ctx as never)
    const session = sessionLike('s-candidate-goal', cwd)
    session.push('user', '我想持续推进产品发布，也许以后学会摄影')

    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })

    expect(yolo.listGoals(cwd)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '持续推进产品发布', status: 'active', completion_criteria: '生产环境稳定运行', target_date: '2026-09-30' }),
      expect.objectContaining({ title: '以后学会摄影', status: 'candidate' }),
    ]))
  })

  it('persists one extraction operation only once when the same session turn is replayed', async () => {
    const llmJson = JSON.stringify({
      todos: [{ title: '确认发布前的回归结果', due_at: '2026-09-02' }],
      milestones: [], goals: [], preferences: [], events: [], updates: [],
    })
    const settings = { get: () => ({ extraction: { minIntervalSec: 0 } }) }
    const { ctx, handlers, stream } = makeCtx(yolo, llmJson, settings)
    apply(ctx as never)
    const session = sessionLike('s-replayed-turn', cwd)
    const agent = { id: session.id, session }
    const message = {
      id: 'human-replayed-turn', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '请提醒我确认发布前的回归结果' }],
    }

    for (let replay = 0; replay < 2; replay++) {
      await handlers.get('agent/pre-step')!(
        { agent, messages: [message], turn: 7, step: 1, signal: new AbortController().signal },
        async () => ({ kind: 'enter', messages: [message] }),
      )
      await handlers.get('agent/turn-stopping')!({ agent, turn: 7 })
    }

    expect(stream).toHaveBeenCalledTimes(4)
    const todo = yolo.listTodos(cwd).find((row) => row.title === '确认发布前的回归结果')
    expect(todo).toBeTruthy()
    expect(yolo.listTodoEvidence(cwd, todo!.id)).toHaveLength(1)
    expect(yolo.countExtractionsSince(cwd, 0)).toBe(1)
  })

  it('captures the exact human message and extracts the explicit today commitment after idle', async () => {
    const llmJson = JSON.stringify({
      todos: [{ title: '完成针对 dsh-yolo 的分析报告', due_at: '2026-08-25' }],
      milestones: [], goals: [], preferences: [], events: [], updates: [],
    })
    const { ctx, handlers, stream } = makeCtx(yolo, llmJson)
    apply(ctx as never)
    const session = sessionLike('s-exact', cwd)
    const events: Array<{ type: string; data: { turn: number; reason: { kind: string } } }> = []
    Object.assign(session, { events })
    session.push('user', `这是不属于本轮的旧内容${'x'.repeat(8_200)}`)
    const message = {
      id: 'human-exact', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '今天我需要完成针对dsh-yolo的分析报告' }],
    }
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
    const agent = { id: 's-exact', options: { provider: 'custom-route', model: 'chat-model' }, session, status: 'running', whenIdle: () => idle }

    await handlers.get('agent/pre-step')!({ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [message] }))
    expect(handlers.get('agent/turn-stopping')!({ agent, turn: 1, signal: new AbortController().signal })).toBeUndefined()
    expect(stream).not.toHaveBeenCalled()
    const steering = { id: 'human-steer', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '报告重点分析自动记忆链路' }] }
    await handlers.get('agent/pre-step')!({ agent, messages: [steering], turn: 1, step: 2, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [steering] }))
    // turn-stopping may be revisited when late steering opens another step;
    // it must still produce one extraction for the completed turn.
    expect(handlers.get('agent/turn-stopping')!({ agent, turn: 1, signal: new AbortController().signal })).toBeUndefined()

    events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    agent.status = 'idle'
    releaseIdle()
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(2))

    const call = stream.mock.calls[0][0] as { provider: string; model: string; messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.provider).toBe('custom-route')
    expect(call.model).toBe('chat-model')
    expect(call.messages[0].content[0].text).toContain('今天我需要完成针对dsh-yolo的分析报告')
    expect(call.messages[0].content[0].text).toContain('报告重点分析自动记忆链路')
    expect(call.messages[0].content[0].text).not.toContain('不属于本轮')
    const extracted = yolo.listTodos(cwd).find((todo) => todo.title === '完成针对 dsh-yolo 的分析报告')
    expect(extracted).toMatchObject({
      session_id: 's-exact',
      source_turn: 1,
      source_excerpt: '今天我需要完成针对dsh-yolo的分析报告 报告重点分析自动记忆链路',
    })
  })

  it('promotes same-turn tool-created todos even when the extractor returns empty', async () => {
    const title = '把客户访谈纪要发给产品组（验证编号 RH0826C）'
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-tool-race', cwd)
    const message = {
      id: 'human-tool-race', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '[E2E] 明天下午三点提醒我把客户访谈纪要发给产品组，验证编号 RH0826C。' }],
    }
    Object.assign(session, { events: [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] })
    const agent = { id: session.id, options: {}, session, status: 'idle', whenIdle: async () => {} }

    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    // Mirrors the host agent's synchronous memory_write after pre-step and
    // before the independent post-turn extractor starts.
    yolo.addTodo(cwd, { title, due_at: '2026-08-27T15:00:00+08:00', source: 'tool', session_id: 's-tool-race', source_turn: 1 })
    await handlers.get('agent/turn-stopping')!({ agent, turn: 1 })
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(2))

    const todos = yolo.listTodos(cwd)
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({
      title,
      source: 'llm',
      session_id: 's-tool-race',
      source_turn: 1,
      source_excerpt: '[E2E] 明天下午三点提醒我把客户访谈纪要发给产品组，验证编号 RH0826C。',
    })
    expect(yolo.listTodoEvidence(cwd, todos[0]!.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'assistant_action', relation: 'origin' }),
      expect.objectContaining({ session_id: 's-tool-race', turn_seq: 1, source_kind: 'human', relation: 'origin' }),
    ]))
    expect(yolo.listTodoEvidence(cwd, todos[0]!.id)).toHaveLength(2)
    expect(JSON.parse(yolo.listTodoResolutions(cwd)[0].candidates_json)).toEqual([])
  })

  it('does not extract automatic Goal rounds that carry user-role goal messages', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-goal-round', cwd)
    const goalMessage = {
      id: 'goal-round-1', role: 'user',
      source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 },
      content: [{ type: 'text', text: '继续完成目标的下一步：补充回归测试' }],
    }
    session.deriveMessages().push(goalMessage)
    Object.assign(session, {
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: goalMessage },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    })

    await handlers.get('agent/pre-step')!(
      { agent: { id: session.id, session }, messages: [goalMessage], turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [goalMessage] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent: { id: session.id, session }, turn: 1 })

    expect(stream).not.toHaveBeenCalled()
  })

  it('does not treat a Goal message as human in the event-log-less compatibility fallback', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-legacy-goal', cwd)
    const goalMessage = {
      id: 'legacy-goal-round', role: 'user',
      source: { kind: 'goal', goalId: 'goal-legacy', revision: 1, round: 1 },
      content: [{ type: 'text', text: '继续目标内部步骤' }],
    }
    session.deriveMessages().push(goalMessage)

    await handlers.get('agent/turn-stopping')!({ agent: { id: session.id, session }, turn: 1 })

    expect(stream).not.toHaveBeenCalled()
  })

  it('extracts real human steering once while ignoring Goal continuation text', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-goal-steer', cwd)
    const goalMessage = {
      id: 'goal-round-2', role: 'user',
      source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 2 },
      content: [{ type: 'text', text: '继续完成目标的下一步：整理发布说明' }],
    }
    const steering = {
      id: 'human-goal-steer', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '发布说明改到明天完成' }],
    }
    session.deriveMessages().push(goalMessage, steering)
    Object.assign(session, {
      events: [
        { type: 'turn/start', data: { turn: 2 } },
        { type: 'user/message', data: goalMessage },
        { type: 'user/message', data: steering },
        { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
      ],
    })

    await handlers.get('agent/pre-step')!(
      { agent: { id: session.id, session }, messages: [goalMessage], turn: 2, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [goalMessage] }),
    )
    await handlers.get('agent/pre-step')!(
      { agent: { id: session.id, session }, messages: [steering], turn: 2, step: 2, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [steering] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent: { id: session.id, session }, turn: 2 })

    expect(stream).toHaveBeenCalledTimes(2)
    const call = stream.mock.calls[0][0] as { messages: Array<{ content: Array<{ text: string }> }> }
    expect(call.messages[0].content[0].text).toContain('发布说明改到明天完成')
    expect(call.messages[0].content[0].text).not.toContain('继续完成目标的下一步')
  })

  it('resolves relative dates from the accepted input time when extraction starts after midnight', async () => {
    // Construct both instants in the runner's host-local timezone. The
    // extractor promises host-local calendar semantics, whether CI runs in
    // UTC or a developer machine runs in Asia/Shanghai.
    let clock = new Date(2026, 7, 26, 23, 58).getTime()
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-midnight', cwd)
    const events: Array<{ type: string; data: { turn: number; reason: { kind: string } } }> = []
    Object.assign(session, { events })
    const message = {
      id: 'human-midnight', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '今天把值班记录发给组长' }],
    }
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
    const agent = { id: 's-midnight', options: {}, session, status: 'running', whenIdle: () => idle }

    await handlers.get('agent/pre-step')!({ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [message] }))
    handlers.get('agent/turn-stopping')!({ agent, turn: 1 })
    events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    agent.status = 'idle'
    clock = new Date(2026, 7, 27, 0, 2).getTime()
    releaseIdle()
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(2))

    const call = stream.mock.calls[0][0] as { system: string }
    expect(call.system).toContain('Current local datetime: 2026-08-26T23:58:00')
  })

  it('does not extract an aborted turn after idle', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-abort', cwd)
    const events: Array<{ type: string; data: { turn: number; reason: { kind: string } } }> = []
    Object.assign(session, { events })
    const message = { id: 'human-abort', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '今天完成报告' }] }
    let releaseIdle!: () => void
    const idle = new Promise<void>((resolve) => { releaseIdle = resolve })
    const agent = { id: 's-abort', options: {}, session, status: 'running', whenIdle: () => idle }
    await handlers.get('agent/pre-step')!({ agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [message] }))
    handlers.get('agent/turn-stopping')!({ agent, turn: 1, signal: new AbortController().signal })
    events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } })
    agent.status = 'idle'
    releaseIdle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stream).not.toHaveBeenCalled()
  })

  it('skips the model call when the turn has no text', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s2', cwd)
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).not.toHaveBeenCalled()
  })

  it('does not drop a second completed turn inside the old throttle interval', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { minIntervalSec: 0.02 } }),
    })
    apply(ctx as never)
    const session = sessionLike('s3', cwd)
    session.push('user', '需要抽取的内容')
    const onTurn = handlers.get('agent/turn-stopping')!

    await onTurn({ agent: { session }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(2)
    await onTurn({ agent: { session }, turn: 2 })
    expect(stream).toHaveBeenCalledTimes(4)
  })

  it('passes the dedup digest of known memories to the model', async () => {
    yolo.addTodo(cwd, { title: '已知待办甲', source: 'llm' })
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s4', cwd)
    session.push('user', '新的一轮对话')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })

    const call = stream.mock.calls[0]?.[0] as { messages: Array<{ content: Array<{ text: string }> }> }
    const userText = call.messages[0].content[0].text
    expect(userText).toContain('已知待办甲')
    expect(userText).toContain('Known memories')
    expect(userText).toContain('新的一轮对话')
  })

  it('logs stable-id shadow decisions without applying them to the todo', async () => {
    const { todo } = yolo.addTodo(cwd, {
      title: '把演示稿发给研发',
      due_at: '2026-09-01',
      source: 'llm',
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'UPDATE',
      candidate_ids: [todo.id],
      proposed_title: '把演示稿改到周五发给研发',
      confidence: 0.94,
      reason: '同一交付物和接收方，用户明确改期',
    }] })
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, undefined, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-shadow-update', cwd)
    session.push('user', '把演示稿改到周五发给研发')

    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 3 })

    expect(stream).toHaveBeenCalledTimes(2)
    expect(yolo.listTodos(cwd).find((row) => row.id === todo.id)?.due_at).toBe('2026-09-01')
    const [log] = yolo.listTodoResolutions(cwd)
    expect(log).toMatchObject({
      session_id: 's-shadow-update',
      turn_seq: 3,
      resolver_version: TODO_RESOLVER_VERSION,
      status: 'ok',
    })
    expect(JSON.parse(log.candidates_json)).toEqual([
      expect.objectContaining({ id: todo.id, title: todo.title }),
    ])
    expect(JSON.parse(log.resolutions_json)).toEqual([
      expect.objectContaining({ decision: 'UPDATE', candidate_ids: [todo.id] }),
    ])
  })

  it('R3 turns a model semantic LINK observation into an explainable merge suggestion without auto-merging', async () => {
    const { todo: existing } = yolo.addTodo(cwd, { title: '演示稿发给研发组', source: 'manual' })
    const llmJson = JSON.stringify({
      todos: [{ title: '把最终版 PPT 发送给开发团队' }],
      milestones: [], goals: [], preferences: [], events: [], updates: [],
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'LINK', candidate_ids: [existing.id], confidence: 0.84,
      reason: '交付物和接收团队一致，只是使用了 PPT 和开发团队的说法。',
    }] })
    const { ctx, handlers } = makeCtx(yolo, llmJson, {
      get: () => ({ extraction: { todoIdentityR3Enabled: true } }),
    }, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-r3-semantic-suggestion', cwd)
    const agent = { id: session.id, session }
    const message = {
      id: 'r3-semantic-human', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '提醒我把最终版 PPT 发送给开发团队' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 5, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 5 })

    expect(yolo.listTodos(cwd)).toHaveLength(2)
    expect(yolo.listDuplicateTodos(cwd)).toEqual([
      expect.objectContaining({
        a: existing.id, source: 'resolver', confidence: 0.84,
        reason: expect.stringContaining('交付物和接收团队一致'),
      }),
    ])
    expect(JSON.parse(yolo.listTodoResolutions(cwd)[0].application_json ?? 'null')).toMatchObject({
      status: 'fallback', plan: { reason: 'policy_disabled' },
    })
  })

  it('R2a links one high-confidence mention to an open stable id without creating a duplicate', async () => {
    const { todo } = yolo.addTodo(cwd, { title: '把演示稿发给研发', source: 'llm' })
    const llmJson = JSON.stringify({
      todos: [{ title: '给研发发送演示材料' }],
      milestones: [], goals: [], preferences: [], events: [], updates: [],
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'LINK', candidate_ids: [todo.id], confidence: 0.99, reason: '同一交付物和接收方',
    }] })
    const { ctx, handlers } = makeCtx(yolo, llmJson, {
      get: () => ({ extraction: { todoIdentityR2Enabled: true } }),
    }, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-r2-link', cwd)
    const agent = { id: session.id, session }
    const message = {
      id: 'r2-link-human', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '给研发的演示材料我还在继续准备' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 6, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 6 })

    expect(yolo.listTodos(cwd)).toHaveLength(1)
    expect(yolo.listTodoEvidence(cwd, todo.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ session_id: session.id, turn_seq: 6, relation: 'mention' }),
    ]))
    const application = JSON.parse(yolo.listTodoResolutions(cwd)[0].application_json ?? 'null')
    expect(application).toMatchObject({ status: 'linked', todo_id: todo.id, evidence_created: true })
    expect(application.evidence_id).toBeTypeOf('string')
  })

  it('R2a applies only an explicit due_at UPDATE through the stable id', async () => {
    const { todo } = yolo.addTodo(cwd, {
      title: '把客户访谈纪要发给产品组', due_at: '2026-09-02', source: 'llm',
    })
    const llmJson = JSON.stringify({
      todos: [], milestones: [], goals: [], preferences: [], events: [],
      updates: [{ kind: 'todo', match_title: '刚才那项', due_at: '2026-09-05' }],
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'UPDATE', candidate_ids: [todo.id], confidence: 0.99, reason: '明确改期',
    }] })
    const { ctx, handlers } = makeCtx(yolo, llmJson, {
      get: () => ({ extraction: { todoIdentityR2Enabled: true } }),
    }, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-r2-update', cwd)
    const agent = { id: session.id, session }
    const message = {
      id: 'r2-update-human', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '给产品组的客户访谈纪要改到 9 月 5 日再发' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 7, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 7 })

    expect(yolo.listTodos(cwd)).toHaveLength(1)
    expect(yolo.findTodo(cwd, { id: todo.id })?.due_at).toBe('2026-09-05')
    expect(yolo.listEvents(cwd).some((event) => event.kind === 'todo_postponed' && event.subject_id === todo.id)).toBe(true)
    expect(JSON.parse(yolo.listTodoResolutions(cwd)[0].application_json ?? 'null')).toMatchObject({
      status: 'updated', todo_id: todo.id, evidence_created: true,
      due_before: '2026-09-02', due_after: '2026-09-05',
    })
  })

  it('R2a blocks status UPDATE until that decision class has prediction evidence', async () => {
    const { todo } = yolo.addTodo(cwd, { title: '把演示稿发给研发', source: 'llm' })
    const llmJson = JSON.stringify({
      todos: [], milestones: [], goals: [], preferences: [], events: [],
      updates: [{ kind: 'todo', match_title: '演示材料', status: 'done' }],
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'UPDATE', candidate_ids: [todo.id], confidence: 0.99, reason: '明确完成',
    }] })
    const { ctx, handlers } = makeCtx(yolo, llmJson, {
      get: () => ({ extraction: { todoIdentityR2Enabled: true } }),
    }, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-r2-status-blocked', cwd)
    const agent = { id: session.id, session }
    const message = {
      id: 'r2-status-human', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '给研发的演示材料已经发完了' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 8, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 8 })

    expect(yolo.findTodo(cwd, { id: todo.id })?.status).toBe('pending')
    expect(JSON.parse(yolo.listTodoResolutions(cwd)[0].application_json ?? 'null')).toMatchObject({
      status: 'blocked', reason: 'update_field_not_authorized',
    })
  })

  it('snapshots candidate fields before same-turn assistant tools can mutate them', async () => {
    const { todo } = yolo.addTodo(cwd, {
      title: '把季度复盘材料发给产品负责人',
      due_at: '2026-09-04',
      source: 'manual',
    })
    const resolverText = JSON.stringify({ resolutions: [{
      decision: 'UPDATE', candidate_ids: [todo.id], confidence: 0.95, reason: '明确改期',
    }] })
    const { ctx, handlers } = makeCtx(yolo, EMPTY_JSON, undefined, resolverText)
    apply(ctx as never)
    const session = sessionLike('s-pre-tool-snapshot', cwd)
    const agent = { id: session.id, session }
    const { todo: secondTodo } = yolo.addTodo(cwd, {
      title: '把客户访谈纪要发给产品组',
      due_at: '2026-09-06',
      source: 'manual',
    })
    const message = {
      id: 'human-pre-tool-snapshot', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '把季度复盘材料改到 9 月 9 日再发给产品负责人' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [message], turn: 5, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [message] }),
    )
    // Mirrors the main agent's yolo_action before background extraction.
    yolo.applyTodoAction(cwd, { id: todo.id }, 'postpone', { due_at: '2026-09-09', session_id: session.id })
    const steering = {
      id: 'human-pre-tool-steering', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '另外，客户访谈纪要那项保持原计划' }],
    }
    await handlers.get('agent/pre-step')!(
      { agent, messages: [steering], turn: 5, step: 2, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [steering] }),
    )
    await handlers.get('agent/turn-stopping')!({ agent, turn: 5 })

    expect(yolo.listTodos(cwd).find((row) => row.id === todo.id)?.due_at).toBe('2026-09-09')
    const candidates = JSON.parse(yolo.listTodoResolutions(cwd)[0].candidates_json)
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: todo.id, due_at: '2026-09-04' }),
      expect.objectContaining({ id: secondTodo.id, due_at: '2026-09-06' }),
    ]))
  })

  it('keeps extraction authoritative when the shadow resolver fails', async () => {
    const llmJson = JSON.stringify({
      todos: [{ title: '发送项目周报给负责人' }],
      milestones: [], goals: [], preferences: [], events: [], updates: [],
    })
    const { ctx, handlers } = makeCtx(yolo, llmJson, undefined, '{"wrong":[]}')
    apply(ctx as never)
    const session = sessionLike('s-shadow-error', cwd)
    session.push('user', '提醒我发送项目周报给负责人')

    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 4 })

    expect(yolo.listTodos(cwd).some((row) => row.title === '发送项目周报给负责人')).toBe(true)
    expect(yolo.listTodoResolutions(cwd)[0]).toMatchObject({
      session_id: 's-shadow-error',
      status: 'error',
      resolutions_json: '[]',
    })
  })

  it('never throws into the agent loop', async () => {
    const handlers = new Map<string, Handler>()
    const badLlm = { stream: vi.fn(() => { throw new Error('llm down') }) } as unknown as LlmRuntime
    const ctx = {
      yolo,
      llm: badLlm,
      logger: { info: vi.fn(), warn: vi.fn() },
      on: (event: string, cb: Handler) => {
        handlers.set(event, cb)
        return () => handlers.delete(event)
      },
    }
    apply(ctx as never)
    const session = sessionLike('s5', cwd)
    session.push('user', '测试失败隔离')
    await expect(handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })).resolves.toBeUndefined()
    expect(yolo.listTodos(cwd)).toHaveLength(0)
  })
})

describe('extract apply: config gating', () => {
  it('does not call the model when extraction.enableLLM is false', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { enableLLM: false } }),
    })
    apply(ctx as never)
    const session = sessionLike('s6', cwd)
    session.push('user', '配置关闭时不应抽取')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).not.toHaveBeenCalled()
  })

  it('uses the configured model name', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { model: 'deepseek-reasoner' } }),
    })
    apply(ctx as never)
    const session = sessionLike('s7', cwd)
    session.push('user', '指定模型的抽取')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    const call = stream.mock.calls[0]?.[0] as { model: string }
    expect(call.model).toBe('deepseek-reasoner')
  })

  it('honors a smaller minIntervalSec from settings', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { minIntervalSec: 10 } }),
    })
    apply(ctx as never)
    const session = sessionLike('s8', cwd)
    session.push('user', '高频抽取节流验证')
    const onTurn = handlers.get('agent/turn-stopping')!

    await onTurn({ agent: { session }, turn: 1 })
    // travel past the 10s window: the last pull happened 11s ago
    const spy = vi.spyOn(Date, 'now')
    const realNow = Date.now()
    spy.mockReturnValue(realNow + 11_000)
    try {
      await onTurn({ agent: { session }, turn: 2 })
    } finally {
      spy.mockRestore()
    }
    expect(stream).toHaveBeenCalledTimes(4)
  })
})

describe('extract apply: frequency gates (M9 P44)', () => {
  it('skips the model call when the last user message is bare smalltalk', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-gate1', cwd)
    session.push('user', '帮我把演示稿发给研发，明天截止')
    session.push('assistant', '好的，我记下了，明天上午提醒你发出去。')
    session.push('user', '嗯')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).not.toHaveBeenCalled()
  })

  it('still extracts a short substantive reply like「周三交稿」', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-gate2', cwd)
    session.push('user', '周三交稿')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('measures the threshold on the last user message, not the whole turn tail', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s-gate3', cwd)
    session.push('user', '帮我把演示稿发给研发，明天截止')
    session.push('assistant', '收到。')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('honors a larger minTurnChars from settings', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { minTurnChars: 10 } }),
    })
    apply(ctx as never)
    const session = sessionLike('s-gate4', cwd)
    session.push('user', '周三交稿')
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).not.toHaveBeenCalled()
  })

  it('skips the model call and warns once the daily run cap is reached', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON, {
      get: () => ({ extraction: { maxRunsPerDay: 1 } }),
    })
    apply(ctx as never)
    const first = sessionLike('s-cap1', cwd)
    first.push('user', '帮我把演示稿发给研发，明天截止')
    await handlers.get('agent/turn-stopping')!({ agent: { session: first }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(2)
    const todayStart = new Date().setHours(0, 0, 0, 0)
    expect(yolo.countExtractionsSince(cwd, todayStart)).toBe(1)

    const second = sessionLike('s-cap2', cwd)
    second.push('user', '这周先把登录的 bug 修了')
    await handlers.get('agent/turn-stopping')!({ agent: { session: second }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(2) // capped — no second extraction or resolver pull
    expect((ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('writes an error audit row when the model call throws', async () => {
    const handlers = new Map<string, Handler>()
    const badLlm = { stream: vi.fn(() => { throw new Error('模型服务超时') }) } as unknown as LlmRuntime
    const ctx = {
      yolo,
      llm: badLlm,
      logger: { info: vi.fn(), warn: vi.fn() },
      on: (event: string, cb: Handler) => {
        handlers.set(event, cb)
        return () => handlers.delete(event)
      },
    }
    apply(ctx as never)
    const logSpy = vi.spyOn(yolo, 'logExtraction')
    const session = sessionLike('s-err', cwd)
    session.push('user', '帮我把演示稿发给研发，明天截止')

    await expect(handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })).resolves.toBeUndefined()

    expect(logSpy).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({
        session_id: 's-err',
        turn_seq: 1,
        strategy: 'llm',
        status: 'error',
      }),
    )
    const row = logSpy.mock.calls[0][1]
    expect(JSON.parse(row.extracted_json ?? '{}')).toEqual(expect.objectContaining({ error: '模型服务超时' }))
    logSpy.mockRestore()
  })

  it('audits an empty model stream as error instead of a false empty extraction', async () => {
    const { ctx, handlers } = makeCtx(yolo, '')
    apply(ctx as never)
    const logSpy = vi.spyOn(yolo, 'logExtraction')
    const session = sessionLike('s-no-text', cwd)
    session.push('user', '今天我需要完成针对dsh-yolo的分析报告')

    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })

    expect(logSpy).toHaveBeenCalledWith(
      cwd,
      expect.objectContaining({ status: 'error' }),
    )
    expect(JSON.parse(logSpy.mock.calls[0][1].extracted_json ?? '{}').error).toContain('returned no text')
  })
})
