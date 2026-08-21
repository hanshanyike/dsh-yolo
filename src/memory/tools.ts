// YOLO memory tools — model-visible access to the memory store.
// Registered on ctx.tools via dsh's defineTool DSL (M1; host-verified at M2/M3).

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type Yolo from '../storage/index.ts'
import type { EventKind, GoalStatus, MilestoneStatus, Priority, RowType, TodoStatus } from '../storage/types.ts'

/** Context augmented with the yolo service (register via inject ['yolo']). */
export interface YoloContext extends Context {
  yolo: Yolo
}

/**
 * Resolve the cwd used for scope partitioning.
 * Tool `execute` callbacks run without a live Session in scope, so we fall back
 * to the host process cwd. The extract/reminder plugins prefer `session.meta?.cwd`;
 * under the web profile the two resolve to the same workspace.
 */
const cwdOf = () => process.cwd()

/** JSON-roundtrip a value so it satisfies the output.schema JsonValue constraint. */
const json = (v: unknown): never => JSON.parse(JSON.stringify(v)) as never

export function registerYoloTools(ctx: YoloContext): void {
  const y = ctx.yolo
  const cwd = cwdOf

  ctx.tools.register(
    defineTool({
      name: 'memory_search',
      description: 'Search the YOLO personal memory store: todos, milestones, goals, preferences and timeline events, with full-text matching. CJK: use >= 3 chars for best recall.',
      parameters: {
        query: { type: 'string', required: true, description: 'Search keywords.' },
        topK: { type: 'integer', description: 'Max results (default 5).' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'Optional row-kind filter: todo|milestone|goal|preference|event.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
      },
      async execute(args) {
        return json(y.search(cwd(), args.query ?? '', args.topK ?? 5, (args.kinds as RowType[] | undefined) ?? undefined))
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_write',
      description: 'Write a memory item into YOLO for tracking: todo, milestone, goal, preference or timeline event. Use when the user explicitly asks to remember or track something.',
      parameters: {
        kind: { type: 'string', required: true, description: 'todo|milestone|goal|preference|event' },
        title: { type: 'string', required: true, description: 'Item title / summary text.' },
        detail: { type: 'string', description: 'Optional detail (todos/milestones/goals/events).' },
        due_at: { type: 'string', description: 'ISO8601 due datetime for todos.' },
        target_date: { type: 'string', description: 'YYYY-MM-DD target date for milestones.' },
        priority: { type: 'string', description: 'low|medium|high|urgent for todos.' },
        key: { type: 'string', description: 'Preference key (kind=preference).' },
        value: { type: 'string', description: 'Preference value (kind=preference).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
      },
      async execute(args) {
        switch (args.kind) {
          case 'todo':
            return json(y.addTodo(cwd(), {
              title: args.title,
              detail: args.detail,
              due_at: args.due_at,
              priority: (args.priority ?? undefined) as Priority | undefined,
              source: 'tool',
            }))
          case 'milestone':
            return json(y.addMilestone(cwd(), { title: args.title, target_date: args.target_date, description: args.detail, source: 'tool' }))
          case 'goal':
            return json(y.addGoal(cwd(), { title: args.title, description: args.detail }))
          case 'preference':
            return json(y.addPreference(cwd(), { key: args.key ?? args.title, value: args.value ?? args.detail ?? '' }))
          case 'event':
            return json(y.addEvent(cwd(), { kind: 'note', summary: args.title, detail: args.detail }))
          default:
            throw new Error(`unknown memory kind: ${String(args.kind)}`)
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'memory_forget',
      description: 'Soft-delete a memory item by id (todo -> cancelled, milestone -> abandoned). Keeps audit history; removes from search.',
      parameters: {
        kind: { type: 'string', required: true, description: 'todo|milestone|goal' },
        id: { type: 'string', required: true, description: 'Item id.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
      },
      async execute(args) {
        if (args.kind === 'todo') {
          y.setTodoStatus(cwd(), args.id, 'cancelled')
          return json({ ok: true })
        }
        if (args.kind === 'milestone') {
          y.setMilestoneStatus(cwd(), args.id, 'abandoned')
          return json({ ok: true })
        }
        if (args.kind === 'goal') {
          y.setGoalProgress(cwd(), args.id, 0)
          return json({ ok: true })
        }
        return json({ ok: false, error: 'unsupported kind' })
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'yolo_query',
      description: 'Query a YOLO dashboard view for the current workspace: timeline, todos, goals, milestones or preferences.',
      parameters: {
        view: { type: 'string', required: true, description: 'timeline|todos|goals|milestones|preferences' },
        status: { type: 'string', description: 'Optional status filter (todo: pending|in_progress|done|cancelled; goal: active|achieved; milestone: planned|active|done).' },
        limit: { type: 'integer', description: 'Max rows (default 50).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
      },
      async execute(args) {
        switch (args.view) {
          case 'timeline':
            return json(y.listEvents(cwd(), args.limit ?? 50))
          case 'todos':
            return json(y.listTodos(cwd(), (args.status ?? undefined) as TodoStatus | undefined))
          case 'goals':
            return json(y.listGoals(cwd(), (args.status ?? undefined) as GoalStatus | undefined))
          case 'milestones':
            return json(y.listMilestones(cwd(), (args.status ?? undefined) as MilestoneStatus | undefined))
          case 'preferences':
            return json(y.listPreferences(cwd()))
          default:
            throw new Error(`unknown view: ${String(args.view)}`)
        }
      },
    }),
  )
}

// keep EventKind import used (addEvent kinds are 'note' literal; re-exported for future kinds)
export type { EventKind }
