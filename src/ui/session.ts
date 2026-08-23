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
// The harness's OWN model-selection capability (the same one the headless
// runner uses). Install it in the agent setup so `{{model}}`/`{{provider}}` are
// bound and the agent can actually run a turn — without it, a programmatically
// created agent errors with `prompt variable "{{model}}" has no value`.
import { installModelSelection, type ModelSelectionRef, type ModelSelection } from '@deepseek-ai/dsh-agent'
import { contentBlocksToText } from '../shared/text.ts'
import { findKnownWorkspaceScope, type WorkspaceScopeMeta } from './workspace-scope.ts'

/** Minimal structural view of a dsh Agent (avoids linking the agent package). */
export interface AgentLike {
  readonly id: string
  followup(message: unknown): void
  readonly session: { deriveMessages(): readonly { role: string; content: readonly unknown[]; source: { kind: string } }[] }
}

export interface AgentHandleLike {
  agent: AgentLike
  dispose(): Promise<void>
}

/** Structural view of ctx.agents (AgentRegistry service face). */
export interface AgentsLike {
  get(id: SessionIdType): AgentLike | undefined
  create(options: {
    sessionId: SessionIdType
    meta?: { cwd?: string }
    agentOptions?: { provider: string; model: string }
    setup?: (agentCtx: unknown) => unknown
  }): Promise<AgentHandleLike>
  resume(options: {
    resumeSessionId: SessionIdType
    agentOptions?: { provider: string; model: string }
    setup?: (agentCtx: unknown) => unknown
  }): Promise<AgentHandleLike>
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

/** True when a session id belongs to a YOLO-owned thread (extraction skip +
 * workspace tracking skip). Covers BOTH the resident thread (yolo-w-*) and the
 * ephemeral anchored-chat threads (yolo-a-*, v0.3.2): their state changes are
 * written by YOLO tools, so turn-end extraction must not double-record them. */
export function isYoloSessionId(id: string | undefined): boolean {
  return !!id && (id.startsWith('yolo-w-') || id.startsWith('yolo-a-'))
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
    private readonly defaultModelSelection?: () => ModelSelection | undefined,
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
    const selection = this.defaultModelSelection?.()
    const setup = selection
      ? (agentCtx: unknown): void => {
          const ref: ModelSelectionRef = { current: selection, assembled: undefined }
          installModelSelection(agentCtx as never, ref)
        }
      : undefined
    const agentOptions = selection ? { provider: selection.provider, model: selection.model } : undefined
    try {
      const handle = await this.agents!.resume({ resumeSessionId: id, agentOptions, setup })
      this.logger?.info?.('[yolo-session] resumed %s', id)
      return handle.agent
    } catch {
      // no persisted log under this id — first boot for this workspace
    }
    try {
      const handle = await this.agents!.create({ sessionId: id, meta: { cwd: resolve(cwd) }, agentOptions, setup })
      this.logger?.info?.('[yolo-session] created %s', id)
      return handle.agent
    } catch (e) {
      this.logger?.warn?.('[yolo-session] create failed: %s', e instanceof Error ? e.message : String(e))
      return undefined
    }
  }
}

/**
 * Ephemeral anchored-chat threads (v0.3.2) — the backing of the kanban card's
 * 「聊一聊」. Each anchored chat is a FRESH conversation: a disposable agent
 * session (`yolo-a-<random>`) created lazily on the first message, so the pane
 * never inherits the resident thread's history. The resident thread
 * (`yolo-w-*`, YoloSessions) stays the persistent channel for the unanchored
 * 对话 tab.
 *
 * Lifecycle: handles are capped per workspace (oldest evicted + disposed);
 * the dsh session logs themselves are inert once unused, so an evicted thread
 * simply stops being readable.
 */
export class YoloChatThreads {
  private readonly byKey = new Map<string, { handle: AgentHandleLike; agent: AgentLike; lastUsed: number }>()
  private readonly starting = new Map<string, Promise<AgentLike | undefined>>()
  /** cwd -> thread keys, most-recently-used last (eviction pops the front). */
  private readonly order = new Map<string, string[]>()
  private static readonly MAX_THREADS_PER_WORKSPACE = 8

  constructor(
    private readonly agents: AgentsLike | undefined,
    private readonly logger?: SessionLogger,
    private readonly defaultModelSelection?: () => ModelSelection | undefined,
  ) {}

  /** Resolve an anchored thread for a workspace, creating it on first use. */
  async ensure(cwd: string, threadKey: string): Promise<AgentLike | undefined> {
    if (!this.agents) return undefined
    const fullKey = `${resolve(cwd)}\u0000${threadKey}`
    const hit = this.byKey.get(fullKey)
    if (hit) {
      hit.lastUsed = Date.now()
      this.touch(cwd, fullKey)
      return hit.agent
    }
    const pending = this.starting.get(fullKey)
    if (pending) return pending
    const starting = this.start(cwd, threadKey, fullKey).finally(() => this.starting.delete(fullKey))
    this.starting.set(fullKey, starting)
    return starting
  }

