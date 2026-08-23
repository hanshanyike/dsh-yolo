export interface ChatMessage {
  role: 'user' | 'ai'
  text: string
}

export type PendingReplyState =
  | { phase: 'idle' }
  | {
      phase: 'posting' | 'awaiting_reply'
      assistantCountAtSend: number
      messageCountAtSend: number
      userText: string
      messagesBeforeSend: readonly ChatMessage[]
    }

export type ActivePendingReplyState = Extract<PendingReplyState, { phase: 'posting' | 'awaiting_reply' }>

export type PendingReplyEvent =
  | { type: 'send_started'; messages: readonly ChatMessage[]; userText: string }
  | { type: 'post_succeeded' }
  | { type: 'messages_observed'; messages: readonly ChatMessage[] }
  | { type: 'failed' }
  | { type: 'reset' }

export const IDLE_PENDING_REPLY: PendingReplyState = { phase: 'idle' }

function assistantCount(messages: readonly ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === 'ai' ? 1 : 0), 0)
}

export function isReplyPending(state: PendingReplyState): state is ActivePendingReplyState {
  return state.phase !== 'idle'
}

/**
 * Pure pending-reply state machine. POST success only changes the phase; it
 * never completes the send. Completion requires observing an assistant line
 * beyond the transcript baseline captured when the user sent the message.
 */
export function reducePendingReply(
  state: PendingReplyState,
  event: PendingReplyEvent,
): PendingReplyState {
  switch (event.type) {
    case 'send_started':
      if (isReplyPending(state)) return state
      return {
        phase: 'posting',
        assistantCountAtSend: assistantCount(event.messages),
        messageCountAtSend: event.messages.length,
        userText: event.userText,
        messagesBeforeSend: [...event.messages],
      }
    case 'post_succeeded':
      return state.phase === 'posting' ? { ...state, phase: 'awaiting_reply' } : state
    case 'messages_observed':
      if (!isReplyPending(state)) return state
      return assistantCount(event.messages) > state.assistantCountAtSend
        ? IDLE_PENDING_REPLY
        : state
    case 'failed':
    case 'reset':
      return IDLE_PENDING_REPLY
  }
}

/** Keep the optimistic user bubble visible until the server transcript has it. */
export function mergeRemoteMessages(
  remote: readonly ChatMessage[],
  pending: PendingReplyState,
): ChatMessage[] {
  if (!isReplyPending(pending)) return [...remote]
  const remoteTail = remote.slice(pending.messageCountAtSend)
  const hasSentUser = remoteTail.some((message) => message.role === 'user' && message.text === pending.userText)
  return hasSentUser ? [...remote] : [...remote, { role: 'user', text: pending.userText }]
}

export function messagesBeforePendingReply(state: PendingReplyState): ChatMessage[] | null {
  return isReplyPending(state) ? [...state.messagesBeforeSend] : null
}
