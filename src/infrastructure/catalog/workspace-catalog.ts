import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { canonicalWorkspaceCwd, computeScopeKey, workspaceIdentity } from '../../domain/scope.ts'

const CATALOG_SCHEMA_VERSION = 1

export interface WorkspaceCatalogRecord {
  workspaceId: string
  cwd: string
  scopeKey: string
  lastSeenAt: number
  status: 'ready' | 'stale' | 'invalid'
  reason?: string
  unavailableSince?: number
}

interface WorkspaceRow {
  workspace_id: string
  canonical_cwd: string
  scope_key: string
  last_seen_at: number
  last_error?: string | null
  unavailable_since?: number | null
}

export function defaultCatalogPath(): string {
  if (process.env.VITEST) return ':memory:'
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(dshHome, 'yolo', 'control.db')
}

/**
 * Durable discovery catalog for workspace stores.
 *
 * It owns discovery only; plan facts remain in each workspace SQLite. Catalog
 * writes are therefore independent, idempotent and replayable, never part of
 * a cross-database UnitOfWork.
 */
export class WorkspaceCatalog {
  readonly path: string
  private db: DatabaseSync

  constructor(path = defaultCatalogPath()) {
    this.path = path
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = this.openRecoverably(path)
  }

  private openRecoverably(path: string): DatabaseSync {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(path)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS workspaces(
          workspace_id TEXT PRIMARY KEY,
          canonical_cwd TEXT NOT NULL UNIQUE,
          scope_key TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          last_error TEXT,
          unavailable_since INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_workspace_scope ON workspaces(scope_key);
        CREATE INDEX IF NOT EXISTS idx_catalog_workspace_seen ON workspaces(last_seen_at DESC);
      `)
      const columns = db.prepare('PRAGMA table_info(workspaces)').all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === 'last_error')) db.exec('ALTER TABLE workspaces ADD COLUMN last_error TEXT')
      if (!columns.some((column) => column.name === 'unavailable_since')) db.exec('ALTER TABLE workspaces ADD COLUMN unavailable_since INTEGER')
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined
      const version = Number(row?.value ?? 0)
      if (version > CATALOG_SCHEMA_VERSION) throw new Error(`unsupported catalog schema ${version}`)
      if (version > 0 && version < CATALOG_SCHEMA_VERSION && path !== ':memory:') {
        copyFileSync(path, `${path}.bak-v${version}-${Date.now()}`)
      }
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(String(CATALOG_SCHEMA_VERSION))
      return db
    } catch (error) {
      try { db?.close() } catch { /* already closed */ }
      if (path === ':memory:') throw error
      if (existsSync(path)) {
        const quarantined = `${path}.corrupt-${Date.now()}`
        renameSync(path, quarantined)
        for (const suffix of ['-wal', '-shm']) {
          const sidecar = `${path}${suffix}`
          if (existsSync(sidecar)) renameSync(sidecar, `${quarantined}${suffix}`)
        }
      }
      const fresh = new DatabaseSync(path)
      fresh.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE workspaces(
          workspace_id TEXT PRIMARY KEY,
          canonical_cwd TEXT NOT NULL UNIQUE,
          scope_key TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          last_error TEXT,
          unavailable_since INTEGER
        );
        CREATE UNIQUE INDEX idx_catalog_workspace_scope ON workspaces(scope_key);
        CREATE INDEX idx_catalog_workspace_seen ON workspaces(last_seen_at DESC);
      `)
      fresh.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?)").run(String(CATALOG_SCHEMA_VERSION))
      return fresh
    }
  }

  register(cwd: string, scopeKey: string, now = Date.now()): WorkspaceCatalogRecord {
    const canonical = canonicalWorkspaceCwd(cwd)
    const expected = computeScopeKey(canonical)
    if (scopeKey !== expected) throw new Error('workspace catalog scope key mismatch')
    const existing = this.db.prepare('SELECT workspace_id FROM workspaces WHERE canonical_cwd = ? OR scope_key = ? LIMIT 1')
      .get(canonical, scopeKey) as { workspace_id?: string } | undefined
    const workspaceId = existing?.workspace_id ?? randomUUID()
    this.db.prepare(`
      INSERT INTO workspaces(workspace_id, canonical_cwd, scope_key, last_seen_at)
      VALUES(?,?,?,?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,
        last_error=NULL,
        unavailable_since=NULL
    `).run(workspaceId, canonical, scopeKey, now)
    return { workspaceId, cwd: canonical, scopeKey, lastSeenAt: now, status: 'ready' }
  }

  list(): WorkspaceCatalogRecord[] {
    const rows = this.db.prepare('SELECT workspace_id, canonical_cwd, scope_key, last_seen_at, last_error, unavailable_since FROM workspaces ORDER BY last_seen_at DESC')
      .all() as unknown as WorkspaceRow[]
    return rows.map((row) => {
      const result = this.validate(row)
      if (result.status === 'ready') {
        this.db.prepare('UPDATE workspaces SET last_error=NULL, unavailable_since=NULL WHERE workspace_id=?').run(row.workspace_id)
      } else {
        this.db.prepare(`UPDATE workspaces SET last_error=?, unavailable_since=COALESCE(unavailable_since, ?) WHERE workspace_id=?`)
          .run(result.reason ?? result.status, Date.now(), row.workspace_id)
      }
      return result
    })
  }

  private validate(row: WorkspaceRow): WorkspaceCatalogRecord {
    const base = {
      workspaceId: row.workspace_id,
      cwd: row.canonical_cwd,
      scopeKey: row.scope_key,
      lastSeenAt: Number(row.last_seen_at),
      ...(row.unavailable_since ? { unavailableSince: Number(row.unavailable_since) } : {}),
    }
    try {
      if (!isAbsolute(row.canonical_cwd)) return { ...base, status: 'invalid', reason: 'cwd is not absolute' }
      const canonical = canonicalWorkspaceCwd(row.canonical_cwd)
      if (workspaceIdentity(canonical) !== workspaceIdentity(row.canonical_cwd)) {
        return { ...base, status: 'invalid', reason: 'cwd is not canonical' }
      }
      const dbPath = join(canonical, '.dsh', 'yolo', `yolo-${row.scope_key.replace(/[\\/]/g, '_')}.db`)
      if (!existsSync(dbPath)) return { ...base, status: 'stale', reason: 'workspace store missing' }
      const workspaceDb = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const scope = workspaceDb.prepare("SELECT value FROM meta WHERE key = 'workspace_scope_key'").get() as { value?: string } | undefined
        const identity = workspaceDb.prepare("SELECT value FROM meta WHERE key = 'workspace_identity'").get() as { value?: string } | undefined
        const workspaceId = workspaceDb.prepare("SELECT value FROM meta WHERE key = 'workspace_id'").get() as { value?: string } | undefined
        if (scope?.value !== row.scope_key || identity?.value !== workspaceIdentity(canonical) || workspaceId?.value !== row.workspace_id) {
          return { ...base, status: 'invalid', reason: 'workspace store marker mismatch' }
        }
      } finally {
        workspaceDb.close()
      }
      return { ...base, cwd: canonical, status: 'ready' }
    } catch (error) {
      return { ...base, status: 'invalid', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Explicit path relocation. The workspace DB keeps its original scope_key;
   * a moved directory therefore preserves both domain identity and row scope. */
  relocate(workspaceId: string, newCwd: string, now = Date.now()): WorkspaceCatalogRecord {
    const row = this.db.prepare('SELECT workspace_id, canonical_cwd, scope_key, last_seen_at FROM workspaces WHERE workspace_id=?')
      .get(workspaceId) as WorkspaceRow | undefined
    if (!row) throw new Error('unknown workspace id')
    const canonical = canonicalWorkspaceCwd(newCwd)
    const dbPath = join(canonical, '.dsh', 'yolo', `yolo-${row.scope_key.replace(/[\\/]/g, '_')}.db`)
    if (!existsSync(dbPath)) throw new Error('relocated workspace store missing')
    const workspaceDb = new DatabaseSync(dbPath)
    try {
      const marker = workspaceDb.prepare("SELECT value FROM meta WHERE key='workspace_id'").get() as { value?: string } | undefined
      const scope = workspaceDb.prepare("SELECT value FROM meta WHERE key='workspace_scope_key'").get() as { value?: string } | undefined
      if (marker?.value !== workspaceId || scope?.value !== row.scope_key) throw new Error('relocated workspace marker mismatch')
      workspaceDb.prepare("INSERT INTO meta(key,value) VALUES('workspace_identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(workspaceIdentity(canonical))
    } finally {
      workspaceDb.close()
    }
    this.db.prepare('UPDATE workspaces SET canonical_cwd=?, last_seen_at=?, last_error=NULL, unavailable_since=NULL WHERE workspace_id=?')
      .run(canonical, now, workspaceId)
    return { workspaceId, cwd: canonical, scopeKey: row.scope_key, lastSeenAt: now, status: 'ready' }
  }

  /** Forget discovery only. Workspace SQLite and snapshots are never deleted. */
  forget(workspaceId: string): boolean {
    return this.db.prepare('DELETE FROM workspaces WHERE workspace_id=?').run(workspaceId).changes > 0
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}
