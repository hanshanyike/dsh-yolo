/** Bounded projection supplied to semantic extraction for dedup/update targeting. */
export function buildKnownContext(known: {
  todos: readonly { title: string; status: string; due_at?: string | null }[]
  goals: readonly { title: string; progress: number }[]
  milestones: readonly { title: string; status: string }[]
  preferences: readonly { key: string; value: string }[]
  events: readonly string[]
}): string | null {
  const lines: string[] = []
  if (known.todos.length) {
    lines.push(`Todos: ${known.todos.slice(0, 20).map((todo) => `[${todo.status}] ${todo.title}${todo.due_at ? ` (due ${todo.due_at})` : ''}`).join(' | ')}`)
  }
  if (known.goals.length) lines.push(`Goals: ${known.goals.slice(0, 10).map((goal) => `[${goal.progress}%] ${goal.title}`).join(' | ')}`)
  if (known.milestones.length) lines.push(`Milestones: ${known.milestones.slice(0, 10).map((milestone) => `[${milestone.status}] ${milestone.title}`).join(' | ')}`)
  if (known.preferences.length) {
    lines.push(`Preferences: ${known.preferences.slice(0, 20).map((preference) => `${preference.key}=${preference.value}`).join(' | ')}`)
  }
  if (known.events.length) lines.push(`Recent events: ${known.events.slice(0, 15).join(' | ')}`)
  if (lines.length === 0) return null
  const text = lines.join('\n')
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text
}
