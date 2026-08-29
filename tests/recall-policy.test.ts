// M9 recall quality tests — decision layer (applyRecallPolicy drop reasons),
// session injection-dedup state machine (RecallDedupTracker), prompt-template
// escaping, and the hybrid multi-path FTS recall (extractQueryTokens +
// ftsRecallSearch) against an in-memory SQLite DB.

import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import { extractQueryTokens, ftsRecallSearch, ftsSearch, recallTodoIdentityCandidates } from '../src/storage/search.ts'
import {
  applyRecallPolicy,
  escapePromptTemplates,
  RecallDedupTracker,
} from '../src/memory/recall.ts'
import type { SearchHit } from '../src/storage/types.ts'

const SCOPE = 'testscope/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

function hit(rowType: SearchHit['row_type'], rowId: string, title: string, rank = 0): SearchHit {
  return { row_type: rowType, row_id: rowId, title, body: '', rank }
}

describe('escapePromptTemplates', () => {
  it('breaks {{...}} interpolation patterns with full-width braces', () => {
    expect(escapePromptTemplates('{{user}} 的偏好')).toBe('｛｛user}} 的偏好')
    expect(escapePromptTemplates('{{name}}')).toBe('｛｛name}}')
  })

  it('leaves single braces and plain text untouched', () => {
    expect(escapePromptTemplates('对象 { a: 1 } 字面量')).toBe('对象 { a: 1 } 字面量')
    expect(escapePromptTemplates('普通记忆内容')).toBe('普通记忆内容')
  })

  it('replaces every {{ occurrence, including runs of three braces', () => {
    expect(escapePromptTemplates('{{{x}}}')).toBe('｛｛{x}}}')
    expect(escapePromptTemplates('{{a}}{{b}}')).toBe('｛｛a}}｛｛b}}')
  })
})

describe('applyRecallPolicy', () => {
  const wideBudget = { injected: new Set<string>(), kindQuota: 2, budgetChars: 2048 }

  it('drops already-injected keys and keeps the rest in order', () => {
    const { keep, drops } = applyRecallPolicy(
      [hit('todo', 't1', '提醒我周三交周报'), hit('goal', 'g1', '上线个人助手'), hit('todo', 't2', '把演示稿发给研发')],
      { ...wideBudget, injected: new Set(['todo:t1']) },
    )
    expect(keep.map((h) => h.row_id)).toEqual(['g1', 't2'])
    expect(drops).toEqual([{ key: 'todo:t1', reason: 'already-injected' }])
  })

  it('caps rows per row_type at kindQuota', () => {
    const { keep, drops } = applyRecallPolicy(
      [hit('todo', 't1', '提醒我周三交周报'), hit('todo', 't2', '把演示稿发给研发'), hit('todo', 't3', '整理季度汇报材料'), hit('goal', 'g1', '上线个人助手')],
      { ...wideBudget, kindQuota: 1 },
    )
    expect(keep.map((h) => h.row_id)).toEqual(['t1', 'g1'])
    expect(drops).toEqual([
      { key: 'todo:t2', reason: 'kind-quota' },
      { key: 'todo:t3', reason: 'kind-quota' },
    ])
  })

  it('skips over-budget rows instead of breaking, so later short rows still fit', () => {
    // line lengths: h1=15, h2=27, h3=14, h4=15 (+1 separator each) against a 40-char budget
    const hits = [
      hit('todo', 't1', '提醒我周三交周报'),
      hit('todo', 't2', '把季度汇报材料整理成幻灯片并排练一遍讲稿'),
      hit('goal', 'g1', '确认会议室预订'),
      hit('goal', 'g2', '更新项目风险清单'),
    ]
    const { keep, drops } = applyRecallPolicy(hits, { ...wideBudget, budgetChars: 40 })
    expect(keep.map((h) => h.row_id)).toEqual(['t1', 'g1'])
    expect(drops).toEqual([
      { key: 'todo:t2', reason: 'over-budget' },
      { key: 'goal:g2', reason: 'over-budget' },
    ])
  })

  it('an over-budget drop does not consume the kind quota', () => {
    const hits = [
      hit('todo', 't1', '把季度汇报材料整理成幻灯片并排练一遍讲稿'),
      hit('todo', 't2', '确认会议室预订'),
    ]
    const { keep, drops } = applyRecallPolicy(hits, { ...wideBudget, kindQuota: 1, budgetChars: 16 })
    expect(keep.map((h) => h.row_id)).toEqual(['t2'])
    expect(drops).toEqual([{ key: 'todo:t1', reason: 'over-budget' }])
  })
})

