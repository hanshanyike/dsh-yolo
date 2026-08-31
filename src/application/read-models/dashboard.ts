// Host-side dashboard projection (M7) — the single data source for the
// browser-side YOLO panel. Serves the projection as JSON over HTTP
// (GET /yolo/dashboard). No per-session durable events: the dashboard is a
// global, session-independent surface.
//
// M8: rows carry the plan context (milestone_title) and the "where is it
// stuck" signals (overdue / stale).
// v0.3.0: adds the day ledger (events joined with session-summaries as source
// attention projections, notification rows, and independent handled/unread counts.
// v0.3.0 cross-workspace: `?scope=all` unions every known workspace (opt-in,
// read-only) and tags each row with its owning workspace.

import type Yolo from '../../storage/index.ts'
import type { Goal, Notification, TimelineEvent, Todo, TodoEvidence } from '../../domain/types.ts'
import type {
  YoloDashboardData,
  YoloLedgerEntry,
  YoloNotificationRow,
  YoloWorkspaceInfo,
  YoloMemoryHealth,
  YoloItemSource,
  YoloTodoRow,
  YoloGoalRow,
  YoloMilestoneRow,
  WorkspaceTag,
} from '../../shared/dashboard.ts'
import { isTodoOpen, isTodoOverdue, isTodoStale } from '../../shared/dashboard.ts'
import { isUserVisibleChange } from '../../shared/dashboard-surfaces.ts'
import { localDateStr, dayBounds } from '../../shared/text.ts'
import { workspaceIdentity } from '../../domain/scope.ts'
import {
  applyAttentionFeedback,
  buildDashboardSummary,
  rankAttentionCandidates,
  rankProjectedAttentionCandidates,
} from '../../attention/index.ts'

/** Resolve the source-badge label of one event (TC-3/TC-5, open question #4). */
export function eventLabel(e: TimelineEvent, sessions: Map<string, string>): string {
  if (e.session_id) return sessions.get(e.session_id) ?? '来源会话'
  if (e.source === 'manual') return e.kind === 'todo_created' ? '快速记一条' : '看板操作'
  if (e.source === 'llm') return '会话记录'
  if (e.source === 'tool') return '助手操作'
  return '早期记录'
}

export function isProgressLedgerEvent(event: Pick<TimelineEvent, 'kind'>): boolean {
  return isUserVisibleChange(event)
}

/** Build a human workspace label from a cwd (basename; fall back to the scope slug). */
export function workspaceLabel(cwd: string, scopeKey: string): string {
  const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return name && !/^[A-Za-z]:$/.test(name) ? name : scopeKey
}

/** Basename by default; duplicate basenames gain the shortest stable parent suffix. */
export function disambiguateWorkspaceLabels(workspaces: readonly { cwd: string; scopeKey: string }[]): Map<string, string> {
  const segments = workspaces.map(({ cwd }) => cwd.replaceAll('\\', '/').replace(/\/+$/, '').split('/').filter(Boolean))
  const labels = new Map<string, string>()
  for (let i = 0; i < workspaces.length; i++) {
    const own = segments[i] ?? []
    let depth = 1
    while (depth < own.length) {
      const suffix = own.slice(-depth).join('/')
      const unique = segments.every((other, j) => j === i || other.slice(-depth).join('/') !== suffix)
      if (unique) break
      depth++
    }
    labels.set(workspaceIdentity(workspaces[i]!.cwd), own.slice(-depth).join('/') || workspaces[i]!.scopeKey)
  }
  return labels
}

function workspaceTag(cwd: string, scopeKey: string, supplied?: WorkspaceTag): WorkspaceTag {
  return {
    slug: supplied?.slug ?? scopeKey,
    label: supplied?.label ?? workspaceLabel(cwd, scopeKey),
    cwd: supplied?.cwd ?? cwd,
  }
}

function itemSource(todo: Todo, sessions: Map<string, string>, ws: WorkspaceTag): YoloItemSource {
  // Manual/tool rows are not source-conversation evidence even if a caller
  // accidentally supplied a session id; never turn them into navigation links.
  if (todo.source === 'manual') return { type: 'manual', label: '快速记一条', session_id: null, workspace: ws }
  if (todo.source === 'tool') return { type: 'tool', label: '助手操作', session_id: null, workspace: ws }
  if (todo.session_id) {
    return {
      type: 'session',
      label: sessions.get(todo.session_id) ?? '来源会话',
      session_id: todo.session_id,
      excerpt: todo.source_excerpt ?? null,
      turn: todo.source_turn ?? null,
      created_at: todo.created_at,
      workspace: ws,
    }
  }
  if (todo.source === 'llm') return { type: 'legacy', label: '会话记录', session_id: null, workspace: ws }
  return { type: 'legacy', label: '早期记录', session_id: null, workspace: ws }
}

