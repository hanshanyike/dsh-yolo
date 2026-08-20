// Client conversation node definition (M4b): matches the host-published
// 'yolo/snapshot' durable event and exposes the dashboard projection as the
// node state. The view builder below collects these nodes per Session.

import type { ConversationNodeDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { YoloDashboardData } from '../../src/shared/dashboard.ts'

/** Structural node shape the builder filters on (avoids deep type coupling). */
export interface YoloDashboardNode {
  key: string
  kind: 'yolo-dashboard'
  id: string
  target: 'yolo'
  data: YoloDashboardData
  anchorSeq?: number
  visibility?: 'visible' | 'hidden'
}

export const yoloDashboardDefinition: ConversationNodeDefinition<YoloDashboardData> = {
  kind: 'yolo-dashboard',
  // the view target this Definition feeds
  target: 'yolo',
  match: (event) =>
    event.type === 'yolo/snapshot' ? { id: 'dashboard', role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'yolo/snapshot') {
      throw new Error('yolo-dashboard start requires yolo/snapshot')
    }
    return match.event.data.data
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    const start = context.start
    return {
      key: context.key,
      kind: 'yolo-dashboard',
      id: 'dashboard',
      target: 'yolo',
      data: context.state,
      anchorSeq: start?.event.seq ?? 0,
      visibility: 'visible',
    } as ConversationViewNode
  },
}

/** Narrow a view node to the dashboard shape we publish. */
export function asYoloDashboardNode(node: unknown): YoloDashboardNode | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const n = node as Partial<YoloDashboardNode>
  return n?.kind === 'yolo-dashboard' && n?.target === 'yolo' ? (node as YoloDashboardNode) : undefined
}
