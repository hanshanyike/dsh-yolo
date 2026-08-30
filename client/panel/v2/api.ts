import type { YoloActionRequest, YoloLearningReceipt, YoloUndoDescriptor } from '../../../src/contracts/actions.ts'
import type { LearningReceiptData } from './model.ts'

export interface ClientActionOutcome {
  ok: true
  item: Record<string, unknown>
  auditEventId?: string
  undo?: YoloUndoDescriptor
  learningReceipt?: LearningReceiptData
}

export class YoloActionError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message)
    this.name = 'YoloActionError'
  }
}

function newClientActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function normalizeReceipt(receipt: YoloLearningReceipt | undefined): LearningReceiptData | undefined {
  if (!receipt) return undefined
  return {
    type: receipt.type,
    summary: receipt.summary,
    scope: receipt.scope,
    before: receipt.before,
    after: receipt.after,
    preferenceId: receipt.preference_id,
    reversible: receipt.reversible,
  }
}

export async function postYoloAction(
  request: YoloActionRequest,
  fetcher: typeof fetch = fetch,
): Promise<ClientActionOutcome> {
  const payload = { ...request, client_action_id: request.client_action_id ?? newClientActionId() }
  const response = await fetcher('/yolo/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await response.json().catch(() => null)) as ({
    ok?: boolean
    error?: string
    code?: string
    item?: Record<string, unknown>
    audit_event_id?: string
    undo?: YoloUndoDescriptor
    learning_receipt?: YoloLearningReceipt
  } | null)
  if (!response.ok || body?.ok !== true || !body.item) {
    throw new YoloActionError(body?.error ?? `HTTP ${response.status}`, response.status, body?.code)
  }
  return {
    ok: true,
    item: body.item,
    auditEventId: body.audit_event_id,
    undo: body.undo,
    learningReceipt: normalizeReceipt(body.learning_receipt),
  }
}
