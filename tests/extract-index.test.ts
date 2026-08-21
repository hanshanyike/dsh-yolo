// M7 extract plugin wiring tests — LLM semantic extraction is the only
// strategy. Exercises apply() registrations end to end: turn-end extraction,
// throttling, config gating, dedup context, and failure isolation.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import Yolo from '../src/storage/index.ts'
import { apply } from '../src/extract/index.ts'

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
  get(ns: unknown): { extraction?: { enableLLM?: boolean; model?: string; minIntervalSec?: number } } | undefined
}

function makeCtx(yolo: Yolo, llmText: string, settings?: SettingsStub) {
  const handlers = new Map<string, Handler>()
  const stream = vi.fn((_opts: unknown) => chunkStream(llmText))
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
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('extract apply: LLM semantic extraction (only path)', () => {
  it('registers only the turn handler — the per-message regex path is gone', () => {
    const { ctx, handlers } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    expect([...handlers.keys()]).toEqual(['agent/turn-stopping'])
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

    expect(yolo.listTodos(cwd).some((t) => t.title === 'LLM 提取的任务')).toBe(true)
    // invalid LLM priority strings are dropped, not stored
    const bad = yolo.listTodos(cwd).find((t) => t.title === '非法优先级任务')
    expect(bad?.priority ?? null).toBeNull()
    expect(yolo.listGoals(cwd).some((g) => g.title === 'LLM 目标')).toBe(true)
    expect(yolo.listPreferences(cwd).some((p) => p.key === '主题' && p.value === '极简')).toBe(true)
    expect(yolo.listEvents(cwd).some((e) => e.summary === 'LLM 决策')).toBe(true)
  })

  it('skips the model call when the turn has no text', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s2', cwd)
    await handlers.get('agent/turn-stopping')!({ agent: { session }, turn: 1 })
    expect(stream).not.toHaveBeenCalled()
  })

  it('throttles repeat LLM pulls within the interval', async () => {
    const { ctx, handlers, stream } = makeCtx(yolo, EMPTY_JSON)
    apply(ctx as never)
    const session = sessionLike('s3', cwd)
    session.push('user', '需要抽取的内容')
    const onTurn = handlers.get('agent/turn-stopping')!

    await onTurn({ agent: { session }, turn: 1 })
    expect(stream).toHaveBeenCalledTimes(1)
    await onTurn({ agent: { session }, turn: 2 })
    expect(stream).toHaveBeenCalledTimes(1) // throttled
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
    expect(stream).toHaveBeenCalledTimes(2)
  })
})
