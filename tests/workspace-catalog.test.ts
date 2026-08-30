import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalWorkspaceCwd, computeScopeKey, workspaceIdentity } from '../src/domain/scope.ts'
import { WorkspaceCatalog } from '../src/infrastructure/catalog/workspace-catalog.ts'
import { dbFileName, resolveDataDir } from '../src/storage/scope.ts'
import { openDb, setMeta } from '../src/storage/db.ts'
import Yolo from '../src/storage/index.ts'
import { mkdtempSync } from 'node:fs'

let root: string
let catalogPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'yolo-workspace-catalog-'))
  catalogPath = join(root, 'control', 'control.db')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function createWorkspaceStore(cwd: string): string {
  const canonical = canonicalWorkspaceCwd(cwd)
  const scopeKey = computeScopeKey(canonical)
  const dbPath = join(resolveDataDir('workspace', canonical), dbFileName(scopeKey))
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = openDb(dbPath)
  db.close()
  return scopeKey
}

function setWorkspaceMarkers(
  cwd: string,
  scopeKey: string,
  workspaceId: string,
  markerPatch: { scopeKey?: string; identity?: string; workspaceId?: string } = {},
): void {
  const canonical = canonicalWorkspaceCwd(cwd)
  const dbPath = join(resolveDataDir('workspace', canonical), dbFileName(scopeKey))
  const db = openDb(dbPath)
  setMeta(db, 'workspace_id', markerPatch.workspaceId ?? workspaceId)
  setMeta(db, 'workspace_scope_key', markerPatch.scopeKey ?? scopeKey)
  setMeta(db, 'workspace_identity', markerPatch.identity ?? workspaceIdentity(canonical))
  db.close()
}

function contextStub() {
  return {
    logger: { info: () => {}, warn: () => {} },
    reflect: { provide: () => {} },
    on: () => () => {},
    effect: () => () => {},
  } as never
}

