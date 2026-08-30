import type Yolo from '../storage/index.ts'
import type { YoloNotificationSeenRequest } from '../shared/notifications.ts'
import {
  buildNotificationLogData,
  markNotificationsSeen,
  type NotificationCursorData,
} from '../application/read-models/notifications.ts'
import type { WebServerLike } from './dashboard.ts'

export * from '../application/read-models/notifications.ts'

interface ReqLike {
  method?: string
  url?: string
  on(event: 'data', cb: (chunk: Buffer) => void): ReqLike
  on(event: 'end', cb: () => void): ReqLike
  on(event: 'error', cb: (error: Error) => void): ReqLike
}

const MAX_BODY_BYTES = 16 * 1024
const DEFAULT_LIMIT = 20

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

function decodeCursor(value: string | null): NotificationCursorData | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<NotificationCursorData>
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

/** Thin HTTP adapter; notification projections and workspace routing are application-owned. */
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
          send(res, 200, markNotificationsSeen(yolo, cwd(), body as YoloNotificationSeenRequest))
          return
        }
        send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' })
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error), code: 'notification_request_failed' })
      }
    },
  })
}
