// YOLO scope resolution — determines which SQLite DB a workspace lives in.
// A workspace is identified only by its canonical cwd. Git is deliberately not
// part of the identity: many dsh sessions are not backed by a Git checkout, and
// switching branches must not split one plan into several stores.

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { resolve, join, win32 } from 'node:path'
import type { ScopeMode } from './types.ts'

/** Canonical filesystem identity. Windows paths compare case-insensitively. */
export function workspaceIdentity(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const value = cwd.trim()
  if (!value || value.includes('\u0000')) throw new Error('invalid workspace cwd')
  if (platform === 'win32') return win32.resolve(value.replaceAll('/', '\\')).toLowerCase()
  return resolve(value)
}

/** Resolved cwd spelling retained for payloads and session metadata. */
export function canonicalWorkspaceCwd(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const value = cwd.trim()
  if (!value || value.includes('\u0000')) throw new Error('invalid workspace cwd')
  return platform === 'win32' ? win32.resolve(value.replaceAll('/', '\\')) : resolve(value)
}

/** Compute the stable cwd-only scope key. `/default` preserves non-Git legacy stores. */
export function computeScopeKey(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const cwdHash = createHash('sha1').update(workspaceIdentity(cwd, platform)).digest('hex').slice(0, 12)
  return `${cwdHash}/default`
}

/** Resolve the directory holding the DB + snapshots for a scope mode + cwd. */
export function resolveDataDir(mode: ScopeMode, cwd: string): string {
  switch (mode) {
    case 'workspace':
      // <cwd>/.dsh/yolo/ — keeps each project's memory self-contained
      return join(resolve(cwd), '.dsh', 'yolo')
    case 'user':
      // ~/.dsh/yolo/ — cross-project personal memory
      return join(homedir(), '.dsh', 'yolo')
    case 'global':
      return join(homedir(), '.dsh', 'yolo', 'global')
  }
}

/** DB filename for a scope key (sanitized). */
export function dbFileName(scopeKey: string): string {
  return `yolo-${scopeKey.replace(/[\\/]/g, '_')}.db`
}