function goalSource(goal: Goal, sessions: Map<string, string>, ws: WorkspaceTag): YoloItemSource {
  if (goal.source === 'manual') return { type: 'manual', label: '快速记一条', session_id: null, workspace: ws }
  if (goal.source === 'tool') return { type: 'tool', label: '助手操作', session_id: null, workspace: ws }
  if (goal.session_id) {
    return {
      type: 'session', label: sessions.get(goal.session_id) ?? '来源会话', session_id: goal.session_id,
      excerpt: goal.source_excerpt ?? null, turn: goal.source_turn ?? null, created_at: goal.created_at, workspace: ws,
    }
  }
  return { type: 'legacy', label: goal.source === 'llm' ? '会话记录' : '早期记录', session_id: null, workspace: ws }
}

function evidenceSource(evidence: TodoEvidence, sessions: Map<string, string>, ws: WorkspaceTag): YoloItemSource {
  if (evidence.session_id) {
    return {
      type: 'session',
      label: sessions.get(evidence.session_id)
        ?? (evidence.source_kind === 'assistant_action' ? '助手操作所在会话' : '关联会话'),
      session_id: evidence.session_id,
      excerpt: evidence.excerpt ?? null,
      turn: evidence.turn_seq ?? null,
      created_at: evidence.occurred_at,
      workspace: ws,
      origin_kind: evidence.source_kind,
      relation: evidence.relation,
    }
  }
  const type = evidence.source_kind === 'panel_action'
    ? 'manual'
    : evidence.source_kind === 'assistant_action'
      ? 'tool'
      : 'legacy'
  return {
    type,
    label: type === 'manual' ? '看板操作' : type === 'tool' ? '助手操作' : '会话记录',
    session_id: null,
    excerpt: evidence.excerpt ?? null,
    turn: evidence.turn_seq ?? null,
    created_at: evidence.occurred_at,
    workspace: ws,
    origin_kind: evidence.source_kind,
    relation: evidence.relation,
  }
}

function postponedTitle(summary: string): string | undefined {
  return /^推迟：「(.+)」→\s/.exec(summary)?.[1]
}

function unhandledReminderMap(rows: readonly Notification[]): Map<string, { id: string; count: number; lastFiredAt: number; title: string; body: string | null }> {
  const out = new Map<string, { id: string; count: number; lastFiredAt: number; title: string; body: string | null }>()
  for (const row of rows) {
    if (row.kind !== 'reminder' || !row.todo_id || row.handled_at != null) continue
    const current = out.get(row.todo_id)
    if (!current) out.set(row.todo_id, { id: row.id, count: 1, lastFiredAt: row.created_at, title: row.title, body: row.body ?? null })
    else {
      current.count += 1
      if (row.created_at >= current.lastFiredAt) {
        current.id = row.id
        current.lastFiredAt = row.created_at
        current.title = row.title
        current.body = row.body ?? null
      }
    }
  }
  return out
}

