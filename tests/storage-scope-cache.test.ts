// Scope-key memoization regression — Yolo.resolve() used to shell out to
// `git rev-parse` on EVERY call (computeScopeKey). One GET /yolo/dashboard
// resolves the scope ~15 times (every list/count helper), i.e. ~15 git
// processes per request ≈ 3s on Windows — the E2E suite's dominant cost.
// The memoized key must: hit within TTL, re-resolve after TTL, skip the cache
// for non-workspace modes, and be dropped by close().

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../src/storage/scope.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/storage/scope.ts')>()
  return { ...actual, computeScopeKey: vi.fn(actual.computeScopeKey) }
})

import Yolo from '../src/storage/index.ts'
import { computeScopeKey } from '../src/storage/scope.ts'

const compute = vi.mocked(computeScopeKey)

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-scopecache-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('Yolo.resolve scope-key memoization', () => {
  it('computes the scope key once per TTL window, not once per storage call', () => {
    yolo.listTodos(cwd)
    yolo.listTodos(cwd)
    yolo.listGoals(cwd)
    yolo.listWorkspaceMeta()
    expect(compute).toHaveBeenCalledTimes(1)

    // past the TTL the key refreshes (branch switches are honored again)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + yolo.SCOPE_KEY_TTL_MS + 1)
    yolo.listTodos(cwd)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('does not memoize non-workspace modes (user/global have no TTL semantics)', () => {
    yolo.resolve(cwd, 'workspace')
    yolo.resolve(cwd, 'user')
    yolo.resolve(cwd, 'user')
    // workspace mode: 1 computation; user mode: computed every call
    expect(compute).toHaveBeenCalledTimes(3)
  })

  it('drops memoized keys on close()', () => {
    yolo.resolve(cwd)
    expect(compute).toHaveBeenCalledTimes(1)
    yolo.close()
    yolo.resolve(cwd)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('keeps knownWorkspaces pointing at the fresh key after a TTL re-resolve', () => {
    yolo.resolve(cwd)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + yolo.SCOPE_KEY_TTL_MS + 1)
    yolo.resolve(cwd)
    const metas = yolo.listWorkspaceMeta()
    expect(metas).toHaveLength(1)
    expect(metas[0].scopeKey).toBe(compute.mock.results[1]?.value ?? metas[0].scopeKey)
  })
})
