import type { UserMessage } from '@deepseek-ai/dsh-llm'

export interface CapturedHumanTurn {
  sessionId: string
  turn: number
  cwd: string
  acceptedAt: number
  messages: readonly UserMessage[]
}
interface MutableHumanTurn {
  cwd: string
  acceptedAt: number
  messages: UserMessage[]
  touchedAt: number
}

/**
 * Single runtime owner for cross-plugin session observations.
 *
 * The provider is owned by the `yolo` Cordis service. Consumers never keep a
 * competing latest-cwd/latest-user/turn counter. Mutations are idempotent so
 * host events observed more than once cannot double-count a turn.
 */
export class TurnObservationService {
  private latestCwdValue: string | undefined
  private latestUserTextValue = ''
  private readonly humanTurns = new Map<string, Map<number, MutableHumanTurn>>()
  private readonly stoppedTurns = new Set<string>()
  private completedTurnCountValue = 0
  private readonly maxSessions: number
  private readonly maxTurnsPerSession: number

  constructor(options: { maxSessions?: number; maxTurnsPerSession?: number } = {}) {
    this.maxSessions = options.maxSessions ?? 128
    this.maxTurnsPerSession = options.maxTurnsPerSession ?? 16
  }

  latestWorkspaceCwd(fallback = process.cwd()): string {
    return this.latestCwdValue ?? fallback
  }

  latestUserText(): string {
    return this.latestUserTextValue
  }

  completedTurnCount(): number {
    return this.completedTurnCountValue
  }

  observeSession(sessionId: string | undefined, cwd: string | undefined, internal: boolean): void {
    if (internal || !sessionId || !cwd) return
    this.latestCwdValue = cwd
  }

  observeUserMessage(sessionId: string | undefined, cwd: string | undefined, text: string, internal: boolean): void {
    if (internal || !sessionId) return
    if (cwd) this.latestCwdValue = cwd
    if (text.trim()) this.latestUserTextValue = text
  }

  observeTurnStopping(sessionId: string | undefined, turn: number, cwd: string | undefined, internal: boolean): number {
    if (internal || !sessionId) return this.completedTurnCountValue
    if (cwd) this.latestCwdValue = cwd
    const key = `${sessionId}:${turn}`
    if (!this.stoppedTurns.has(key)) {
      this.stoppedTurns.add(key)
      this.completedTurnCountValue++
      if (this.stoppedTurns.size > this.maxSessions * this.maxTurnsPerSession) {
        const oldest = this.stoppedTurns.values().next().value as string | undefined
        if (oldest) this.stoppedTurns.delete(oldest)
      }
    }
    return this.completedTurnCountValue
  }

  captureHumanTurn(
    sessionId: string,
    turn: number,
    cwd: string,
    messages: readonly UserMessage[],
    acceptedAt = Date.now(),
  ): void {
    const direct = messages.filter((message) => message.source?.kind === 'user')
    if (direct.length === 0) return
    this.latestCwdValue = cwd
    const turns = this.humanTurns.get(sessionId) ?? new Map<number, MutableHumanTurn>()
    const current = turns.get(turn)
    const byId = new Map((current?.messages ?? []).map((message) => [message.id, message]))
    for (const message of direct) if (!byId.has(message.id)) byId.set(message.id, message)
    turns.set(turn, {
      cwd,
      acceptedAt: current?.acceptedAt ?? acceptedAt,
      messages: [...byId.values()],
      touchedAt: Date.now(),
    })
    while (turns.size > this.maxTurnsPerSession) turns.delete(turns.keys().next().value as number)
    this.humanTurns.delete(sessionId)
    this.humanTurns.set(sessionId, turns)
    while (this.humanTurns.size > this.maxSessions) this.humanTurns.delete(this.humanTurns.keys().next().value as string)
  }

  peekHumanTurn(sessionId: string, turn: number): CapturedHumanTurn | undefined {
    const item = this.humanTurns.get(sessionId)?.get(turn)
    return item ? { sessionId, turn, cwd: item.cwd, acceptedAt: item.acceptedAt, messages: [...item.messages] } : undefined
  }

  takeHumanTurn(sessionId: string, turn: number): CapturedHumanTurn | undefined {
    const item = this.peekHumanTurn(sessionId, turn)
    this.discardHumanTurn(sessionId, turn)
    return item
  }

  discardHumanTurn(sessionId: string, turn: number): void {
    const turns = this.humanTurns.get(sessionId)
    turns?.delete(turn)
    if (turns?.size === 0) this.humanTurns.delete(sessionId)
    this.stoppedTurns.delete(`${sessionId}:${turn}`)
  }

  clear(): void {
    this.latestCwdValue = undefined
    this.latestUserTextValue = ''
    this.humanTurns.clear()
    this.stoppedTurns.clear()
    this.completedTurnCountValue = 0
  }
}
