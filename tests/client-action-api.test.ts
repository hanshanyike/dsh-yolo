import { describe, expect, it, vi } from 'vitest'
import { postYoloAction, YoloActionError } from '../client/panel/v2/api.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('postYoloAction', () => {
  it('adds a client action id and maps only a server learning receipt', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(payload.client_action_id).toEqual(expect.any(String))
      expect(payload.scope_cwd).toBe('D:/work/a')
      return jsonResponse({
        ok: true,
        item: { id: 'todo-1' },
        audit_event_id: 'event-1',
        learning_receipt: {
          type: 'schedule_change', summary: '已推迟到明天', scope: 'item',
          before: '2026-08-23', after: '2026-08-24', preference_id: 'pref-1', reversible: true,
        },
      })
    }) as unknown as typeof fetch

    const result = await postYoloAction({
      action: 'postpone', kind: 'todo', id: 'todo-1', due_at: '2026-08-24', scope_cwd: 'D:/work/a',
    }, fetcher)

    expect(result).toMatchObject({
      auditEventId: 'event-1',
      learningReceipt: { type: 'schedule_change', preferenceId: 'pref-1', reversible: true },
    })
  })

  it('does not invent a receipt when the server omits it', async () => {
    const result = await postYoloAction(
      { action: 'handled', kind: 'notification', id: 'notification-1' },
      (async () => jsonResponse({ ok: true, item: { id: 'notification-1' } })) as typeof fetch,
    )
    expect(result.learningReceipt).toBeUndefined()
  })

  it('surfaces server status, code and explanation', async () => {
    await expect(postYoloAction(
      { action: 'feedback', kind: 'attention', id: 'attention-1' },
      (async () => jsonResponse({ ok: false, code: 'attention_binding_required', error: '判断依据已变化' }, 409)) as typeof fetch,
    )).rejects.toEqual(expect.objectContaining<Partial<YoloActionError>>({
      name: 'YoloActionError', status: 409, code: 'attention_binding_required', message: '判断依据已变化',
    }))
  })
})
