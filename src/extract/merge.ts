// YOLO merge — fold rule/LLM candidates into the storage service.
// Idempotent by design: storage upserts dedupe on normalized titles.

import type Yolo from '../storage/index.ts'
import type { Candidate } from './rules.ts'

export interface MergeResult {
  added: number
  skipped: number
}

/** Merge candidates into storage; returns counts. Never throws per-item (isolation). */
export function mergeCandidates(yolo: Yolo, cwd: string, candidates: readonly Candidate[]): MergeResult {
  let added = 0
  let skipped = 0
  for (const c of candidates) {
    try {
      switch (c.kind) {
        case 'todo':
          yolo.addTodo(cwd, { title: c.title, due_at: c.dueAt, priority: c.priority, source: 'rule' })
          added++
          break
        case 'milestone':
          yolo.addMilestone(cwd, { title: c.title, target_date: c.targetDate, description: c.detail, source: 'rule' })
          added++
          break
        case 'goal':
          yolo.addGoal(cwd, { title: c.title, description: c.detail })
          added++
          break
        case 'preference':
          if (c.prefKey && c.prefValue) {
            yolo.addPreference(cwd, { key: c.prefKey, value: c.prefValue })
            added++
          } else {
            skipped++
          }
          break
        case 'decision':
          yolo.addEvent(cwd, { kind: 'decision', summary: c.title })
          added++
          break
      }
    } catch {
      skipped++
    }
  }
  return { added, skipped }
}
