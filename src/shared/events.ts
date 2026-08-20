// YOLO custom durable session event types (declaration merge).
// Emitted by the ui plugin when the dashboard is opened; consumed by the
// client conversation node renderer (M4b) via the Conversation Node engine.

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The user opened the YOLO dashboard in this session. */
    'yolo/snapshot': {
      createdAt: number
      scopeKey: string
    }
  }
}

export {}
