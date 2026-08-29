// YOLO storage layer unit tests — exercises the pure repository/db/search/snapshot
// functions against an in-memory SQLite DB (no Cordis host needed).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, withTransaction, type DB } from '../src/storage/db.ts'
import * as repo from '../src/storage/repository.ts'
import { ftsSearch, toFtsPhrase } from '../src/storage/search.ts'
import { renderSnapshot } from '../src/storage/snapshot.ts'

const SCOPE = 'testscope/main'

let db: DB

beforeEach(() => {
  db = openDb(':memory:')
})

describe('db + schema', () => {
  it('opens and creates all tables', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tableNames = names.map((t) => t.name)
    for (const t of ['meta', 'user_profile', 'milestones', 'todos', 'todo_evidence', 'goals', 'preferences', 'preference_history', 'events', 'extraction_log', 'pending_reminders', 'yolo_fts']) {
      expect(tableNames).toContain(t)
    }
  })

  it('idempotently adds source evidence columns to an old database', () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-old-source-'))
    const path = join(root, 'old.db')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE todos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT,
      status TEXT NOT NULL DEFAULT 'pending', priority TEXT, due_at TEXT,
      milestone_id TEXT, scope_key TEXT NOT NULL, dedup_key TEXT, source TEXT,
      session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      completed_at INTEGER, last_reminded_at INTEGER,
      good_count INTEGER NOT NULL DEFAULT 0, stale_count INTEGER NOT NULL DEFAULT 0
    )`)
    old.prepare('INSERT INTO todos(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('old-1', '旧事项', 'pending', SCOPE, 1, 1)
    old.close()

    const migrated = openDb(path)
    const columns = migrated.prepare('PRAGMA table_info(todos)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'source_excerpt', 'source_turn', 'record_status', 'merged_into_id',
    ]))
    expect(migrated.prepare('SELECT source_excerpt,source_turn,record_status,merged_into_id FROM todos WHERE id=?').get('old-1'))
      .toEqual({ source_excerpt: null, source_turn: null, record_status: 'canonical', merged_into_id: null })
    expect(migrated.prepare('SELECT todo_id,relation,source_fingerprint FROM todo_evidence WHERE todo_id=?').get('old-1'))
      .toEqual({ todo_id: 'old-1', relation: 'origin', source_fingerprint: 'legacy:todo:old-1:origin' })
    migrated.close()

    // A second open proves both the ALTERs and evidence backfill are idempotent.
    const reopened = openDb(path)
    expect(reopened.prepare('SELECT COUNT(*) AS n FROM todo_evidence WHERE todo_id=?').get('old-1')).toEqual({ n: 1 })
    reopened.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('adds a seen baseline to legacy notifications without replaying history', () => {
    const root = mkdtempSync(join(tmpdir(), 'yolo-old-notifications-'))
    const path = join(root, 'old.db')
    const old = new DatabaseSync(path)
    old.exec(`CREATE TABLE notifications (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
      todo_id TEXT, scope_cwd TEXT, created_at INTEGER NOT NULL,
      handled_at INTEGER, scope_key TEXT NOT NULL
    )`)
    old.prepare('INSERT INTO notifications(id,kind,title,created_at,scope_key) VALUES(?,?,?,?,?)')
      .run('legacy-notice', 'brief', '旧早报', 1, SCOPE)
    old.close()

    const migrated = openDb(path)
    expect(migrated.prepare('SELECT seen_at,handled_at FROM notifications WHERE id=?').get('legacy-notice'))
      .toMatchObject({ seen_at: expect.any(Number), handled_at: null })
    expect(repo.countUnseenNotifications(migrated, SCOPE)).toBe(0)
    migrated.close()

    const reopened = openDb(path)
    expect(repo.countUnseenNotifications(reopened, SCOPE)).toBe(0)
    reopened.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('commits successful transactions and rolls back failed ones', () => {
    withTransaction(db, () => {
      repo.upsertTodo(db, { title: '保留外层写入', scope_key: SCOPE })
      expect(() => withTransaction(db, () => {
        repo.upsertTodo(db, { title: '回滚内层写入', scope_key: SCOPE })
        throw new Error('rollback nested savepoint')
      })).toThrow('rollback nested savepoint')
    })

    expect(repo.listTodos(db, SCOPE).map((todo) => todo.title)).toEqual(['保留外层写入'])

    expect(() => withTransaction(db, () => {
      repo.upsertTodo(db, { title: '回滚整个事务', scope_key: SCOPE })
      throw new Error('rollback transaction')
    })).toThrow('rollback transaction')
    expect(repo.listTodos(db, SCOPE).map((todo) => todo.title)).toEqual(['保留外层写入'])
  })
})

describe('notification popup feed', () => {
  it('returns only the bounded newest open reminders', () => {
    const older = repo.addNotification(db, { kind: 'reminder', title: '把演示稿发给研发', scope_key: SCOPE })
    repo.addNotification(db, { kind: 'brief', title: '今日简报', scope_key: SCOPE })
    const newer = repo.addNotification(db, { kind: 'reminder', title: '核对发布清单', scope_key: SCOPE })

    expect(repo.listRecentUnhandledReminders(db, SCOPE, 1).map((row) => row.id)).toEqual([newer.id])
    repo.markNotificationHandled(db, newer.id)
    expect(repo.listRecentUnhandledReminders(db, SCOPE, 5).map((row) => row.id)).toEqual([older.id])
  })

  it('keeps delivery seen state separate from reminder handling state', () => {
    const reminder = repo.addNotification(db, { kind: 'reminder', title: '把演示稿发给研发', scope_key: SCOPE })
    const brief = repo.addNotification(db, { kind: 'brief', title: '今日简报', scope_key: SCOPE })
    expect(repo.countUnseenNotifications(db, SCOPE)).toBe(2)
    expect(repo.listRecentUnseenNotifications(db, SCOPE, 5).map((row) => row.id)).toEqual(
      expect.arrayContaining([brief.id, reminder.id]),
    )

    expect(repo.markNotificationSeen(db, SCOPE, reminder.id, 100)).toBe(true)
    expect(repo.markNotificationSeen(db, SCOPE, reminder.id, 200)).toBe(false)
    expect(repo.countUnseenNotifications(db, SCOPE)).toBe(1)
    expect(repo.listUnhandledNotifications(db, SCOPE)).toHaveLength(2)

    repo.markNotificationsSeenThrough(db, SCOPE, Date.now())
    expect(repo.countUnseenNotifications(db, SCOPE)).toBe(0)
    expect(repo.listUnhandledNotifications(db, SCOPE)).toHaveLength(2)
  })
})

describe('todos', () => {
  it('dedupes by normalized title and merges due_at', () => {
    repo.upsertTodo(db, { title: '完成报告', scope_key: SCOPE })
    repo.upsertTodo(db, { title: '完成报告', due_at: '2026-08-21', priority: 'high', scope_key: SCOPE })
    const todos = repo.listTodos(db, SCOPE)
    expect(todos).toHaveLength(1)
    expect(todos[0].due_at).toBe('2026-08-21')
    expect(todos[0].priority).toBe('high')
  })

  it('chooses the open canonical duplicate deterministically instead of a terminal row', () => {
    const terminal = repo.upsertTodo(db, { title: '核对发布清单', scope_key: SCOPE }).row
    repo.setTodoStatus(db, terminal.id, 'done')
    const open = repo.upsertTodo(db, { title: '核对发布清单', scope_key: SCOPE }).row
    const replay = repo.upsertTodo(db, { title: '核对发布清单', due_at: '2026-09-01', scope_key: SCOPE })

    expect(replay).toMatchObject({ created: false, row: { id: open.id, due_at: '2026-09-01' } })
    expect(repo.listTodoRecords(db, SCOPE)).toHaveLength(2)
  })

  it('stores multiple session evidences and makes a source fingerprint idempotent', () => {
    const first = repo.upsertTodo(db, {
      title: '把演示稿发给研发', scope_key: SCOPE, source: 'llm', session_id: 'session-a',
      source_excerpt: '明天把演示稿发给研发', source_turn: 2, source_fingerprint: 'extract/a/2/todo/0',
    })
    const second = repo.upsertTodo(db, {
      title: '把演示稿发给研发', scope_key: SCOPE, source: 'llm', session_id: 'session-b',
      source_excerpt: '研发那份演示稿别忘了', source_turn: 7, source_fingerprint: 'extract/b/7/todo/0',
      evidence_relation: 'mention',
    })
    const replay = repo.upsertTodo(db, {
      title: '模型重试时文案发生变化', scope_key: SCOPE, source: 'llm', session_id: 'session-b',
      source_excerpt: '研发那份演示稿别忘了', source_turn: 7, source_fingerprint: 'extract/b/7/todo/0',
    })

    expect(second.row.id).toBe(first.row.id)
    expect(replay).toMatchObject({ created: false, row: { id: first.row.id } })
    expect(repo.listTodoEvidence(db, first.row.id).map((row) => [row.session_id, row.relation])).toEqual([
      ['session-a', 'origin'],
      ['session-b', 'mention'],
    ])
  })

  it('rejects reuse of one evidence fingerprint for different canonical todos', () => {
    const a = repo.upsertTodo(db, { title: '事项 A', scope_key: SCOPE }).row
    const b = repo.upsertTodo(db, { title: '事项 B', scope_key: SCOPE }).row
    repo.addTodoEvidence(db, {
      todo_id: a.id, source_scope_key: SCOPE, source_kind: 'assistant_action', relation: 'update',
      source_fingerprint: 'tool/same-call',
    })
    expect(() => repo.addTodoEvidence(db, {
      todo_id: b.id, source_scope_key: SCOPE, source_kind: 'assistant_action', relation: 'update',
      source_fingerprint: 'tool/same-call',
    })).toThrow('todo evidence fingerprint conflict')
  })

  it('keeps the original source evidence when a later upsert updates the todo', () => {
    const first = repo.upsertTodo(db, {
      title: '把演示稿发给研发', scope_key: SCOPE, source: 'llm', session_id: 'session-origin',
      source_excerpt: '明天下午把演示稿发给研发', source_turn: 3,
    })
    const second = repo.upsertTodo(db, {
      title: '把演示稿发给研发', scope_key: SCOPE, due_at: '2026-08-28', source: 'llm', session_id: 'session-update',
      source_excerpt: '刚才那件事改到周五', source_turn: 8,
    })

    expect(second.created).toBe(false)
    expect(second.row).toMatchObject({
      id: first.row.id,
      due_at: '2026-08-28',
      session_id: 'session-origin',
      source_excerpt: '明天下午把演示稿发给研发',
      source_turn: 3,
    })
  })

  it('promotes a same-session provisional tool write to direct-user extraction evidence once', () => {
    const provisional = repo.upsertTodo(db, {
      title: '把访谈纪要发给产品组（编号 RH0826B）', scope_key: SCOPE, source: 'tool', session_id: 'session-same',
    })
    const extracted = repo.upsertTodo(db, {
      title: '把访谈纪要发给产品组', scope_key: SCOPE, source: 'llm', session_id: 'session-same',
      source_excerpt: '明天下午三点把访谈纪要发给产品组', source_turn: 2,
    })
    expect(extracted).toMatchObject({
      created: false,
      row: {
        id: provisional.row.id, source: 'llm', session_id: 'session-same',
        source_excerpt: '明天下午三点把访谈纪要发给产品组', source_turn: 2,
      },
    })
    expect(repo.listTodos(db, SCOPE)).toHaveLength(1)

    const unrelated = repo.upsertTodo(db, {
      title: '把访谈纪要发给产品组（编号 RH0826B）', scope_key: SCOPE, source: 'llm', session_id: 'session-later',
      source_excerpt: '后来把它改到周五', source_turn: 9,
    })
    expect(unrelated.row).toMatchObject({
      source: 'llm', session_id: 'session-same',
      source_excerpt: '明天下午三点把访谈纪要发给产品组', source_turn: 2,
    })
  })

  it('promotes provisional tool origins only inside the accepted turn window', () => {
    const earlier = repo.upsertTodo(db, { title: '早一轮事项', scope_key: SCOPE, source: 'tool', session_id: 'session-window' }).row
    const wrongTurn = repo.upsertTodo(db, { title: '相邻轮事项', scope_key: SCOPE, source: 'tool', session_id: 'session-window', source_turn: 3 }).row
    const current = repo.upsertTodo(db, { title: '本轮事项', scope_key: SCOPE, source: 'tool', session_id: 'session-window', source_turn: 4 }).row
    db.prepare('UPDATE todos SET created_at = ? WHERE id = ?').run(100, earlier.id)
    db.prepare('UPDATE todos SET created_at = ? WHERE id = ?').run(200, wrongTurn.id)
    db.prepare('UPDATE todos SET created_at = ? WHERE id = ?').run(200, current.id)

    expect(repo.promoteToolTodoOrigins(db, SCOPE, {
      session_id: 'session-window', source_excerpt: '本轮直接用户输入', source_turn: 4,
      created_from: 150, created_to: 250, evidence_operation_key: 'extract/accepted/session-window/4',
    })).toBe(1)
    const rows = repo.listTodos(db, SCOPE)
    expect(rows.find((row) => row.id === earlier.id)).toMatchObject({ source: 'tool', source_excerpt: null })
    expect(rows.find((row) => row.id === wrongTurn.id)).toMatchObject({ source: 'tool', source_excerpt: null, source_turn: 3 })
    expect(rows.find((row) => row.id === current.id)).toMatchObject({ source: 'llm', source_excerpt: '本轮直接用户输入', source_turn: 4 })
    expect(repo.listTodoEvidence(db, earlier.id).map((row) => row.source_kind)).toEqual(['assistant_action'])
    const currentEvidenceKinds = repo.listTodoEvidence(db, current.id).map((row) => row.source_kind)
    expect(currentEvidenceKinds).toHaveLength(2)
    expect(currentEvidenceKinds).toEqual(expect.arrayContaining(['assistant_action', 'human']))
    expect(repo.promoteToolTodoOrigins(db, SCOPE, {
      session_id: 'session-window', source_excerpt: '本轮直接用户输入', source_turn: 4,
      created_from: 150, created_to: 250, evidence_operation_key: 'extract/accepted/session-window/4',
    })).toBe(0)
  })

  it('bounds direct-user excerpts while preserving only durable tool turn metadata', () => {
    const llm = repo.upsertTodo(db, {
      title: '核对发布窗口', scope_key: SCOPE, source: 'llm', session_id: 'session-source',
      source_excerpt: `核对  ${'😀'.repeat(450)}`, source_turn: 5,
    }).row
    expect(Array.from(llm.source_excerpt ?? '')).toHaveLength(400)
    expect(llm.source_turn).toBe(5)

    const manual = repo.upsertTodo(db, {
      title: 'manual 来源', scope_key: SCOPE, source: 'manual', session_id: 'forged-session',
      source_excerpt: '不应保存', source_turn: 9,
    }).row
    expect(manual).toMatchObject({ source_excerpt: null, source_turn: null })
    const tool = repo.upsertTodo(db, {
      title: 'tool 来源', scope_key: SCOPE, source: 'tool', session_id: 'tool-session',
      source_excerpt: '不应保存', source_turn: 9,
    }).row
    expect(tool).toMatchObject({ source_excerpt: null, source_turn: 9 })
  })

  it('keeps the persisted todo title and its FTS projection identical after a normalized-title upsert', () => {
    const first = repo.upsertTodo(db, { title: 'Prepare Q3 Report', scope_key: SCOPE })
    const second = repo.upsertTodo(db, { title: 'Prepare Q3 Report!!!', scope_key: SCOPE })
    expect(second.row.id).toBe(first.row.id)

    const indexed = db
      .prepare("SELECT title FROM yolo_fts WHERE row_type = 'todo' AND row_id = ?")
      .get(first.row.id) as { title: string }
    expect(indexed.title).toBe(second.row.title)
  })

  it('setTodoStatus(done) sets completed_at and stops matching search', () => {
    const { row: t } = repo.upsertTodo(db, { title: 'ship the feature', scope_key: SCOPE })
    repo.setTodoStatus(db, t.id, 'done')
    expect(repo.listTodos(db, SCOPE, 'done')).toHaveLength(1)
    // FTS row removed for done todos
    expect(ftsSearch(db, 'ship')).toHaveLength(0)
  })

  it('lists due todos before a cutoff', () => {
    repo.upsertTodo(db, { title: 'past', due_at: '2026-01-01', scope_key: SCOPE })
    repo.upsertTodo(db, { title: 'future', due_at: '2099-01-01', scope_key: SCOPE })
    expect(repo.listDueTodos(db, SCOPE, '2026-08-20')).toHaveLength(1)
  })

  it('filters mixed due formats by parsed instants instead of SQLite text order', () => {
    const cutoff = new Date(2026, 7, 25, 10)
    repo.upsertTodo(db, { title: 'date today', due_at: '2026-08-25', scope_key: SCOPE })
    repo.upsertTodo(db, { title: 'local past', due_at: '2026-08-25T09:59:59', scope_key: SCOPE })
    repo.upsertTodo(db, { title: 'z past', due_at: new Date(cutoff.getTime() - 2 * 3_600_000).toISOString(), scope_key: SCOPE })
    repo.upsertTodo(db, { title: 'offset future', due_at: new Date(cutoff.getTime() + 1_000).toISOString(), scope_key: SCOPE })

    expect(repo.listDueTodos(db, SCOPE, cutoff).map((todo) => todo.title))
      .toEqual(['z past', 'local past'])
  })
})

describe('milestones & goals', () => {
  it('upserts milestone and updates target_date on re-insert', () => {
    repo.upsertMilestone(db, { title: 'M1', scope_key: SCOPE })
    repo.upsertMilestone(db, { title: 'M1', target_date: '2026-09-01', scope_key: SCOPE })
    const ms = repo.listMilestones(db, SCOPE)
    expect(ms).toHaveLength(1)
    expect(ms[0].target_date).toBe('2026-09-01')
  })

  it('goal is idempotent (re-insert does not duplicate) and progress clamps', () => {
    repo.upsertGoal(db, { title: '掌握 dsh', scope_key: SCOPE })
    repo.upsertGoal(db, { title: '掌握 dsh', scope_key: SCOPE })
    expect(repo.listGoals(db, SCOPE)).toHaveLength(1)
    const g = repo.listGoals(db, SCOPE)[0]
    repo.setGoalProgress(db, g.id, 150)
    expect(repo.listGoals(db, SCOPE, 'achieved')[0].progress).toBe(100)
  })

  it('setMilestoneStatus(done) stops matching search (FTS soft-delete)', () => {
    const m = repo.upsertMilestone(db, { title: 'finish milestone tests', scope_key: SCOPE })
    expect(ftsSearch(db, 'milestone tests')).toHaveLength(1)
    repo.setMilestoneStatus(db, m.id, 'done')
    expect(ftsSearch(db, 'milestone tests')).toHaveLength(0)
  })

  it('restores milestone searchability when a terminal milestone is reopened', () => {
    const m = repo.upsertMilestone(db, { title: '恢复发布里程碑', scope_key: SCOPE })
    repo.setMilestoneStatus(db, m.id, 'done')
    expect(ftsSearch(db, '发布里程碑', 5, ['milestone'])).toHaveLength(0)

    repo.setMilestoneStatus(db, m.id, 'active')
    expect(ftsSearch(db, '发布里程碑', 5, ['milestone'])).toHaveLength(1)
  })
})

describe('preferences', () => {
  it('upserts and bumps confidence on repeat', () => {
    repo.upsertPreference(db, { key: 'lang', value: 'zh', scope_key: SCOPE })
    repo.upsertPreference(db, { key: 'lang', value: 'zh', scope_key: SCOPE })
    const p = repo.listPreferences(db, SCOPE)
    expect(p).toHaveLength(1)
    expect(p[0].confidence).toBeGreaterThan(0.5)
    expect(p[0].value).toBe('zh')
    expect(repo.listPreferenceHistory(db, SCOPE)).toHaveLength(0)
  })

  it('supersedes a changed value, keeping one current row and a history trail (R14)', () => {
    repo.upsertPreference(db, { key: 'port', value: '8080', scope_key: SCOPE, session_id: 's1' })
    repo.upsertPreference(db, { key: 'port', value: '9090', scope_key: SCOPE, session_id: 's2' })
    const p = repo.listPreferences(db, SCOPE)
    expect(p).toHaveLength(1)
    expect(p[0].value).toBe('9090')
    expect(p[0].session_id).toBe('s2')
    expect(p[0].valid_at).not.toBeNull()
    expect(p[0].invalid_at ?? null).toBeNull()
    // the superseded fact is preserved (证据溯源), with the old source
    const h = repo.listPreferenceHistory(db, SCOPE)
    expect(h).toHaveLength(1)
    expect(h[0].value).toBe('8080')
    expect(h[0].session_id).toBe('s1')
    expect(h[0].invalid_at).not.toBeNull()
  })

  it('does not recall a superseded preference from FTS (R14 auto-expire)', () => {
    repo.upsertPreference(db, { key: 'port', value: '8080', scope_key: SCOPE })
    repo.upsertPreference(db, { key: 'port', value: '9090', scope_key: SCOPE })
    const hits = ftsSearch(db, '8080')
    expect(hits.filter((h) => h.row_type === 'preference')).toHaveLength(0)
  })
})

describe('events', () => {
  it('addEvent returns the generated UUID row (not a rowid) and persists it', () => {
    const e = repo.addEvent(db, { kind: 'decision', summary: 'chose trigram', scope_key: SCOPE })
    expect(e).not.toBeNull()
    // UUID shape, not a numeric rowid string
    expect(e!.id).toMatch(/^[0-9a-f-]{36}$/)
    const stored = repo.listEvents(db, SCOPE)
    expect(stored.some((x) => x.id === e!.id)).toBe(true)
  })
})

describe('search (trigram, CJK)', () => {
  it('matches a 4-char CJK substring of an inserted todo', () => {
    repo.upsertTodo(db, { title: '完成季度报告', scope_key: SCOPE })
    const hits = ftsSearch(db, '季度报告')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].row_type).toBe('todo')
  })

  it('matches English tokens', () => {
    repo.upsertMilestone(db, { title: 'release yolo v1', scope_key: SCOPE })
    const hits = ftsSearch(db, 'release')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].row_type).toBe('milestone')
  })

  it('filters by row kind', () => {
    repo.upsertTodo(db, { title: 'review pr', scope_key: SCOPE })
    repo.upsertMilestone(db, { title: 'review milestone', scope_key: SCOPE })
    const onlyTodos = ftsSearch(db, 'review', 5, ['todo'])
    expect(onlyTodos.every((h) => h.row_type === 'todo')).toBe(true)
  })

  // regression: raw user text is FTS5 query syntax — special characters used
  // to throw "fts5: syntax error near ..." and kill the whole turn
  it.each([
    '<div>',
    'a<b 和 a>b',
    'he said "done" AND THEN (not OR)',
    'C:\\Users\\x*y',
    'NOT NEAR ^col:token',
  ])('treats FTS5 syntax characters as literals: %s', (q) => {
    repo.upsertTodo(db, { title: 'stable row', scope_key: SCOPE })
    expect(() => ftsSearch(db, q)).not.toThrow()
  })

  it('caps query length instead of scanning a pasted blob', () => {
    repo.upsertTodo(db, { title: 'stable row', scope_key: SCOPE })
    expect(() => ftsSearch(db, '头'.repeat(10_000))).not.toThrow()
  })

  it('toFtsPhrase doubles embedded quotes and wraps in phrase quotes', () => {
    expect(toFtsPhrase('he said "hi"')).toBe('"he said ""hi"""')
    expect(toFtsPhrase('plain')).toBe('"plain"')
  })

  it('a quoted phrase still hits rows containing that literal substring', () => {
    repo.upsertTodo(db, { title: '修复 <div> 渲染问题', scope_key: SCOPE })
    const hits = ftsSearch(db, '<div> 渲染')
    expect(hits.length).toBeGreaterThanOrEqual(1)
  })
})

describe('snapshot', () => {
  it('renders a non-empty markdown with expected sections', () => {
    repo.upsertTodo(db, { title: '写文档', scope_key: SCOPE })
    repo.upsertGoal(db, { title: '上线 yolo', scope_key: SCOPE })
    repo.addEvent(db, { kind: 'note', summary: 'M1 推进', scope_key: SCOPE })
    const md = renderSnapshot(db, SCOPE, '/tmp/test')
    expect(md).toContain('# YOLO Snapshot')
    expect(md).toContain('## Active Goals')
    expect(md).toContain('上线 yolo')
    expect(md).toContain('写文档')
    expect(md).toContain('M1 推进')
  })
})

describe('reminders + extraction log', () => {
  it('queues, lists, and deletes pending reminders', () => {
    const { row: t } = repo.upsertTodo(db, { title: 'call mom', due_at: '2026-08-20', scope_key: SCOPE })
    repo.queuePendingReminder(db, { todo_id: t.id, fire_at: 1000, payload: 'remind: call mom', scope_key: SCOPE })
    expect(repo.listPendingReminders(db, SCOPE, 2000)).toHaveLength(1)
    const [r] = repo.listPendingReminders(db, SCOPE, 2000)
    repo.deletePendingReminder(db, r.id)
    expect(repo.listPendingReminders(db, SCOPE, 2000)).toHaveLength(0)
  })

  it('logs extraction runs and reports last timestamp', () => {
    repo.logExtraction(db, { session_id: 's1', turn_seq: 1, strategy: 'llm', status: 'ok' })
    repo.logExtraction(db, { session_id: 's1', turn_seq: 2, strategy: 'llm', status: 'error', error: 'boom' })
    const last = repo.lastExtractionAt(db, 's1', 'llm')
    expect(last).toBeDefined()
    expect(repo.lastExtractionAt(db, 'other', 'llm')).toBeUndefined()
  })
})
