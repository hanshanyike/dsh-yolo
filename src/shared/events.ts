// YOLO custom durable session event types (declaration merge).
// The host ui plugin appends 'yolo/snapshot' carrying the dashboard projection;
// the client conversation node renderer matches it to materialize the YOLO tab.

import type { YoloDashboardData } from './dashboard.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Host-published dashboard projection for the YOLO conversation view. */
    'yolo/snapshot': {
      createdAt: number
      scopeKey: string
      data: YoloDashboardData
    }
  }
}

export {}