/** Surface memory-health metrics for the current scope (recall/extraction quality + duplicate candidates). */
export function buildMemoryHealth(yolo: Yolo, cwd: string): YoloMemoryHealth {
  const todayStart = new Date().setHours(0, 0, 0, 0)
  const recallRunsToday = yolo.countRecallSince?.(cwd, todayStart) ?? 0
  const recallOk = yolo.countRecallStatusSince?.(cwd, 'ok', todayStart) ?? 0
  const recallErrorsToday = yolo.countRecallStatusSince?.(cwd, 'error', todayStart) ?? 0
  const recallHitRate = recallRunsToday === 0 ? 0 : Math.round((recallOk / recallRunsToday) * 100) / 100
  return {
    recallRunsToday,
    recallHitRate,
    recallErrorsToday,
    extractionErrorsToday: yolo.countExtractionErrorsSince?.(cwd, todayStart) ?? 0,
    deniedToday: yolo.countEventKindSince?.(cwd, 'action_denied', todayStart) ?? 0,
    duplicateTodos: yolo.listDuplicateTodos?.(cwd) ?? [],
  }
}
/** Build the full dashboard projection for a workspace scope. */
export function buildDashboardData(yolo: Yolo, cwd: string, day = localDateStr(), ws?: WorkspaceTag): YoloDashboardData {
  const now = Date.now()
  const scopeKey = ws?.slug ?? yolo.resolve(cwd).scopeKey
  const owner = workspaceTag(cwd, scopeKey, ws)
  const milestones = yolo.listMilestones(cwd)
  const msTitle = new Map(milestones.map((m) => [m.id, m.title]))
  const msStatus = new Map(milestones.map((m) => [m.id, m.status]))
  const sessions = new Map(yolo.listSessionSummaries(cwd).map((s) => [s.session_id, s.summary]))
  const storageTodos = yolo.listTodos(cwd)
  const openByMilestone = new Map<string, number>()
  for (const todo of storageTodos) {
    if (!todo.milestone_id || todo.status === 'done' || todo.status === 'cancelled') continue
    openByMilestone.set(todo.milestone_id, (openByMilestone.get(todo.milestone_id) ?? 0) + 1)
  }

  // Event rows do not yet carry a todo id. Exact current-title matching is a
  // conservative, auditable derivation: edits may under-count but never invent
  // postpones. A future schema can replace this projection without changing the
  // attention contract.
  const recentEvents = yolo.listEvents(cwd, 1_000)
  const postponeByTitle = new Map<string, number>()
  for (const event of recentEvents) {
    if (event.kind !== 'todo_postponed') continue
    const title = postponedTitle(event.summary)
    if (title) postponeByTitle.set(title, (postponeByTitle.get(title) ?? 0) + 1)
  }

  const unhandledNotifications = yolo.listUnhandledNotifications(cwd)
  const reminders = unhandledReminderMap(unhandledNotifications)

  const todos: YoloTodoRow[] = storageTodos.map((t) => {
    const sources = (yolo.listTodoEvidence?.(cwd, t.id) ?? []).map((evidence) => evidenceSource(evidence, sessions, owner))
    const relatedSessionCount = new Set(sources.map((source) => source.session_id).filter((id): id is string => !!id)).size
    return {
      id: t.id,
      title: t.title,
      detail: t.detail ?? null,
      status: t.status,
      priority: t.priority,
      due_at: t.due_at,
      milestone_title: t.milestone_id ? msTitle.get(t.milestone_id) ?? null : null,
      milestone_id: t.milestone_id ?? null,
      milestone_status: t.milestone_id ? msStatus.get(t.milestone_id) ?? null : null,
      milestone_open_todo_count: t.milestone_id ? openByMilestone.get(t.milestone_id) ?? 0 : 0,
      updated_at: t.updated_at,
      created_at: t.created_at,
      completed_at: t.completed_at ?? null,
      overdue: isTodoOverdue(t.due_at, t.status, new Date(now)),
      stale: isTodoStale(t.status, t.updated_at, now),
      session_label: t.session_id
        ? sessions.get(t.session_id) ?? '来源会话'
        : t.source === 'manual'
          ? '快速记一条'
          : null,
      session_id: t.session_id ?? null,
      source: itemSource(t, sessions, owner),
      sources,
      source_count: sources.length,
      related_session_count: relatedSessionCount,
      scope_cwd: cwd,
      postpone_count: postponeByTitle.get(t.title) ?? 0,
      ...(reminders.has(t.id)
        ? {
            reminder: {
              id: reminders.get(t.id)!.id,
              unhandled: true,
              unhandled_count: reminders.get(t.id)!.count,
              last_fired_at: reminders.get(t.id)!.lastFiredAt,
              title: reminders.get(t.id)!.title,
              body: reminders.get(t.id)!.body,
            },
          }
        : { reminder: { unhandled: false, unhandled_count: 0 } }),
      // v0.3.2 feedback signal (P/B1): how the user's history treats this commitment
      belief: { good: t.good_count ?? 0, stale: t.stale_count ?? 0 },
      ws: owner,
    }
  })

  const { from, to } = dayBounds(day)
  const dayEvents = yolo.listEventsBetween(cwd, from, to)
  const progressEvents = dayEvents.filter(isProgressLedgerEvent)
  const ledger: YoloLedgerEntry[] = progressEvents.map((e) => ({
    id: e.id,
    kind: e.kind,
    summary: e.summary,
    detail: e.detail ?? null,
    occurred_at: e.occurred_at,
    label: eventLabel(e, sessions),
    session_id: e.session_id ?? null,
    ws: owner,
  }))
  const ledgerSessions = new Set(progressEvents.map((e) => e.session_id).filter((s): s is string => !!s)).size

  const notifications: YoloNotificationRow[] = yolo.listNotifications(cwd, 12).map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    todo_id: n.todo_id ?? null,
    created_at: n.created_at,
    seen: n.seen_at != null,
    handled: n.handled_at != null,
    scope_cwd: cwd,
    ws: owner,
  }))

  const feedback = yolo.listAttentionFeedback?.(cwd) ?? []
  const rankedAttention = applyAttentionFeedback(rankAttentionCandidates(todos, new Date(now)), feedback, now)
  const reasonByTodo = new Map(rankedAttention.map((row) => [row.todo_id, row]))
  const projectedTodos = todos.map((todo) => {
    const reason = reasonByTodo.get(todo.id)
    if (!reason) return todo
    return {
      ...todo,
      attention_reason: {
        code: reason.reason_code,
        short_reason: reason.short_reason,
        explanation: reason.explanation,
        evidence: reason.evidence,
        reason_version: reason.reason_version,
        evidence_fingerprint: reason.evidence_fingerprint,
      },
    }
  })
  const milestoneRows: YoloMilestoneRow[] = milestones.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    target_date: m.target_date,
    ws: owner,
  }))
  const projectedById = new Map(projectedTodos.map((todo) => [todo.id, todo]))
  const goals: YoloGoalRow[] = yolo.listGoals(cwd).map((g) => {
    const links = yolo.listGoalTodoLinks?.(cwd, g.id) ?? []
    const linkedTodos = links
      .map((link) => projectedById.get(link.todo_id))
      .filter((todo): todo is YoloTodoRow => todo !== undefined)
    const nextTodo = g.next_todo_id ? projectedById.get(g.next_todo_id) ?? null : null
    const goalMilestones = yolo.listGoalMilestones?.(cwd, g.id) ?? []
    const currentMilestone = goalMilestones.find((m) => m.status === 'active')
      ?? goalMilestones.find((m) => m.status === 'planned')
      ?? goalMilestones[0]
    const attention = g.status === 'active'
      ? !nextTodo
        ? 'no_next_step' as const
        : g.next_review_at && Date.parse(g.next_review_at) <= now
          ? 'waiting_review' as const
          : null
      : null
    return {
      id: g.id,
      title: g.title,
      description: g.description ?? null,
      status: g.status,
      progress: g.progress,
      completion_criteria: g.completion_criteria ?? null,
      target_date: g.target_date ?? null,
      progress_note: g.progress_note ?? null,
      progress_source: g.progress_source ?? null,
      next_review_at: g.next_review_at ?? null,
      next_todo_id: g.next_todo_id ?? null,
      next_todo: nextTodo,
      open_todo_count: linkedTodos.filter((todo) => isTodoOpen(todo.status)).length,
      linked_todo_count: linkedTodos.length,
      current_milestone: currentMilestone
        ? milestoneRows.find((row) => row.id === currentMilestone.id) ?? null
        : null,
      milestone_count: goalMilestones.length,
      attention,
      source: goalSource(g, sessions, owner),
      updated_at: g.updated_at,
      milestone_title: g.milestone_id ? msTitle.get(g.milestone_id) ?? null : null,
      ws: owner,
    }
  })
  return {
    scopeKey,
    cwd,
    at: now,
    ui_contract_version: 2,
    attention: rankedAttention.slice(0, 1),
    summary: buildDashboardSummary(projectedTodos, day, ledger.length),
    capabilities: {
      preferenceUndo: false,
      notificationSeen: true,
      sourceExcerpt: true,
    },
    todos: projectedTodos,
    goals,
    milestones: milestoneRows,
    events: recentEvents.slice(0, 30).map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      occurred_at: e.occurred_at,
      ws: owner,
    })),
    preferences: yolo.listPreferences(cwd).map((p) => ({
      id: p.id,
      key: p.key,
      value: p.value,
      ws: owner,
    })),
    ledger,
    ledgerDay: day,
    ledgerSessions,
    notifications,
    // v0.3.3 review fix: count ALL unhandled notifications, not just those that
    // fit the 12-row display slice — reminder handling still needs the complete
    // domain count even though the product badge now belongs to `unseen`.
    unhandled: unhandledNotifications.length,
    unseen: yolo.countUnseenNotifications?.(cwd)
      ?? yolo.listNotifications(cwd, 100_000).filter((row) => row.seen_at == null).length,
    health: buildMemoryHealth(yolo, cwd),
    focusDefaultCount: 0,
  }
}

