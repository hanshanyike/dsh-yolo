import type Yolo from '../storage/index.ts'
import type { YoloDashboardData } from '../shared/dashboard.ts'
import { localDateStr } from '../shared/text.ts'
import { workspaceIdentity } from '../domain/scope.ts'
import {
  aggregateDashboards,
  buildDashboardData,
  disambiguateWorkspaceLabels,
  workspaceLabel,
} from '../application/read-models/dashboard.ts'

export * from '../application/read-models/dashboard.ts'

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
function ledgerDayOf(req: unknown): string {
  const url = (req as { url?: string } | undefined)?.url ?? ''
  const m = /[?&]day=(\d{4}-\d{2}-\d{2})/.exec(url)
  return m ? m[1] : localDateStr()
}

/** Thin HTTP adapter; projection ownership lives in application/read-models. */
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
        const metas = yolo.listWorkspaceMeta()
        const list: YoloDashboardData[] = []
        const errors: string[] = []
        if (metas.length > 0) {
          const labels = disambiguateWorkspaceLabels(metas)
          for (const { cwd: workspaceCwd, scopeKey } of metas) {
            try {
              list.push(yolo.runInScope(workspaceCwd, scopeKey, () => buildDashboardData(yolo, workspaceCwd, day, {
                slug: scopeKey,
                label: labels.get(workspaceIdentity(workspaceCwd)) ?? workspaceLabel(workspaceCwd, scopeKey),
                cwd: workspaceCwd,
              })))
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              errors.push(`${workspaceLabel(workspaceCwd, scopeKey)}: ${message}`)
              ctx.logger?.warn?.('[yolo] dashboard skipped workspace %s: %s', workspaceCwd, message)
            }
          }
        } else {
          list.push(buildDashboardData(yolo, cwd(), day))
        }
        if (list.length === 0) throw new Error(errors[0] ?? 'no workspace could be read')
        const data = aggregateDashboards(list)
        data.focusDefaultCount = opts?.focusDefaultCount?.() ?? 0
        if (errors.length > 0) {
          data.workspaceErrors = errors
          if (data.summary) data.summary.partial = true
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(data))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  })
}
