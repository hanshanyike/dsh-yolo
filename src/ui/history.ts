import type Yolo from '../storage/index.ts'
import type { HistorySubjectType } from '../domain/types.ts'
import type { YoloHistoryStatusFilter, YoloHistoryView } from '../shared/history.ts'
import {
  buildHistoryData,
  type HistoryCursorData,
} from '../application/read-models/history.ts'
import type { WebServerLike } from './dashboard.ts'

export * from '../application/read-models/history.ts'

const DEFAULT_LIMIT = 30

function send(
  res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void },
  status: number,
  body: unknown,
): void {
  // Serialize before committing response headers. If an unexpected value is
  // not JSON-safe, the outer request handler can still return a complete JSON
  // error instead of leaving the browser with an empty, half-written body.
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(payload)
}

function decodeCursor(value: string | null): HistoryCursorData | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<HistoryCursorData>
    if (!Number.isFinite(parsed.openedAt) || !Number.isInteger(parsed.offset) || parsed.offset! < 0) return undefined
    return { openedAt: parsed.openedAt!, offset: parsed.offset! }
  } catch {
    return undefined
  }
}

function requestUrl(req: unknown): URL {
  const raw = (req as { url?: string } | undefined)?.url ?? '/yolo/history'
  return new URL(raw, 'http://localhost')
}

function localDayBounds(day: string): { fromAt: number; toAt: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null
  const start = new Date(`${day}T00:00:00`)
  const [year, month, date] = day.split('-').map(Number)
  if (!Number.isFinite(start.getTime())
    || start.getFullYear() !== year
    || start.getMonth() + 1 !== month
    || start.getDate() !== date) return null
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { fromAt: start.getTime(), toAt: end.getTime() }
}

/** Thin HTTP adapter for the application-owned product history projection. */
export function registerHistoryEndpoint(ctx: { webServer?: WebServerLike }, yolo: Yolo, cwd: () => string): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/history',
    handler: (req, res) => {
      const url = requestUrl(req)
      const method = ((req as { method?: string } | undefined)?.method ?? 'GET').toUpperCase()
      if (method !== 'GET' || url.pathname !== '/yolo/history') {
        send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' })
        return
      }
      const view = (url.searchParams.get('view') ?? 'timeline') as YoloHistoryView
      if (!['timeline', 'items', 'subject'].includes(view)) {
        send(res, 400, { error: 'invalid view', code: 'invalid_view' })
        return
      }
      const cursorParam = url.searchParams.get('cursor')
      const cursor = decodeCursor(cursorParam)
      if (cursorParam && !cursor) {
        send(res, 400, { error: 'invalid cursor', code: 'invalid_cursor' })
        return
      }
      const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
      const limit = Number.isInteger(limitParam) ? limitParam : DEFAULT_LIMIT
      const status = (url.searchParams.get('status') ?? 'all') as YoloHistoryStatusFilter
      if (!['all', 'open', 'ended', 'completed', 'cancelled'].includes(status)) {
        send(res, 400, { error: 'invalid status', code: 'invalid_status' })
        return
      }
      const dayParam = url.searchParams.get('day')
      const dayBounds = dayParam === null ? undefined : localDayBounds(dayParam)
      if (dayParam !== null && !dayBounds) {
        send(res, 400, { error: 'invalid day', code: 'invalid_day' })
        return
      }
      try {
        const subjectTypeParam = url.searchParams.get('subject_type')
        const subjectType = subjectTypeParam && ['todo', 'goal', 'milestone'].includes(subjectTypeParam)
          ? subjectTypeParam as HistorySubjectType
          : undefined
        if (view === 'subject' && subjectTypeParam && !subjectType) {
          send(res, 400, { error: 'invalid subject_type', code: 'invalid_subject_type' })
          return
        }
        send(res, 200, buildHistoryData(yolo, cwd(), {
          view, cursor, limit, status,
          query: url.searchParams.get('q') ?? undefined,
          subjectType,
          subjectId: url.searchParams.get('subject_id') ?? undefined,
          subjectCwd: url.searchParams.get('scope_cwd') ?? undefined,
          fromAt: dayBounds?.fromAt,
          toAt: dayBounds?.toAt,
        }))
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), code: 'history_request_failed' })
      }
    },
  })
}
