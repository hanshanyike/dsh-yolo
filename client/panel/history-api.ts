import type { YoloHistoryData } from '../../src/contracts/history.ts'

interface HistoryErrorBody {
  error?: unknown
}

function isHistoryData(value: unknown): value is YoloHistoryData {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<YoloHistoryData>
  return (row.view === 'timeline' || row.view === 'items' || row.view === 'subject')
    && Array.isArray(row.events)
    && Array.isArray(row.items)
    && Array.isArray(row.workspaceErrors)
    && typeof row.partial === 'boolean'
    && typeof row.openedAt === 'number'
    && typeof row.revision === 'number'
    && (row.nextCursor === null || typeof row.nextCursor === 'string')
}

function emptyResponseMessage(status: number): string {
  if (status === 404) return '历史服务尚未加载，请重启 dsh 后重试。'
  return `历史服务没有返回内容（${status}），请刷新后重试。`
}

/** Read the history endpoint defensively. Some stale dsh hosts answer an empty
 * 404 when the newly-installed client is loaded before the host is restarted;
 * never leak the browser's JSON parser error to users. */
export async function fetchHistory(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<YoloHistoryData> {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
  const text = await response.text()
  if (!text.trim()) throw new Error(emptyResponseMessage(response.status))

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(response.ok
      ? '历史服务返回的数据无法识别，请刷新或重启 dsh 后重试。'
      : `历史加载失败（${response.status}）`)
  }
  if (!response.ok) {
    const message = (body as HistoryErrorBody).error
    throw new Error(typeof message === 'string' && message.trim() ? message : `历史加载失败（${response.status}）`)
  }
  if (!isHistoryData(body)) throw new Error('历史数据不完整，请刷新或重启 dsh 后重试。')
  return body
}
