import type Yolo from '../../storage/index.ts'
import type { Notification, Todo } from '../../domain/types.ts'
import type {
  YoloNotificationLogData,
  YoloNotificationLogItem,
  YoloNotificationSeenOutcome,
  YoloNotificationSeenRequest,
} from '../../shared/notifications.ts'
import { workspaceIdentity } from '../../domain/scope.ts'
import { findKnownWorkspaceScope } from '../workspace-scope.ts'
import { disambiguateWorkspaceLabels, workspaceLabel } from './dashboard.ts'

export interface NotificationCursorData {
  openedAt: number
  offset: number
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function encodeCursor(cursor: NotificationCursorData): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
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

/** Build the cursor-paginated notification record across known workspaces. */
export function buildNotificationLogData(
  yolo: Yolo,
  fallbackCwd: string,
  options: { cursor?: NotificationCursorData; limit?: number } = {},
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

/** Update notification viewing state through application-owned workspace routing. */
export function markNotificationsSeen(
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
