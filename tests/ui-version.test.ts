import { describe, expect, it, vi } from 'vitest'
import type { VersionTags } from '../src/application/read-models/version-check.ts'
import { DIST_TAGS_URL, registerVersionEndpoint } from '../src/ui/version.ts'

interface Res {
  writeHead(status: number): void
  end(body?: string): void
}

interface Mounted {
  handle: ReturnType<typeof registerVersionEndpoint>
  get(): Promise<{ status: number; body: { current: string; update?: { latest: string }; checkedAt?: number } }>
}

/** Mount the endpoint over a fake web server and expose a plain GET. */
function mount(options: Parameters<typeof registerVersionEndpoint>[1]): Mounted {
  let handler: ((req: unknown, res: Res) => Promise<void> | void) | undefined
  const register = (opts: { kind: 'prefix'; path: string; handler: (req: unknown, res: Res) => Promise<void> | void }): void => {
    handler = opts.handler
  }
  const handle = registerVersionEndpoint({ webServer: { register } } as never, options)
  return {
    handle,
    async get() {
      let status = 0
      let body = ''
      await handler!({}, { writeHead: (s) => { status = s }, end: (b) => { body = b ?? '' } })
      return { status, body: JSON.parse(body) as never }
    },
  }
}

const NEWER: VersionTags = { latest: '0.5.0-rc.2', rc: '0.5.0-rc.2', beta: '0.5.0-beta.3' }

describe('GET /yolo/version', () => {
  it('publishes the registry address it consults', () => {
    expect(DIST_TAGS_URL).toBe('https://registry.npmjs.org/-/package/dsh-plugin-yolo/dist-tags')
  })

  it('serves the cached answer, and only that', async () => {
    const fetchTags = vi.fn(async () => NEWER)
    const { get, handle } = mount({ current: '0.5.0-rc.1', fetchTags, now: () => 1_000 })

    // The mount already warmed the cache; an explicit refresh during the TTL
    // shares that read, and two requests are served from memory either way.
    await handle.refresh()
    const first = await get()
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ current: '0.5.0-rc.1', update: { latest: '0.5.0-rc.2' }, checkedAt: 1_000 })

    await get()
    expect(fetchTags).toHaveBeenCalledTimes(1)
  })

  it('reports no update when the running version is the registry latest', async () => {
    const { get, handle } = mount({ current: '0.5.0-rc.1', fetchTags: async () => ({ latest: '0.5.0-rc.1' }) })
    await handle.refresh()
    expect((await get()).body).toEqual({ current: '0.5.0-rc.1', checkedAt: expect.any(Number) })
  })

  it('stays silent when the registry read fails', async () => {
    const logger = { warn: vi.fn() }
    const mounted = mount({
      current: '0.5.0-rc.1',
      fetchTags: async () => { throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org') },
      logger,
    })
    await mounted.handle.refresh()

    // No update and no checkedAt: indistinguishable from "not checked yet".
    const { status, body } = await mounted.get()
    expect(status).toBe(200)
    expect(body).toEqual({ current: '0.5.0-rc.1' })
    expect(logger.warn).toHaveBeenCalledWith('[yolo] version check failed: %s', 'getaddrinfo ENOTFOUND registry.npmjs.org')
  })

  it('shares one in-flight read between concurrent refreshes', async () => {
    let release: ((tags: VersionTags) => void) | undefined
    const fetchTags = vi.fn(() => new Promise<VersionTags>((resolve) => { release = resolve }))
    const mounted = mount({ current: '0.5.0-rc.1', fetchTags })

    const refresh = mounted.handle.refresh()
    expect(mounted.handle.refresh()).toBe(refresh)
    release?.({ latest: '0.6.0' })
    await refresh
    expect(fetchTags).toHaveBeenCalledTimes(1)
    expect(mounted.handle.snapshot().update).toEqual({ latest: '0.6.0' })
  })
})
