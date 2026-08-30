/** @deprecated Compatibility facade; commands and DTOs have stable owners. */
export { applyYoloAction, hashYoloActionRequest } from '../application/commands/apply-yolo-action.ts'
export type {
  AttentionFeedbackReason,
  YoloActionOutcome,
  YoloActionRequest,
  YoloLearningReceipt,
  YoloUndoDescriptor,
} from '../contracts/actions.ts'
