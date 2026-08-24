import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { chatMessagesOf, registerSessionEndpoints, yoloUserPrompt, type WebServerLike } from '../src/ui/session.ts'

type EndpointHandler = (req: unknown, res: unknown) => Promise<void>

function requestBody(body: unknown): { method: string; on(event: string, cb: (chunk?: Buffer) => void): unknown } {
  const encoded = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    on(event, cb) {
      if (event === 'data') cb(encoded)
      if (event === 'end') cb()
      return this
    },
  }
}

function response(): {
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
} {
  return { writeHead: vi.fn(), end: vi.fn() }
}

function outcome(res: ReturnType<typeof response>): { status: number; body: Record<string, unknown> } {
  return {
    status: Number(res.writeHead.mock.calls[0]?.[0]),
    body: JSON.parse(String(res.end.mock.calls[0]?.[0])) as Record<string, unknown>,
  }
}

function setup(workspaces: Array<{ cwd: string; scopeKey: string }>) {
  const handlers = new Map<string, EndpointHandler>()
  const residentAgent = { id: 'resident', followup: vi.fn(), session: { deriveMessages: () => [] } }
  const anchoredAgent = { id: 'anchored', followup: vi.fn(), session: { deriveMessages: () => [] } }
  const sessions = { ensure: vi.fn(async () => residentAgent) }
  const threads = {
    get: vi.fn(() => anchoredAgent),
    ensure: vi.fn(async () => anchoredAgent),
  }
  registerSessionEndpoints(
    { webServer: { register: (opts: Parameters<WebServerLike['register']>[0]) => { handlers.set(opts.path, opts.handler as EndpointHandler) } } } as never,
    sessions as never,
    threads as never,
    () => resolve('/ws/default'),
    () => workspaces,
  )
  return { handlers, sessions, threads, residentAgent, anchoredAgent }
}

describe('session endpoint workspace scopes', () => {
  it('keeps GET and POST for the same thread isolated by known workspace', async () => {
    const workspaceA = resolve('/ws/a')
    const workspaceB = resolve('/ws/b')
    const { handlers, threads } = setup([
      { cwd: workspaceA, scopeKey: 'a/main' },
      { cwd: workspaceB, scopeKey: 'b/main' },
    ])
    const send = handlers.get('/yolo/session/send')!
    const messages = handlers.get('/yolo/session/messages')!

    for (const cwd of [workspaceA, workspaceB]) {
      const sent = response()
      await send(requestBody({ text: '确认本周的发布安排', thread: 'same-thread', cwd }), sent)
      expect(outcome(sent).status).toBe(200)

      const read = response()
      await messages({ method: 'GET', url: `/yolo/session/messages?thread=same-thread&cwd=${encodeURIComponent(cwd)}` }, read)
      expect(outcome(read)).toMatchObject({ status: 200, body: { ok: true, cwd, thread: 'same-thread' } })
    }

    expect(threads.ensure).toHaveBeenNthCalledWith(1, workspaceA, 'same-thread')
    expect(threads.ensure).toHaveBeenNthCalledWith(2, workspaceB, 'same-thread')
    expect(threads.get).toHaveBeenNthCalledWith(1, workspaceA, 'same-thread')
    expect(threads.get).toHaveBeenNthCalledWith(2, workspaceB, 'same-thread')
  })

  it('normalizes an explicit cwd but returns the registry-owned spelling', async () => {
    const known = resolve('/ws/alpha')
    const equivalent = join(known, '..', 'alpha')
    const { handlers, threads } = setup([{ cwd: known, scopeKey: 'alpha/main' }])
    const res = response()

    await handlers.get('/yolo/session/send')!(requestBody({ text: '继续讨论访谈结论', thread: 'card-a', cwd: equivalent }), res)

    expect(outcome(res)).toMatchObject({ status: 200, body: { ok: true } })
    expect(threads.ensure).toHaveBeenCalledWith(known, 'card-a')
  })

  it('rejects unknown explicit scopes on both GET and POST', async () => {
    const known = resolve('/ws/known')
    const unknown = resolve('/ws/unknown')
    const { handlers, sessions, threads } = setup([{ cwd: known, scopeKey: 'known/main' }])

    const read = response()
    await handlers.get('/yolo/session/messages')!(
      { method: 'GET', url: `/yolo/session/messages?thread=card-x&cwd=${encodeURIComponent(unknown)}` },
      read,
    )
    expect(outcome(read)).toEqual({
      status: 400,
      body: { ok: false, error: 'unknown workspace scope', code: 'unknown_workspace_scope' },
    })

    const sent = response()
    await handlers.get('/yolo/session/send')!(requestBody({ text: '提醒我发出演示稿', thread: 'card-x', cwd: unknown }), sent)
    expect(outcome(sent)).toEqual({
      status: 400,
      body: { ok: false, error: 'unknown workspace scope', code: 'unknown_workspace_scope' },
    })
    expect(threads.get).not.toHaveBeenCalled()
    expect(threads.ensure).not.toHaveBeenCalled()
    expect(sessions.ensure).not.toHaveBeenCalled()
  })

  it('does not require registry membership for the resident default thread', async () => {
    const defaultCwd = resolve('/ws/default')
    const { handlers, sessions, residentAgent } = setup([])

    const read = response()
    await handlers.get('/yolo/session/messages')!({ method: 'GET', url: '/yolo/session/messages' }, read)
    expect(outcome(read)).toMatchObject({ status: 200, body: { ok: true, cwd: defaultCwd } })

    const sent = response()
    await handlers.get('/yolo/session/send')!(requestBody({ text: '总结今天的进展' }), sent)
    expect(outcome(sent).status).toBe(200)
    expect(sessions.ensure).toHaveBeenNthCalledWith(1, defaultCwd)
    expect(sessions.ensure).toHaveBeenNthCalledWith(2, defaultCwd)
    const delivered = residentAgent.followup.mock.calls[0]?.[0] as { content?: Array<{ text?: string }> }
    expect(delivered.content?.[0]?.text).toContain('today=')
    expect(delivered.content?.[0]?.text).toContain('tomorrow=')
    expect(delivered.content?.[0]?.text?.endsWith('总结今天的进展')).toBe(true)
  })

  it('keeps the clock context hidden from the visible conversation', () => {
    const visible = chatMessagesOf({
      id: 'resident',
      followup: vi.fn(),
      session: {
        deriveMessages: () => [{
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: yoloUserPrompt('明天下午提醒我', new Date(2026, 7, 24, 22, 25)) }],
        }],
      },
    })
    expect(visible).toEqual([{ role: 'user', text: '明天下午提醒我' }])
  })
})
