import { describe, expect, it } from 'vitest'
import { canonicalTodoTitle, compareTodoTitles } from '../src/shared/todo-similarity.ts'

describe('todo merge suggestion similarity', () => {
  it('normalizes common title paraphrases used by manual todos', () => {
    expect(canonicalTodoTitle('提醒我把最终版 PPT 发给开发组'))
      .toBe('把最终版 演示稿 给研发')
    expect(canonicalTodoTitle('user: 提醒我把最终版 PPT 发给开发组'))
      .toBe('把最终版 演示稿 给研发')
    expect(canonicalTodoTitle('user: 明天上午9点提醒我把最终版 PPT 发给开发组'))
      .toBe('把最终版 演示稿 给研发')
    expect(compareTodoTitles('把演示稿发给研发', '提醒我把演示稿发送给研发组'))
      .toMatchObject({ score: 1 })
  })

  it('accepts strong lexical paraphrases without requiring identical titles', () => {
    const result = compareTodoTitles('整理客户访谈纪要并发给产品组', '把客户访谈纪要发送给产品组')
    expect(result?.score).toBeGreaterThanOrEqual(0.68)
    expect(result?.reason).toContain('核心')
  })

  it('rejects weak overlap and explicit occurrence mismatches', () => {
    expect(compareTodoTitles('整理客户访谈纪要', '预约年度体检')).toBeNull()
    expect(compareTodoTitles('提交季度报告', '下次提交季度报告')).toBeNull()
    expect(compareTodoTitles('', '提交季度报告')).toBeNull()
  })
})
