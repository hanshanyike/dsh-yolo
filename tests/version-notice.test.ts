import { describe, expect, it, vi } from 'vitest'
import { fetchVersionUpdate, parseVersionUpdate } from '../client/settings/version-notice.ts'

describe('version update notice', () => {
  it('reads an update out of the host answer', () => {
    expect(parseVersionUpdate({ current: '0.5.0-rc.1', update: { latest: '0.5.0-rc.2', tag: 'rc' } }))
      .toEqual({ latest: '0.5.0-rc.2', tag: 'rc' })
  })

  it('treats every other answer as "no update"', () => {
    expect(parseVersionUpdate({ current: '0.5.0-rc.1' })).toBeUndefined()
    expect(parseVersionUpdate({ current: '0.5.0-rc.1', update: null })).toBeUndefined()
    expect(parseVersionUpdate({ update: { latest: '', tag: 'rc' } })).toBeUndefined()
    expect(parseVersionUpdate({ update: { latest: '0.6.0' } })).toBeUndefined()
    expect(parseVersionUpdate({ update: { latest: 6, tag: 'rc' } })).toBeUndefined()
    expect(parseVersionUpdate(null)).toBeUndefined()
    expect(parseVersionUpdate('nope')).toBeUndefined()
  })

  it('asks the host endpoint and never throws', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ update: { latest: '0.6.0', tag: 'latest' } }), { status: 200 }))
    await expect(fetchVersionUpdate(ok as unknown as typeof fetch)).resolves.toEqual({ latest: '0.6.0', tag: 'latest' })
    expect(ok).toHaveBeenCalledWith('/yolo/version', { headers: { accept: 'application/json' } })

    const notFound = vi.fn(async () => new Response('', { status: 404 }))
    await expect(fetchVersionUpdate(notFound as unknown as typeof fetch)).resolves.toBeUndefined()

    const offline = vi.fn(async () => { throw new Error('offline') })
    await expect(fetchVersionUpdate(offline as unknown as typeof fetch)).resolves.toBeUndefined()

    const garbage = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(fetchVersionUpdate(garbage as unknown as typeof fetch)).resolves.toBeUndefined()
  })
})
