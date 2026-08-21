// Host-side in-place actions (M8 interaction layer B) — POST /yolo/actions
// lets the sidebar dashboard operate todos/goals/milestones directly through
// the SAME domain actions as the yolo_action model tool, so a click and a
// conversational reply produce identical state transitions + audit events.

import type Yolo from '../storage/index.ts'
import { applyYoloAction, type YoloActionRequest } from '../shared/actions.ts'

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

const MAX_BODY_BYTES = 64 * 1024

/** Structural view of a Node IncomingMessage (method + readable stream). */
interface ReqLike {
  method?: string
  on(event: 'data', cb: (chunk: Buffer) => void): ReqLike
  on(event: 'end', cb: () => void): ReqLike
  on(event: 'error', cb: (err: Error) => void): ReqLike
}

function toReqLike(v: unknown): ReqLike | undefined {
  if (typeof v === 'object' && v !== null && typeof (v as ReqLike).on === 'function') return v as ReqLike
  return undefined
}

function send(res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read and JSON-parse the request body, enforcing the 64KB cap. */
function readJsonBody(req: ReqLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        settled = true
        reject(new Error('payload too large (max 64KB)'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/** Serve POST /yolo/actions — in-place plan operations for the dashboard. */
export function registerActionsEndpoint(ctx: { webServer?: WebServerLike }, yolo: Yolo, cwd: () => string): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/actions',
    handler: async (req, res) => {
      const r = toReqLike(req)
      const method = (r?.method ?? '').toUpperCase()
      if (method !== 'POST') {
        send(res, 405, { ok: false, error: 'method not allowed (POST only)' })
        return
      }
      if (!r) {
        send(res, 400, { ok: false, error: 'bad request' })
        return
      }
      try {
        const body = await readJsonBody(r)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          send(res, 400, { ok: false, error: 'body must be a JSON object' })
          return
        }
        const outcome = applyYoloAction(yolo, cwd(), body as YoloActionRequest)
        send(res, outcome.ok ? 200 : outcome.httpStatus, outcome)
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })
}
