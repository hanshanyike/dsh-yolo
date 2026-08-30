import {
  YoloChatThreads,
  YoloSessions,
  type AgentsLike,
  type SessionLogger,
} from '../application/conversation/index.ts'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'

export interface ConversationRuntimeHandle {
  sessions: YoloSessions
  threads: YoloChatThreads
}
/** Single owner of YOLO-created dsh Agent handles across UI and reminder. */
export class ConversationRuntime {
  private handle: ConversationRuntimeHandle | undefined

  get(
    agents: AgentsLike | undefined,
    logger?: SessionLogger,
    defaultModelSelection?: () => ModelSelection | undefined,
  ): ConversationRuntimeHandle {
    if (!this.handle) {
      this.handle = {
        sessions: new YoloSessions(agents, logger, defaultModelSelection),
        threads: new YoloChatThreads(agents, logger, defaultModelSelection),
      }
    }
    return this.handle
  }
}
