// Scope resolution tests — scope keys, data dirs, DB filenames, path helpers.

import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import {
  computeScopeKey,
  currentGitBranch,
  dbFileName,
  resolveDataDir,
  toPosix,
} from '../src/storage/scope.ts'

describe('computeScopeKey', () => {
  it('is stable for the same cwd and distinct across cwds', () => {
    const a1 = computeScopeKey('D:/proj/a')
    const a2 = computeScopeKey('D:/proj/a')
    const b = computeScopeKey('D:/proj/b')
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })

  it('starts with a 12-hex cwd hash segment', () => {
    const key = computeScopeKey('D:/proj/a')
    expect(key).toMatch(/^[0-9a-f]{12}\//)
  })

  it('falls back to "default" branch outside a git repo', () => {
    // a fresh temp-ish path that is certainly not a git worktree
    const key = computeScopeKey(join(homedir(), '.yolo-not-a-repo'))
    expect(key.endsWith('/default')).toBe(true)
  })
})

describe('currentGitBranch', () => {
  it('resolves the branch of this repo (a git checkout)', () => {
    const branch = currentGitBranch(process.cwd())
    expect(branch).toBeTruthy()
    expect(branch).not.toBe('HEAD')
  })

  it('returns null for a nonexistent directory', () => {
    expect(currentGitBranch('Z:/definitely/not/here')).toBeNull()
  })
})

describe('resolveDataDir', () => {
  it('workspace mode nests under <cwd>/.dsh/yolo', () => {
    expect(resolveDataDir('workspace', 'D:/proj/a')).toBe(resolve(join('D:/proj/a', '.dsh', 'yolo')))
  })

  it('user mode points at ~/.dsh/yolo and global at its subdir', () => {
    expect(resolveDataDir('user', 'D:/proj/a')).toBe(join(homedir(), '.dsh', 'yolo'))
    expect(resolveDataDir('global', 'D:/proj/a')).toBe(join(homedir(), '.dsh', 'yolo', 'global'))
  })
})

describe('dbFileName', () => {
  it('sanitizes path separators out of the scope key', () => {
    expect(dbFileName('abc123/main')).toBe('yolo-abc123_main.db')
    expect(dbFileName('abc123\\feat')).toBe('yolo-abc123_feat.db')
  })
})

describe('toPosix', () => {
  it('normalizes windows separators to forward slashes', () => {
    expect(toPosix('D:\\proj\\a')).toBe('D:/proj/a')
    expect(toPosix('/already/posix')).toBe('/already/posix')
  })
})
