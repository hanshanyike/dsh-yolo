import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type DB } from '../src/storage/db.ts'
import { migrateLegacyScopeDatabases } from '../src/storage/migrate-scope.ts'

const CANONICAL = 'canonical/default'
const LEGACY = 'canonical/main'
let roots: string[] = []
let openDatabases: DB[] = []

afterEach(() => {
  for (const db of openDatabases) {
    try { db.close() } catch { /* already closed */ }
  }
  openDatabases = []
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'yolo-scope-migrate-'))
  roots.push(root)
  return root
}

function seedCanonical(db: DB): void {
  db.prepare('INSERT INTO milestones(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('same-ms', '主线里程碑', 'active', CANONICAL, 1, 10)
  db.prepare('INSERT INTO todos(id,title,status,milestone_id,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('same-todo', '主线事项', 'pending', 'same-ms', CANONICAL, 1, 10)
  db.prepare('INSERT INTO goals(id,title,progress,status,milestone_id,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('same-goal', '主线目标', 10, 'active', 'same-ms', CANONICAL, 1, 10)
  db.prepare('INSERT INTO preferences(id,key,value,confidence,scope_key,updated_at,valid_at) VALUES(?,?,?,?,?,?,?)').run('pref-main', '跟进节奏', '每周', 0.5, CANONICAL, 10, 10)
  db.prepare('INSERT INTO client_actions(scope_key,client_action_id,request_hash,outcome_json,created_at) VALUES(?,?,?,?,?)').run(CANONICAL, 'action-1', 'hash-main', '{}', 10)
}

function seedLegacy(db: DB): void {
  db.prepare('INSERT INTO milestones(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('same-ms', '功能分支里程碑', 'active', LEGACY, 2, 20)
  db.prepare('INSERT INTO todos(id,title,status,milestone_id,scope_key,session_id,source_excerpt,source_turn,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('same-todo', '功能分支事项', 'pending', 'same-ms', LEGACY, 'session-1', '请继续跟进功能分支事项', 2, 2, 20)
  db.prepare('INSERT INTO goals(id,title,progress,status,milestone_id,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('same-goal', '功能分支目标', 20, 'active', 'same-ms', LEGACY, 2, 20)
  // Same id+key but different content must still follow updated_at conflict policy.
  db.prepare('INSERT INTO preferences(id,key,value,confidence,scope_key,updated_at,valid_at) VALUES(?,?,?,?,?,?,?)').run('pref-main', '跟进节奏', '每天', 0.8, LEGACY, 20, 20)
  db.prepare('INSERT INTO preference_history(id,key,value,scope_key,valid_at,invalid_at) VALUES(?,?,?,?,?,?)').run('history-1', '提醒方式', '邮件', LEGACY, 1, 2)
  db.prepare('INSERT INTO events(id,kind,summary,scope_key,occurred_at) VALUES(?,?,?,?,?)').run('event-1', 'note', '确认功能分支安排', LEGACY, 20)
  db.prepare('INSERT INTO session_summaries(session_id,summary,scope_key,updated_at) VALUES(?,?,?,?)').run('session-1', '讨论功能分支安排', LEGACY, 20)
  db.prepare('INSERT INTO notifications(id,kind,title,todo_id,scope_cwd,created_at,scope_key) VALUES(?,?,?,?,?,?,?)').run('notice-1', 'reminder', '发送功能分支方案', 'same-todo', '/old/path', 20, LEGACY)
  db.prepare('INSERT INTO attention_feedback(scope_key,todo_id,reason_version,evidence_fingerprint,seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(LEGACY, 'same-todo', 'v1', 'fp', 20, 20, 20)
  db.prepare('INSERT INTO client_actions(scope_key,client_action_id,request_hash,outcome_json,created_at) VALUES(?,?,?,?,?)').run(LEGACY, 'action-1', 'hash-feature', '{"ok":true}', 20)
  db.prepare('INSERT INTO extraction_log(session_id,turn_seq,strategy,status,created_at) VALUES(?,?,?,?,?)').run('session-1', 1, 'llm', 'ok', 20)
  db.prepare('INSERT INTO pending_reminders(id,todo_id,milestone_id,fire_at,payload,scope_key) VALUES(?,?,?,?,?,?)').run('pending-1', 'same-todo', 'same-ms', 30, '跟进功能分支', LEGACY)
  db.prepare('INSERT INTO recall_log(scope_key,query,source,status,created_at) VALUES(?,?,?,?,?)').run(LEGACY, '功能分支', 'user', 'ok', 20)
  db.prepare('INSERT INTO user_profile(id,display_name,updated_at) VALUES(?,?,?)').run(1, '新用户资料', 20)
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('last_snapshot_date', '2026-08-25')
}

function seedSecondLegacy(db: DB): void {
  db.prepare('INSERT INTO todos(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('feature-extra', '功能分支事项', 'pending', 'canonical/feature', 3, 30)
  db.prepare('INSERT INTO events(id,kind,summary,scope_key,occurred_at) VALUES(?,?,?,?,?)').run('event-2', 'note', '补充另一条分支记录', 'canonical/feature', 30)
  db.prepare('INSERT INTO notifications(id,kind,title,todo_id,scope_cwd,created_at,handled_at,scope_key) VALUES(?,?,?,?,?,?,?,?)').run('notice-2', 'reminder', '已处理的分支提醒', 'feature-extra', '/old/path', 30, 31, 'canonical/feature')
}

describe('legacy branch scope migration', () => {
  it('keeps true conflicts, deterministically remaps ids and repairs every reference', () => {
    const dataDir = tempDir()
    const canonicalPath = join(dataDir, 'yolo-canonical_default.db')
    const legacyPath = join(dataDir, 'yolo-canonical_main.db')
    const featurePath = join(dataDir, 'yolo-canonical_feature.db')
    const canonical = openDb(canonicalPath)
    openDatabases.push(canonical)
    const legacy = openDb(legacyPath)
    const feature = openDb(featurePath)
    seedCanonical(canonical)
    seedLegacy(legacy)
    seedSecondLegacy(feature)
    legacy.close()
    feature.close()

    const first = migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\\Work\\Alpha')
    expect(first.imported).toEqual(['yolo-canonical_feature.db', 'yolo-canonical_main.db'])
    expect(first.warnings).toContain('yolo-canonical_main.db: client_action_id conflict action-1; kept canonical outcome')
    expect(existsSync(legacyPath)).toBe(true)
    expect(existsSync(featurePath)).toBe(true)

    const milestones = canonical.prepare('SELECT id,title,scope_key FROM milestones ORDER BY title').all() as Array<{ id: string; title: string; scope_key: string }>
    const todos = canonical.prepare('SELECT id,title,milestone_id,scope_key FROM todos ORDER BY title').all() as Array<{ id: string; title: string; milestone_id: string; scope_key: string }>
    const goals = canonical.prepare('SELECT title,milestone_id FROM goals ORDER BY title').all() as Array<{ title: string; milestone_id: string }>
    expect(milestones).toHaveLength(2)
    expect(todos).toHaveLength(3)
    expect(todos.filter((row) => row.title === '功能分支事项')).toHaveLength(2)
    const featureMilestone = milestones.find((row) => row.title === '功能分支里程碑')!
    const featureTodo = todos.find((row) => row.title === '功能分支事项' && row.id !== 'feature-extra')!
    expect(featureMilestone.id).not.toBe('same-ms')
    expect(featureTodo.id).not.toBe('same-todo')
    expect(featureTodo.milestone_id).toBe(featureMilestone.id)
    expect(canonical.prepare('SELECT session_id,source_excerpt,source_turn FROM todos WHERE id=?').get(featureTodo.id))
      .toEqual({ session_id: 'session-1', source_excerpt: '请继续跟进功能分支事项', source_turn: 2 })
    expect(goals.find((row) => row.title === '功能分支目标')?.milestone_id).toBe(featureMilestone.id)
    expect(canonical.prepare('SELECT todo_id FROM notifications WHERE title = ?').get('发送功能分支方案')).toEqual({ todo_id: featureTodo.id })
    expect(canonical.prepare('SELECT handled_at FROM notifications WHERE title = ?').get('已处理的分支提醒')).toEqual({ handled_at: 31 })
    expect(canonical.prepare('SELECT todo_id,milestone_id FROM pending_reminders WHERE payload = ?').get('跟进功能分支')).toEqual({ todo_id: featureTodo.id, milestone_id: featureMilestone.id })
    expect(canonical.prepare('SELECT todo_id FROM attention_feedback WHERE evidence_fingerprint = ?').get('fp')).toEqual({ todo_id: featureTodo.id })

    expect(canonical.prepare('SELECT value FROM preferences WHERE key = ?').get('跟进节奏')).toEqual({ value: '每天' })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM preference_history WHERE key = ?').get('跟进节奏')).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 2 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM session_summaries').get()).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM extraction_log').get()).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM recall_log').get()).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT display_name FROM user_profile WHERE id=1').get()).toEqual({ display_name: '新用户资料' })
    expect(canonical.prepare("SELECT COUNT(*) AS n FROM yolo_fts WHERE yolo_fts MATCH '功能分支事项'").get()).toEqual({ n: 2 })
    expect(canonical.prepare("SELECT COUNT(DISTINCT scope_key) AS n FROM todos").get()).toEqual({ n: 1 })

    const countsBefore = {
      todos: canonical.prepare('SELECT COUNT(*) AS n FROM todos').get(),
      events: canonical.prepare('SELECT COUNT(*) AS n FROM events').get(),
      notifications: canonical.prepare('SELECT COUNT(*) AS n FROM notifications').get(),
    }
    expect(migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\\Work\\Alpha').imported).toEqual([])
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM todos').get()).toEqual(countsBefore.todos)
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual(countsBefore.events)
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual(countsBefore.notifications)
    canonical.close()
  })

  it('names a corrupt legacy source instead of silently dropping it', () => {
    const dataDir = tempDir()
    const canonicalPath = join(dataDir, 'yolo-canonical_default.db')
    const corruptPath = join(dataDir, 'yolo-canonical_feature.db')
    writeFileSync(corruptPath, 'not sqlite')
    const canonical = openDb(canonicalPath)
    openDatabases.push(canonical)
    expect(() => migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, '/work/alpha'))
      .toThrow(/legacy scope migration failed \(yolo-canonical_feature\.db\)/)
    canonical.close()
  })
})
