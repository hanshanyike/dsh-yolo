import { canonicalWorkspaceCwd, workspaceIdentity } from '../domain/scope.ts'

export interface WorkspaceScopeMeta {
  cwd: string
  scopeKey: string
}

/** Lexical workspace identity used to compare an explicit browser scope with
 * the storage registry. Windows paths are case-insensitive; other platforms
 * retain their native case-sensitive behavior. */
export function normalizeWorkspaceCwd(cwd: string): string | undefined {
  try {
    return workspaceIdentity(cwd)
  } catch {
    return undefined
  }
}

/** Registry spelling used in payloads; identity comparisons remain canonical. */
export function resolvedWorkspaceCwd(cwd: string): string | undefined {
  try {
    return canonicalWorkspaceCwd(cwd)
  } catch {
    return undefined
  }
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
