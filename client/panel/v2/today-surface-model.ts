import type {
  YoloAttentionRow,
  YoloDashboardData,
  YoloItemSource,
  YoloLedgerEntry,
  YoloTodoRow,
} from '../../../src/shared/dashboard.ts'
import type {
  AssistantJudgmentView,
  JudgmentSource,
  YoloTodoRowV2,
} from './model.ts'
import { dueAtLocalDate, isTodoOverdue } from '../../../src/shared/due.ts'
import { buildDashboardSurfaces, dashboardTodoKey } from '../../../src/shared/dashboard-surfaces.ts'

export interface TodayTaskReason {
  label: string
  evidence: string[]
}

export interface TodayTaskRowView {
  key: string
  todo: YoloTodoRowV2
  scopeCwd: string
  source: JudgmentSource
  reason?: TodayTaskReason
}

export interface TodayProgressView {
  completed: number
  changes: number
  sessions: number
}

export interface TodaySurfaceModel {
  dateLabel: string
  description: string
  partialMessage?: string
  judgment?: AssistantJudgmentView
  judgmentScopeCwd?: string
  attentionRows: TodayTaskRowView[]
  todayRows: TodayTaskRowView[]
  upcomingRows: TodayTaskRowView[]
  recentChanges: YoloLedgerEntry[]
  /** Deduplicated open todo owners actually carried by the default Today face. */
  openItemCount: number
  /** True when the count and rows cover only the successfully loaded workspaces. */
  partial: boolean
  /** True only before the aggregate workspace contains any user material. */
  pristine: boolean
  progress: TodayProgressView
  showClosure: boolean
}

export interface BuildTodaySurfaceOptions {
  now?: Date
  nearQuietHours?: boolean
  closureDismissed?: boolean
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isCompleted(status: string): boolean {
  return status === 'done' || status === 'completed'
}

function isOpen(status: string): boolean {
  return !isCompleted(status) && status !== 'cancelled'
}

function scopeOf(todo: YoloTodoRow, data: YoloDashboardData): string {
  return todo.scope_cwd ?? todo.ws?.cwd ?? data.cwd
}

function scopedTodoKey(todo: YoloTodoRow, data: YoloDashboardData): string {
  return `${scopeOf(todo, data)}\u0000${todo.id}`
}

function mapSource(
  source: YoloItemSource | undefined,
  todo: YoloTodoRow,
  fallbackWorkspace = todo.ws,
): JudgmentSource {
  if (source) {
    return {
      type: source.type,
      label: source.label,
      sessionId: source.session_id,
      excerpt: source.excerpt,
      workspace: source.workspace ?? fallbackWorkspace,
    }
  }
  if (todo.session_id || todo.session_label) {
    return {
      type: 'session',
      label: todo.session_label ?? '来源会话',
      sessionId: todo.session_id,
      workspace: fallbackWorkspace,
    }
  }
  return { type: 'legacy', label: '早期记录', workspace: fallbackWorkspace }
}

function mapTodo(
  todo: YoloTodoRow,
  data: YoloDashboardData,
  source?: YoloItemSource,
  forcedScope?: string,
): YoloTodoRowV2 {
  return {
    ...todo,
    scope_cwd: forcedScope ?? scopeOf(todo, data),
    source: mapSource(source ?? todo.source, todo),
  }
}

function findJudgmentTodo(data: YoloDashboardData, attention: YoloAttentionRow): YoloTodoRow | undefined {
  return data.todos.find((todo) => todo.id === attention.todo_id && scopeOf(todo, data) === attention.scope_cwd)
}

function findNotificationTodo(data: YoloDashboardData, todoId: string, scopeCwd?: string): YoloTodoRow | undefined {
  const matches = data.todos.filter((todo) => todo.id === todoId)
  if (scopeCwd) return matches.find((todo) => scopeOf(todo, data) === scopeCwd)
  // Legacy single-workspace notifications may have no explicit cwd. Never
  // guess when the same todo id exists in more than one loaded workspace.
  return matches.length === 1 ? matches[0] : undefined
}

function reasonLabelKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').replace(/[，,。.!！?？；;：:、·\s]+$/gu, '')
}