describe('RecallDedupTracker', () => {
  it('keeps the injected set unchanged across repeated assemblies within one round', () => {
    const tracker = new RecallDedupTracker()
    tracker.onUserMessage('s1', '演示稿进展如何')
    tracker.onRecallKept(['todo:1'])
    tracker.onRecallKept(['todo:1']) // second model step, same round
    expect(tracker.getInjected().size).toBe(0)
  })

  it('commits the previous round keys when the next user message arrives', () => {
    const tracker = new RecallDedupTracker()
    tracker.onUserMessage('s1', '演示稿进展如何')
    tracker.onRecallKept(['todo:1'])
    tracker.onUserMessage('s1', '研发那边有反馈了吗')
    expect(tracker.getInjected()).toEqual(new Set(['todo:1']))

    tracker.onRecallKept(['todo:2', 'goal:3'])
    tracker.onUserMessage('s1', '顺便看下周报')
    expect(tracker.getInjected()).toEqual(new Set(['todo:1', 'todo:2', 'goal:3']))
  })

  it('clears the injected history on a session switch (new session injects fresh)', () => {
    const tracker = new RecallDedupTracker()
    tracker.onUserMessage('s1', '演示稿进展如何')
    tracker.onRecallKept(['todo:1'])
    tracker.onUserMessage('s1', '研发那边有反馈了吗')
    tracker.onRecallKept(['todo:2'])
    tracker.onUserMessage('s2', '接着上次的来')
    // todo:1 was committed inside s1 and is cleared with it; only the round that
    // just finished (todo:2, rendered one turn ago) carries over
    expect(tracker.getInjected()).toEqual(new Set(['todo:2']))
  })

  it('ignores empty user messages', () => {
    const tracker = new RecallDedupTracker()
    tracker.onUserMessage('s1', '演示稿进展如何')
    tracker.onRecallKept(['todo:1'])
    tracker.onUserMessage('s1', '')
    expect(tracker.getInjected().size).toBe(0)
  })
})

describe('extractQueryTokens', () => {
  it('slides CJK runs into trigrams', () => {
    expect(extractQueryTokens('把演示稿发给研发')).toEqual({
      phrases: ['把演示', '演示稿', '示稿发', '稿发给', '发给研', '给研发'],
      likeTerms: [],
    })
  })

  it('keeps latin/digit words of 3+ chars and routes 2-char CJK runs to LIKE terms', () => {
    expect(extractQueryTokens('react 组件渲染失败 vitest')).toEqual({
      phrases: ['react', 'vitest', '组件渲', '件渲染', '渲染失', '染失败'],
      likeTerms: [],
    })
    expect(extractQueryTokens('研发')).toEqual({ phrases: [], likeTerms: ['研发'] })
    expect(extractQueryTokens('react 渲染 ok')).toEqual({
      phrases: ['react'],
      likeTerms: ['渲染'],
    })
  })

  it('dedupes repeated tokens', () => {
    expect(extractQueryTokens('演示稿演示稿')).toEqual({
      phrases: ['演示稿', '示稿演', '稿演示'],
      likeTerms: [],
    })
  })

  it('caps phrases at 8 and LIKE terms at 2', () => {
    const { phrases } = extractQueryTokens('帮我把演示稿发给研发顺便约一下会议室再提醒我周三交周报')
    expect(phrases).toHaveLength(8)
    expect(phrases[0]).toBe('帮我把')
    expect(extractQueryTokens('研发 和 产品 对齐 设计')).toEqual({ phrases: [], likeTerms: ['研发', '产品'] })
  })
})

