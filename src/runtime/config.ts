// YOLO host runtime configuration owner. The stable data shape lives under
// contracts; this adapter owns schemastery validation/defaults and the dsh
// settings namespace join key.

import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type { YoloConfig } from '../contracts/config.ts'

/** Compatibility name used by the Cordis plugin loader. */
export type Config = YoloConfig

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
    checkIntervalSec: z.number().default(30).min(10),
    aheadMin: z.number().default(0).min(0),
    quietHoursEnabled: z.boolean().default(false),
    quietStart: z.string().default('22:00').pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    quietEnd: z.string().default('08:00').pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
  }),
  brief: z.object({
    enabled: z.boolean().default(true),
    morningTime: z.string().default('09:00').pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    eveningTime: z.string().default('21:00').pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    model: z.string().default('deepseek-chat'),
  }),
  storage: z.object({
    scope: z.string().default('workspace'),
    snapshotInterval: z.union(['daily', 'every_10_turns']).default('daily'),
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

/** Host settings service key; must remain settingsNamespace('yolo'). */
export const YOLO_NS = settingsNamespace('yolo')
