import type Yolo from '../storage/index.ts'
import type { Notification } from '../storage/types.ts'
import type { YoloBadgeData, YoloBadgeNotification } from '../shared/badge.ts'
import type { WebServerLike } from './dashboard.ts'

function preview(notification: Notification | undefined, fallbackCwd: string): YoloBadgeNotification | undefined {
  if (!notification) return undefined
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body ?? null,
    todo_id: notification.todo_id ?? null,
    scope_cwd: notification.scope_cwd ?? fallbackCwd,
    created_at: notification.created_at,
  }
}

const RECENT_REMINDER_LIMIT = 5

function newestFirst(a: YoloBadgeNotification, b: YoloBadgeNotification): number {
  return b.created_at - a.created_at || a.id.localeCompare(b.id)
}

/** Count all known workspace notifications and return a bounded reminder feed. */
export function buildBadgeData(yolo: Yolo, fallbackCwd: string): YoloBadgeData {
  const metas = yolo.listWorkspaceMeta()
  if (metas.length === 0) {
    const unhandled = yolo.countUnhandledNotifications(fallbackCwd)
    const recentReminders = yolo.listRecentUnhandledReminders(fallbackCwd, RECENT_REMINDER_LIMIT)
      .map((row) => preview(row, fallbackCwd))
      .filter((row): row is YoloBadgeNotification => row !== undefined)
      .sort(newestFirst)
    return { unhandled, recentReminders }
  }

  let unhandled = 0
  let failures = 0
  const recentReminders: YoloBadgeNotification[] = []
  for (const { cwd, scopeKey } of metas) {
    try {
      const result = yolo.runInScope(cwd, scopeKey, () => ({
        count: yolo.countUnhandledNotifications(cwd),
        recent: yolo.listRecentUnhandledReminders(cwd, RECENT_REMINDER_LIMIT),
      }))
      unhandled += result.count
      recentReminders.push(...result.recent.map((row) => preview(row, cwd)).filter((row): row is YoloBadgeNotification => row !== undefined))
    } catch {
      failures += 1
    }
  }
  if (failures === metas.length) throw new Error('no workspace badge count could be read')
  recentReminders.sort(newestFirst)
  const unique = new Map<string, YoloBadgeNotification>()
  for (const row of recentReminders) {
    const key = `${row.scope_cwd ?? ''}\u0000${row.id}`
    if (!unique.has(key)) unique.set(key, row)
  }
  return {
    unhandled,
    recentReminders: [...unique.values()].slice(0, RECENT_REMINDER_LIMIT),
    ...(failures > 0 ? { partial: true } : {}),
  }
}

export function registerBadgeEndpoint(
  ctx: { webServer?: WebServerLike },
  yolo: Yolo,
  cwd: () => string,
): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/badge',
    handler: (_req, res) => {
      try {
        const data = buildBadgeData(yolo, cwd())
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-cache',
        })
        res.end(JSON.stringify(data))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  })
}
