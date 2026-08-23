// Scope-pin regression (v0.3.3 review fix) — runInScope() must pin every
// workspace-mode resolve(cwd) inside the callback to the EXACT registered
// scopeKey, so a board row rendered from branch A stays editable on branch A
// even if computeScopeKey (git branch) changes in between. Without the pin,
// an action routed by cwd re-resolved the key at click time and could land in
// another branch's store ("todo not found" / cross-branch edits).

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
  cwd = mkdtempSync(join(tmpdir(), 'yolo-scopepin-'))
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  compute.mockReset()
  let n = 0
  compute.mockImplementation(() => `branch-${n++}`)
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('Yolo.runInScope', () => {
  it('pins resolve() to the given scopeKey even after the live key changed', () => {
    yolo.resolve(cwd)
    expect(yolo.resolve(cwd).scopeKey).toBe('branch-0')

    // "branch switch": the live key now resolves differently
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + yolo.SCOPE_KEY_TTL_MS + 1)
    expect(yolo.resolve(cwd).scopeKey).toBe('branch-1')
    const meta = yolo.listWorkspaceMeta().find((m) => m.cwd === cwd)

    // a pinned operation lands in the REGISTERED store, not the fresh one
    const seen = yolo.runInScope(cwd, 'branch-0', () => yolo.resolve(cwd).scopeKey)
    expect(seen).toBe('branch-0')
    // ...while unpinned reads keep following the live key
    expect(yolo.resolve(cwd).scopeKey).toBe('branch-1')
    expect(meta).toBeDefined()
  })

  it('restores unpinned resolution when the callback returns or throws', () => {
    yolo.runInScope(cwd, 'pinned/x', () => {
      expect(yolo.resolve(cwd).scopeKey).toBe('pinned/x')
    })
    expect(yolo.resolve(cwd).scopeKey).not.toBe('pinned/x')

    expect(() =>
      yolo.runInScope(cwd, 'pinned/y', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(yolo.resolve(cwd).scopeKey).not.toBe('pinned/y')
  })

  it('nests pins with the innermost matching cwd winning', () => {
    yolo.runInScope(cwd, 'outer/x', () => {
      const inner = yolo.runInScope(cwd, 'inner/y', () => yolo.resolve(cwd).scopeKey)
      expect(inner).toBe('inner/y')
      expect(yolo.resolve(cwd).scopeKey).toBe('outer/x')
    })
  })
})
