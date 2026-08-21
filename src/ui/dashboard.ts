// Host-side dashboard projection (M7) — the single data source for the
// browser-side sidebar dashboard. Serves the projection as JSON over HTTP
// (GET /yolo/dashboard). No per-session durable events: the dashboard is a
// global, session-independent surface, so publishing 'yolo/snapshot' into
// every session log was pure bloat.
//
// M8: rows now carry the plan context (milestone_title) and the "where is it
// stuck" signals (overdue / stale), so the dashboard can render a stateful
// plan instead of a flat read-only list.

import type Yolo from '../storage/index.ts'
import type { YoloDashboardData } from '../shared/dashboard.ts'
import { isTodoOverdue, isTodoStale } from '../shared/dashboard.ts'

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

/** Build the full dashboard projection for a workspace scope. */
export function buildDashboardData(yolo: Yolo, cwd: string): YoloDashboardData {
  const now = Date.now()
  const milestones = yolo.listMilestones(cwd)
  const msTitle = new Map(milestones.map((m) => [m.id, m.title]))
  return {
    scopeKey: yolo.resolve(cwd).scopeKey,
    cwd,
    at: now,
    todos: yolo.listTodos(cwd).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_at: t.due_at,
      milestone_title: t.milestone_id ? msTitle.get(t.milestone_id) ?? null : null,
      updated_at: t.updated_at,
      overdue: isTodoOverdue(t.due_at, t.status, new Date(now)),
      stale: isTodoStale(t.status, t.updated_at, now),
    })),
    goals: yolo.listGoals(cwd).map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      progress: g.progress,
      milestone_title: g.milestone_id ? msTitle.get(g.milestone_id) ?? null : null,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      target_date: m.target_date,
    })),
    events: yolo.listEvents(cwd, 30).map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      occurred_at: e.occurred_at,
    })),
    preferences: yolo.listPreferences(cwd).map((p) => ({
      id: p.id,
      key: p.key,
      value: p.value,
    })),
  }
}

/** Serve GET /yolo/dashboard — the sidebar dashboard's live data source. */
export function registerDashboardEndpoint(ctx: { webServer?: WebServerLike }, yolo: Yolo, cwd: () => string): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/dashboard',
    handler: async (_req, res) => {
      try {
        const data = buildDashboardData(yolo, cwd())
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-cache',
        })
        res.end(JSON.stringify(data))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      }
    },
  })
}
