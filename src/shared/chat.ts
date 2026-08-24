export interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

export type ChatRequestStatus = 'accepted' | 'completed' | 'failed' | 'stale'

export interface ChatRequestSnapshot {
  request_id: string
  client_request_id: string
  status: ChatRequestStatus
  text: string
  accepted_at: number
  updated_at: number
  revision: number
  error?: string
}

export interface ChatMessagesPayload {
  ok: boolean
  messages: ChatMessage[]
  request: ChatRequestSnapshot | null
  revision: number
  error?: string
}

export function isActiveChatRequest(request: ChatRequestSnapshot | null | undefined): boolean {
  return request?.status === 'accepted' || request?.status === 'stale'
}
