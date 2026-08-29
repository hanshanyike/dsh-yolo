import { createHash } from 'node:crypto'
import { normalizeTitle } from './text.ts'

const FINGERPRINT_VERSION = 'todo-evidence-v1'

function digest(parts: readonly (string | number | null | undefined)[]): string {
  const canonical = parts.map((part) => part == null ? '' : String(part)).join('\u0000')
  return `${FINGERPRINT_VERSION}:${createHash('sha256').update(canonical).digest('hex')}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object' || value === null) return value
  const input = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]))
}

/** Stable request hash paired with an operation id. The operation id answers
 * "which call/turn", while this hash detects an accidental reuse with a
 * different payload. */
export function todoOperationRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function extractionTodoOperationId(sessionId: string, turn: number): string {
  return digest(['extract-operation', sessionId, turn])
}

/** One operation may legitimately touch several todos. Bind immutable evidence
 * to the resolved canonical id after identity resolution. */
export function todoEvidenceFingerprint(operationId: string, canonicalTodoId: string): string {
  return digest(['evidence', operationId, canonicalTodoId])
}

/** Stable identity for one todo candidate produced by one durable extraction turn.
 * The candidate index keeps two source observations distinct; occurrence
 * identity is a later resolver concern, so storage may still conservatively
 * collapse exact-title open candidates. The normalized title guards against a
 * reordered/different result being mistaken for the earlier candidate. */
export function extractionTodoFingerprint(
  sessionId: string,
  turn: number,
  candidateIndex: number,
  title: string,
): string {
  return digest(['extract', sessionId, turn, candidateIndex, normalizeTitle(title)])
}

/** Stable identity for one todo update observation from an extraction turn. */
export function extractionTodoUpdateFingerprint(
  sessionId: string,
  turn: number,
  candidateIndex: number,
  matchTitle: string,
): string {
  return digest(['extract-update', sessionId, turn, candidateIndex, normalizeTitle(matchTitle)])
}

/** Tool call ids are host-owned durable call identities. A retried tool call
 * therefore resolves to the same evidence and domain result. */
export function toolTodoFingerprint(sessionId: string | undefined, callId: string): string {
  return digest(['tool-write', sessionId ?? 'unknown-session', callId])
}

export function toolTodoActionId(sessionId: string | undefined, callId: string): string {
  return digest(['tool-action', sessionId ?? 'unknown-session', callId])
}
