// v0.3.2 YoloChatThreads tests — the ephemeral anchored-chat (聊一聊) backing.
// Each anchored chat must be a FRESH agent session (not the resident thread's
// history), deduped per thread key, and LRU-evicted past a per-workspace cap.

import { describe, it, expect, vi } from 'vitest'
import { YoloChatThreads, type AgentsLike, type AgentHandleLike } from '../src/ui/session.ts'

interface FakeAgent {
  id: string
  followup: (m: unknown) => void
  session: { deriveMessages: () => never[] }
}

function handleOf(id: string): AgentHandleLike {
  return {
    agent: { id, followup: vi.fn(), session: { deriveMessages: () => [] } } as unknown as FakeAgent,
    dispose: vi.fn(() => Promise.resolve()),
  }
}

function makeAgents(): { agents: AgentsLike; created: string[]; disposed: string[] } {
  const created: string[] = []
  const disposed: string[] = []
  const agents = {
    create: vi.fn(async (opts: { sessionId: { toString(): string } }) => {
      const id = String(opts.sessionId)
      created.push(id)
      const h = handleOf(id)
      // dispose hooks the handle's agent id for assertion
      ;(h.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
        disposed.push(id)
        return Promise.resolve()
      })
      return h
    }),
    get: vi.fn(() => undefined),
  } as unknown as AgentsLike
  return { agents, created, disposed }
}

describe('YoloChatThreads (fresh 聊一聊 threads)', () => {
  it('creates a fresh agent per thread key and reuses it across calls', async () => {
    const { agents, created } = makeAgents()
    const threads = new YoloChatThreads(agents)
    const a = await threads.ensure('/ws/a', 'card-x')
    const b = await threads.ensure('/ws/a', 'card-x')
    expect(a).toBe(b)
    expect(created).toHaveLength(1)
    expect(agents.create).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent first-use creation for the same anchored thread', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const create = vi.fn(async (opts: { sessionId: { toString(): string } }) => {
      await gate
      return handleOf(String(opts.sessionId))
    })
    const agents = { create, get: vi.fn(() => undefined) } as unknown as AgentsLike
    const threads = new YoloChatThreads(agents)

    const first = threads.ensure('/ws/a', 'card-race')
    const second = threads.ensure('/ws/a', 'card-race')
    release()
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe(b)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('creates a distinct agent for a different thread key (fresh conversation)', async () => {
    const { agents, created } = makeAgents()
    const threads = new YoloChatThreads(agents)
    await threads.ensure('/ws/a', 'card-x')
    await threads.ensure('/ws/a', 'card-y')
    expect(created).toHaveLength(2)
    expect(created[0]).not.toBe(created[1])
  })

  it('isolates the same thread key between two workspaces', async () => {
    const { agents, created } = makeAgents()
    const threads = new YoloChatThreads(agents)

    const workspaceA = await threads.ensure('/ws/a', 'shared-card')
    const workspaceB = await threads.ensure('/ws/b', 'shared-card')

    expect(workspaceA).not.toBe(workspaceB)
    expect(created).toHaveLength(2)
    expect(created[0]).not.toBe(created[1])
    expect(threads.get('/ws/a', 'shared-card')).toBe(workspaceA)
    expect(threads.get('/ws/b', 'shared-card')).toBe(workspaceB)
  })

  it('peeks without creating before the first send', async () => {
    const { agents } = makeAgents()
    const threads = new YoloChatThreads(agents)
    expect(threads.get('/ws/a', 'card-x')).toBeUndefined()
    expect(agents.create).not.toHaveBeenCalled()
  })

  it('LRU-evicts the oldest thread per workspace beyond the cap and disposes it', async () => {
    const { agents, created, disposed } = makeAgents()
    const threads = new YoloChatThreads(agents)
    // cap is 8; create 9 distinct threads — the first must be evicted+disposed
    for (let i = 0; i < 9; i++) await threads.ensure('/ws/a', `card-${i}`)
    expect(created).toHaveLength(9)
    expect(disposed).toContain(created[0])
    // a different workspace is independent
    await threads.ensure('/ws/b', 'card-x')
    expect(disposed).toHaveLength(1)
  })
})
