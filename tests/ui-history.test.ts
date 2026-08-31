import { describe, expect, it } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import type { Goal, HistorySubjectStats, Milestone, TimelineEvent, Todo } from '../src/storage/types.ts'
import { buildHistoryData, registerHistoryEndpoint } from '../src/ui/history.ts'

const WS_A = 'D:\\work\\alpha'
const WS_B = 'D:\\work\\beta'

function event(id: string, occurredAt: number, over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id, kind: 'todo_updated', summary: `变化 ${id}`, occurred_at: occurredAt, scope_key: 'a/default',
    subject_type: 'todo', subject_id: 'todo-a', subject_title: '准备客户演示',
    ...over,
  }
}

function fakeYolo(failures = new Set<string>()): Yolo {
  const events: Record<string, TimelineEvent[]> = {
    [WS_A]: [
      event('a-new', 400, { change: { due_at: { before: '2026-08-29', after: '2026-09-01' } } }),
      event('a-old', 100, { kind: 'todo_created' }),
      event('legacy', 90, { kind: 'decision', subject_type: null, subject_id: null, subject_title: null }),
      event('audit', 500, { kind: 'action_denied' }),
    ],
    [WS_B]: [event('b-mid', 300, {
      scope_key: 'b/default', subject_id: 'todo-b', subject_title: '预约年度体检',
    })],
  }
  const todos: Record<string, Todo[]> = {
    [WS_A]: [{
      id: 'todo-a', title: '准备客户演示', status: 'in_progress', due_at: '2026-09-01', scope_key: 'a/default',
      created_at: 1, updated_at: 400, record_status: 'canonical',
    }],
    [WS_B]: [{
      id: 'todo-b', title: '预约年度体检', status: 'done', scope_key: 'b/default',
      created_at: 1, updated_at: 300, completed_at: 300, record_status: 'canonical',
    }],
  }
  const stats: Record<string, HistorySubjectStats[]> = {
    [WS_A]: [{ subject_type: 'todo', subject_id: 'todo-a', change_count: 2, last_changed_at: 400 }],
    [WS_B]: [{ subject_type: 'todo', subject_id: 'todo-b', change_count: 1, last_changed_at: 300 }],
  }
  const visible = (cwd: string, openedAt: number, limit: number, kinds: readonly string[]) => (events[cwd] ?? [])
    .filter((row) => row.occurred_at <= openedAt && kinds.includes(row.kind))
    .sort((left, right) => right.occurred_at - left.occurred_at)
    .slice(0, limit)
  return {
    listWorkspaceMeta: () => [{ cwd: WS_A, scopeKey: 'a/default' }, { cwd: WS_B, scopeKey: 'b/default' }],
    runInScope: (cwd: string, _scopeKey: string, fn: () => unknown) => {
      if (failures.has(cwd)) throw new Error('locked')
      return fn()
    },
    listSessionSummaries: () => [],
    listEventsUntil: visible,
    listEventsForSubject: (cwd: string, type: string, id: string, openedAt: number, limit: number, kinds: readonly string[]) =>
      visible(cwd, openedAt, limit, kinds).filter((row) => row.subject_type === type && row.subject_id === id),
    listEventSubjectStats: (cwd: string) => stats[cwd] ?? [],
    listLatestEventsBySubject: (cwd: string, openedAt: number, kinds: readonly string[]) => {
      const seen = new Set<string>()
      return visible(cwd, openedAt, 100, kinds).filter((row) => {
        const key = `${row.subject_type}:${row.subject_id}`
        if (!row.subject_id || seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
    listTodoRecords: (cwd: string) => todos[cwd] ?? [],
    listGoals: () => [] as Goal[],
    listMilestones: () => [] as Milestone[],
  } as unknown as Yolo
}

describe('history projection', () => {
  it('globally orders and paginates user-visible timeline events while retaining unlinked legacy facts', () => {
    const data = buildHistoryData(fakeYolo(), WS_A, {
      view: 'timeline', cursor: { openedAt: 450, offset: 0 }, limit: 3,
    })
    expect(data.events.map((row) => row.id)).toEqual(['a-new', 'b-mid', 'a-old'])
    expect(data.events[0]).toMatchObject({
      subject: { type: 'todo', id: 'todo-a', title: '准备客户演示' },
      change: { due_at: { before: '2026-08-29', after: '2026-09-01' } },
      ws: { label: 'alpha' },
    })
    expect(data.events.some((row) => row.id === 'audit')).toBe(false)
    expect(data.nextCursor).toEqual(expect.any(String))

    const legacy = buildHistoryData(fakeYolo(), WS_A, {
      view: 'timeline', cursor: { openedAt: 450, offset: 3 }, limit: 3,
    })
    expect(legacy.events).toHaveLength(1)
    expect(legacy.events[0]).not.toHaveProperty('subject')
  })

  it('groups current records by stable identity and applies ended status before pagination', () => {
    const all = buildHistoryData(fakeYolo(), WS_A, {
      view: 'items', cursor: { openedAt: 450, offset: 0 }, limit: 10,
    })
    expect(all.items.map((row) => row.id)).toEqual(['todo-a', 'todo-b'])
    expect(all.items[0]).toMatchObject({ change_count: 2, latest_summary: '变化 a-new', status: 'in_progress' })

    const ended = buildHistoryData(fakeYolo(), WS_A, {
      view: 'items', cursor: { openedAt: 450, offset: 0 }, limit: 10, status: 'ended',
    })
    expect(ended.items.map((row) => row.id)).toEqual(['todo-b'])
  })

  it('loads one subject in its owning workspace and reports partial aggregate reads', () => {
    const subject = buildHistoryData(fakeYolo(), WS_A, {
      view: 'subject', cursor: { openedAt: 450, offset: 0 }, limit: 10,
      subjectType: 'todo', subjectId: 'todo-a', subjectCwd: WS_A,
    })
    expect(subject.events.map((row) => row.id)).toEqual(['a-new', 'a-old'])

    const partial = buildHistoryData(fakeYolo(new Set([WS_B])), WS_A, {
      view: 'timeline', cursor: { openedAt: 450, offset: 0 }, limit: 10,
    })
    expect(partial.events.map((row) => row.id)).toEqual(['a-new', 'a-old', 'legacy'])
    expect(partial.partial).toBe(true)
    expect(partial.workspaceErrors).toEqual(['beta: locked'])
  })

  it('returns a complete JSON error before committing headers when projection serialization fails', () => {
    const yolo = {
      ...fakeYolo(),
      listEventsUntil: () => [event('not-json-safe', 400, { detail: 1n as never })],
    } as unknown as Yolo
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerHistoryEndpoint({
      webServer: {
        register: (options: { handler: (req: unknown, res: unknown) => void }) => { handler = options.handler },
      } as never,
    }, yolo, () => WS_A)

    const statuses: number[] = []
    const bodies: string[] = []
    handler?.({ method: 'GET', url: '/yolo/history?view=timeline' }, {
      writeHead: (status: number) => {
        if (statuses.length > 0) throw new Error('headers already sent')
        statuses.push(status)
      },
      end: (body?: string) => { bodies.push(body ?? '') },
    })

    expect(statuses).toEqual([400])
    expect(JSON.parse(bodies[0] ?? '')).toMatchObject({ code: 'history_request_failed' })
  })
})
