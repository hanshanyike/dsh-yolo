import type Yolo from '../storage/index.ts'
import type { YoloBadgeData } from '../shared/badge.ts'
import type { WebServerLike } from './dashboard.ts'

/** Count all known workspace notifications without building dashboard projections. */
export function buildBadgeData(yolo: Yolo, fallbackCwd: string): YoloBadgeData {
  const metas = yolo.listWorkspaceMeta()
  if (metas.length === 0) {
    return { unhandled: yolo.countUnhandledNotifications(fallbackCwd) }
  }

  let unhandled = 0
  let failures = 0
  for (const { cwd, scopeKey } of metas) {
    try {
      unhandled += yolo.runInScope(cwd, scopeKey, () => yolo.countUnhandledNotifications(cwd))
    } catch {
      failures += 1
    }
  }
  if (failures === metas.length) throw new Error('no workspace badge count could be read')
  return { unhandled, ...(failures > 0 ? { partial: true } : {}) }
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
