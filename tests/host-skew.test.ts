import { describe, expect, it, vi } from 'vitest'
import { fetchHostSkew, hostSkewHint, PANEL_VERSION, parseServerVersion } from '../client/panel/host-skew.ts'

describe('host-half skew detection', () => {
  it('reads the running version out of the host answer', () => {
    expect(parseServerVersion({ current: '0.5.0' })).toBe('0.5.0')
    expect(parseServerVersion({ current: '' })).toBeNull()
    expect(parseServerVersion({ current: 7 })).toBeNull()
    expect(parseServerVersion({})).toBeNull()
    expect(parseServerVersion(null)).toBeNull()
    expect(parseServerVersion('nope')).toBeNull()
  })

  it('reports skew when the host runs a different version', async () => {
    const older = vi.fn(async () => new Response(JSON.stringify({ current: '0.4.3' }), { status: 200 }))
    await expect(fetchHostSkew(older as unknown as typeof fetch))
      .resolves.toEqual({ kind: 'stale', client: PANEL_VERSION, server: '0.4.3' })
  })

  it('treats a missing version endpoint as skew: the endpoint ships with this bundle', async () => {
    const missing = vi.fn(async () => new Response('', { status: 404 }))
    await expect(fetchHostSkew(missing as unknown as typeof fetch))
      .resolves.toEqual({ kind: 'stale', client: PANEL_VERSION, server: null })
  })

  it('stays silent when the halves match or the answer is unreadable', async () => {
    const fresh = vi.fn(async () => new Response(JSON.stringify({ current: PANEL_VERSION }), { status: 200 }))
    await expect(fetchHostSkew(fresh as unknown as typeof fetch)).resolves.toEqual({ kind: 'fresh' })

    const garbage = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(fetchHostSkew(garbage as unknown as typeof fetch)).resolves.toEqual({ kind: 'fresh' })

    const broken = vi.fn(async () => new Response('', { status: 500 }))
    await expect(fetchHostSkew(broken as unknown as typeof fetch)).resolves.toEqual({ kind: 'fresh' })

    const unreachable = vi.fn(async () => { throw new Error('offline') })
    await expect(fetchHostSkew(unreachable as unknown as typeof fetch)).resolves.toEqual({ kind: 'fresh' })
  })

  it('explains 405 as the stale-host signature and nothing else', () => {
    expect(hostSkewHint(405)).toBe('宿主还在运行旧版助手：重启宿主（dsh web）后再试，重启后即可生效。')
    expect(hostSkewHint(404)).toBeUndefined()
    expect(hostSkewHint(500)).toBeUndefined()
    expect(hostSkewHint(400)).toBeUndefined()
  })
})
