// YOLO extraction write-quality gate (v0.3.2, borrowed from the dsh-mneme
// quality-filter idea, trimmed to the two failure modes that matter here).
//
// A managing assistant's memory is commitments + plans + rules. The LLM is the
// primary judge, but two classes of junk still slip through and are worth a
// deterministic cheap check before they land in storage — because a WRONG
// memory can trigger a WRONG reminder (worse than no memory):
//   1. acknowledgement noise ("好的 / 收到 / ok") that is not a commitment;
//   2. bare meta commands ("记住这个 / 记录下来") that are self-referential,
//      not an actual task.
// This is deliberately CONSERVATIVE: it only drops clear junk. Everything else
// passes through to the model's judgment in src/extract/prompt.ts.

/** Normalize a short label for comparison (trim + lowercase, CJK-safe). */
function norm(s: string): string {
  return s.trim().toLowerCase()
}

/** Acknowledgements — a reply formality, not a commitment. */
const ACK = new Set([
  '好的', '收到', 'ok', '好', '嗯', '知道了', '行', '没问题', '可以', '可以呀', '了解',
  '好的收到', '好的,收到', '收到谢谢', '收到了', '好的没问题', '👌', 'done', 'okay',
])

/** Bare meta commands that reference the memory system, not a real task. */
const META = new Set([
  '记住', '记住这个', '记住了', '记录下来', '记一下', '记一下这个', '记得', '备注', '记得记下',
])

/** True when an extracted item is clearly junk and must not be stored. */
export function shouldDropExtracted(
  kind: 'todo' | 'milestone' | 'goal' | 'preference' | 'event',
  title: string,
  value?: string | null,
): boolean {
  const t = (title ?? '').trim()
  if (!t) return true
  const n = norm(t)
  if (ACK.has(n)) return true
  if (META.has(n)) return true
  // a single char cannot carry a real commitment/rule (e.g. "a", "A", "中")
  if ([...t].length < 2) return true
  if (kind === 'preference') {
    // a tracking RULE must name a key and carry a non-empty value
    if (n.length < 2) return true
    if (!(value ?? '').trim()) return true
  }
  return false
}
