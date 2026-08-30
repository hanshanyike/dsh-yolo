import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TurnObservationService } from '../src/runtime/turn-observation.ts'
import Yolo from '../src/storage/index.ts'

function human(id: string, text: string, source: 'user' | 'goal' = 'user'): UserMessage {
  return {
    id,
    role: 'user',
    source: { kind: source },
    content: [{ type: 'text', text }],
  } as unknown as UserMessage
}

describe('TurnObservationService', () => {
  it('keeps captured human turns isolated across concurrent sessions', () => {
    const observations = new TurnObservationService()

    observations.captureHumanTurn('session-a', 4, 'C:\\ws\\alpha', [human('a-1', '把演示稿发给研发')], 100)
    observations.captureHumanTurn('session-b', 4, 'C:\\ws\\beta', [human('b-1', '明天下午确认客户时间')], 200)

    expect(observations.peekHumanTurn('session-a', 4)).toMatchObject({
      sessionId: 'session-a',
      turn: 4,
      cwd: 'C:\\ws\\alpha',
      acceptedAt: 100,
    })
    expect(observations.peekHumanTurn('session-b', 4)).toMatchObject({
      sessionId: 'session-b',
      turn: 4,
      cwd: 'C:\\ws\\beta',
      acceptedAt: 200,
    })
    expect(observations.takeHumanTurn('session-a', 4)?.messages.map((message) => message.id)).toEqual(['a-1'])
    expect(observations.peekHumanTurn('session-a', 4)).toBeUndefined()
    expect(observations.peekHumanTurn('session-b', 4)?.messages.map((message) => message.id)).toEqual(['b-1'])
  })

  it('merges late steering into the same turn without duplicating messages or moving acceptedAt', () => {
    const observations = new TurnObservationService()
    const first = human('human-1', '先把演示稿发给研发')
    const late = human('human-2', '再补一份风险说明')

    observations.captureHumanTurn('session-a', 7, 'C:\\ws\\alpha', [first], 1_000)
    observations.captureHumanTurn(
      'session-a',
      7,
      'C:\\ws\\alpha',
      [first, late, human('goal-1', '系统续跑', 'goal')],
      2_000,
    )

    const captured = observations.takeHumanTurn('session-a', 7)
    expect(captured?.acceptedAt).toBe(1_000)
    expect(captured?.messages.map((message) => message.id)).toEqual(['human-1', 'human-2'])
  })

  it('counts turn-stopping once when provider and consumer observe the same event', () => {
    const observations = new TurnObservationService()

    expect(observations.observeTurnStopping('session-a', 1, 'C:\\ws\\alpha', false)).toBe(1)
    expect(observations.observeTurnStopping('session-a', 1, 'C:\\ws\\alpha', false)).toBe(1)
    expect(observations.observeTurnStopping('session-b', 1, 'C:\\ws\\beta', false)).toBe(2)
    expect(observations.completedTurnCount()).toBe(2)
  })

  it('excludes YOLO-owned calls from all shared latest/cadence observations', () => {
    const observations = new TurnObservationService()
    observations.observeSession('work-1', 'C:\\ws\\alpha', false)
    observations.observeUserMessage('work-1', 'C:\\ws\\alpha', '季度汇报', false)
    observations.observeTurnStopping('work-1', 1, 'C:\\ws\\alpha', false)

    observations.observeSession('yolo-w-1', 'C:\\ws\\internal', true)
    observations.observeUserMessage('yolo-w-1', 'C:\\ws\\internal', '内部提醒回复', true)
    expect(observations.observeTurnStopping('yolo-w-1', 1, 'C:\\ws\\internal', true)).toBe(1)

    expect(observations.latestWorkspaceCwd()).toBe('C:\\ws\\alpha')
    expect(observations.latestUserText()).toBe('季度汇报')
    expect(observations.completedTurnCount()).toBe(1)
  })

  it('bounds retained sessions and turns, then clear resets every observable value', () => {
    const observations = new TurnObservationService({ maxSessions: 2, maxTurnsPerSession: 2 })

    observations.captureHumanTurn('session-a', 1, 'C:\\ws\\alpha', [human('a-1', '第一条')])
    observations.captureHumanTurn('session-a', 2, 'C:\\ws\\alpha', [human('a-2', '第二条')])
    observations.captureHumanTurn('session-a', 3, 'C:\\ws\\alpha', [human('a-3', '第三条')])
    expect(observations.peekHumanTurn('session-a', 1)).toBeUndefined()
    expect(observations.peekHumanTurn('session-a', 2)).toBeDefined()

    observations.captureHumanTurn('session-b', 1, 'C:\\ws\\beta', [human('b-1', '并发工作')])
    observations.captureHumanTurn('session-a', 4, 'C:\\ws\\alpha', [human('a-4', '刷新最近使用')])
    observations.captureHumanTurn('session-c', 1, 'C:\\ws\\gamma', [human('c-1', '第三个会话')])
    expect(observations.peekHumanTurn('session-b', 1)).toBeUndefined()
    expect(observations.peekHumanTurn('session-a', 4)).toBeDefined()
    expect(observations.peekHumanTurn('session-c', 1)).toBeDefined()

    observations.observeUserMessage('session-c', 'C:\\ws\\gamma', '需要记住的内容', false)
    observations.observeTurnStopping('session-c', 1, 'C:\\ws\\gamma', false)
    observations.clear()

    expect(observations.peekHumanTurn('session-a', 4)).toBeUndefined()
    expect(observations.latestWorkspaceCwd('C:\\fallback')).toBe('C:\\fallback')
    expect(observations.latestUserText()).toBe('')
    expect(observations.completedTurnCount()).toBe(0)
  })

  it('bounds turn-stopping idempotency keys instead of retaining them forever', () => {
    const observations = new TurnObservationService({ maxSessions: 1, maxTurnsPerSession: 2 })
    observations.observeTurnStopping('session-a', 1, undefined, false)
    observations.observeTurnStopping('session-a', 2, undefined, false)
    observations.observeTurnStopping('session-a', 3, undefined, false)

    // Turn 1 is now outside the bounded key window, so a future observation is
    // treated as a new completion rather than growing an unbounded tombstone set.
    expect(observations.observeTurnStopping('session-a', 1, undefined, false)).toBe(4)
  })
})

