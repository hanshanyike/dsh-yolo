import type Yolo from '../../storage/index.ts'
import type { YoloGoalDetail, YoloGoalHistoryEntry } from '../../shared/dashboard.ts'
import { buildDashboardData } from './dashboard.ts'
import { localDateStr } from '../../shared/text.ts'

/** Build one goal detail from the same workspace facts as the dashboard. */
export function buildGoalDetail(yolo: Yolo, cwd: string, goalId: string): YoloGoalDetail | null {
  const dashboard = buildDashboardData(yolo, cwd, localDateStr())
  const goal = dashboard.goals.find((row) => row.id === goalId)
  if (!goal) return null
  const linkedIds = new Set((yolo.listGoalTodoLinks?.(cwd, goalId) ?? []).map((link) => link.todo_id))
  const milestoneIds = new Set((yolo.listGoalMilestoneLinks?.(cwd, goalId) ?? []).map((link) => link.milestone_id))
  const supportTodos = dashboard.todos.filter((todo) => linkedIds.has(todo.id))
  const milestones = dashboard.milestones.filter((milestone) => milestoneIds.has(milestone.id))
  const history: YoloGoalHistoryEntry[] = yolo.listEvents(cwd, 1_000)
    .filter((event) => event.subject_type === 'goal' && event.subject_id === goalId)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      summary: event.summary,
      detail: event.detail ?? null,
      occurred_at: event.occurred_at,
      ...(goal.source ? { source: goal.source } : {}),
    }))
  return {
    goal,
    support_todos: supportTodos,
    milestones,
    recent_progress: history.filter((event) => ['goal_progress', 'goal_reviewed', 'goal_status'].includes(event.kind)).slice(0, 10),
    history,
  }
}
