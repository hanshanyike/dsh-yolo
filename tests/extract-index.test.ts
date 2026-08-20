// M2 extract plugin wiring tests — per-message rule capture + turn-end LLM
// extraction, exercising the apply() registrations end to end.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import Yolo from '../src/storage/index.ts'
import { apply } from '../src/extract/index.ts'

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
  const llm = { stream: vi.fn(() => chunkStream(llmText)) } as unknown as LlmRuntime
  const ctx = {
    yolo,
    llm,
    logger: { info: vi.fn(), warn: vi.fn() },
    on: (event: string, cb: Handler) => {
      handlers.set(event, cb)
      return () => handlers.delete(event)
    },
  }
  return { ctx, handlers, llm }
}

function sessionLike(id: string, cwd: string) {
  const messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = []
  return {
    id,
    meta: { cwd },
    deriveMessages: () => messages,
    push(role: string, text: string) {
      messages.push({ role, content: [{ type: 'text', text }] })
    },
  }
}

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-extract-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} } } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('extract apply: rule fast path', () => {
  it('captures a deadline todo from a user message and flushes at turn end', async () => {
    const { ctx, handlers } = makeCtx(yolo, '{"todos":[],"milestones":[],"goals":[],"preferences":[],"events":[]}')
    apply(ctx as never)

    const session = sessionLike('s1', cwd)
    const onEvent = handlers.get('session/event')!
    onEvent(session, { type: 'user/message', data: { content: [{ type: 'text', text: '请在明天前完成报告' }] } })

    // turn end flushes rule candidates into storage
    const onTurn = handlers.get('agent/turn-stopping')!
    await onTurn({ agent: { session }, turn: 1 })

    const todos = yolo.listTodos(cwd)
    expect(todos.some((t) => t.title.includes('完成报告'))).toBe(true)
    const withDue = todos.find((t) => t.title.includes('完成报告'))
    expect(withDue?.due_at).toBeTruthy()
  })

  it('ignores unrelated messages', async () => {
    const { ctx, handlers } = makeCtx(yolo, '{"todos":[],"milestones":[],"goals":[],"preferences":[],"events":[]}')
    apply(ctx as never)
    const session = sessionLike('s2', cwd)
    const onEvent = handlers.get('session/event')!
    onEvent(session, { type: 'user/message', data: { content: [{ type: 'text', text: '随便聊聊' }] } })
    const onTurn = handlers.get('agent/turn-stopping')!
    await onTurn({ agent: { session }, turn: 1 })
    expect(yolo.listTodos(cwd)).toHaveLength(0)
  })
})

describe('extract apply: LLM slow path', () => {
  it('merges LLM extraction into storage and logs it', async () => {
    const llmJson = JSON.stringify({
      todos: [{ title: 'LLM 提取的任务', due_at: '2026-09-10' }],
      goals: [{ title: 'LLM 目标' }],
      milestones: [],
      preferences: [{ key: '主题', value: '极简' }],
      events: [{ kind: 'decision', summary: 'LLM 决策', occurred_at: '2026-08-20' }],
    })
    const { ctx, handlers } = makeCtx(yolo, llmJson)
    apply(ctx as never)
    const session = sessionLike('s3', cwd)
    session.push('user', '记住：下个月完成 LLM 抽取验证')

    const onTurn = handlers.get('agent/turn-stopping')!
    await onTurn({ agent: { session }, turn: 2 })

    expect(yolo.listTodos(cwd).some((t) => t.title === 'LLM 提取的任务')).toBe(true)
    expect(yolo.listGoals(cwd).some((g) => g.title === 'LLM 目标')).toBe(true)
    expect(yolo.listPreferences(cwd).some((p) => p.key === '主题' && p.value === '极简')).toBe(true)
    expect(yolo.listEvents(cwd).some((e) => e.summary === 'LLM 决策')).toBe(true)
  })

  it('throttles repeat LLM pulls within the interval', async () => {
    const { ctx, handlers, llm } = makeCtx(yolo, '{"todos":[],"milestones":[],"goals":[],"preferences":[],"events":[]}')
    apply(ctx as never)
    const session = sessionLike('s4', cwd)
    session.push('user', '需要抽取的内容')
    const onTurn = handlers.get('agent/turn-stopping')!

    await onTurn({ agent: { session }, turn: 1 })
    expect(llm.stream).toHaveBeenCalledTimes(1)
    await onTurn({ agent: { session }, turn: 2 })
    expect(llm.stream).toHaveBeenCalledTimes(1) // throttled
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
    const onTurn = handlers.get('agent/turn-stopping')!
    await expect(onTurn({ agent: { session }, turn: 1 })).resolves.toBeUndefined()
    expect(yolo.listTodos(cwd)).toHaveLength(0)
  })
})
