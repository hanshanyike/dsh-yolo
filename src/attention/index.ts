// Dashboard-v2 deterministic judgment domain.
//
// This module deliberately consumes only projected, auditable facts. It does
// not call an LLM, read storage, or inspect React state, so ranking and wording
// remain stable under refresh and are straightforward to test.

import type {
  YoloAttentionEvidence,
  YoloAttentionReasonCode,
  YoloAttentionRow,
  YoloDashboardSummary,
  YoloTodoRow,
} from '../shared/dashboard.ts'
import { isTodoOpen } from '../shared/dashboard.ts'
import { localDateStr } from '../shared/text.ts'

export const ATTENTION_REASON_VERSION = 'attention-v1'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

interface ScoredEvidence extends YoloAttentionEvidence {
  reason: YoloAttentionReasonCode | 'active_milestone'
  points: number
  qualifies: boolean
}

export interface AttentionFeedbackState {
  todo_id: string
  reason_version: string
  evidence_fingerprint: string
  seen_at?: number | null
  suppressed_until?: number | null
  feedback_reason?: string | null
}

function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Parse a due value without turning a local YYYY-MM-DD into UTC. */
function dueMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = new Date(dateOnly(value) ? `${value}T23:59:59.999` : value).getTime()
  return Number.isFinite(parsed) ? parsed : undefined
}

