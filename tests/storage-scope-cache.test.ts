// Cwd-only scope registry regression: equivalent cwd spellings share one DB
// handle and one aggregation entry without a TTL or Git refresh cycle.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Yolo from '../src/storage/index.ts'

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-cwdscope-'))
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe('Yolo cwd-only scope registry', () => {
  it('reuses one handle and registry entry for equivalent cwd spelling', () => {
    const equivalent = join(cwd, 'child', '..')
    const first = yolo.resolve(cwd)
    const second = yolo.resolve(equivalent)
    expect(second.db).toBe(first.db)
    expect(second.scopeKey).toBe(first.scopeKey)
    expect(yolo.listWorkspaceMeta()).toHaveLength(1)
  })

  it('keeps distinct workspaces isolated', () => {
    const other = mkdtempSync(join(tmpdir(), 'yolo-cwdscope-other-'))
    try {
      expect(yolo.resolve(other).scopeKey).not.toBe(yolo.resolve(cwd).scopeKey)
      expect(yolo.listWorkspaceMeta()).toHaveLength(2)
    } finally {
      yolo.close()
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('drops handles and rebuilds the same stable key after close', () => {
    const first = yolo.resolve(cwd)
    yolo.close()
    const second = yolo.resolve(cwd)
    expect(second.scopeKey).toBe(first.scopeKey)
    expect(second.db).not.toBe(first.db)
  })
})
