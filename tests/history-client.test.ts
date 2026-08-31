import { describe, expect, it, vi } from 'vitest'
import { fetchHistory } from '../client/panel/history-api.ts'

const VALID_HISTORY = {
  view: 'timeline',
  openedAt: 1,
  events: [],
  items: [],
  nextCursor: null,
  partial: false,
  workspaceErrors: [],
  revision: 1,
}

function fetcher(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch
}

describe('history client response handling', () => {
  it('returns a valid history payload', async () => {
    await expect(fetchHistory('/yolo/history', fetcher(new Response(JSON.stringify(VALID_HISTORY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))).resolves.toEqual(VALID_HISTORY)
  })

  it('turns an empty stale-host 404 into an actionable restart message', async () => {
    await expect(fetchHistory('/yolo/history', fetcher(new Response(null, { status: 404 }))))
      .rejects.toThrow('历史服务尚未加载，请重启 dsh 后重试。')
  })

  it('does not expose JSON parser errors for malformed or incomplete responses', async () => {
    await expect(fetchHistory('/yolo/history', fetcher(new Response('{', { status: 200 }))))
      .rejects.toThrow('历史服务返回的数据无法识别')
    await expect(fetchHistory('/yolo/history', fetcher(new Response(JSON.stringify({ view: 'timeline' }), { status: 200 }))))
      .rejects.toThrow('历史数据不完整')
  })

  it('uses a server-provided JSON error when one is available', async () => {
    await expect(fetchHistory('/yolo/history', fetcher(new Response(JSON.stringify({ error: '某个工作区暂时不可用' }), { status: 503 }))))
      .rejects.toThrow('某个工作区暂时不可用')
  })
})
