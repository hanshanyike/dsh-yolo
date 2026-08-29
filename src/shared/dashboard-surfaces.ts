import type {
  YoloAttentionRow,
  YoloDashboardData,
  YoloGoalRow,
  YoloLedgerEntry,
  YoloMilestoneRow,
  YoloNotificationRow,
  YoloTodoRow,
  WorkspaceTag,
} from './dashboard.ts'
import { isTodoOpen } from './dashboard.ts'
import { compareDueAt, dueAtLocalDate } from './due.ts'

/**
 * The three product pages are pure projections of the server dashboard
 * snapshot. They do not fetch, mutate or manufacture facts: reasons,
 * provenance, reminder state and partial coverage all come from the payload.
 */

export interface DashboardSurfaceCoverage {
  partial: boolean
  workspaceErrors: string[]
  loadedWorkspaceCount: number
}

export interface HomePrimaryItem {
  key: string
  todo: YoloTodoRow
  judgment: YoloAttentionRow
}

export type HomeActionItem =
  | { kind: 'todo'; key: string; todo: YoloTodoRow }
  | { kind: 'notification'; key: string; notification: YoloNotificationRow }

export interface HomeSurface {
  coverage: DashboardSurfaceCoverage
  /** At most one server-ranked judgment; never selected by the projection. */
  primary: HomePrimaryItem | null
  /** Rows for which the server supplied a reason/reminder. Notification history lives elsewhere. */
  needsAction: HomeActionItem[]
  /** Open rows explicitly scheduled for the dashboard's local day. */
  today: YoloTodoRow[]
  /** The next dated open rows only; undated backlog never fills the home page. */
  upcoming: YoloTodoRow[]
  /** A compact preview of the same allow-listed changes used by History. */
  recentChanges: YoloLedgerEntry[]
}

export interface PlanSurface {
  coverage: DashboardSurfaceCoverage
  /** Overdue facts supplied by the server plus rows scheduled for today. */
  today: YoloTodoRow[]
  /** Open rows scheduled after today; undated rows remain available in all. */
  upcoming: YoloTodoRow[]
  goals: YoloGoalRow[]
  milestones: YoloMilestoneRow[]
  all: YoloTodoRow[]
}

export interface HistorySurface {
  coverage: DashboardSurfaceCoverage
  completed: YoloTodoRow[]
  cancelled: YoloTodoRow[]
  recentChanges: YoloLedgerEntry[]
}

export interface DashboardSurfaces {
  home: HomeSurface
  plan: PlanSurface
  history: HistorySurface
}

export interface DashboardSurfaceOptions {
  homeUpcomingLimit?: number
  homeRecentChangesLimit?: number
}

/**
 * Explicit user-facing history contract. Unknown/future audit kinds stay out
 * until product semantics deliberately add them here.
 */
export const USER_VISIBLE_CHANGE_KINDS = new Set([
  'decision',
  'milestone_reached',
  'todo_created',
  'todo_started',
  'todo_completed',
  'todo_cancelled',
  'todo_postponed',
  'todo_remind_again',
  'todo_updated',
  'todo_reopened',
  'todo_consolidated',
  'goal_progress',
  'goal_status',
  'milestone_status',
])

export function isUserVisibleChange(row: Pick<YoloLedgerEntry, 'kind'>): boolean {
  return USER_VISIBLE_CHANGE_KINDS.has(row.kind)
}

function ownerKey(ws: WorkspaceTag | undefined, fallbackCwd: string): string {
  return ws?.cwd ?? ws?.slug ?? fallbackCwd
}

/** Stable cross-workspace identity: scope owner plus row id. */
export function dashboardTodoKey(row: YoloTodoRow, fallbackCwd: string): string {
  return `${row.scope_cwd ?? ownerKey(row.ws, fallbackCwd)}\u0000${row.id}`
}

function attentionTodoKey(row: YoloAttentionRow): string {
  return `${row.scope_cwd}\u0000${row.todo_id}`
}

function genericRowKey(row: { id: string; ws?: WorkspaceTag }, fallbackCwd: string): string {
  return `${ownerKey(row.ws, fallbackCwd)}\u0000${row.id}`
}

