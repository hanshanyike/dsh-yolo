import type Yolo from '../storage/index.ts'
import { workspaceIdentity } from '../storage/scope.ts'
import type { Notification, Todo } from '../storage/types.ts'
import type {
  YoloNotificationLogData,
  YoloNotificationLogItem,
  YoloNotificationSeenOutcome,
  YoloNotificationSeenRequest,
} from '../shared/notifications.ts'
import { disambiguateWorkspaceLabels, workspaceLabel, type WebServerLike } from './dashboard.ts'
import { findKnownWorkspaceScope } from './workspace-scope.ts'

interface ReqLike {
  method?: string
  url?: string
  on(event: 'data', cb: (chunk: Buffer) => void): ReqLike
  on(event: 'end', cb: () => void): ReqLike
  on(event: 'error', cb: (error: Error) => void): ReqLike
}

interface CursorData {
  openedAt: number
  offset: number
}

const MAX_BODY_BYTES = 16 * 1024
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function reqLike(value: unknown): ReqLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as ReqLike
  return typeof candidate.on === 'function' ? candidate : undefined
}

function send(
  res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void },
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(body))
}

function readJsonBody(req: ReqLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        reject(new Error('payload too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function encodeCursor(cursor: CursorData): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null): CursorData | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorData>
    if (!Number.isFinite(parsed.openedAt) || !Number.isInteger(parsed.offset) || parsed.offset! < 0) return undefined
    return { openedAt: parsed.openedAt!, offset: parsed.offset! }
  } catch {
    return undefined
  }
}

function requestUrl(req: unknown): URL {
  const raw = (req as { url?: string } | undefined)?.url ?? '/yolo/notifications'
  return new URL(raw, 'http://localhost')
}

function metasOf(yolo: Yolo, fallbackCwd: string): Array<{ cwd: string; scopeKey: string }> {
  const known = yolo.listWorkspaceMeta()
  if (known.length > 0) return known
  const resolved = yolo.resolve(fallbackCwd)
  return [{ cwd: fallbackCwd, scopeKey: resolved.scopeKey }]
}

function itemOf(
  notification: Notification,
  cwd: string,
  scopeKey: string,
  label: string,
  todos: Map<string, Todo>,
): YoloNotificationLogItem {
  const todo = notification.todo_id ? todos.get(notification.todo_id) : undefined
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body ?? null,
    todo_id: notification.todo_id ?? null,
    scope_cwd: notification.scope_cwd ?? cwd,
    created_at: notification.created_at,
    seen: notification.seen_at != null,
    handled: notification.handled_at != null,
    ws: { slug: scopeKey, label, cwd },
    ...(todo
      ? { todo: { id: todo.id, title: todo.title, status: todo.status, due_at: todo.due_at ?? null } }
      : {}),
  }
}

function compareItems(left: YoloNotificationLogItem, right: YoloNotificationLogItem): number {
  return right.created_at - left.created_at
    || right.scope_cwd.localeCompare(left.scope_cwd)
    || right.id.localeCompare(left.id)
}

