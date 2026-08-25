// Registry pin regression: runInScope remains an allowlisted operation guard,
// but Git branch changes are no longer part of workspace resolution.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Yolo from '../src/storage/index.ts'

let cwd: string
let yolo: Yolo

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'yolo-scopepin-'))
  yolo = new Yolo({ logger: { info: () => {}, warn: () => {} }, reflect: { provide: () => {} }, effect: () => () => {} } as never)
})

afterEach(() => {
  yolo.close()
  rmSync(cwd, { recursive: true, force: true })
})

describe('Yolo.runInScope', () => {
  it('pins an equivalent cwd spelling to the registered canonical key', () => {
    const registered = yolo.resolve(cwd).scopeKey
    const equivalent = join(cwd, 'nested', '..')
    expect(yolo.runInScope(equivalent, registered, () => yolo.resolve(cwd).scopeKey)).toBe(registered)
  })

  it('restores resolution when the callback returns or throws', () => {
    const canonical = yolo.resolve(cwd).scopeKey
    yolo.runInScope(cwd, canonical, () => expect(yolo.resolve(cwd).scopeKey).toBe(canonical))
    expect(() => yolo.runInScope(cwd, canonical, () => { throw new Error('boom') })).toThrow('boom')
    expect(yolo.resolve(cwd).scopeKey).toBe(canonical)
  })

  it('lets the innermost matching pin win', () => {
    const canonical = yolo.resolve(cwd).scopeKey
    yolo.runInScope(cwd, canonical, () => {
      const inner = yolo.runInScope(cwd, canonical, () => yolo.resolve(cwd).scopeKey)
      expect(inner).toBe(canonical)
      expect(yolo.resolve(cwd).scopeKey).toBe(canonical)
    })
  })
})
