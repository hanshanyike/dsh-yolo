import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
  db.prepare(`INSERT INTO todo_evidence(id,todo_id,source_scope_key,session_id,turn_seq,source_kind,relation,excerpt,occurred_at,source_fingerprint)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run('evidence-1', 'same-todo', LEGACY, 'session-1', 2, 'extraction', 'origin', '请继续跟进功能分支事项', 20, 'extract/session-1/2/todo-0')
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
  db.prepare(`INSERT INTO todo_resolution_log(
    scope_key,session_id,turn_seq,operation_id,input_fingerprint,input_excerpt,resolver_version,
    model_provider,model_name,status,candidates_json,resolutions_json,application_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    LEGACY, 'session-1', 2, 'extract/session-1/2', 'request-hash', '继续跟进功能分支事项', 'shadow-v1',
    'provider', 'model', 'ok',
    JSON.stringify([{ id: 'same-todo', title: '功能分支事项' }]),
    JSON.stringify([{ decision: 'LINK', candidate_ids: ['same-todo'] }]),
    JSON.stringify({ policy_version: 'r2a-v1', status: 'linked', todo_id: 'same-todo', evidence_id: 'evidence-1' }),
    20,
  )
  db.prepare(`INSERT INTO todo_identity_feedback(
    id,resolution_operation_id,scope_key,todo_id,evidence_id,verdict,reason,undo_status,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    'identity-feedback-1', 'extract/session-1/2', LEGACY, 'same-todo', 'evidence-1',
    'incorrect', 'wrong_item', 'not_needed', 21,
  )
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

/** Build a real pre-provenance branch DB without ever passing through openDb.
 * Its todos table physically lacks source_excerpt/source_turn until the
 * production migration opens it. */
function createPreSourceLegacy(path: string): void {
  const currentSchema = readFileSync(new URL('../src/storage/schema.sql', import.meta.url), 'utf8')
  const legacySchema = currentSchema
    .replace(/^\s*source_excerpt\s+TEXT[^\r\n]*(?:\r?\n)/mu, '')
    .replace(/^\s*source_turn\s+INTEGER[^\r\n]*(?:\r?\n)/mu, '')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(legacySchema)
    const columns = db.prepare('PRAGMA table_info(todos)').all() as Array<{ name: string }>
    expect(columns.some((column) => column.name === 'source_excerpt')).toBe(false)
    expect(columns.some((column) => column.name === 'source_turn')).toBe(false)

    db.prepare('INSERT INTO milestones(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('old-ms', '完成客户演示准备', 'active', LEGACY, 1, 20)
    db.prepare(`INSERT INTO todos(id,title,detail,status,priority,due_at,milestone_id,scope_key,dedup_key,source,session_id,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('old-todo', '把客户演示材料发给研发', '先确认最终数字', 'pending', 'high', '2026-08-28', 'old-ms', LEGACY, '把客户演示材料发给研发', 'llm', 'old-session', 2, 20)
    db.prepare('INSERT INTO goals(id,title,progress,status,milestone_id,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('old-goal', '完成发布准备', 60, 'active', 'old-ms', LEGACY, 2, 20)
    db.prepare('INSERT INTO events(id,kind,summary,session_id,source,occurred_at,scope_key) VALUES(?,?,?,?,?,?,?)')
      .run('old-event', 'todo_created', '创建：把客户演示材料发给研发', 'old-session', 'llm', 20, LEGACY)
    db.prepare('INSERT INTO session_summaries(session_id,summary,scope_key,updated_at) VALUES(?,?,?,?)')
      .run('old-session', '客户演示交付讨论', LEGACY, 20)
    db.prepare('INSERT INTO notifications(id,kind,title,todo_id,scope_cwd,created_at,scope_key) VALUES(?,?,?,?,?,?,?)')
      .run('old-notification', 'reminder', '提醒发送客户演示材料', 'old-todo', 'D:\\old\\alpha', 20, LEGACY)
    db.prepare('INSERT INTO attention_feedback(scope_key,todo_id,reason_version,evidence_fingerprint,seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(LEGACY, 'old-todo', 'v1', 'old-fingerprint', 20, 20, 20)
    db.prepare('INSERT INTO pending_reminders(id,todo_id,milestone_id,fire_at,payload,scope_key) VALUES(?,?,?,?,?,?)')
      .run('old-pending', 'old-todo', 'old-ms', 30, '继续跟进客户演示材料', LEGACY)
  } finally {
    db.close()
  }
}

describe('legacy branch scope migration', () => {
  it('MIG-02 migrates a true pre-source-column branch twice without loss or duplication', () => {
    const dataDir = tempDir()
    const canonicalPath = join(dataDir, 'yolo-canonical_default.db')
    const legacyPath = join(dataDir, 'yolo-canonical_main.db')
    createPreSourceLegacy(legacyPath)

    const canonical = openDb(canonicalPath)
    openDatabases.push(canonical)
    const first = migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\\Work\\Alpha')
    expect(first.imported).toEqual(['yolo-canonical_main.db'])
    expect(first.warnings).toEqual([])

    expect(canonical.prepare(`SELECT title,detail,status,priority,due_at,milestone_id,scope_key,source,session_id,source_excerpt,source_turn
                              FROM todos WHERE id=?`).get('old-todo')).toEqual({
      title: '把客户演示材料发给研发',
      detail: '先确认最终数字',
      status: 'pending',
      priority: 'high',
      due_at: '2026-08-28',
      milestone_id: 'old-ms',
      scope_key: CANONICAL,
      source: 'llm',
      session_id: 'old-session',
      source_excerpt: null,
      source_turn: null,
    })
    expect(canonical.prepare('SELECT milestone_id,scope_key FROM goals WHERE id=?').get('old-goal'))
      .toEqual({ milestone_id: 'old-ms', scope_key: CANONICAL })
    expect(canonical.prepare('SELECT todo_id,scope_cwd,scope_key FROM notifications WHERE id=?').get('old-notification'))
      .toEqual({ todo_id: 'old-todo', scope_cwd: 'D:\\Work\\Alpha', scope_key: CANONICAL })
    expect(canonical.prepare('SELECT todo_id FROM attention_feedback WHERE evidence_fingerprint=?').get('old-fingerprint'))
      .toEqual({ todo_id: 'old-todo' })
    expect(canonical.prepare('SELECT todo_id,milestone_id,scope_key FROM pending_reminders WHERE id=?').get('old-pending'))
      .toEqual({ todo_id: 'old-todo', milestone_id: 'old-ms', scope_key: CANONICAL })
    expect(canonical.prepare('SELECT summary,scope_key FROM session_summaries WHERE session_id=?').get('old-session'))
      .toEqual({ summary: '客户演示交付讨论', scope_key: CANONICAL })
    expect(canonical.prepare("SELECT COUNT(*) AS n FROM yolo_fts WHERE yolo_fts MATCH '客户演示材料' AND row_type='todo'").get()).toEqual({ n: 1 })
    expect(canonical.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })

    const countsBefore = Object.fromEntries([
      'milestones', 'todos', 'goals', 'events', 'session_summaries', 'notifications',
      'attention_feedback', 'pending_reminders', 'yolo_fts',
    ].map((table) => [table, canonical.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()]))
    const second = migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\\Work\\Alpha')
    expect(second).toEqual({ imported: [], warnings: [] })
    for (const [table, count] of Object.entries(countsBefore)) {
      expect(canonical.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual(count)
    }
    expect(canonical.prepare('SELECT source_excerpt,source_turn FROM todos WHERE id=?').get('old-todo'))
      .toEqual({ source_excerpt: null, source_turn: null })
    expect(canonical.prepare("SELECT COUNT(*) AS n FROM yolo_fts WHERE yolo_fts MATCH '客户演示材料' AND row_type='todo'").get()).toEqual({ n: 1 })
    expect(canonical.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    canonical.close()
  })

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
    expect(canonical.prepare('SELECT todo_id,source_scope_key FROM todo_evidence WHERE source_fingerprint = ?').get('extract/session-1/2/todo-0'))
      .toEqual({ todo_id: featureTodo.id, source_scope_key: CANONICAL })

    expect(canonical.prepare('SELECT value FROM preferences WHERE key = ?').get('跟进节奏')).toEqual({ value: '每天' })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM preference_history WHERE key = ?').get('跟进节奏')).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 2 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM session_summaries').get()).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM extraction_log').get()).toEqual({ n: 1 })
    const resolver = canonical.prepare('SELECT scope_key,candidates_json,resolutions_json,application_json FROM todo_resolution_log').get() as
      { scope_key: string; candidates_json: string; resolutions_json: string; application_json: string }
    expect(resolver.scope_key).toBe(CANONICAL)
    expect(JSON.parse(resolver.candidates_json)[0].id).toBe(featureTodo.id)
    expect(JSON.parse(resolver.resolutions_json)[0].candidate_ids).toEqual([featureTodo.id])
    expect(JSON.parse(resolver.application_json).todo_id).toBe(featureTodo.id)
    expect(canonical.prepare('SELECT scope_key,todo_id,evidence_id FROM todo_identity_feedback WHERE resolution_operation_id=?').get('extract/session-1/2'))
      .toEqual({ scope_key: CANONICAL, todo_id: featureTodo.id, evidence_id: 'evidence-1' })
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM recall_log').get()).toEqual({ n: 1 })
    expect(canonical.prepare('SELECT display_name FROM user_profile WHERE id=1').get()).toEqual({ display_name: '新用户资料' })
    expect(canonical.prepare("SELECT COUNT(*) AS n FROM yolo_fts WHERE yolo_fts MATCH '功能分支事项'").get()).toEqual({ n: 2 })
    expect(canonical.prepare("SELECT COUNT(DISTINCT scope_key) AS n FROM todos").get()).toEqual({ n: 1 })

    const countsBefore = {
      todos: canonical.prepare('SELECT COUNT(*) AS n FROM todos').get(),
      events: canonical.prepare('SELECT COUNT(*) AS n FROM events').get(),
      notifications: canonical.prepare('SELECT COUNT(*) AS n FROM notifications').get(),
      evidence: canonical.prepare('SELECT COUNT(*) AS n FROM todo_evidence').get(),
    }
    expect(migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\\Work\\Alpha').imported).toEqual([])
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM todos').get()).toEqual(countsBefore.todos)
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM events').get()).toEqual(countsBefore.events)
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual(countsBefore.notifications)
    expect(canonical.prepare('SELECT COUNT(*) AS n FROM todo_evidence').get()).toEqual(countsBefore.evidence)
    canonical.close()
  })

  it('remaps merged todo self-references and their immutable evidence', () => {
    const dataDir = tempDir()
    const canonicalPath = join(dataDir, 'yolo-canonical_default.db')
    const legacyPath = join(dataDir, 'yolo-canonical_main.db')
    const canonical = openDb(canonicalPath)
    openDatabases.push(canonical)
    canonical.prepare('INSERT INTO todos(id,title,status,scope_key,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run('source-id', '主库占用同一 ID', 'pending', CANONICAL, 1, 1)

    const legacy = openDb(legacyPath)
    legacy.prepare('INSERT INTO todos(id,title,status,scope_key,record_status,merged_into_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('source-id', '分支重复副本', 'done', LEGACY, 'merged', 'keeper-id', 2, 3)
    legacy.prepare('INSERT INTO todos(id,title,status,scope_key,record_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run('keeper-id', '分支规范事项', 'pending', LEGACY, 'canonical', 1, 3)
    legacy.prepare(`INSERT INTO todo_evidence(id,todo_id,source_scope_key,session_id,turn_seq,source_kind,relation,occurred_at,source_fingerprint)
                    VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('merged-evidence', 'source-id', LEGACY, 'session-merged', 5, 'extraction', 'completion_claim', 3, 'merged/fingerprint')
    legacy.close()

    expect(migrateLegacyScopeDatabases(canonical, dataDir, canonicalPath, CANONICAL, 'D:\Work\Alpha').imported)
      .toEqual(['yolo-canonical_main.db'])
    const source = canonical.prepare('SELECT id,status,record_status,merged_into_id FROM todos WHERE title=?').get('分支重复副本') as
      { id: string; status: string; record_status: string; merged_into_id: string }
    expect(source).toMatchObject({ status: 'done', record_status: 'merged', merged_into_id: 'keeper-id' })
    expect(source.id).not.toBe('source-id')
    expect(canonical.prepare('SELECT todo_id,source_scope_key FROM todo_evidence WHERE source_fingerprint=?').get('merged/fingerprint'))
      .toEqual({ todo_id: source.id, source_scope_key: CANONICAL })
    expect(canonical.prepare("SELECT COUNT(*) AS n FROM yolo_fts WHERE row_type='todo' AND row_id=?").get(source.id))
      .toEqual({ n: 0 })
    expect(canonical.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
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