function localMidnightMs(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function overdueDays(value: string, now: Date): number {
  if (dateOnly(value)) {
    const dueDay = new Date(`${value}T00:00:00`)
    return Math.max(0, Math.round((localMidnightMs(now) - localMidnightMs(dueDay)) / DAY_MS))
  }
  const parsed = dueMs(value)
  if (parsed === undefined || parsed >= now.getTime()) return 0
  return Math.max(0, Math.floor((now.getTime() - parsed) / DAY_MS))
}

function fingerprint(parts: readonly unknown[]): string {
  const input = JSON.stringify(parts)
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${ATTENTION_REASON_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function priorityRank(priority: string | null | undefined): number {
  if (priority === 'urgent') return 3
  if (priority === 'high') return 2
  if (priority === 'medium') return 1
  return 0
}

function evidenceFor(row: YoloTodoRow, now: Date): ScoredEvidence[] {
  const evidence: ScoredEvidence[] = []
  const nowMs = now.getTime()
  const parsedDue = dueMs(row.due_at)
  const dueInHours = parsedDue === undefined ? undefined : (parsedDue - nowMs) / HOUR_MS
  const precisePastDue = parsedDue !== undefined && parsedDue < nowMs
  const datePastDue = !!row.due_at && row.due_at.slice(0, 10) < localDateStr(now)

  if (row.reminder?.unhandled) {
    const count = Math.max(1, row.reminder.unhandled_count ?? 1)
    evidence.push({
      reason: 'reminder_due',
      code: 'unhandled_reminder',
      label: count === 1 ? '有一条未处理提醒' : `有 ${count} 条未处理提醒`,
      value: count,
      points: 50,
      qualifies: true,
    })
  }

  if (row.due_at && (datePastDue || precisePastDue)) {
    const days = overdueDays(row.due_at, now)
    evidence.push({
      reason: 'overdue',
      code: 'overdue',
      label: days > 0 ? `已逾期 ${days} 天` : '已超过截止时间',
      value: days,
      // PRD default: +40, then one point per overdue day, capped at +20.
      points: 40 + Math.min(days, 20),
      qualifies: true,
    })
  } else if (dueInHours !== undefined && dueInHours >= 0 && dueInHours <= 24) {
    const withinTwoHours = dueInHours <= 2
    evidence.push({
      reason: 'due_soon',
      code: withinTwoHours ? 'due_within_2h' : 'due_within_24h',
      label: withinTwoHours ? '距离截止时间不到 2 小时' : '距离截止时间不到 24 小时',
      value: Math.max(0, Math.round(dueInHours * 10) / 10),
      points: withinTwoHours ? 35 : 20,
      qualifies: true,
    })
  }

  if (row.priority === 'urgent' || row.priority === 'high') {
    const urgentSoon = row.priority === 'urgent' && dueInHours !== undefined && dueInHours >= 0 && dueInHours <= 72
    evidence.push({
      reason: 'high_priority',
      code: 'priority',
      label: row.priority === 'urgent' ? '优先级为紧急' : '优先级为高',
      value: row.priority,
      points: row.priority === 'urgent' ? 20 : 10,
      qualifies: urgentSoon,
    })
  }

  if ((row.postpone_count ?? 0) >= 2) {
    evidence.push({
      reason: 'repeated_postpone',
      code: 'postpone_count',
      label: `已推迟 ${row.postpone_count} 次`,
      value: row.postpone_count,
      points: 15,
      qualifies: true,
    })
  }

  if (row.stale) {
    evidence.push({
      reason: 'stale',
      code: 'stale_over_7d',
      label: '已超过 7 天未更新',
      value: row.updated_at,
      points: 10,
      qualifies: true,
    })
  }

  if (row.milestone_status === 'active') {
    const onlyOpen = row.milestone_open_todo_count === 1
    evidence.push({
      reason: onlyOpen ? 'milestone_risk' : 'active_milestone',
      code: onlyOpen ? 'only_open_in_milestone' : 'active_milestone',
      label: onlyOpen ? '是进行中里程碑近期唯一未完成项' : '关联进行中的里程碑',
      value: row.milestone_title ?? row.milestone_id ?? undefined,
      points: 5,
      qualifies: onlyOpen,
    })
  }

  return evidence
}

function primaryEvidence(evidence: readonly ScoredEvidence[]): ScoredEvidence {
  return [...evidence]
    .filter((item) => item.qualifies)
    .sort((a, b) => b.points - a.points || a.reason.localeCompare(b.reason))[0]!
}

function levelOf(score: number): YoloAttentionRow['level'] {
  if (score >= 50) return 'critical'
  if (score >= 20) return 'attention'
  return 'normal'
}

/** Convert one open todo into a judgment candidate, or null below threshold. */
export function scoreAttentionCandidate(row: YoloTodoRow, now = new Date()): YoloAttentionRow | null {
  if (!isTodoOpen(row.status) || !row.ws?.slug || !row.ws.cwd) return null
  const evidence = evidenceFor(row, now)
  if (!evidence.some((item) => item.qualifies)) return null
  const primary = primaryEvidence(evidence)
  const score = evidence.reduce((total, item) => total + item.points, 0)
  const publicEvidence = evidence.map(({ code, label, value }) => ({ code, label, ...(value !== undefined ? { value } : {}) }))

  return {
    id: `${row.ws.slug}:${row.id}`,
    todo_id: row.id,
    scope_cwd: row.scope_cwd ?? row.ws.cwd,
    ws: row.ws,
    score,
    level: levelOf(score),
    reason_code: primary.reason as YoloAttentionReasonCode,
    short_reason: primary.label,
    explanation: `${publicEvidence.map((item) => item.label).join('，')}。`,
    evidence: publicEvidence,
    reason_version: ATTENTION_REASON_VERSION,
    evidence_fingerprint: fingerprint([
      row.ws.slug,
      row.id,
      row.status,
      row.due_at ?? null,
      row.priority ?? null,
      row.reminder?.id ?? null,
      row.reminder?.unhandled ?? false,
      row.reminder?.unhandled_count ?? 0,
      row.postpone_count ?? 0,
      row.updated_at ?? null,
      row.milestone_id ?? null,
      row.milestone_status ?? null,
      row.milestone_open_todo_count ?? null,
      primary.reason,
      publicEvidence,
      ATTENTION_REASON_VERSION,
    ]),
    ...(row.source ? { source: row.source } : {}),
  }
}

function candidateKey(row: Pick<YoloAttentionRow, 'todo_id' | 'reason_version' | 'evidence_fingerprint'>): string {
  return `${row.todo_id}|${row.reason_version}|${row.evidence_fingerprint}`
}

/** Apply trust state only to the exact immutable evidence version it belongs to. */
export function applyAttentionFeedback(
  rows: readonly YoloAttentionRow[],
  states: readonly AttentionFeedbackState[],
  nowMs = Date.now(),
): YoloAttentionRow[] {
  const byKey = new Map(states.map((state) => [candidateKey(state), state]))
  return rows.flatMap((row) => {
    const state = byKey.get(candidateKey(row))
    if (!state) return [row]
    if (state.suppressed_until != null && state.suppressed_until > nowMs) return []
    return [{
      ...row,
      seen_at: state.seen_at ?? null,
      suppressed_until: state.suppressed_until ?? null,
      feedback_reason: state.feedback_reason ?? null,
    }]
  })
}

function compareCandidates(a: YoloAttentionRow, b: YoloAttentionRow, todoByKey: Map<string, YoloTodoRow>): number {
  if (a.score !== b.score) return b.score - a.score
  const todoA = todoByKey.get(`${a.ws.slug}|${a.todo_id}`)
  const todoB = todoByKey.get(`${b.ws.slug}|${b.todo_id}`)
  const dueA = dueMs(todoA?.due_at) ?? Number.POSITIVE_INFINITY
  const dueB = dueMs(todoB?.due_at) ?? Number.POSITIVE_INFINITY
  if (dueA !== dueB) return dueA - dueB
  const priority = priorityRank(todoB?.priority) - priorityRank(todoA?.priority)
  if (priority !== 0) return priority
  const updatedA = todoA?.updated_at ?? Number.POSITIVE_INFINITY
  const updatedB = todoB?.updated_at ?? Number.POSITIVE_INFINITY
  if (updatedA !== updatedB) return updatedA - updatedB
  const keyA = `${a.ws.slug}|${a.todo_id}`
  const keyB = `${b.ws.slug}|${b.todo_id}`
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
}

export function rankProjectedAttentionCandidates(
  rows: readonly YoloAttentionRow[],
  todos: readonly YoloTodoRow[],
): YoloAttentionRow[] {
  const todoByKey = new Map(todos.map((row) => [`${row.ws?.slug ?? ''}|${row.id}`, row]))
  return [...rows].sort((a, b) => compareCandidates(a, b, todoByKey))
}

/** Stable server-side ranking. No score or explanation is accepted from clients. */
export function rankAttentionCandidates(rows: readonly YoloTodoRow[], now = new Date()): YoloAttentionRow[] {
  const candidates = rows
    .map((row) => scoreAttentionCandidate(row, now))
    .filter((row): row is YoloAttentionRow => row !== null)
  return rankProjectedAttentionCandidates(candidates, rows)
}

/** Select the unique judgment and a de-duplicated remainder for later lists. */
export function selectPrimaryAttention(
  rows: readonly YoloTodoRow[],
  now = new Date(),
  feedback: readonly AttentionFeedbackState[] = [],
): { attention: YoloAttentionRow[]; remaining: YoloTodoRow[] } {
  const ranked = applyAttentionFeedback(rankAttentionCandidates(rows, now), feedback, now.getTime())
  const primary = ranked[0]
  if (!primary) return { attention: [], remaining: [...rows] }
  return {
    attention: [primary],
    remaining: rows.filter((row) => !(row.id === primary.todo_id && row.ws?.slug === primary.ws.slug)),
  }
}

/** Build the v2 summary from the same projected facts used by the UI. */
export function buildDashboardSummary(
  rows: readonly YoloTodoRow[],
  day: string,
  changesToday: number,
  partial = false,
): YoloDashboardSummary {
  return {
    open: rows.filter((row) => isTodoOpen(row.status)).length,
    overdue: rows.filter((row) => row.overdue && isTodoOpen(row.status)).length,
    dueToday: rows.filter((row) => isTodoOpen(row.status) && row.due_at?.slice(0, 10) === day).length,
    completedToday: rows.filter((row) =>
      (row.status === 'done' || row.status === 'completed')
      && row.completed_at != null
      && localDateStr(new Date(row.completed_at)) === day,
    ).length,
    changesToday,
    partial,
  }
}
