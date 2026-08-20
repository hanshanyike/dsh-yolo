// YOLO LLM extraction prompt — asks the model to decompose a turn into strict JSON.

export const EXTRACTION_PROMPT = `You are the memory extractor of a personal assistant. From the conversation turn below, extract structured information that matters for long-term memory.

Return ONLY JSON, no commentary, no markdown fence. Schema:

{
  "milestones": [{"title": string, "target_date": "YYYY-MM-DD" | null, "description": string | null}],
  "todos":      [{"title": string, "due_at": "ISO8601 datetime" | null, "priority": "low|medium|high|urgent" | null, "milestone_title": string | null}],
  "goals":      [{"title": string, "description": string | null}],
  "preferences":[{"key": string, "value": string}],
  "events":     [{"kind": "note|decision|milestone_reached", "summary": string, "occurred_at": "ISO8601" | null}]
}

Rules:
- Extract only explicit facts. Never invent or infer beyond what is stated.
- Dates: normalize relative dates (明天/下周/本月底/tomorrow/next week) to ISO8601 using today's date as reference.
- If nothing is worth remembering, return {"milestones":[],"todos":[],"goals":[],"preferences":[],"events":[]}.
- Keep titles close to the user's own wording; do not paraphrase or rewrite.
`