/**
 * Project one secondary attention reason without repeating the primary fact.
 * The row uses only server-authored structured evidence; the full free-text
 * explanation remains reserved for the primary assistant judgment.
 */
export function buildTodayTaskReason(
  reason: NonNullable<YoloTodoRow['attention_reason']>,
): TodayTaskReason | undefined {
  const candidates = (reason.evidence ?? [])
    .map((item) => item.label.trim())
    .filter((label) => reasonLabelKey(label).length > 0)
  const label = reason.short_reason.trim() || candidates[0]
  if (!label) return undefined

  const seen = new Set<string>([reasonLabelKey(label)])
  const evidence: string[] = []
  for (const candidate of candidates) {
    const key = reasonLabelKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    evidence.push(candidate)
  }
  return { label, evidence }
}

function buildJudgment(
  data: YoloDashboardData,
  attention: YoloAttentionRow | undefined,
): { view: AssistantJudgmentView; scopeCwd: string; todoKey: string } | null {
  if (!attention) return null
  const todo = findJudgmentTodo(data, attention)
  if (!todo || !isOpen(todo.status)) return null
  const source = mapSource(attention.source ?? todo.source, todo, attention.ws)
  const presentation = attention.seen_at == null ? 'full' : 'compact'
  const mappedTodo = mapTodo(todo, data, attention.source, attention.scope_cwd)
  return {
    view: {
      id: attention.id,
      version: attention.reason_version,
      evidenceFingerprint: attention.evidence_fingerprint,
      todo: mappedTodo,
      presentation,
      reason: presentation === 'compact' ? attention.short_reason : attention.explanation,
      fullReason: attention.explanation,
      evidence: attention.evidence.map((item) => ({ ...item })),
      source,
    },
    scopeCwd: attention.scope_cwd,
    todoKey: `${attention.scope_cwd}\u0000${attention.todo_id}`,
  }
}

function fallbackSummary(data: YoloDashboardData, today: string, now: Date): {
  open: number
  overdue: number
  dueToday: number
  completedToday: number
  changesToday: number
} {
  const openRows = data.todos.filter((todo) => isOpen(todo.status))
  const completedToday = data.todos.filter((todo) => {
    if (!isCompleted(todo.status) || !todo.completed_at) return false
    return localDate(new Date(todo.completed_at)) === today
  }).length
  return {
    open: openRows.length,
    overdue: openRows.filter((todo) => todo.overdue ?? isTodoOverdue(todo.due_at, todo.status, now)).length,
    dueToday: openRows.filter((todo) => dueAtLocalDate(todo.due_at) === today).length,
    completedToday,
    changesToday: data.ledger.length,
  }
}

