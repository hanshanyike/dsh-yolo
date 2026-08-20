// Client conversation view definition (M4b): one isolated per-Session snapshot
// builder for the 'yolo' target. It collects yolo-dashboard nodes produced by
// the conversation node engine and folds them into a YoloSnapshot the tab reads
// via `useSession(s => s.views.get('yolo'))`.

import type {
  ConversationViewBuilder,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  EMPTY_YOLO_SNAPSHOT,
  type YoloDashboardData,
  type YoloSnapshot,
} from '../../src/shared/dashboard.ts'
import { asYoloDashboardNode } from '../node/DashboardNode.ts'

type AnyNode = { key: string; kind: string; id: string; target: string; data: unknown }

class YoloSnapshotBuilder implements ConversationViewBuilder<AnyNode, YoloSnapshot> {
  private current: YoloDashboardData | null = null
  readonly empty = EMPTY_YOLO_SNAPSHOT

  private snapshot(): YoloSnapshot {
    const d = this.current
    if (!d) return EMPTY_YOLO_SNAPSHOT
    return {
      scopeKey: d.scopeKey,
      cwd: d.cwd,
      at: d.at,
      todos: d.todos,
      goals: d.goals,
      milestones: d.milestones,
      events: d.events,
      preferences: d.preferences,
    }
  }

  replace(input: { nodes: readonly AnyNode[] }): YoloSnapshot {
    this.current = null
    for (const node of input.nodes) {
      const dash = asYoloDashboardNode(node)
      if (dash) this.current = dash.data
    }
    return this.snapshot()
  }

  apply(input: { upserts: readonly AnyNode[] }): YoloSnapshot {
    for (const node of input.upserts) {
      const dash = asYoloDashboardNode(node)
      if (dash) this.current = dash.data
    }
    return this.snapshot()
  }
}

export const yoloViewDefinition: ConversationViewDefinition<AnyNode, YoloSnapshot> = {
  target: 'yolo',
  create: () => new YoloSnapshotBuilder(),
}

export { EMPTY_YOLO_SNAPSHOT }
