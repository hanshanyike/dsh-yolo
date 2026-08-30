/**
 * Stable YOLO settings contract shared by the host and browser bundles.
 *
 * Keep this module free of Cordis, dsh and schemastery runtime imports: the
 * client bundle needs the shape and namespace, while validation belongs to
 * the host runtime adapter in `src/runtime/config.ts`.
 */
export const YOLO_SETTINGS_NAMESPACE = 'yolo' as const

export interface YoloConfig {
  enabled: boolean
  extraction: {
    enableLLM: boolean
    model: string
    minIntervalSec: number
    minTurnChars: number
    maxRunsPerDay: number
    /** Experimental R2a stable-id LINK/due-date UPDATE policy. Default off
     * until a labeled model-prediction report satisfies the safety gate. */
    todoIdentityR2Enabled: boolean
    /** Experimental R3 duplicate suggestions. Suggestions require a preview
     * and explicit confirmation; this switch never authorizes auto-merge. */
    todoIdentityR3Enabled: boolean
  }
  reminder: {
    enabled: boolean
    checkIntervalSec: number
    aheadMin: number
    quietHoursEnabled: boolean
    quietStart: string
    quietEnd: string
  }
  brief: {
    enabled: boolean
    morningTime: string
    eveningTime: string
    model: string
  }
  storage: {
    scope: string
    snapshotInterval: 'daily' | 'every_10_turns'
  }
  recall: {
    maxTokens: number
    topK: number
  }
  semantic: {
    enabled: boolean
    model: string
    expansionsPerQuery: number
    rerankOn: boolean
    maxRerankCandidates: number
    dailyBudget: number
    minQueryChars: number
    degradeAfterEmpty: number
  }
  ui: {
    aggregateAcrossWorkspaces: boolean
    focusDefaultCount: number
  }
}

/** Browser-facing name retained for settings UI readability. */
export type YoloSettings = YoloConfig
