// YOLO scope resolution — determines which SQLite DB a memory item lives in.
// Mirrors dsh-memory-evolve: scope_key = sha1(cwd) + '/' + (git branch or 'default').
// This keeps work-contexts separate (two projects don't share todos).

import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve, posix, join, sep } from 'node:path'
import type { ScopeMode } from './types.ts'

/** Compute a stable scope_key for the given directory. */
export function computeScopeKey(cwd: string): string {
  const cwdHash = createHash('sha1').update(cwd).digest('hex').slice(0, 12)
  const branch = currentGitBranch(cwd)
  return `${cwdHash}/${branch ?? 'default'}`
}

/** Best-effort current git branch name; null if not a git repo / git unavailable. */
export function currentGitBranch(cwd: string): string | null {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      encoding: 'utf8',
    }).trim()
    return out && out !== 'HEAD' ? out : null
  } catch {
    return null
  }
}

/** Resolve the directory holding the DB + snapshots for a scope mode + scope key. */
export function resolveDataDir(mode: ScopeMode, cwd: string, scopeKey: string): string {
  // sanitize scopeKey for filesystem (replace / with _)
  const safe = scopeKey.replace(/[\\/]/g, '_')
  switch (mode) {
    case 'workspace':
      // <cwd>/.dsh/yolo/ — keeps each project's memory self-contained
      return join(resolve(cwd), '.dsh', 'yolo')
    case 'user':
      // ~/.dsh/yolo/ — cross-project personal memory
      return join(homedir(), '.dsh', 'yolo')
    case 'global':
      return join(homedir(), '.dsh', 'yolo', 'global')
    default: {
      // exhaustive fallback
      const _exhaustive: never = mode
      return join(homedir(), '.dsh', 'yolo', safe ?? String(_exhaustive))
    }
  }
}

/** DB filename for a scope key (sanitized). */
export function dbFileName(scopeKey: string): string {
  return `yolo-${scopeKey.replace(/[\\/]/g, '_')}.db`
}

/** Normalize a path to posix forward-slashes (Windows-safe for SQLite + tsx). */
export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

// re-export posix join for callers that build URLs/paths
export const posixJoin = posix.join
