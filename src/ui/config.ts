// YOLO plugin configuration — schemastery schema, surfaced in the dsh Settings page.
// Pattern follows host plugins: explicit Config interface + `export const
// Config: z<Config>` (z.infer is unavailable here).
//
// M7: `enableRules` removed — the per-message regex fast path is gone; LLM
// semantic extraction at turn end is the only extraction strategy.

import z from '@deepseek-ai/schemastery'

export interface Config {
  enabled: boolean
  extraction: {
    enableLLM: boolean
    model: string
    minIntervalSec: number
    minTurnChars: number
    maxRunsPerDay: number
  }
  reminder: {
    enabled: boolean
    checkIntervalSec: number
    aheadMin: number
  }
  brief: {
    enabled: boolean
    morningTime: string
    eveningTime: string
    model: string
  }
  storage: {
    scope: string
    snapshotInterval: string
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

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  extraction: z.object({
    enableLLM: z.boolean().default(true),
    model: z.string().default('deepseek-chat'),
    minIntervalSec: z.number().default(30).min(10),
    minTurnChars: z.number().default(4).min(0),
    maxRunsPerDay: z.number().default(300).min(1),
  }),
  reminder: z.object({
    enabled: z.boolean().default(true),
    checkIntervalSec: z.number().default(300).min(60),
    aheadMin: z.number().default(0).min(0),
  }),
  brief: z.object({
    enabled: z.boolean().default(true),
    morningTime: z.string().default('09:00'),
    eveningTime: z.string().default('21:00'),
    model: z.string().default('deepseek-chat'),
  }),
  storage: z.object({
    scope: z.string().default('workspace'),
    snapshotInterval: z.string().default('daily'),
  }),
  recall: z.object({
    maxTokens: z.number().default(512).min(64),
    topK: z.number().default(5).min(1).max(20),
  }),
  semantic: z.object({
    enabled: z.boolean().default(true),
    model: z.string().default('deepseek-chat'),
    expansionsPerQuery: z.number().default(3).min(1).max(6),
    rerankOn: z.boolean().default(true),
    maxRerankCandidates: z.number().default(8).min(2).max(20),
    dailyBudget: z.number().default(60).min(0),
    minQueryChars: z.number().default(6).min(0),
    degradeAfterEmpty: z.number().default(5).min(0).max(50),
  }),
  ui: z.object({
    aggregateAcrossWorkspaces: z.boolean().default(false),
    focusDefaultCount: z.number().default(0).min(0).max(50),
  }),
})
