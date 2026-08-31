import type { ExtractionResult } from '../../contracts/extraction.ts'
import type {
  TodoIdentityCandidate,
  TodoResolutionDecision,
  TodoResolutionPrediction,
} from '../../domain/types.ts'

export const TODO_IDENTITY_POLICY_VERSION = 'r2a-v1'
export const TODO_IDENTITY_MIN_CONFIDENCE = 0.98

export type TodoIdentityPolicyMode = 'fallback' | 'create' | 'authorized' | 'blocked'

export interface TodoIdentityApplicationPlan {
  policy_version: typeof TODO_IDENTITY_POLICY_VERSION
  mode: TodoIdentityPolicyMode
  decision?: TodoResolutionDecision
  candidate_id?: string
  confidence?: number | null
  reason: string
}

const OPEN_STATUSES = new Set(['pending', 'in_progress'])

function plan(
  mode: TodoIdentityPolicyMode,
  reason: string,
  prediction?: TodoResolutionPrediction,
  candidateId?: string,
): TodoIdentityApplicationPlan {
  return {
    policy_version: TODO_IDENTITY_POLICY_VERSION,
    mode,
    ...(prediction ? { decision: prediction.decision, confidence: prediction.confidence ?? null } : {}),
    ...(candidateId ? { candidate_id: candidateId } : {}),
    reason,
  }
}

/** Decide whether an observational resolver result may control todo writes.
 *
 * The classifier never authorizes itself. R2a deliberately supports one todo
 * mention at a time: a single prediction, at most one extracted todo mutation,
 * one same-workspace open canonical candidate, and only LINK/UPDATE. Terminal,
 * occurrence, step and ambiguous decisions stay blocked for later stages.
 * Resolver failure/empty output falls back to the pre-R2 extraction path so an
 * auxiliary-model outage cannot make ordinary capture unavailable. */
export function planTodoIdentityApplication(
  result: ExtractionResult,
  predictions: readonly TodoResolutionPrediction[],
  candidates: readonly TodoIdentityCandidate[],
  enabled = false,
): TodoIdentityApplicationPlan {
  if (!enabled) return plan('fallback', 'policy_disabled')
  if (predictions.length === 0) return plan('fallback', 'resolver_empty')
  if (predictions.length !== 1) return plan('blocked', 'multiple_resolutions')

  const prediction = predictions[0]
  const todoUpdates = result.updates.filter((update) => update.kind === 'todo')
  const todoMutationCount = result.todos.length + todoUpdates.length

  if (prediction.decision === 'CREATE') {
    if (prediction.candidate_ids.length !== 0) return plan('blocked', 'create_referenced_candidate', prediction)
    if (result.todos.length !== 1 || todoUpdates.length !== 0) return plan('blocked', 'create_shape_ambiguous', prediction)
    return plan('create', 'independent_single_create', prediction)
  }

  if (prediction.decision !== 'LINK' && prediction.decision !== 'UPDATE') {
    return plan('blocked', `decision_not_authorized:${prediction.decision}`, prediction)
  }
  if ((prediction.confidence ?? 0) < TODO_IDENTITY_MIN_CONFIDENCE) {
    return plan('blocked', 'confidence_below_threshold', prediction)
  }
  if (prediction.candidate_ids.length !== 1) {
    return plan('blocked', 'candidate_not_unique', prediction)
  }
  const candidateId = prediction.candidate_ids[0]
  const candidate = candidates.find((row) => row.id === candidateId)
  if (!candidate) return plan('blocked', 'candidate_not_in_snapshot', prediction)
  if (candidate.match_source === 'similarity') {
    return plan('blocked', 'candidate_recall_not_r2_safe', prediction, candidateId)
  }
  if (!OPEN_STATUSES.has(candidate.status)) {
    return plan('blocked', 'candidate_not_open', prediction, candidateId)
  }
  if (todoMutationCount > 1) {
    return plan('blocked', 'todo_mutation_shape_ambiguous', prediction, candidateId)
  }
  if (prediction.decision === 'LINK' && todoUpdates.length > 0) {
    return plan('blocked', 'link_conflicts_with_extracted_update', prediction, candidateId)
  }
  if (prediction.decision === 'LINK' && result.todos.some((todo) => todo.due_at != null || todo.priority != null)) {
    return plan('blocked', 'link_conflicts_with_extracted_fields', prediction, candidateId)
  }
  if (prediction.decision === 'UPDATE' && todoMutationCount !== 1) {
    return plan('blocked', 'update_shape_missing', prediction, candidateId)
  }
  if (prediction.decision === 'UPDATE') {
    const update = todoUpdates[0]
    const extracted = result.todos[0]
    if (update && (update.status != null || update.due_at == null)) {
      return plan('blocked', 'update_field_not_authorized', prediction, candidateId)
    }
    if (extracted && (extracted.due_at == null || extracted.priority != null)) {
      return plan('blocked', 'update_field_not_authorized', prediction, candidateId)
    }
  }

  return plan('authorized', prediction.decision === 'LINK' ? 'safe_single_link' : 'safe_single_update', prediction, candidateId)
}
