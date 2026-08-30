// YOLO scope resolution — determines which SQLite DB a workspace lives in.
// A workspace is identified only by its canonical cwd. Git is deliberately not
// part of the identity: many dsh sessions are not backed by a Git checkout, and
// switching branches must not split one plan into several stores.

import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import type { ScopeMode } from './types.ts'
export {
  canonicalWorkspaceCwd,
  computeScopeKey,
  workspaceIdentity,
  workspaceScopeRef,
  USER_SCOPE_KEY,
  type ScopeRef,
} from '../domain/scope.ts'

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