function dedupeRows<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const row of rows) {
    const key = keyOf(row)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

function coverageOf(snapshot: YoloDashboardData): DashboardSurfaceCoverage {
  const workspaceErrors = [...(snapshot.workspaceErrors ?? [])]
  return {
    partial: snapshot.summary?.partial === true || workspaceErrors.length > 0,
    workspaceErrors,
    loadedWorkspaceCount: snapshot.workspaceCount ?? (snapshot.scope === 'all' ? snapshot.workspaces?.length ?? 0 : 1),
  }
}

function isCompleted(row: YoloTodoRow): boolean {
  return row.status === 'done' || row.status === 'completed'
}

function isCancelled(row: YoloTodoRow): boolean {
  return row.status === 'cancelled'
}

function isActiveGoal(row: YoloGoalRow): boolean {
  return row.status !== 'achieved' && row.status !== 'abandoned' && row.status !== 'completed' && row.status !== 'done' && row.status !== 'cancelled'
}

function isActiveMilestone(row: YoloMilestoneRow): boolean {
  return row.status !== 'done' && row.status !== 'abandoned' && row.status !== 'completed' && row.status !== 'cancelled'
}

function sortedByDue(rows: readonly YoloTodoRow[]): YoloTodoRow[] {
  return [...rows].sort((left, right) => compareDueAt(left.due_at, right.due_at))
}

function sortedTerminal(rows: readonly YoloTodoRow[]): YoloTodoRow[] {
  return [...rows].sort((left, right) => (
    (right.completed_at ?? right.updated_at ?? 0) - (left.completed_at ?? left.updated_at ?? 0)
  ))
}

function visibleChanges(snapshot: YoloDashboardData): YoloLedgerEntry[] {
  return dedupeRows(
    snapshot.ledger.filter(isUserVisibleChange),
    (row) => genericRowKey(row, snapshot.cwd),
  ).sort((left, right) => right.occurred_at - left.occurred_at)
}

export function buildDashboardSurfaces(
  snapshot: YoloDashboardData,
  options: DashboardSurfaceOptions = {},
): DashboardSurfaces {
  const coverage = coverageOf(snapshot)
  const todos = dedupeRows(snapshot.todos, (row) => dashboardTodoKey(row, snapshot.cwd))
  const openTodos = todos.filter((row) => isTodoOpen(row.status))
  const todoByKey = new Map(openTodos.map((row) => [dashboardTodoKey(row, snapshot.cwd), row]))

  // The server owns ranking. We only take its first usable open-todo judgment.
  const primaryJudgment = (snapshot.attention ?? []).find((row) => todoByKey.has(attentionTodoKey(row)))
  const primary = primaryJudgment
    ? {
        key: attentionTodoKey(primaryJudgment),
        todo: todoByKey.get(attentionTodoKey(primaryJudgment))!,
        judgment: primaryJudgment,
      }
    : null

  const usedHomeTodoKeys = new Set<string>()
  if (primary) usedHomeTodoKeys.add(primary.key)

  const needsAction: HomeActionItem[] = []
  for (const todo of openTodos) {
    const key = dashboardTodoKey(todo, snapshot.cwd)
    if (usedHomeTodoKeys.has(key)) continue
    if (!todo.attention_reason && todo.reminder?.unhandled !== true) continue
    needsAction.push({ kind: 'todo', key, todo })
    usedHomeTodoKeys.add(key)
  }

  const today: YoloTodoRow[] = []
  const future: YoloTodoRow[] = []
  for (const todo of openTodos) {
    const key = dashboardTodoKey(todo, snapshot.cwd)
    if (usedHomeTodoKeys.has(key)) continue
    const dueDay = dueAtLocalDate(todo.due_at)
    if (dueDay === snapshot.ledgerDay) {
      today.push(todo)
      usedHomeTodoKeys.add(key)
    } else if (dueDay && dueDay > snapshot.ledgerDay) {
      future.push(todo)
    }
  }

  const planToday = openTodos.filter((row) => row.overdue === true || dueAtLocalDate(row.due_at) === snapshot.ledgerDay)
  const planUpcoming = openTodos.filter((row) => {
    const dueDay = dueAtLocalDate(row.due_at)
    return dueDay !== undefined && dueDay > snapshot.ledgerDay
  })
  const changes = visibleChanges(snapshot)
  const homeUpcomingLimit = Math.max(0, options.homeUpcomingLimit ?? 3)
  const homeRecentChangesLimit = Math.max(0, options.homeRecentChangesLimit ?? 3)

  return {
    home: {
      coverage,
      primary,
      needsAction,
      today: sortedByDue(today),
      upcoming: sortedByDue(future).slice(0, homeUpcomingLimit),
      recentChanges: changes.slice(0, homeRecentChangesLimit),
    },
    plan: {
      coverage,
      today: sortedByDue(planToday),
      upcoming: sortedByDue(planUpcoming),
      goals: dedupeRows(snapshot.goals.filter(isActiveGoal), (row) => genericRowKey(row, snapshot.cwd)),
      milestones: dedupeRows(snapshot.milestones.filter(isActiveMilestone), (row) => genericRowKey(row, snapshot.cwd)),
      all: sortedByDue(openTodos),
    },
    history: {
      coverage,
      completed: sortedTerminal(todos.filter(isCompleted)),
      cancelled: sortedTerminal(todos.filter(isCancelled)),
      recentChanges: changes,
    },
  }
}