export function buildTodaySurfaceModel(
  data: YoloDashboardData,
  options: BuildTodaySurfaceOptions = {},
): TodaySurfaceModel {
  const now = options.now ?? new Date(data.at)
  const today = localDate(now)
  const fallback = fallbackSummary(data, today, now)
  const serverSummary = data.summary
  // A cancelled row is never allowed to inflate completed, even if a stale
  // server summary counted terminal states together.
  const completedRows = data.todos.filter((todo) => isCompleted(todo.status)).length
  const completed = serverSummary
    ? Math.min(serverSummary.completedToday, completedRows)
    : fallback.completedToday
  const summary = {
    open: serverSummary?.open ?? fallback.open,
    overdue: serverSummary?.overdue ?? fallback.overdue,
    dueToday: serverSummary?.dueToday ?? fallback.dueToday,
    completedToday: completed,
    changesToday: serverSummary?.changesToday ?? fallback.changesToday,
  }

  const home = buildDashboardSurfaces(data).home
  const primary = buildJudgment(data, home.primary?.judgment)
  const attentionRows: TodayTaskRowView[] = []
  const todayRows: TodayTaskRowView[] = []
  const upcomingRows: TodayTaskRowView[] = []
  const openItemKeys = new Set<string>()
  if (primary) openItemKeys.add(primary.todoKey)

  const mapHomeRow = (todo: YoloTodoRow): TodayTaskRowView => {
    const mapped = mapTodo(todo, data)
    return {
      key: dashboardTodoKey(todo, data.cwd),
      todo: mapped,
      scopeCwd: scopeOf(todo, data),
      source: mapSource(todo.source, todo),
    }
  }

  for (const action of home.needsAction) {
    if (action.kind !== 'todo') continue
    const row = mapHomeRow(action.todo)
    attentionRows.push({
      ...row,
      reason: action.todo.attention_reason
        ? buildTodayTaskReason(action.todo.attention_reason)
        : undefined,
    })
    openItemKeys.add(row.key)
  }
  for (const todo of home.today) {
    const row = mapHomeRow(todo)
    todayRows.push(row)
    openItemKeys.add(row.key)
  }
  for (const todo of home.upcoming) {
    const row = mapHomeRow(todo)
    upcomingRows.push(row)
    openItemKeys.add(row.key)
  }

  // Reminder cards render on Today after the task lists. A future/open todo
  // with an unhandled reminder must therefore contribute to the tab count,
  // while duplicate cards and todos already carried above remain one item.
  for (const notification of data.notifications) {
    if (notification.handled || notification.kind !== 'reminder' || !notification.todo_id) continue
    const notificationScope = notification.scope_cwd ?? notification.ws?.cwd
    const todo = findNotificationTodo(data, notification.todo_id, notificationScope)
    if (todo && isOpen(todo.status)) openItemKeys.add(scopedTodoKey(todo, data))
  }

  const partial = serverSummary?.partial === true || (data.workspaceErrors?.length ?? 0) > 0
  // Keep first-run branding out of established workspaces, including ones
  // that are merely quiet today but still have goals, history or notices.
  const pristine = !partial
    && data.todos.length === 0
    && data.goals.length === 0
    && data.milestones.length === 0
    // Scheduled briefs are ambient assistant output, not user material. A
    // brand-new installation may create them before the first panel open.
    && data.events.every((row) => row.kind === 'brief_generated')
    && data.ledger.every((row) => row.kind === 'brief_generated')
    && data.notifications.every((row) => row.kind === 'brief')
    && data.preferences.length === 0
    && (data.attention?.length ?? 0) === 0
  const partialMessage = partial
    ? `部分工作区暂不可用${data.workspaceErrors?.length ? `：${data.workspaceErrors.join('；')}` : ''}。当前内容可能不完整。`
    : undefined
  const progress: TodayProgressView = {
    completed: summary.completedToday,
    changes: summary.changesToday,
    sessions: data.ledgerSessions,
  }
  const hasUnhandledRisk = primary !== null || attentionRows.length > 0
  const showClosure = options.closureDismissed !== true && (
    (progress.completed > 0 && hasUnhandledRisk)
    || progress.changes >= 3
    || options.nearQuietHours === true
  )

  return {
    dateLabel: `${now.getMonth() + 1}月${now.getDate()}日 · 周${'日一二三四五六'[now.getDay()]}`,
    description: `重点安排 ${openItemKeys.size} 件 · 全部挂起 ${summary.open} 件 · 今天到期 ${summary.dueToday} 件 · 逾期 ${summary.overdue} 件`,
    partialMessage,
    judgment: primary?.view,
    judgmentScopeCwd: primary?.scopeCwd,
    attentionRows,
    todayRows,
    upcomingRows,
    recentChanges: home.recentChanges,
    openItemCount: openItemKeys.size,
    partial,
    pristine,
    progress,
    showClosure,
  }
}