describe('WorkspaceCatalog', () => {
  it('recovers ready workspace discovery after the catalog is reopened', () => {
    const cwd = join(root, 'workspace-a')
    const scopeKey = createWorkspaceStore(cwd)
    const first = new WorkspaceCatalog(catalogPath)
    const registered = first.register(cwd, scopeKey, 100)
    setWorkspaceMarkers(cwd, scopeKey, registered.workspaceId)
    first.close()

    const restarted = new WorkspaceCatalog(catalogPath)
    expect(restarted.list()).toEqual([
      expect.objectContaining({
        cwd: canonicalWorkspaceCwd(cwd),
        scopeKey,
        lastSeenAt: 100,
        status: 'ready',
      }),
    ])
    restarted.close()
  })

  it('re-registers the same workspace idempotently and refreshes lastSeenAt', () => {
    const cwd = join(root, 'workspace-a')
    const scopeKey = createWorkspaceStore(cwd)
    const catalog = new WorkspaceCatalog(catalogPath)

    const first = catalog.register(cwd, scopeKey, 100)
    setWorkspaceMarkers(cwd, scopeKey, first.workspaceId)
    const second = catalog.register(cwd, scopeKey, 250)

    expect(catalog.list()).toEqual([
      expect.objectContaining({ workspaceId: first.workspaceId, scopeKey, lastSeenAt: 250, status: 'ready' }),
    ])
    expect(second.workspaceId).toBe(first.workspaceId)
    catalog.close()
  })

  it('quarantines a corrupt catalog and starts with a fresh empty database', () => {
    mkdirSync(dirname(catalogPath), { recursive: true })
    writeFileSync(catalogPath, 'this is not sqlite')

    const catalog = new WorkspaceCatalog(catalogPath)
    expect(catalog.list()).toEqual([])
    catalog.close()

    expect(existsSync(catalogPath)).toBe(true)
    expect(readdirSync(dirname(catalogPath)).some((name) => name.startsWith('control.db.corrupt-'))).toBe(true)
  })

  it('marks a registered workspace stale when its workspace store is missing', () => {
    const cwd = join(root, 'missing-workspace')
    const scopeKey = computeScopeKey(cwd)
    const catalog = new WorkspaceCatalog(catalogPath)
    catalog.register(cwd, scopeKey, 100)

    expect(catalog.list()).toEqual([
      expect.objectContaining({ status: 'stale', reason: 'workspace store missing' }),
    ])
    catalog.close()
  })

  it('reports invalid catalog paths and invalid workspace scope markers', () => {
    const goodCwd = join(root, 'marker-workspace')
    const scopeKey = createWorkspaceStore(goodCwd)
    const catalog = new WorkspaceCatalog(catalogPath)
    const registered = catalog.register(goodCwd, scopeKey, 200)
    setWorkspaceMarkers(goodCwd, scopeKey, registered.workspaceId, { scopeKey: 'wrong/default' })
    catalog.close()

    const raw = new DatabaseSync(catalogPath)
    raw.prepare(
      'INSERT INTO workspaces(workspace_id, canonical_cwd, scope_key, last_seen_at) VALUES(?,?,?,?)',
    ).run('invalid/default', 'relative/workspace', 'invalid/default', 100)
    raw.close()

    const reopened = new WorkspaceCatalog(catalogPath)
    const rows = reopened.list()
    expect(rows.find((row) => row.scopeKey === 'invalid/default')).toMatchObject({
      status: 'invalid',
      reason: 'cwd is not absolute',
    })
    expect(rows.find((row) => row.scopeKey === scopeKey)).toMatchObject({
      status: 'invalid',
      reason: 'workspace store marker mismatch',
    })
    reopened.close()
  })

  it('rejects a registration whose supplied scope key disagrees with cwd identity', () => {
    const catalog = new WorkspaceCatalog(catalogPath)
    expect(() => catalog.register(join(root, 'workspace-a'), 'wrong/default')).toThrow('scope key mismatch')
    expect(catalog.list()).toEqual([])
    catalog.close()
  })

  it('relocates only a marker-proven store and forgets discovery without deleting data', () => {
    const original = join(root, 'workspace-before-move')
    const moved = join(root, 'workspace-after-move')
    const scopeKey = createWorkspaceStore(original)
    const catalog = new WorkspaceCatalog(catalogPath)
    const registered = catalog.register(original, scopeKey, 100)
    setWorkspaceMarkers(original, scopeKey, registered.workspaceId)
    renameSync(original, moved)

    expect(catalog.relocate(registered.workspaceId, moved, 300)).toMatchObject({
      workspaceId: registered.workspaceId,
      cwd: canonicalWorkspaceCwd(moved),
      scopeKey,
      status: 'ready',
    })
    expect(catalog.list()).toEqual([
      expect.objectContaining({ workspaceId: registered.workspaceId, cwd: canonicalWorkspaceCwd(moved), status: 'ready' }),
    ])
    expect(catalog.forget(registered.workspaceId)).toBe(true)
    expect(catalog.list()).toEqual([])
    expect(existsSync(join(resolveDataDir('workspace', moved), dbFileName(scopeKey)))).toBe(true)
    catalog.close()
  })
})

describe('Yolo durable workspace discovery', () => {
  it('restores listWorkspaceMeta after service restart using an explicit catalog path', () => {
    const cwd = join(root, 'workspace-a')
    const first = new Yolo(contextStub(), { catalogPath })
    const firstScope = first.resolve(cwd).scopeKey
    expect(first.listWorkspaceMeta()).toEqual([
      expect.objectContaining({ cwd: canonicalWorkspaceCwd(cwd), scopeKey: firstScope }),
    ])
    first.dispose()

    const restarted = new Yolo(contextStub(), { catalogPath })
    expect(restarted.listWorkspaceMeta()).toEqual([
      expect.objectContaining({ cwd: canonicalWorkspaceCwd(cwd), scopeKey: firstScope }),
    ])
    restarted.dispose()
  })
})
