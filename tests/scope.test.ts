// Scope resolution tests — scope keys, data dirs, DB filenames, path helpers.

import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import {
  canonicalWorkspaceCwd,
  computeScopeKey,
  dbFileName,
  resolveDataDir,
  workspaceIdentity,
} from '../src/storage/scope.ts'

describe('computeScopeKey', () => {
  it('is stable for the same cwd and distinct across cwds', () => {
    const a1 = computeScopeKey('D:/proj/a')
    const a2 = computeScopeKey('D:/proj/a')
    const b = computeScopeKey('D:/proj/b')
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })

  it('is a cwd-only key with the stable default suffix', () => {
    const key = computeScopeKey('D:/proj/a')
    expect(key).toMatch(/^[0-9a-f]{12}\/default$/)
  })

  it('uses the same default suffix outside a git repo', () => {
    const key = computeScopeKey(join(homedir(), '.yolo-not-a-repo'))
    expect(key.endsWith('/default')).toBe(true)
  })

  it('stays unchanged when the same cwd gains or switches Git state', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'yolo-git-state-'))
    try {
      const beforeGit = computeScopeKey(cwd)
      execFileSync('git', ['init', cwd], { stdio: 'ignore' })
      const afterInit = computeScopeKey(cwd)
      execFileSync('git', ['-C', cwd, 'checkout', '-b', 'feature/scope-test'], { stdio: 'ignore' })
      expect(computeScopeKey(cwd)).toBe(beforeGit)
      expect(afterInit).toBe(beforeGit)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('workspace cwd identity', () => {
  it('collapses equivalent Windows spelling, separators, case and dot segments', () => {
    const variants = ['D:\\Work\\Alpha', 'd:/work/alpha', 'D:\\Work\\x\\..\\Alpha\\']
    expect(new Set(variants.map((cwd) => workspaceIdentity(cwd, 'win32')))).toHaveLength(1)
    expect(new Set(variants.map((cwd) => computeScopeKey(cwd, 'win32')))).toHaveLength(1)
  })

  it('keeps POSIX path case significant', () => {
    expect(workspaceIdentity('/work/Alpha', 'linux')).not.toBe(workspaceIdentity('/work/alpha', 'linux'))
  })

  it('retains resolved registry spelling separately from comparison identity', () => {
    expect(canonicalWorkspaceCwd('D:/Work/Alpha', 'win32')).toBe('D:\\Work\\Alpha')
    expect(workspaceIdentity('D:/Work/Alpha', 'win32')).toBe('d:\\work\\alpha')
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
