// Host-side dashboard publisher (M4b).
// Builds the global YOLO projection from `ctx.yolo` and appends it to a session
// as the durable 'yolo/snapshot' event. The browser bundle's conversation node
// engine picks it up and renders the YOLO tab. Also serves the same projection
// as JSON over HTTP (/yolo/dashboard) for the global sidebar button.

import type Yolo from '../storage/index.ts'
import type { YoloDashboardData } from '../shared/dashboard.ts'

/** Minimal webServer view (dsh's node half provides ctx.webServer). */
export interface WebServerLike {
  register(opts: {
    kind: 'prefix'
    path: string
    handler: (req: unknown, res: {
      writeHead(status: number, headers?: Record<string, string>): void
      end(body?: unknown): void
    }) => Promise<void> | void
  }): unknown
}

/** Build the full dashboard projection for a cwd (workspace scope). */
export function buildDashboardData(yolo: Yolo, cwd: string): YoloDashboardData {
  return {
    scopeKey: yolo.resolve(cwd).scopeKey,
    cwd,
    at: Date.now(),
    todos: yolo.listTodos(cwd).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority ?? null,
      due_at: t.due_at ?? null,
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
      target_date: m.target_date ?? null,
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

/** The exact durable payload appended for 'yolo/snapshot' (matches events.ts). */
export interface YoloSnapshotEvent {
  createdAt: number
  scopeKey: string
  data: YoloDashboardData
}

/**
 * Minimal structural Session view. The real dsh Session satisfies this shape
 * once the 'yolo/snapshot' SessionEventMap merge is in the program.
 */
export interface SessionLike {
  append(type: 'yolo/snapshot', data: YoloSnapshotEvent): unknown
  meta?: { cwd?: string }
}

/**
 * Publish the dashboard projection into one session as a durable event.
 * Safe to call at turn end or on '/yolo' — the client re-renders from the log.
 */
export function publishDashboard(yolo: Yolo, session: SessionLike, cwd: string): void {
  const data = buildDashboardData(yolo, cwd)
  try {
    session.append('yolo/snapshot', {
      createdAt: Date.now(),
      scopeKey: data.scopeKey,
      data,
    })
  } catch {
    // never crash the host on a publish failure; the tab shows last snapshot
  }
}

/**
 * Register a JSON endpoint serving the live dashboard projection. The global
 * sidebar button (client half) fetches this — it is session-independent.
 */
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
