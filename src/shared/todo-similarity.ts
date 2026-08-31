import { normalizeTitle } from './text.ts'

export interface TodoSimilarity {
  score: number
  reason: string
}

const OCCURRENCE_MARKERS = /(?:下次|再做一次|再次|每(?:天|周|月|年)|第二次|新一轮|下一轮)/u

/** Lightweight fallback for manually-created todos. Model-derived semantic
 * suggestions come from the shadow resolver; this scorer only covers strong
 * lexical paraphrases and deliberately rejects occurrence mismatches. */
export function canonicalTodoTitle(title: string): string {
  return normalizeTitle(title)
    .replace(/\b(?:powerpoint|ppt)\b/gu, '演示稿')
    .replace(/(?:幻灯片|演示文稿)/gu, '演示稿')
    .replace(/(?:开发团队|开发小组|开发组|研发团队|研发小组|研发组|开发人员)/gu, '研发')
    .replace(/(?:发送给|发给|同步给|交给)/gu, '给')
    .replace(/(?:访谈记录|采访纪要)/gu, '访谈纪要')
    .replace(/^(?:请|提醒我|记得|我要|我得|需要)\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function bigrams(value: string): Set<string> {
  // Pure numeric runs (dates, ticket ids, fixture stamps) are distinguishing
  // fields, not semantic evidence. They must not inflate similarity.
  const chars = [...value.replace(/\d+/gu, '').replace(/\s+/gu, '')]
  if (chars.length < 2) return new Set(chars)
  return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`))
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0
  for (const value of left) if (right.has(value)) count++
  return count
}

/** Returns only high-similarity suggestions. A false negative is acceptable;
 * a noisy dashboard is not. The result is recommendation evidence, never
 * merge authorization. */
export function compareTodoTitles(leftTitle: string, rightTitle: string): TodoSimilarity | null {
  const left = canonicalTodoTitle(leftTitle)
  const right = canonicalTodoTitle(rightTitle)
  if (!left || !right || left === right) return left === right && left
    ? { score: 1, reason: '两个标题只有大小写、标点、空格或常见同义表达的差异。' }
    : null
  if (OCCURRENCE_MARKERS.test(left) !== OCCURRENCE_MARKERS.test(right)) return null

  const compactLeft = left.replace(/\d+/gu, '').replace(/\s+/gu, '')
  const compactRight = right.replace(/\d+/gu, '').replace(/\s+/gu, '')
  const shorter = compactLeft.length <= compactRight.length ? compactLeft : compactRight
  const longer = compactLeft.length > compactRight.length ? compactLeft : compactRight
  const containment = shorter.length >= 4 && longer.includes(shorter)

  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  const overlap = intersectionSize(leftPairs, rightPairs)
  const dice = leftPairs.size + rightPairs.size === 0 ? 0 : (2 * overlap) / (leftPairs.size + rightPairs.size)
  const coverage = Math.min(leftPairs.size, rightPairs.size) === 0 ? 0 : overlap / Math.min(leftPairs.size, rightPairs.size)
  const score = Math.min(0.99, Math.max(containment ? 0.82 : 0, dice * 0.7 + coverage * 0.3))
  if (score < 0.68) return null
  return {
    score: Math.round(score * 100) / 100,
    reason: containment
      ? '一个标题包含另一个标题的核心动作与对象，可能只是补充了限定信息。'
      : `两个标题的核心文字高度重合（相似度 ${Math.round(score * 100)}%）。`,
  }
}