  private async start(cwd: string, threadKey: string, fullKey: string): Promise<AgentLike | undefined> {
    const id = SessionId(`yolo-a-${createHash('sha1').update(fullKey).digest('hex').slice(0, 12)}`)
    const selection = this.defaultModelSelection?.()
    const createOpts = selection
      ? {
          sessionId: id,
          meta: { cwd: resolve(cwd) },
          agentOptions: { provider: selection.provider, model: selection.model },
          setup: (agentCtx: unknown): void => {
            const ref: ModelSelectionRef = { current: selection, assembled: undefined }
            installModelSelection(agentCtx as never, ref)
          },
        }
      : { sessionId: id, meta: { cwd: resolve(cwd) } }
    try {
      const handle = await this.agents!.create(createOpts)
      this.logger?.info?.('[yolo-thread] created %s (%s)', id, threadKey.slice(0, 24))
      this.byKey.set(fullKey, { handle, agent: handle.agent, lastUsed: Date.now() })
      this.touch(cwd, fullKey)
      this.evict(cwd)
      return handle.agent
    } catch (e) {
      this.logger?.warn?.('[yolo-thread] create failed: %s', e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  /** Peek at a thread's agent without creating it (GET before any send). */
  get(cwd: string, threadKey: string): AgentLike | undefined {
    return this.byKey.get(`${resolve(cwd)}\u0000${threadKey}`)?.agent
  }

  private touch(cwd: string, fullKey: string): void {
    const list = this.order.get(cwd) ?? []
    const i = list.indexOf(fullKey)
    if (i !== -1) list.splice(i, 1)
    list.push(fullKey)
    this.order.set(cwd, list)
  }

  /** Evict the least-recently-used thread once the per-workspace cap is hit. */
  private evict(cwd: string): void {
    const list = this.order.get(cwd) ?? []
    while (list.length > YoloChatThreads.MAX_THREADS_PER_WORKSPACE) {
      const oldest = list.shift()
      if (oldest === undefined) break
      const entry = this.byKey.get(oldest)
      if (entry) {
        this.byKey.delete(oldest)
        try {
          void entry.handle.dispose().catch(() => {})
        } catch {
          // dispose is best-effort
        }
        this.logger?.info?.('[yolo-thread] evicted %s', oldest.slice(-24))
      }
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

/** Serve the panel chat channel: GET messages + POST send (v0.3.0 A 对话 Tab / 侧栏对话).
 * v0.3.2: an optional `thread` selects an EPHEMERAL anchored conversation (聊一聊);
 * without it the call targets the per-workspace resident thread (existing). */
export function registerSessionEndpoints(
  ctx: { webServer?: WebServerLike; logger?: SessionLogger },
  sessions: YoloSessions,
  threads: YoloChatThreads | undefined,
  defaultCwd: () => string,
  listWorkspaceMeta: () => readonly WorkspaceScopeMeta[],
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
        const params = new URL(r!.url ?? '/', 'http://local').searchParams
        const requestedCwd = params.get('cwd')
        const workspace = requestedCwd === null ? undefined : findKnownWorkspaceScope(requestedCwd, listWorkspaceMeta())
        if (requestedCwd !== null && !workspace) {
          send(res, 400, { ok: false, error: 'unknown workspace scope', code: 'unknown_workspace_scope' })
          return
        }
        const cwd = workspace?.cwd ?? defaultCwd()
        const thread = params.get('thread')
        if (thread) {
          // anchored chat: the thread is created lazily on first SEND; a GET
          // before that returns [] so a freshly-opened 聊一聊 starts empty.
          const agent = threads?.get(cwd, thread)
          send(res, 200, { ok: true, cwd, thread, messages: agent ? chatMessagesOf(agent) : [] })
          return
        }
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
        const body = (await readBody(r as never)) as { cwd?: unknown; text?: string; thread?: string }
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) {
          send(res, 400, { ok: false, error: 'text required' })
          return
        }
        const hasExplicitCwd = Object.prototype.hasOwnProperty.call(body, 'cwd')
        const workspace = hasExplicitCwd && typeof body.cwd === 'string'
          ? findKnownWorkspaceScope(body.cwd, listWorkspaceMeta())
          : undefined
        if (hasExplicitCwd && !workspace) {
          send(res, 400, { ok: false, error: 'unknown workspace scope', code: 'unknown_workspace_scope' })
          return
        }
        const cwd = workspace?.cwd ?? defaultCwd()
        const thread = typeof body.thread === 'string' && body.thread ? body.thread : undefined
        const agent = thread
          ? await threads?.ensure(cwd, thread)
          : await sessions.ensure(cwd)
        if (!agent) {
          send(res, 503, { ok: false, error: 'YOLO session unavailable (agents service missing?)' })
          return
        }
        agent.followup(
          createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
        )
        send(res, 200, { ok: true, sent: text.length, thread: thread ?? null })
      } catch (e) {
        send(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
  })
}
