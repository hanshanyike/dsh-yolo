import { describe, expect, it, vi } from 'vitest'
import type Yolo from '../src/storage/index.ts'
import { registerIdentityReceiptsEndpoint } from '../src/ui/identity.ts'

function response() {
  return { writeHead: vi.fn(), end: vi.fn() }
}

describe('GET /yolo/identity-receipts', () => {
  it('routes by registered workspace and returns only the requested todo receipts', () => {
    const register = vi.fn()
    const receipts = [{ resolution_id: 7, todo_id: 'todo-1', decision: 'LINK' }]
    const yolo = {
      listWorkspaceMeta: () => [{ cwd: 'D:\\Work\\Alpha', scopeKey: 'alpha/default', workspaceId: 'ws-alpha' }],
      runInScope: (_cwd: string, _scope: string, execute: () => unknown) => execute(),
      listTodoIdentityReceipts: vi.fn(() => receipts),
    } as unknown as Yolo
    registerIdentityReceiptsEndpoint({ webServer: { register } }, yolo)
    const handler = register.mock.calls[0][0].handler as (req: unknown, res: ReturnType<typeof response>) => void
    const res = response()
    handler({ method: 'GET', url: '/yolo/identity-receipts?todo_id=todo-1&scope_cwd=d%3A%2Fwork%2Falpha' }, res)

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
      todo_id: 'todo-1', scope_cwd: 'D:\\Work\\Alpha', receipts,
    })
    expect(yolo.listTodoIdentityReceipts).toHaveBeenCalledWith('D:\\Work\\Alpha', 'todo-1', 20)
  })

  it('rejects missing parameters and unknown workspaces', () => {
    const register = vi.fn()
    const yolo = { listWorkspaceMeta: () => [] } as unknown as Yolo
    registerIdentityReceiptsEndpoint({ webServer: { register } }, yolo)
    const handler = register.mock.calls[0][0].handler as (req: unknown, res: ReturnType<typeof response>) => void

    const missing = response()
    handler({ method: 'GET', url: '/yolo/identity-receipts' }, missing)
    expect(missing.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(JSON.parse(missing.end.mock.calls[0][0]).code).toBe('invalid_identity_receipt_request')

    const unknown = response()
    handler({ method: 'GET', url: '/yolo/identity-receipts?todo_id=todo-1&scope_cwd=D%3A%2Fmissing' }, unknown)
    expect(unknown.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(JSON.parse(unknown.end.mock.calls[0][0]).code).toBe('unknown_workspace_scope')
  })
})