describe('Yolo observation provider wiring', () => {
  it('owns host observation once and rejects YOLO session traffic before consumers read it', () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-observation-provider-'))
    const handlers = new Map<string, Array<(...args: any[]) => unknown>>()
    const ctx = {
      logger: { info: () => {}, warn: () => {} },
      reflect: { provide: () => {} },
      on: (event: string, callback: (...args: any[]) => unknown) => {
        const listeners = handlers.get(event) ?? []
        listeners.push(callback)
        handlers.set(event, listeners)
        return () => {}
      },
      effect: () => () => {},
    }
    const yolo = new Yolo(ctx as never, { catalogPath: join(root, 'catalog', 'control.db') })
    const dispatch = (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    }

    dispatch('agent/session-start', {
      agent: { id: 'work-1', session: { header: { id: 'work-1', cwd: join(root, 'alpha') } } },
    })
    dispatch('session/event',
      { header: { id: 'work-1', cwd: join(root, 'alpha') } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '准备季度汇报材料' }] } },
    )
    dispatch('agent/turn-stopping', {
      agent: { id: 'work-1', session: { header: { id: 'work-1', cwd: join(root, 'alpha') } } },
      turn: 3,
    })
    // A duplicate delivery of the provider event is idempotent.
    dispatch('agent/turn-stopping', {
      agent: { id: 'work-1', session: { header: { id: 'work-1', cwd: join(root, 'alpha') } } },
      turn: 3,
    })
    dispatch('session/event',
      { header: { id: 'yolo-w-abc123def456', cwd: join(root, 'internal') } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '内部提醒回复' }] } },
    )
    dispatch('agent/turn-stopping', {
      agent: { id: 'yolo-w-abc123def456', session: { header: { id: 'yolo-w-abc123def456', cwd: join(root, 'internal') } } },
      turn: 1,
    })

    expect(yolo.observations.latestWorkspaceCwd()).toBe(join(root, 'alpha'))
    expect(yolo.observations.latestUserText()).toBe('准备季度汇报材料')
    expect(yolo.observations.completedTurnCount()).toBe(1)

    yolo.dispose()
    rmSync(root, { recursive: true, force: true })
  })
})
