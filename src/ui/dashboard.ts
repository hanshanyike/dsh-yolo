// Host-side dashboard projection (M7) — the single data source for the
// browser-side sidebar dashboard. Serves the projection as JSON over HTTP
// (GET /yolo/dashboard). No per-session durable events: the dashboard is a
// global, session-independent surface, so publishing 'yolo/snapshot' into
// every session log was pure bloat.

import type Yolo from '../storage/index.ts'
import type { YoloDashboardData } from '../shared/dashboard.ts'

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
  return {
    scopeKey: yolo.resolve(cwd).scopeKey,
    cwd,
    at: Date.now(),
    todos: yolo.listTodos(cwd).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_at: t.due_at,
    })),
    goals: yolo.listGoals(cwd).map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      progress: g.progress,
    })),
    milestones: yolo.listMilestones(cwd).map((m) => ({
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
