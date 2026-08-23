import type {
  YoloAttentionRow,
  YoloDashboardData,
  YoloItemSource,
  YoloTodoRow,
} from '../../../src/shared/dashboard.ts'
import type {
  AssistantJudgmentView,
  JudgmentSource,
  YoloTodoRowV2,
} from './model.ts'

export interface TodayTaskReason {
  label: string
  explanation: string
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

function attentionFact(todo: YoloTodoRow, today: string): TodayTaskReason | null {
  const due = todo.due_at?.slice(0, 10) ?? null
  if (todo.reminder?.unhandled) return { label: '提醒待处理', explanation: '有一条尚未处理的提醒。' }
  if (todo.overdue || (due !== null && due < today)) return { label: '逾期', explanation: `截止时间为 ${due ?? '过去日期'}。` }
  if (todo.stale) return { label: '长期未动', explanation: '这项事情已经一段时间没有变化。' }
  if ((todo.postpone_count ?? 0) >= 2) return { label: '多次推迟', explanation: `已经推迟 ${todo.postpone_count} 次。` }
  if (todo.priority === 'urgent' || todo.priority === 'high') return { label: '高优先级', explanation: '这项事情被标记为高优先级。' }
  return null
}

function findJudgmentTodo(data: YoloDashboardData, attention: YoloAttentionRow): YoloTodoRow | undefined {
  return data.todos.find((todo) => todo.id === attention.todo_id && scopeOf(todo, data) === attention.scope_cwd)
    ?? data.todos.find((todo) => todo.id === attention.todo_id)
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
      todo: mappedTodo,
      presentation,
      reason: presentation === 'compact' ? attention.short_reason : attention.explanation,
      evidence: attention.evidence.map((item) => ({ ...item })),
      source,
    },
    scopeCwd: attention.scope_cwd,
    todoKey: `${attention.scope_cwd}\u0000${attention.todo_id}`,
  }
}

function fallbackSummary(data: YoloDashboardData, today: string): {
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
    overdue: openRows.filter((todo) => todo.overdue || ((todo.due_at?.slice(0, 10) ?? today) < today)).length,
    dueToday: openRows.filter((todo) => todo.due_at?.slice(0, 10) === today).length,
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
  const fallback = fallbackSummary(data, today)
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

  const primary = buildJudgment(data, data.attention?.[0])
  const attentionRows: TodayTaskRowView[] = []
  const todayRows: TodayTaskRowView[] = []

  for (const todo of data.todos) {
    if (!isOpen(todo.status) || scopedTodoKey(todo, data) === primary?.todoKey) continue
    const mapped = mapTodo(todo, data)
    const row: TodayTaskRowView = {
      key: scopedTodoKey(todo, data),
      todo: mapped,
      scopeCwd: scopeOf(todo, data),
      source: mapSource(todo.source, todo),
    }
    const fact = attentionFact(todo, today)
    if (fact) attentionRows.push({ ...row, reason: fact })
    else if (todo.due_at?.slice(0, 10) === today) todayRows.push(row)
  }

  const partial = serverSummary?.partial === true || (data.workspaceErrors?.length ?? 0) > 0
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
    description: `${summary.open} 件挂起 · ${summary.dueToday} 件今天到期 · ${summary.overdue} 件逾期`,
    partialMessage,
    judgment: primary?.view,
    judgmentScopeCwd: primary?.scopeCwd,
    attentionRows,
    todayRows,
    progress,
    showClosure,
  }
}
