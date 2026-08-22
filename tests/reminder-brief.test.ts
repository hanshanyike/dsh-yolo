// Daily brief tests (v0.3.0 D) — TD-1 timing/catch-up, once-per-day stamps,
// the deterministic markdown fallback (TD-6) and the fact collectors.

import { describe, expect, it, vi } from 'vitest'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type Yolo from '../src/storage/index.ts'
import type { Todo, TimelineEvent } from '../src/storage/types.ts'
import { runBriefTick, type BriefConfig } from '../src/reminder/scheduler.ts'
import { collectEveningFacts, collectMorningFacts, renderBriefMarkdown } from '../src/reminder/brief.ts'

const CWD = '/tmp/ws'
const CONFIG: BriefConfig = { enabled: true, morningTime: '09:00', eveningTime: '18:00', model: 'test-model' }

const at = (hm: string): () => Date => () => new Date(`2026-08-22T${hm}:00`)

const todo = (over: Partial<Todo> = {}): Todo =>
  ({ id: 't1', title: '某事', status: 'pending', due_at: null, created_at: 0, ...over }) as Todo
const event = (over: Partial<TimelineEvent>): TimelineEvent =>
  ({ id: 'e1', kind: 'note', summary: '', occurred_at: 0, ...over }) as TimelineEvent

function mockYolo(over: Partial<Record<keyof Yolo, unknown>> = {}): Yolo {
  return {
    listTodos: vi.fn(() => [] as Todo[]),
    listEventsBetween: vi.fn(() => [] as TimelineEvent[]),
    addNotification: vi.fn(),
    addEvent: vi.fn(),
    getBriefStamp: vi.fn(() => ''),
    setBriefStamp: vi.fn(),
    ...over,
  } as unknown as Yolo
}

describe('runBriefTick timing (TD-1)', () => {
  it('disabled → nothing fires', async () => {
    const yolo = mockYolo()
    const r = await runBriefTick({ yolo, cwd: () => CWD, config: { ...CONFIG, enabled: false }, now: at('20:00') })
    expect(r).toEqual({ morning: false, evening: false })
    expect(yolo.addNotification).not.toHaveBeenCalled()
  })

  it('before the morning time → nothing fires yet', async () => {
    const yolo = mockYolo()
    const r = await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, now: at('08:00') })
    expect(r).toEqual({ morning: false, evening: false })
  })

  it('between morning and evening → only the morning brief fires (catch-up)', async () => {
    const yolo = mockYolo()
    const r = await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, now: at('10:30') })
    expect(r).toEqual({ morning: true, evening: false })
    expect(yolo.addNotification).toHaveBeenCalledTimes(1)
    expect(yolo.addNotification).toHaveBeenCalledWith(
      CWD,
      expect.objectContaining({ kind: 'brief', title: '☀ 早报 · 2026-08-22' }),
    )
  })

  it('after both times → both cards once, stamps written', async () => {
    const yolo = mockYolo()
    const r = await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, now: at('20:00') })
    expect(r).toEqual({ morning: true, evening: true })
    expect(yolo.setBriefStamp).toHaveBeenCalledWith(CWD, 'morning', '2026-08-22')
    expect(yolo.setBriefStamp).toHaveBeenCalledWith(CWD, 'evening', '2026-08-22')
    expect(yolo.addNotification).toHaveBeenCalledTimes(2)
  })

  it('stamped today → not regenerated on the next tick', async () => {
    const yolo = mockYolo({ getBriefStamp: vi.fn(() => '2026-08-22') })
    const r = await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, now: at('20:00') })
    expect(r).toEqual({ morning: false, evening: false })
    expect(yolo.addNotification).not.toHaveBeenCalled()
  })
})

describe('brief body fallback (TD-6)', () => {
  it('no llm → the plain markdown facts are the card body', async () => {
    const yolo = mockYolo({
      listTodos: vi.fn(() => [todo({ title: '写周报', due_at: '2026-08-22' })]),
    })
    await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, now: at('10:00') })
    const call = (yolo.addNotification as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].body).toContain('☀ 早报 · 2026-08-22')
    expect(call[1].body).toContain('今日到期 1 件：写周报')
  })

  it('a failing llm call still yields the fallback body', async () => {
    const yolo = mockYolo()
    const brokenLlm = { stream: () => { throw new Error('llm down') } } as unknown as LlmRuntime
    await runBriefTick({ yolo, cwd: () => CWD, config: CONFIG, llm: brokenLlm, now: at('19:00') })
    // 19:00 已过两个时段：call[0] 早报、call[1] 晚报，正文都应是回退 markdown
    const calls = (yolo.addNotification as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][1].body).toContain('☀ 早报 · 2026-08-22')
    expect(calls[1][1].body).toContain('🌙 晚报 · 2026-08-22')
  })
})

describe('fact collectors', () => {
  it('morning: due today / overdue / goal moves each get a line', () => {
    const yolo = mockYolo({
      listTodos: vi.fn(() => [
        todo({ id: 'a', title: '今日事', due_at: '2026-08-22', created_at: 0 }),
        todo({ id: 'b', title: '逾期事', due_at: '2026-08-19', created_at: 0 }),
      ]),
      listEventsBetween: vi.fn(() => [event({ kind: 'goal_progress', summary: '目标A → 60%' })]),
    })
    const facts = collectMorningFacts(yolo, CWD, '2026-08-22')
    expect(facts[0]).toContain('今日到期 1 件：今日事')
    expect(facts[1]).toContain('逾期 1 件：逾期事')
    expect(facts[3]).toContain('目标进展 1 条')
  })

  it('evening: done today / still hanging / nearest next', () => {
    const yolo = mockYolo({
      listTodos: vi.fn(() => [
        todo({ id: 'a', title: '已完成', status: 'done', created_at: 0 }),
        todo({ id: 'b', title: '挂着', due_at: '2026-08-23', created_at: 0 }),
      ]),
      listEventsBetween: vi.fn(() => [event({ kind: 'todo_completed', summary: '完成：已完成' })]),
    })
    const facts = collectEveningFacts(yolo, CWD, '2026-08-22')
    expect(facts[0]).toContain('今日完成 1 件：已完成')
    expect(facts[2]).toContain('还挂着 1 件，最近的：挂着（2026-08-23）')
  })

  it('renderBriefMarkdown formats head + bullet lines', () => {
    const md = renderBriefMarkdown('morning', ['今日到期：无', '逾期：无'], '2026-08-22')
    expect(md.split('\n')).toEqual(['☀ 早报 · 2026-08-22', '', '- 今日到期：无', '- 逾期：无'])
  })
})
