// YOLO shared constants — slot keys, namespaces, default paths.
// Centralized so dsh API drift is a one-place change (risk: dsh is v0.1.0-rc).

export const NAMESPACE = 'yolo' as const

/** ctx service name — accessed as ctx.yolo */
export const SERVICE_NAME = 'yolo' as const

/** dsh client UI slot keys (verified/assumed at M4). */
export const SLOT = {
  conversationView: 'conversation.view',
  conversationNode: 'conversation.chat.node',
  sessionHeaderActions: 'conversation.session.header.actions',
  settingsPluginItem: 'settings.plugin.item',
} as const

/** system prompt section orders (dsh convention: -100 harness, 0 persona, 100–199 tool guidance, 200+ runtime). */
export const PROMPT_ORDER = {
  preferencesPreamble: 120,
  recallContext: 220,
} as const

/** Custom durable session event types declared via SessionEventMap merge. */
export const EVENT = {
  snapshot: 'yolo/snapshot',
} as const

/** LLM stream purpose tag — segregates yolo extraction traffic from main agent. */
export const LLM_PURPOSE = 'yolo-extract' as const

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
  snapshotKeepDays: 90,
} as const
