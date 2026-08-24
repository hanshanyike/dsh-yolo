export const CHAT_NEAR_BOTTOM_PX = 48

export interface ChatScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function isNearChatBottom(
  metrics: ChatScrollMetrics,
  thresholdPx = CHAT_NEAR_BOTTOM_PX,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= Math.max(0, thresholdPx)
}

export type ChatScrollDecision = 'follow' | 'notify' | 'none'

/** Decide after a semantic transcript change, before mutating scrollTop. */
export function decideChatScroll(input: {
  initial: boolean
  contentChanged: boolean
  wasNearBottom: boolean
}): ChatScrollDecision {
  if (!input.contentChanged && !input.initial) return 'none'
  if (input.initial || input.wasNearBottom) return 'follow'
  return 'notify'
}