export function buildNotificationLogData(
  yolo: Yolo,
  fallbackCwd: string,
  options: { cursor?: CursorData; limit?: number } = {},
): YoloNotificationLogData {
  const openedAt = options.cursor?.openedAt ?? Date.now()
  const offset = options.cursor?.offset ?? 0
  const limit = Math.max(1, Math.min(MAX_LIMIT, options.limit ?? DEFAULT_LIMIT))
  const fetchLimit = offset + limit + 1
  const metas = metasOf(yolo, fallbackCwd)
  const labels = disambiguateWorkspaceLabels(metas)
  const rows: YoloNotificationLogItem[] = []
  const errors: string[] = []
  let unseen = 0

  for (const meta of metas) {
    try {
      yolo.runInScope(meta.cwd, meta.scopeKey, () => {
        const todos = new Map(yolo.listTodos(meta.cwd).map((todo) => [todo.id, todo]))
        const label = labels.get(workspaceIdentity(meta.cwd)) ?? workspaceLabel(meta.cwd, meta.scopeKey)
        rows.push(...yolo.listNotificationsUntil(meta.cwd, openedAt, fetchLimit)
          .map((notification) => itemOf(notification, meta.cwd, meta.scopeKey, label, todos)))
        unseen += yolo.countUnseenNotifications(meta.cwd)
      })
    } catch (error) {
      errors.push(`${workspaceLabel(meta.cwd, meta.scopeKey)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length === metas.length) throw new Error(errors[0] ?? 'no workspace notification log could be read')
  rows.sort(compareItems)
  const items = rows.slice(offset, offset + limit)
  const hasMore = rows.length > offset + limit
  return {
    items,
    unseen,
    openedAt,
    nextCursor: hasMore ? encodeCursor({ openedAt, offset: offset + items.length }) : null,
    partial: errors.length > 0,
    workspaceErrors: errors,
    revision: Date.now(),
  }
}

function markSeen(
  yolo: Yolo,
  fallbackCwd: string,
  request: YoloNotificationSeenRequest,
): YoloNotificationSeenOutcome {
  const metas = metasOf(yolo, fallbackCwd)
  let changed = 0
  let failures = 0

  if (request.notification) {
    const meta = findKnownWorkspaceScope(request.notification.scope_cwd, metas)
    if (!meta) throw new Error('unknown workspace scope')
    changed += yolo.runInScope(meta.cwd, meta.scopeKey, () => (
      yolo.markNotificationSeen(meta.cwd, request.notification!.id) ? 1 : 0
    ))
  } else if (Number.isFinite(request.opened_at)) {
    for (const meta of metas) {
      try {
        changed += yolo.runInScope(meta.cwd, meta.scopeKey, () => (
          yolo.markNotificationsSeenThrough(meta.cwd, request.opened_at!)
        ))
      } catch {
        failures += 1
      }
    }
    if (failures === metas.length) throw new Error('no workspace notification baseline could be updated')
  } else {
    throw new Error('opened_at or notification is required')
  }

  let unseen = 0
  let countFailures = 0
  for (const meta of metas) {
    try {
      unseen += yolo.runInScope(meta.cwd, meta.scopeKey, () => yolo.countUnseenNotifications(meta.cwd))
    } catch {
      countFailures += 1
    }
  }
  return {
    ok: true,
    changed,
    unseen,
    partial: failures > 0 || countFailures > 0,
    revision: Date.now(),
  }
}

/** GET paginates the immutable record; POST /seen updates only viewing state. */
export function registerNotificationsEndpoint(
  ctx: { webServer?: WebServerLike },
  yolo: Yolo,
  cwd: () => string,
): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/notifications',
    handler: async (req, res) => {
      const url = requestUrl(req)
      const method = ((req as { method?: string } | undefined)?.method ?? 'GET').toUpperCase()
      try {
        if (method === 'GET' && url.pathname === '/yolo/notifications') {
          const cursorParam = url.searchParams.get('cursor')
          const cursor = decodeCursor(cursorParam)
          if (cursorParam && !cursor) {
            send(res, 400, { error: 'invalid cursor', code: 'invalid_cursor' })
            return
          }
          const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
          const limit = Number.isInteger(limitParam) ? limitParam : DEFAULT_LIMIT
          send(res, 200, buildNotificationLogData(yolo, cwd(), { cursor, limit }))
          return
        }
        if (method === 'POST' && url.pathname === '/yolo/notifications/seen') {
          const readable = reqLike(req)
          if (!readable) {
            send(res, 400, { error: 'bad request', code: 'bad_request' })
            return
          }
          const body = await readJsonBody(readable)
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            send(res, 400, { error: 'body must be a JSON object', code: 'invalid_body' })
            return
          }
          send(res, 200, markSeen(yolo, cwd(), body as YoloNotificationSeenRequest))
          return
        }
        send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), code: 'notification_request_failed' })
      }
    },
  })
}
