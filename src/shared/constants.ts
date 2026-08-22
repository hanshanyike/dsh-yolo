// YOLO shared constants — namespaces and default paths.
// Centralized so dsh API drift is a one-place change (risk: dsh is v0.1.0-rc).

export const NAMESPACE = 'yolo' as const

/** ctx service name — accessed as ctx.yolo */
export const SERVICE_NAME = 'yolo' as const

/** dsh client UI slot keys (verified/assumed at M4). */
export const SLOT = {
  sidebarFooterAction: 'sidebar.footer.action',
  settingsPluginItem: 'settings.plugin.item',
} as const

/** system prompt section orders (dsh convention: -100 harness, 0 persona, 100–199 tool guidance, 200+ runtime). */
export const PROMPT_ORDER = {
  instructions: 110,
  preferencesPreamble: 120,
  recallContext: 220,
} as const

/** Default storage config. */
export const DEFAULTS = {
  scope: 'workspace' as const,
  reminderCheckIntervalSec: 300,
  reminderAheadMin: 60,
  extractionMinIntervalSec: 30,
  extractionTokenBudgetPerTurn: 2048,
  extractionTokenBudgetPerDay: 100_000,
  recallMaxTokens: 512,
  recallTopK: 5,
  recallKindQuota: 2,
  recallPrefsMax: 12,
  extractionMinTurnChars: 4,
  extractionMaxRunsPerDay: 300,
  snapshotKeepDays: 90,
  recallLogRetentionDays: 30,
  semantic: {
    enabled: true,
    model: 'deepseek-chat',
    expansionsPerQuery: 3,
    rerankOn: true,
    maxRerankCandidates: 8,
    dailyBudget: 60,
    minQueryChars: 6,
  },
  ui: {
    aggregateAcrossWorkspaces: false,
  },
  briefEnabled: true,
  briefMorningTime: '09:00',
  briefEveningTime: '21:00',
  briefModel: 'deepseek-chat',
  briefCheckIntervalSec: 30,
} as const

