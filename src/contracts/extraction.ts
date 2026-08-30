export interface ExtractedTodo {
  title: string
  due_at?: string | null
  priority?: string | null
  milestone_title?: string | null
}
export interface ExtractedMilestone {
  title: string
  target_date?: string | null
  description?: string | null
}
export interface ExtractedGoal {
  title: string
  description?: string | null
  milestone_title?: string | null
}
export interface ExtractedPreference {
  key: string
  value: string
}
export interface ExtractedEvent {
  kind: 'note' | 'decision' | 'milestone_reached'
  summary: string
  occurred_at?: string | null
}
export interface ExtractedUpdate {
  kind: 'todo' | 'goal' | 'milestone'
  match_title: string
  status?: string | null
  progress?: number | null
  due_at?: string | null
  note?: string | null
}

export interface ExtractionResult {
  session_summary?: string | null
  milestones: ExtractedMilestone[]
  todos: ExtractedTodo[]
  goals: ExtractedGoal[]
  preferences: ExtractedPreference[]
  events: ExtractedEvent[]
  updates: ExtractedUpdate[]
}
