// Host-side dashboard projection (M7) — the single data source for the
// browser-side YOLO panel. Serves the projection as JSON over HTTP
// (GET /yolo/dashboard). No per-session durable events: the dashboard is a
// global, session-independent surface.
//
// M8: rows carry the plan context (milestone_title) and the "where is it
// stuck" signals (overdue / stale).
// v0.3.0: adds the day ledger (events joined with session-summaries as source
// badges), notification cards, and the unhandled badge count.
// v0.3.0 cross-workspace: `?scope=all` unions every known workspace (opt-in,
// read-only) and tags each row with its owning workspace.

import { basename } from 'node:path'
import type Yolo from '../storage/index.ts'
import type { TimelineEvent } from '../storage/types.ts'
import type {
  YoloDashboardData,
  YoloLedgerEntry,
  YoloNotificationRow,
  YoloWorkspaceInfo,
  YoloMemoryHealth,
  WorkspaceTag,
} from '../shared/dashboard.ts'
import { isTodoOverdue, isTodoStale } from '../shared/dashboard.ts'
import { localDateStr, dayBounds } from '../shared/text.ts'

export interface WebServerLike {
  register(opts: {
    kind: 'prefix'
    path: string
    handler: (req: unknown, res: {
      writeHead(status: number, headers: Record<string, string>): void
      end(body?: string): void
    }) => Promise<void> | void
  }): void
}

/** Resolve the source-badge label of one event (TC-3/TC-5, open question #4). */
function eventLabel(e: TimelineEvent, sessions: Map<string, string>): string {
  if (e.session_id) return sessions.get(e.session_id) ?? '来源会话'
  if (e.source === 'manual') return e.kind === 'todo_created' ? '快速记一条' : '看板操作'
  if (e.source === 'llm') return '会话记录'
  if (e.source === 'tool') return '助手操作'
  return '早期记录'
}

/** Build a human workspace label from a cwd (basename; fall back to the scope slug). */
export function workspaceLabel(cwd: string, scopeKey: string): string {
  const name = basename(cwd.replace(/[\\/]+$/, ''))
  return name || scopeKey
}