describe('ftsRecallSearch (hybrid multi-path)', () => {
  it('recalls a rephrased CJK query the single-phrase search misses', () => {
    const { row } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    expect(ftsSearch(db, '演示稿进展如何')).toHaveLength(0)
    const hits = ftsRecallSearch(db, '演示稿进展如何')
    expect(hits).toHaveLength(1)
    expect(hits[0].row_id).toBe(row.id)
    expect(hits[0].row_type).toBe('todo')
  })

  it('falls back to LIKE for 2-char CJK queries and tags them with the worst rank', () => {
    const { row } = repo.upsertTodo(db, { title: '找研发同学评审', scope_key: SCOPE })
    const hits = ftsRecallSearch(db, '研发')
    expect(hits).toHaveLength(1)
    expect(hits[0].row_id).toBe(row.id)
    expect(hits[0].rank).toBe(1000)
  })

  it('ranks whole-phrase hits first and dedupes rows hit by multiple paths', () => {
    const { row: exact } = repo.upsertTodo(db, { title: '提醒我周三交周报', scope_key: SCOPE })
    const { row: partial } = repo.upsertTodo(db, { title: '周三交周报前先对齐数据', scope_key: SCOPE })
    const hits = ftsRecallSearch(db, '提醒我周三交周报')
    expect(hits.map((h) => h.row_id)).toEqual([exact.id, partial.id])
    expect(hits.filter((h) => h.row_id === exact.id)).toHaveLength(1)
  })

  it('truncates to topK', () => {
    repo.upsertTodo(db, { title: '提醒我周三交周报', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '周三交周报前先对齐数据', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '记得周三交周报给主管', scope_key: SCOPE })
    expect(ftsRecallSearch(db, '提醒我周三交周报', 2)).toHaveLength(2)
  })

  it('filters by row kind across all paths', () => {
    repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    expect(ftsRecallSearch(db, '演示稿进展如何', 5, ['goal'])).toHaveLength(0)
    expect(ftsRecallSearch(db, '研发', 5, ['goal'])).toHaveLength(0)
  })
})

describe('recallTodoIdentityCandidates (R1 shadow resolver)', () => {
  it('recalls terminal todos without putting them back into ordinary memory recall', () => {
    const { row } = repo.upsertTodo(db, { title: '把演示稿发给研发', scope_key: SCOPE })
    repo.setTodoStatus(db, row.id, 'done')
    expect(ftsRecallSearch(db, '演示稿进展如何', 5, ['todo'])).toHaveLength(0)
    expect(recallTodoIdentityCandidates(db, '演示稿进展如何')).toEqual([
      expect.objectContaining({ id: row.id, title: row.title, status: 'done', aliases: [] }),
    ])
  })

  it('folds a matched merged title onto its canonical stable id as an alias', () => {
    const { row: canonical } = repo.upsertTodo(db, { title: '发送研发演示材料', scope_key: SCOPE })
    const { row: duplicate } = repo.upsertTodo(db, { title: '把最终 deck 给开发团队', scope_key: SCOPE })
    expect(repo.applyTodoConsolidate(db, { id: duplicate.id }, { id: canonical.id }, null, SCOPE).ok).toBe(true)
    const candidates = recallTodoIdentityCandidates(db, '最终 deck 给开发团队')
    expect(candidates).toEqual([
      expect.objectContaining({ id: canonical.id, title: canonical.title, aliases: [duplicate.title] }),
    ])
  })

  it('uses immutable evidence wording to recall a rephrased canonical todo', () => {
    const { row } = repo.upsertTodo(db, { title: '发送最终演示材料', scope_key: SCOPE })
    repo.addTodoEvidence(db, {
      todo_id: row.id,
      source_scope_key: SCOPE,
      source_kind: 'human',
      relation: 'mention',
      excerpt: '别忘了把那份 deck 给研发团队',
      occurred_at: 1,
      source_fingerprint: 'identity-evidence-1',
    })
    expect(recallTodoIdentityCandidates(db, '研发团队那份 deck 怎么样了')[0]).toMatchObject({ id: row.id })
  })

  it('uses the newest steering tail when a completed turn contains long earlier text', () => {
    const { row } = repo.upsertTodo(db, { title: '周五发送最终演示稿', scope_key: SCOPE })
    const query = `${'先讨论背景信息'.repeat(30)}\n不对，改成周五发送最终演示稿`
    expect(recallTodoIdentityCandidates(db, query)[0]).toMatchObject({ id: row.id })
  })
})
