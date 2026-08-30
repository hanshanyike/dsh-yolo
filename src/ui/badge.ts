import type Yolo from '../storage/index.ts'
import type { WebServerLike } from './dashboard.ts'
import { buildBadgeData } from '../application/read-models/badge.ts'

export { buildBadgeData } from '../application/read-models/badge.ts'

export function registerBadgeEndpoint(ctx: { webServer?: WebServerLike }, yolo: Yolo, cwd: () => string): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/badge',
    handler: (_req, res) => {
      try {
        const data = buildBadgeData(yolo, cwd())
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(data))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      }
    },
  })
}
