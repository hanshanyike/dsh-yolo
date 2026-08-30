import type Yolo from '../storage/index.ts'
import type { TodoIdentityReceiptsResponse } from '../contracts/identity.ts'
import { findKnownWorkspaceScope } from '../application/workspace-scope.ts'
import type { WebServerLike } from './dashboard.ts'

function send(
  res: { writeHead(status: number, headers: Record<string, string>): void; end(body?: string): void },
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(JSON.stringify(body))
}

function requestUrl(req: unknown): URL {
  const raw = (req as { url?: string } | undefined)?.url ?? '/yolo/identity-receipts'
  return new URL(raw, 'http://localhost')
}

/** Bounded receipt projection used only when one todo detail is open. */
export function registerIdentityReceiptsEndpoint(ctx: { webServer?: WebServerLike }, yolo: Yolo): void {
  ctx.webServer?.register({
    kind: 'prefix',
    path: '/yolo/identity-receipts',
    handler: (req, res) => {
      const method = ((req as { method?: string } | undefined)?.method ?? 'GET').toUpperCase()
      const url = requestUrl(req)
      if (method !== 'GET' || url.pathname !== '/yolo/identity-receipts') {
        send(res, 405, { error: 'method not allowed', code: 'method_not_allowed' })
        return
      }
      const todoId = url.searchParams.get('todo_id')?.trim()
      const scopeCwd = url.searchParams.get('scope_cwd')?.trim()
      if (!todoId || !scopeCwd) {
        send(res, 400, { error: 'todo_id and scope_cwd are required', code: 'invalid_identity_receipt_request' })
        return
      }
      const workspace = findKnownWorkspaceScope(scopeCwd, yolo.listWorkspaceMeta())
      if (!workspace) {
        send(res, 400, { error: 'unknown workspace scope', code: 'unknown_workspace_scope' })
        return
      }
      try {
        const response: TodoIdentityReceiptsResponse = {
          todo_id: todoId,
          scope_cwd: workspace.cwd,
          receipts: yolo.runInScope(workspace.cwd, workspace.scopeKey, () => (
            yolo.listTodoIdentityReceipts(workspace.cwd, todoId, 20)
          )),
        }
        send(res, 200, response)
      } catch (error) {
        send(res, 400, {
          error: error instanceof Error ? error.message : String(error),
          code: 'identity_receipt_request_failed',
        })
      }
    },
  })
}
