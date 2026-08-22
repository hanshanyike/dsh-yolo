// YOLO persistent session manager (v0.3.0 B) — the assistant's own resident
// thread. One thread per WORKSPACE: the session id derives from the scope cwd,
// so the agent's tool calls (yolo_action, memory_*) resolve the same scope the
// panel renders — a single global thread would cross workspace isolation.
// Created lazily on first use; resumed across host restarts when the session
// store still holds the log (TB-5), created fresh otherwise.

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { contentBlocksToText } from '../shared/text.ts'

/** Minimal structural view of a dsh Agent (avoids linking the agent package). */
export interface AgentLike {
  readonly id: string
  followup(message: unknown): void
  readonly session: { deriveMessages(): readonly { role: string; content: readonly unknown[]; source: { kind: string } }[] }
}

interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

/** Structural view of ctx.agents (AgentRegistry service face). */
export interface AgentsLike {
  get(id: SessionIdType): AgentLike | undefined
  create(options: { sessionId: SessionIdType; meta?: { cwd?: string } }): Promise<AgentHandleLike>
  resume(options: { resumeSessionId: SessionIdType }): Promise<AgentHandleLike>
}

export interface SessionLogger {
  info?(fmt: string, ...args: unknown[]): void
  warn?(fmt: string, ...args: unknown[]): void
}

/** Stable per-workspace YOLO session id: "yolo-w-<sha1(cwd)/12>". */
export function yoloSessionId(cwd: string): SessionIdType {
  const h = createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12)
  return SessionId(`yolo-w-${h}`)
}

/** True when a session id belongs to a YOLO resident thread (extraction skip). */
export function isYoloSessionId(id: string | undefined): boolean {
  return !!id && id.startsWith('yolo-w-')
}

/** One chat line for the panel's conversation view. */
export interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

/** Project a live session's messages into visible chat lines (tool/context noise dropped). */
export function chatMessagesOf(agent: AgentLike): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of agent.session.deriveMessages()) {
    const text = contentBlocksToText(m.content)
    if (!text) continue
    if (m.role === 'assistant' && m.source?.kind === 'model') out.push({ role: 'ai', text })
    else if (m.role === 'user' && m.source?.kind === 'user') out.push({ role: 'user', text })
  }
  return out
}

/** Owns the live YOLO agent handles; one ensure() per workspace, deduped. */
export class YoloSessions {
  private readonly starting = new Map<string, Promise<AgentLike | undefined>>()

  constructor(
    private readonly agents: AgentsLike | undefined,
    private readonly logger?: SessionLogger,
  ) {}

  async ensure(cwd: string): Promise<AgentLike | undefined> {
    if (!this.agents) return undefined
    const id = yoloSessionId(cwd)
    const live = this.agents.get(id)
    if (live) return live
    const pending = this.starting.get(cwd)
    if (pending) return pending
    const p = this.start(cwd, id).finally(() => this.starting.delete(cwd))
    this.starting.set(cwd, p)
    return p
  }

  private async start(cwd: string, id: SessionIdType): Promise<AgentLike | undefined> {
    try {
      const handle = await this.agents!.resume({ resumeSessionId: id })
      this.logger?.info?.('[yolo-session] resumed %s', id)
      return handle.agent
    } catch {
      // no persisted log under this id — first boot for this workspace
    }
    try {
      const handle = await this.agents!.create({ sessionId: id, meta: { cwd: resolve(cwd) } })
      this.logger?.info?.('[yolo-session] created %s', id)
      return handle.agent
    } catch (e) {
      this.logger?.warn?.('[yolo-session] create failed: %s', e instanceof Error ? e.message : String(e))
      return undefined
    }
  }
}

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

function send(res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Serve the panel chat channel: GET messages + POST send (v0.3.0 A 对话 Tab / 侧栏对话). */
export function registerSessionEndpoints(
  ctx: { webServer?: WebServerLike; logger?: SessionLogger },
  sessions: YoloSessions,
  defaultCwd: () => string,
): void {
  const readBody = (req: { on(event: 'data', cb: (c: Buffer) => void): unknown; on(event: 'end', cb: () => void): unknown }): Promise<unknown> =>
    new Promise((resolveBody, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          reject(new Error('invalid JSON body'))
        }
      })
    })

  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/session/messages',
    handler: async (req, res) => {
      const r = req as { method?: string; url?: string; on: unknown } | undefined
      if ((r?.method ?? '').toUpperCase() !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed (GET only)' })
        return
      }
      try {
        const cwd = new URL(r!.url ?? '/', 'http://local').searchParams.get('cwd') ?? defaultCwd()
        const agent = await sessions.ensure(cwd)
        send(res, 200, { ok: true, cwd, messages: agent ? chatMessagesOf(agent) : [] })
      } catch (e) {
        send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })

  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/session/send',
    handler: async (req, res) => {
      const r = req as { method?: string; on(event: never, cb: never): unknown } | undefined
      if ((r?.method ?? '').toUpperCase() !== 'POST') {
        send(res, 405, { ok: false, error: 'method not allowed (POST only)' })
        return
      }
      try {
        const body = (await readBody(r as never)) as { cwd?: string; text?: string }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) {
          send(res, 400, { ok: false, error: 'text required' })
          return
        }
        const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : defaultCwd()
        const agent = await sessions.ensure(cwd)
        if (!agent) {
          send(res, 503, { ok: false, error: 'YOLO session unavailable (agents service missing?)' })
          return
        }
        agent.followup(
          createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
        )
        send(res, 200, { ok: true, sent: text.length })
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })
}