/** Surface memory-health metrics for the current scope (recall/extraction quality + duplicate candidates). */
export function buildMemoryHealth(yolo: Yolo, cwd: string): YoloMemoryHealth {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const recallRunsToday = yolo.countRecallSince?.(cwd, todayStart) ?? 0
  const recallOk = yolo.countRecallStatusSince?.(cwd, 'ok', todayStart) ?? 0
  const recallErrorsToday = yolo.countRecallStatusSince?.(cwd, 'error', todayStart) ?? 0
  const recallHitRate = recallRunsToday === 0 ? 0 : Math.round((recallOk / recallRunsToday) * 100) / 100
  return {
    recallRunsToday,
    recallHitRate,
    recallErrorsToday,
    extractionErrorsToday: yolo.countExtractionErrorsSince?.(cwd, todayStart) ?? 0,
    deniedToday: yolo.countEventKindSince?.(cwd, 'action_denied', todayStart) ?? 0,
    duplicateTodos: yolo.listDuplicateTodos?.(cwd) ?? [],
  }
}
/** Build the full dashboard projection for a workspace scope. */
export function buildDashboardData(yolo: Yolo, cwd: string, day = localDateStr(), ws?: WorkspaceTag): YoloDashboardData {
  const now = Date.now()
  const milestones = yolo.listMilestones(cwd)
  const msTitle = new Map(milestones.map((m) => [m.id, m.title]))
  const sessions = new Map(yolo.listSessionSummaries(cwd).map((s) => [s.session_id, s.summary]))

  const todos = yolo.listTodos(cwd).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_at: t.due_at,
    milestone_title: t.milestone_id ? msTitle.get(t.milestone_id) ?? null : null,
    updated_at: t.updated_at,
    completed_at: t.completed_at ?? null,
    overdue: isTodoOverdue(t.due_at, t.status, new Date(now)),
    stale: isTodoStale(t.status, t.updated_at, now),
    session_label: t.session_id
      ? sessions.get(t.session_id) ?? '来源会话'
      : t.source === 'manual'
        ? '快速记一条'
        : null,
    // v0.3.2 feedback signal (P/B1): how the user's history treats this commitment
    belief: { good: t.good_count ?? 0, stale: t.stale_count ?? 0 },
    ws,
  }))

  const { from, to } = dayBounds(day)
  const dayEvents = yolo.listEventsBetween(cwd, from, to)
  const ledger: YoloLedgerEntry[] = dayEvents.map((e) => ({
    id: e.id,
    kind: e.kind,
    summary: e.summary,
    detail: e.detail ?? null,
    occurred_at: e.occurred_at,
    label: eventLabel(e, sessions),
    session_id: e.session_id ?? null,
    ws,
  }))
  const ledgerSessions = new Set(dayEvents.map((e) => e.session_id).filter((s): s is string => !!s)).size

  const notifications: YoloNotificationRow[] = yolo.listNotifications(cwd, 12).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    todo_id: n.todo_id ?? null,
    created_at: n.created_at,
    handled: n.handled_at != null,
    ws,
  }))

  const scopeKey = yolo.resolve(cwd).scopeKey
  return {
    scopeKey,
    cwd,
    at: now,
    todos,
    goals: yolo.listGoals(cwd).map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      progress: g.progress,
      milestone_title: g.milestone_id ? msTitle.get(g.milestone_id) ?? null : null,
      ws,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      target_date: m.target_date,
      ws,
    })),
    events: yolo.listEvents(cwd, 30).map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      occurred_at: e.occurred_at,
      ws,
    })),
    preferences: yolo.listPreferences(cwd).map((p) => ({
      id: p.id,
      key: p.key,
      value: p.value,
      ws,
    })),
    ledger,
    ledgerDay: day,
    ledgerSessions,
    notifications,
    // v0.3.3 review fix: count ALL unhandled notifications, not just those that
    // fit the 12-row display slice — the badge is a promise ("N 件未处理") and
    // must not undercount when older cards are still open.
    unhandled: yolo.listUnhandledNotifications(cwd).length,
    health: buildMemoryHealth(yolo, cwd),
    focusDefaultCount: 0,
  }
}

