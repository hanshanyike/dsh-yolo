import { createHash } from 'node:crypto'
import { resolve, win32 } from 'node:path'

/** Stable application-level scope identity. Adapters may accept cwd for
 * compatibility, but application use cases resolve it to this type first. */
export type ScopeRef =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'user' }

/** Stable scope key for new user-level facts. Legacy `global` stores remain
 * readable through the storage compatibility API and are not a new ScopeRef. */
export const USER_SCOPE_KEY = 'user/default'

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

/** Workspace identity intentionally remains the existing cwd hash so schema,
 * HTTP rows and stored scope_key values do not need a destructive migration. */
export function computeScopeKey(cwd: string, platform: NodeJS.Platform = process.platform): string {
  const cwdHash = createHash('sha1').update(workspaceIdentity(cwd, platform)).digest('hex').slice(0, 12)
  return `${cwdHash}/default`
}

export function workspaceScopeRef(workspaceId: string): ScopeRef {
  const value = workspaceId.trim()
  if (!value) throw new Error('workspace id is required')
  return { kind: 'workspace', workspaceId: value }
}
