import type Yolo from '../storage/index.ts'
import { findKnownWorkspaceScope } from '../application/workspace-scope.ts'
import { buildGoalDetail } from '../application/read-models/goal-detail.ts'

interface WebServerLike {
  register(opts: {
    kind: 'prefix'
    path: string
    handler: (req: unknown, res: {
      writeHead(status: number, headers: Record<string, string>): void
      end(body?: string): void
    }) => Promise<void> | void
  }): void
}

function send(res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(JSON.stringify(body))
}

/** Serve one goal detail without making the browser query SQLite or fan out scopes. */
export function registerGoalDetailEndpoint(
  ctx: { webServer?: WebServerLike; logger?: { warn?(fmt: string, ...args: unknown[]): void } },
  yolo: Yolo,
  cwd: () => string,
): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/goals',
    handler: async (req, res) => {
      const rawUrl = (req as { url?: string } | undefined)?.url ?? ''
      const method = ((req as { method?: string } | undefined)?.method ?? '').toUpperCase()
      if (method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed (GET only)', code: 'method_not_allowed' })
        return
      }
      let parsed: URL
      try {
        parsed = new URL(rawUrl, 'http://127.0.0.1')
      } catch {
        send(res, 400, { ok: false, error: 'invalid URL', code: 'invalid_url' })
        return
      }
      const match = /^\/yolo\/goals\/([^/]+)$/.exec(parsed.pathname)
      if (!match) {
        send(res, 404, { ok: false, error: 'goal route not found', code: 'goal_route_not_found' })
        return
      }
      const requestedCwd = parsed.searchParams.get('scope_cwd') ?? ''
      const meta = requestedCwd ? findKnownWorkspaceScope(requestedCwd, yolo.listWorkspaceMeta()) : undefined
      if (requestedCwd && !meta) {
        send(res, 400, { ok: false, error: 'unknown workspace scope', code: 'unknown_workspace_scope' })
        return
      }
      const actionCwd = meta?.cwd ?? cwd()
      try {
        const detail = buildGoalDetail(yolo, actionCwd, decodeURIComponent(match[1]!))
        if (!detail) {
          send(res, 404, { ok: false, error: 'goal not found', code: 'goal_not_found' })
          return
        }
        send(res, 200, { ok: true, ...detail })
      } catch (error) {
        ctx.logger?.warn?.('[yolo] goal detail failed: %s', error instanceof Error ? error.message : String(error))
        send(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error), code: 'goal_detail_failed' })
      }
    },
  })
}
