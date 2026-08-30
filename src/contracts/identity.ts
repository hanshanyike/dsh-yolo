import type { TodoIdentityReceipt } from '../domain/types.ts'

export interface TodoIdentityReceiptsResponse {
  todo_id: string
  scope_cwd: string
  receipts: TodoIdentityReceipt[]
}
