import { resolve } from 'node:path'

export interface WorkspaceScopeMeta {
  cwd: string
  scopeKey: string
}

/** Lexical workspace identity used to compare an explicit browser scope with
 * the storage registry. Windows paths are case-insensitive; other platforms
 * retain their native case-sensitive behavior. */
export function normalizeWorkspaceCwd(cwd: string): string | undefined {
  const value = cwd.trim()
  if (!value || value.includes('\u0000')) return undefined
  const normalized = resolve(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Return the registry-owned cwd/scope pair, never the untrusted spelling from
 * the request. This prevents explicit chat scopes from creating ghost stores. */
export function findKnownWorkspaceScope(
  requestedCwd: string,
  workspaces: readonly WorkspaceScopeMeta[],
): WorkspaceScopeMeta | undefined {
  const requested = normalizeWorkspaceCwd(requestedCwd)
  if (!requested) return undefined
  return workspaces.find((workspace) => normalizeWorkspaceCwd(workspace.cwd) === requested)
}
