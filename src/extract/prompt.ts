// YOLO LLM extraction prompt (M7) — semantic memory extraction for a coding
// agent. Replaces the old regex fast path: the model reads a whole turn and
// decides what is durable knowledge, following the industry pattern (Mem0 /
// Claude Code auto-memory): extract only what is worth remembering across
// sessions, never re-extract what is already stored, and normalize dates.

export function buildExtractionPrompt(now: Date): string {
  const today = now.toISOString().slice(0, 10)
  return `You are the semantic memory extractor of a coding assistant (like Claude Code's auto-memory). Your job: read one finished conversation turn between the user and the AI agent, and extract ONLY the durable knowledge worth remembering across future sessions.

Current date: ${today} (use it to resolve relative dates like 明天/下周/next week into absolute dates).

Return ONLY JSON, no commentary, no markdown fence. Schema:

{
  "milestones": [{"title": string, "target_date": "YYYY-MM-DD" | null, "description": string | null}],
  "todos":      [{"title": string, "due_at": "YYYY-MM-DD" | null, "priority": "low|medium|high|urgent" | null, "milestone_title": string | null}],
  "goals":      [{"title": string, "description": string | null}],
  "preferences":[{"key": string, "value": string}],
  "events":     [{"kind": "note|decision|milestone_reached", "summary": string, "occurred_at": "YYYY-MM-DD" | null}]
}

What to extract:
- todos: concrete tasks the user committed to, AND scheduled commitments with a date/time — meetings, trips, appointments, deliveries, deadlines someone must hit.
- goals: what the user is trying to achieve over days/weeks (not single-turn asks).
- milestones: named project phases or checkpoints with target dates.
- preferences: durable user preferences — reply language, code style, workflow habits, tool choices, communication style. Key should be a short stable slug (e.g. "reply-language"); value the preference itself.
- events: decisions made ("we chose SQLite because ..."), milestone completions, scheduled plans with dates (trips, launches), and other timeline-worthy facts.

What NOT to extract:
- Anything already listed under "Known memories" below — unless its state materially changed (then extract it again with updated fields).
- Transient chatter, greetings, one-off questions, debugging back-and-forth.
- Code specifics that live in files (paths, function names) unless they are a durable decision or convention.
- Anything the user explicitly asks to forget.
- Restatements of the same fact within the turn — one entry per fact.

Rules:
- Extract only explicit facts. Never invent or infer beyond what is stated.
- Write titles/summaries in the user's language, close to their own wording; do not paraphrase into English unless they wrote in English.
- Dates: absolute YYYY-MM-DD. No time component.
- If nothing is worth remembering, return all-empty arrays.
- Keep the JSON compact.`
}

/** Render the "already remembered" digest the model deduplicates against. */
export function buildKnownContext(known: {
  todos: readonly string[]
  goals: readonly string[]
  milestones: readonly string[]
  preferences: readonly { key: string; value: string }[]
  events: readonly string[]
}): string | null {
  const lines: string[] = []
  if (known.todos.length) lines.push(`Todos: ${known.todos.slice(0, 20).join(' | ')}`)
  if (known.goals.length) lines.push(`Goals: ${known.goals.slice(0, 10).join(' | ')}`)
  if (known.milestones.length) lines.push(`Milestones: ${known.milestones.slice(0, 10).join(' | ')}`)
  if (known.preferences.length) {
    lines.push(`Preferences: ${known.preferences.slice(0, 20).map((p) => `${p.key}=${p.value}`).join(' | ')}`)
  }
  if (known.events.length) lines.push(`Recent events: ${known.events.slice(0, 15).join(' | ')}`)
  if (lines.length === 0) return null
  const text = lines.join('\n')
  // hard cap: the digest is a hint, not a payload
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text
}