/** Dedup a row list across workspaces by (owner slug, row id). */
function mergeRows<T extends { id: string; ws?: WorkspaceTag }>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const key = `${r.ws?.slug ?? ''}|${r.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/** Union several workspace dashboards into one cross-workspace (scope:all) view.
 *  v0.3.3 review fixes: ledger/notifications are re-sorted into ONE global time
 *  order (per-workspace slices were simply concatenated), and memory-health
 *  metrics are merged across workspaces instead of inheriting the first one. */
export function aggregateDashboards(list: readonly YoloDashboardData[]): YoloDashboardData {
  const base = list[0]
  if (!base) throw new Error('aggregateDashboards: empty dashboard list')
  const allTodos = mergeRows(list.flatMap((d) => d.todos))
  const allGoals = mergeRows(list.flatMap((d) => d.goals))
  const allMilestones = mergeRows(list.flatMap((d) => d.milestones))
  const allEvents = mergeRows(list.flatMap((d) => d.events))
  const allPrefs = mergeRows(list.flatMap((d) => d.preferences))
  const allLedger = mergeRows(list.flatMap((d) => d.ledger)).sort((a, b) => b.occurred_at - a.occurred_at)
  const allNotifications = mergeRows(list.flatMap((d) => d.notifications)).sort((a, b) => b.created_at - a.created_at)

  // health: sum the counters; weight each hit-rate by its run count
  const healths = list.map((d) => d.health).filter((h): h is YoloMemoryHealth => h !== undefined)
  let health: YoloMemoryHealth | undefined
  if (healths.length > 0) {
    const sum = (pick: (h: YoloMemoryHealth) => number): number => healths.reduce((n, h) => n + pick(h), 0)
    const runs = sum((h) => h.recallRunsToday)
    const weightedRate =
      runs === 0 ? 0 : Math.round(healths.reduce((n, h) => n + h.recallHitRate * h.recallRunsToday, 0) / runs * 100) / 100
    health = {
      recallRunsToday: runs,
      recallHitRate: weightedRate,
      recallErrorsToday: sum((h) => h.recallErrorsToday),
      extractionErrorsToday: sum((h) => h.extractionErrorsToday),
      deniedToday: sum((h) => h.deniedToday),
      duplicateTodos: healths.flatMap((h) => h.duplicateTodos),
    }
  }

  const wsMap = new Map<string, YoloWorkspaceInfo>()
  for (const d of list) {
    const slug = d.scopeKey
    const label = d.todos[0]?.ws?.label ?? workspaceLabel(d.cwd, slug)
    const existing = wsMap.get(slug)
    const count = d.todos.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length
    if (existing) existing.count += count
    else wsMap.set(slug, { slug, label, count })
  }

  return {
    ...base,
    scope: 'all',
    workspaces: [...wsMap.values()],
    workspaceCount: wsMap.size,
    todos: allTodos,
    goals: allGoals,
    milestones: allMilestones,
    events: allEvents,
    preferences: allPrefs,
    ledger: allLedger,
    ledgerSessions: list.reduce((n, d) => n + d.ledgerSessions, 0),
    notifications: allNotifications,
    // per-workspace unhandled is already a full count (not the display slice) —
    // summing them keeps the aggregate badge exact.
    unhandled: list.reduce((n, d) => n + (d.unhandled ?? 0), 0),
    ...(health !== undefined ? { health } : {}),
  }
}

/** Parse ?day=YYYY-MM-DD from the request URL; falls back to today. */
function ledgerDayOf(req: unknown): string {
  const url = (req as { url?: string } | undefined)?.url ?? ''
  const m = /[?&]day=(\d{4}-\d{2}-\d{2})/.exec(url)
  return m ? m[1] : localDateStr()
}

/** Serve GET /yolo/dashboard — the panel's live data source.
 * v0.3.3: ALWAYS unions every known workspace (no 当前/全部 toggle — the board
 * shows it all, per the user. Cross-workspace rows carry their owning `ws`, and
 * POST /yolo/actions routes by that row's cwd, so every row stays actionable). */
export function registerDashboardEndpoint(
  ctx: { webServer?: WebServerLike; logger?: { warn?(fmt: string, ...args: unknown[]): void } },
  yolo: Yolo,
  cwd: () => string,
  opts?: { allowAggregate?: () => boolean; focusDefaultCount?: () => number },
): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/dashboard',
    handler: async (req, res) => {
      try {
        const day = ledgerDayOf(req)
        const focusDefault = opts?.focusDefaultCount?.() ?? 0
        const metas = yolo.listWorkspaceMeta()
        if (metas.length > 1) {
          // One broken workspace (corrupt/locked DB) must not take the whole
          // board down: skip it, keep the rest, and surface what was skipped.
          const list: YoloDashboardData[] = []
          const errors: string[] = []
          for (const { cwd: wcwd, scopeKey } of metas) {
            try {
              // Pin to the REGISTRY's scopeKey so the projection (and every
              // action later routed to this row) reads exactly this store even
              // if the workspace's git branch switches mid-flight.
              list.push(yolo.runInScope(wcwd, scopeKey, () => buildDashboardData(yolo, wcwd, day, { slug: scopeKey, label: workspaceLabel(wcwd, scopeKey), cwd: wcwd })))
            } catch (e) {
              errors.push(`${workspaceLabel(wcwd, scopeKey)}: ${e instanceof Error ? e.message : String(e)}`)
              ctx.logger?.warn?.('[yolo] dashboard skipped workspace %s: %s', wcwd, e instanceof Error ? e.message : String(e))
            }
          }
          if (list.length === 0) throw new Error(errors[0] ?? 'no workspace could be read')
          const data = aggregateDashboards(list)
          data.focusDefaultCount = focusDefault
          if (errors.length > 0) data.workspaceErrors = errors
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
          res.end(JSON.stringify(data))
          return
        }
        const data = buildDashboardData(yolo, cwd(), day)
        data.focusDefaultCount = focusDefault
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(data))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      }
    },
  })
}


