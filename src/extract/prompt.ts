// YOLO LLM extraction prompt (M7 + M8 + v0.3.2 scope) — semantic memory
// extraction for a MANAGING assistant, not a general-purpose memory engine.
// YOLO's job is "management, not execution": it must remember the COMMITMENTS,
// PLANS and RULES that let it keep an item on track and remind at the right
// time — not the user's profile, taste, or general knowledge.
// Replaces the old regex fast path: the model reads a whole turn and decides
// what is durable, following the industry pattern (Mem0 / Claude Code
// auto-memory): extract only what is worth remembering across sessions, never
// re-extract what is already stored, and normalize dates. M8 adds the
// "updates" array: state changes of KNOWN items (todo finished / started /
// cancelled, goal progress, due moves, milestone transitions).

export function buildExtractionPrompt(now: Date): string {
  const today = now.toISOString().slice(0, 10)
  return `You are the semantic memory extractor of a managing assistant (like a project manager who tracks commitments and deadlines). Your job: read one finished conversation turn between the user and the AI agent, and extract ONLY what helps this assistant MANAGE the user's commitments and plans across future sessions.

SCOPE DISCIPLINE (critical): this is NOT a general memory or personal-knowledge engine. A fact is only worth storing if it directly shapes how the assistant should TRACK, REMIND, or MANAGE a commitment/plan — otherwise it must be left out. Do not turn the user's life into a diary.

Current date: ${today} (use it to resolve relative dates like 明天/下周/next week into absolute dates).

Return ONLY JSON, no commentary, no markdown fence. Schema:

{
  "session_summary": string | null,
  "milestones": [{"title": string, "target_date": "YYYY-MM-DD" | null, "description": string | null}],
  "todos":      [{"title": string, "due_at": "YYYY-MM-DD" | null, "priority": "low|medium|high|urgent" | null, "milestone_title": string | null}],
  "goals":      [{"title": string, "description": string | null, "milestone_title": string | null}],
  "preferences":[{"key": string, "value": string}],
  "events":     [{"kind": "decision|milestone_reached", "summary": string, "occurred_at": "YYYY-MM-DD" | null}],
  "updates":    [
    {"kind": "todo",      "match_title": string, "status": "in_progress|done|cancelled" | null, "due_at": "YYYY-MM-DD" | null, "note": string | null},
    {"kind": "goal",      "match_title": string, "progress": 0-100},
    {"kind": "milestone", "match_title": string, "status": "active|done|abandoned"}
  ]
}

What to extract:
- session_summary: ONE line (<= 24 chars, user's language) naming what this session is about — e.g. "修复登录bug"、"写季度报告"、"聊产品方向". It labels the session as the source badge of daily ledger entries. Update it when the session's focus shifts; null only when the turn carries no hint of a topic.
- todos: NEW concrete commitments the user made, AND scheduled commitments with a date/time — meetings, trips, appointments, deliveries, deadlines someone must hit. (These are what YOLO reminds about.)
- goals: NEW long-term aims spanning days/weeks (not single-turn asks).
- milestones: NEW named project phases or checkpoints with target dates.
- preferences: ONLY rules that shape HOW YOLO tracks or reminds — e.g. reminder timing ("提前1小时提醒"), working hours ("工作日9-18别打扰"), per-project tracking rules ("这个项目每天跟进"). Store a short stable key (e.g. "reminder-ahead", "working-hours", "project:demo-track"). NEVER store personal taste, communication style, coding style, general facts, or the user's life details.
- events: decisions made ("we chose SQLite because ..."), milestone completions, and scheduled plans with dates (trips, launches) that belong on a timeline. NOT generic notes.
- updates: STATE CHANGES of items that already appear under "Known memories" below — the user finished / started / cancelled a todo, stated progress on a goal ("写了一半" → 50), moved a due date, or reached / abandoned a milestone. "match_title" must copy the Known memories title verbatim so the change lands on the right row.

What NOT to extract (these are out of scope for a managing assistant):
- Anything already listed under "Known memories" — UNLESS its state materially changed, which belongs in "updates", never in the new-item arrays.
- State changes of items NOT in Known memories — that is a new item, extract it in its own array instead.
- Transient chatter, greetings, one-off questions, debugging back-and-forth.
- Code specifics that live in files (paths, function names) unless they are a durable decision or convention.
- Anything the user explicitly asks to forget.
- Restatements of the same fact within the turn — one entry per fact.
- User facts/persona, preferences unrelated to tracking, general knowledge, lessons, taste, or life details. When in doubt, LEAVE IT OUT — a missed extract costs nothing, a wrong memory can trigger a wrong reminder.

Rules:
- Extract only explicit facts. Never invent or infer beyond what is stated.
- Write titles/summaries in the user's language, close to their own wording; do not paraphrase into English unless they wrote in English.
- Dates: absolute YYYY-MM-DD. No time component.
- Progress: an integer 0-100.
- If nothing is worth remembering, return all-empty arrays.
- Keep the JSON compact.`
}

/** Render the "already remembered" digest the model deduplicates against.
 * M8: rows carry their current state so the model can emit targeted updates. */
export function buildKnownContext(known: {
  todos: readonly { title: string; status: string; due_at?: string | null }[]
  goals: readonly { title: string; progress: number }[]
  milestones: readonly { title: string; status: string }[]
  preferences: readonly { key: string; value: string }[]
  events: readonly string[]
}): string | null {
  const lines: string[] = []
  if (known.todos.length) {
    lines.push(`Todos: ${known.todos.slice(0, 20).map((t) => `[${t.status}] ${t.title}${t.due_at ? ` (due ${t.due_at})` : ''}`).join(' | ')}`)
  }
  if (known.goals.length) lines.push(`Goals: ${known.goals.slice(0, 10).map((g) => `[${g.progress}%] ${g.title}`).join(' | ')}`)
  if (known.milestones.length) lines.push(`Milestones: ${known.milestones.slice(0, 10).map((m) => `[${m.status}] ${m.title}`).join(' | ')}`)
  if (known.preferences.length) {
    lines.push(`Preferences: ${known.preferences.slice(0, 20).map((p) => `${p.key}=${p.value}`).join(' | ')}`)
  }
  if (known.events.length) lines.push(`Recent events: ${known.events.slice(0, 15).join(' | ')}`)
  if (lines.length === 0) return null
  const text = lines.join('\n')
  // hard cap: the digest is a hint, not a payload
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text
}