/** Dedup a row list across workspaces by (owner slug, row id). */
function mergeRows<T extends { id: string; ws?: WorkspaceTag }>(rows: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    const key = `${r.ws?.slug ?? ''}|${r.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

/** Union several workspace dashboards into one cross-workspace (scope:all) view.
 *  v0.3.3 review fixes: ledger/notifications are re-sorted into ONE global time
 *  order (per-workspace slices were simply concatenated), and memory-health
 *  metrics are merged across workspaces instead of inheriting the first one. */
export function aggregateDashboards(list: readonly YoloDashboardData[]): YoloDashboardData {
  const base = list[0]
  if (!base) throw new Error('aggregateDashboards: empty dashboard list')
  const labels = disambiguateWorkspaceLabels(list.map((d) => ({ cwd: d.cwd, scopeKey: d.scopeKey })))
  const labelOf = (d: YoloDashboardData): string => labels.get(workspaceIdentity(d.cwd)) ?? workspaceLabel(d.cwd, d.scopeKey)
  const labelRow = <T extends { ws?: WorkspaceTag; source?: YoloItemSource; sources?: YoloItemSource[] }>(row: T, label: string): T => ({
    ...row,
    ...(row.ws ? { ws: { ...row.ws, label } } : {}),
    ...(row.source?.workspace ? { source: { ...row.source, workspace: { ...row.source.workspace, label } } } : {}),
    ...(row.sources ? { sources: row.sources.map((source) => source.workspace
      ? { ...source, workspace: { ...source.workspace, label } }
      : source) } : {}),
  })
  const allTodos = mergeRows(list.flatMap((d) => d.todos.map((row) => labelRow(row, labelOf(d)))))
  const allGoals = mergeRows(list.flatMap((d) => d.goals.map((row) => labelRow(row, labelOf(d)))))
  const allMilestones = mergeRows(list.flatMap((d) => d.milestones.map((row) => labelRow(row, labelOf(d)))))
  const allEvents = mergeRows(list.flatMap((d) => d.events.map((row) => labelRow(row, labelOf(d)))))
  const allPrefs = mergeRows(list.flatMap((d) => d.preferences.map((row) => labelRow(row, labelOf(d)))))
  const allLedger = mergeRows(list.flatMap((d) => d.ledger.map((row) => labelRow(row, labelOf(d))))).sort((a, b) => b.occurred_at - a.occurred_at)
  const allNotifications = mergeRows(list.flatMap((d) => d.notifications.map((row) => labelRow(row, labelOf(d))))).sort((a, b) => b.created_at - a.created_at)
  const workspaceAttention = list.flatMap((d) => (d.attention ?? []).map((row) => labelRow(row, labelOf(d))))

  // health: sum the counters; weight each hit-rate by its run count
  const healths = list.map((d) => d.health).filter((h): h is YoloMemoryHealth => h !== undefined)
  let health: YoloMemoryHealth | undefined
  if (healths.length > 0) {
    const sum = (pick: (h: YoloMemoryHealth) => number): number => healths.reduce((n, h) => n + pick(h), 0)
    const runs = sum((h) => h.recallRunsToday)
    const weightedRate =
      runs === 0 ? 0 : Math.round(healths.reduce((n, h) => n + h.recallHitRate * h.recallRunsToday, 0) / runs * 100) / 100
    health = {
      recallRunsToday: runs,
      recallHitRate: weightedRate,
      recallErrorsToday: sum((h) => h.recallErrorsToday),
      extractionErrorsToday: sum((h) => h.extractionErrorsToday),
      deniedToday: sum((h) => h.deniedToday),
      duplicateTodos: healths.flatMap((h) => h.duplicateTodos),
    }
  }

  const wsMap = new Map<string, YoloWorkspaceInfo>()
  for (const d of list) {
    const slug = d.scopeKey
    const label = labelOf(d)
    const existing = wsMap.get(slug)
    const count = d.todos.filter((t) => isTodoOpen(t.status)).length
    if (existing) existing.count += count
    else wsMap.set(slug, { slug, label, count })
  }

  return {
    ...base,
    ui_contract_version: 2,
    scope: 'all',
    workspaces: [...wsMap.values()],
    workspaceCount: wsMap.size,
    todos: allTodos,
    goals: allGoals,
    milestones: allMilestones,
    events: allEvents,
    preferences: allPrefs,
    ledger: allLedger,
    ledgerSessions: list.reduce((n, d) => n + d.ledgerSessions, 0),
    notifications: allNotifications,
    attention: rankProjectedAttentionCandidates(workspaceAttention, allTodos).slice(0, 1),
    summary: buildDashboardSummary(
      allTodos,
      base.ledgerDay,
      allLedger.length,
      list.some((d) => d.summary?.partial === true || (d.workspaceErrors?.length ?? 0) > 0),
    ),
    // per-workspace unhandled is already a full count (not the display slice) —
    // summing them keeps the aggregate badge exact.
    unhandled: list.reduce((n, d) => n + (d.unhandled ?? 0), 0),
    unseen: list.reduce((n, d) => n + (d.unseen ?? 0), 0),
    ...(health !== undefined ? { health } : {}),
  }
}
