import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'

const SCOPE = 'goal-relations/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

describe('goal relationships', () => {
  it('links multiple support todos and milestones without changing todo lifecycle', () => {
    const goal = repo.upsertGoal(db, { title: '完成产品发布', scope_key: SCOPE })
    const first = repo.upsertTodo(db, { title: '整理发布材料', scope_key: SCOPE }).row
    const second = repo.upsertTodo(db, { title: '确认灰度范围', scope_key: SCOPE }).row
    const milestone = repo.upsertMilestone(db, { title: '内部评审完成', scope_key: SCOPE })

    expect(repo.linkGoalTodo(db, goal.id, first.id, { is_primary: true })).toMatchObject({
      goal_id: goal.id, todo_id: first.id, relation: 'support', is_primary: 1,
    })
    repo.linkGoalTodo(db, goal.id, second.id)
    repo.linkGoalMilestone(db, goal.id, milestone.id)
    repo.setGoalNextTodo(db, goal.id, second.id)

    expect(repo.listGoalTodos(db, goal.id).map((todo) => todo.title)).toEqual(['整理发布材料', '确认灰度范围'])
    expect(repo.listGoalMilestones(db, goal.id).map((row) => row.title)).toEqual(['内部评审完成'])
    expect(repo.getGoal(db, goal.id)).toMatchObject({ next_todo_id: second.id })
    expect(repo.listGoalTodoLinks(db, goal.id).map((link) => [link.todo_id, link.relation])).toEqual([
      [first.id, 'support'], [second.id, 'next'],
    ])
    expect(repo.listTodos(db, SCOPE).map((todo) => todo.status)).toEqual(['pending', 'pending'])
  })

  it('keeps links idempotent and unlinking a next todo does not delete the todo', () => {
    const goal = repo.upsertGoal(db, { title: '完成研究计划', scope_key: SCOPE })
    const todo = repo.upsertTodo(db, { title: '确定研究问题', scope_key: SCOPE }).row

    const first = repo.linkGoalTodo(db, goal.id, todo.id)
    const second = repo.linkGoalTodo(db, goal.id, todo.id)
    expect(second).toEqual(first)
    repo.setGoalNextTodo(db, goal.id, todo.id)
    expect(repo.unlinkGoalTodo(db, goal.id, todo.id)).toBe(true)
    expect(repo.getGoal(db, goal.id)?.next_todo_id).toBeNull()
    expect(repo.listTodos(db, SCOPE)).toHaveLength(1)
    expect(repo.unlinkGoalTodo(db, goal.id, todo.id)).toBe(false)
  })

  it('rejects cross-scope and terminal todos as goal next steps', () => {
    const goal = repo.upsertGoal(db, { title: '完成发布', scope_key: SCOPE })
    const other = repo.upsertTodo(db, { title: '其他工作区事项', scope_key: 'other/main' }).row
    expect(() => repo.linkGoalTodo(db, goal.id, other.id)).toThrow('same scope')

    const todo = repo.upsertTodo(db, { title: '已完成事项', scope_key: SCOPE }).row
    repo.applyTodoAction(db, todo.id, 'complete')
    expect(() => repo.setGoalNextTodo(db, goal.id, todo.id)).toThrow('open todo')
  })
})
