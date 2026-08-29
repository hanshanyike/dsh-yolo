-- YOLO storage schema (SQLite + FTS5)
-- Used by src/storage/db.ts on first open (idempotent — CREATE IF NOT EXISTS).
-- Scope: see scope.ts; scope_key = sha1(canonical cwd) + '/default'.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- scope metadata (single-row per scope db)
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- user profile (singleton row, id=1)
CREATE TABLE IF NOT EXISTS user_profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT,
  timezone     TEXT,                 -- IANA, e.g. Asia/Shanghai (drives reminder + ISO date)
  working_hours TEXT,                -- JSON { "start": "09:00", "end": "18:00" }
  traits       TEXT,                 -- JSON array of strings (learned preferences/style)
  updated_at   INTEGER NOT NULL
);

-- milestones
CREATE TABLE IF NOT EXISTS milestones (
  id          TEXT PRIMARY KEY,      -- ULID
  title       TEXT NOT NULL,
  description TEXT,
  target_date TEXT,                  -- ISO8601 date YYYY-MM-DD (nullable)
  status      TEXT NOT NULL DEFAULT 'planned',  -- planned|active|done|abandoned
  scope_key   TEXT NOT NULL,
  source      TEXT,                  -- rule|llm|tool|manual
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_date   ON milestones(target_date) WHERE target_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_milestones_status  ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestones_scope  ON milestones(scope_key);

-- todos
CREATE TABLE IF NOT EXISTS todos (
  id            TEXT PRIMARY KEY,    -- ULID
  title         TEXT NOT NULL,
  detail        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|in_progress|done|cancelled
  priority      TEXT,                -- low|medium|high|urgent
  due_at        TEXT,                -- ISO8601 datetime (nullable)
  milestone_id  TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  scope_key     TEXT NOT NULL,
  dedup_key     TEXT,                -- rule/llm dedup (see extract/merge.ts)
  source        TEXT,
  session_id    TEXT,                -- originating dsh session (ledger source badge, v0.3.0)
  source_excerpt TEXT,               -- bounded direct-user excerpt; never a full transcript
  source_turn   INTEGER,             -- originating host turn when known
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  last_reminded_at INTEGER,          -- reminder dedup stamp (M3)
  good_count    INTEGER NOT NULL DEFAULT 0,  -- v0.3.2 feedback: times the user completed it
  stale_count   INTEGER NOT NULL DEFAULT 0,  -- v0.3.2 feedback: times it was cancelled/abandoned
  record_status TEXT NOT NULL DEFAULT 'canonical', -- canonical|merged|rejected (independent of business status)
  merged_into_id TEXT                -- canonical todo id when record_status=merged
);
CREATE INDEX IF NOT EXISTS idx_todos_due      ON todos(due_at) WHERE due_at IS NOT NULL AND status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_todos_status   ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_dedup    ON todos(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_milestone ON todos(milestone_id);
CREATE INDEX IF NOT EXISTS idx_todos_scope   ON todos(scope_key);

-- Immutable provenance for every occurrence, mention and assistant/panel
-- action related to a todo. The legacy source columns on todos remain the
-- compatibility projection of its first origin evidence.
CREATE TABLE IF NOT EXISTS todo_evidence (
  id                 TEXT PRIMARY KEY,
  todo_id            TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  source_scope_key   TEXT NOT NULL,
  session_id         TEXT,
  turn_seq           INTEGER,
  source_kind        TEXT NOT NULL, -- human|assistant_action|panel_action|extraction
  relation           TEXT NOT NULL, -- origin|mention|update|correction|completion_claim|discussion
  excerpt            TEXT,
  occurred_at        INTEGER NOT NULL,
  source_fingerprint TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_todo_evidence_todo ON todo_evidence(todo_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS idx_todo_evidence_session ON todo_evidence(session_id, turn_seq) WHERE session_id IS NOT NULL;

-- goals
CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,     -- ULID
  title        TEXT NOT NULL,
  description  TEXT,
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status       TEXT NOT NULL DEFAULT 'active',  -- active|achieved|abandoned
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  scope_key    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_scope  ON goals(scope_key);

-- preferences (key-value, confidence-weighted)
CREATE TABLE IF NOT EXISTS preferences (
  id         TEXT PRIMARY KEY,       -- ULID
  key        TEXT NOT NULL,           -- e.g. coding_style, communication_lang
  value      TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  scope_key  TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  valid_at   INTEGER,                -- R14: becomes current at this epoch ms
  invalid_at INTEGER,                -- R14: superseded at this epoch ms (null = current)
  session_id TEXT,                   -- R14: originating dsh session (provenance)
  UNIQUE(key, scope_key)
);
CREATE INDEX IF NOT EXISTS idx_prefs_key   ON preferences(key);
CREATE INDEX IF NOT EXISTS idx_prefs_scope ON preferences(scope_key);

-- append-only provenance trail for superseded preferences (R14 evidence)
CREATE TABLE IF NOT EXISTS preference_history (
  id         TEXT PRIMARY KEY,       -- ULID
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  scope_key  TEXT NOT NULL,
  session_id TEXT,
  valid_at   INTEGER NOT NULL,
  invalid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prefhist_scope ON preference_history(scope_key);
CREATE INDEX IF NOT EXISTS idx_prefhist_key   ON preference_history(key);

-- timeline events (append-only; references source session)
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,      -- ULID
  kind        TEXT NOT NULL,         -- note|decision|milestone_reached|reminder_fired|...
  summary     TEXT NOT NULL,
  detail      TEXT,
  session_id  TEXT,                  -- originating dsh session (nullable)
  source      TEXT,                  -- llm|tool|manual (nullable; drives ledger labels)
  occurred_at INTEGER NOT NULL,
  scope_key   TEXT NOT NULL,
  subject_type TEXT,                 -- todo|goal|milestone; null for free-form/legacy events
  subject_id   TEXT,                 -- stable id, deliberately not an FK so deleted history survives
  subject_title TEXT,                -- title snapshot at event time
  related_subject_type TEXT,         -- second object for relations such as consolidate
  related_subject_id TEXT,
  related_subject_title TEXT,
  change_json TEXT                   -- structured field changes; summary remains display text
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope_key);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id) WHERE session_id IS NOT NULL;

-- one-line summary per originating session (ledger source badges, v0.3.0)
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,
  summary    TEXT NOT NULL,
  scope_key  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- notification delivery log + reminder handling state.
-- Seen means the delivery has been viewed; handled remains a separate reminder-domain state.
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,       -- ULID
  kind       TEXT NOT NULL,          -- reminder|brief
  title      TEXT NOT NULL,
  body       TEXT,                   -- brief markdown / reminder detail
  todo_id    TEXT,
  scope_cwd  TEXT,                   -- workspace the item belongs to (action routing)
  created_at INTEGER NOT NULL,
  seen_at    INTEGER,
  handled_at INTEGER,
  scope_key  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_open ON notifications(scope_key, handled_at);

-- Dashboard-v2 judgment trust state. A judgment version is immutable: when
-- evidence changes its fingerprint changes and the new judgment starts unseen.
CREATE TABLE IF NOT EXISTS attention_feedback (
  scope_key            TEXT NOT NULL,
  todo_id              TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  reason_version       TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  seen_at              INTEGER,
  suppressed_until     INTEGER,
  feedback_reason      TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  PRIMARY KEY(scope_key, todo_id, reason_version, evidence_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_attention_feedback_scope ON attention_feedback(scope_key, updated_at DESC);

-- Durable HTTP/model action idempotency. The request hash prevents a caller
-- from reusing one client_action_id for a different mutation after restart.
CREATE TABLE IF NOT EXISTS client_actions (
  scope_key       TEXT NOT NULL,
  client_action_id TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  outcome_json    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY(scope_key, client_action_id)
);
CREATE INDEX IF NOT EXISTS idx_client_actions_time ON client_actions(created_at DESC);

-- extraction audit log + dedup guard
CREATE TABLE IF NOT EXISTS extraction_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  turn_seq      INTEGER NOT NULL,    -- which turn within the session
  strategy      TEXT NOT NULL,      -- rule|llm
  status        TEXT NOT NULL,       -- ok|empty|error
  error         TEXT,
  extracted_json TEXT,              -- raw LLM JSON return (audit)
  token_in      INTEGER,
  token_out     INTEGER,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE(session_id, turn_seq, strategy)
);
CREATE INDEX IF NOT EXISTS idx_extlog_session ON extraction_log(session_id);

-- R1 shadow resolver observations. These rows are deliberately append-only
-- and have no domain-action columns: a shadow decision must never mutate a
-- todo until a later rollout explicitly promotes a safe decision class.
CREATE TABLE IF NOT EXISTS todo_resolution_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key         TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  turn_seq          INTEGER NOT NULL,
  operation_id      TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  input_excerpt     TEXT NOT NULL,
  resolver_version  TEXT NOT NULL,
  model_provider    TEXT NOT NULL,
  model_name        TEXT NOT NULL,
  status            TEXT NOT NULL,
  error             TEXT,
  candidates_json   TEXT NOT NULL,
  resolutions_json  TEXT NOT NULL,
  token_in          INTEGER,
  token_out         INTEGER,
  duration_ms       INTEGER,
  created_at        INTEGER NOT NULL,
  UNIQUE(session_id, turn_seq, resolver_version)
);
CREATE INDEX IF NOT EXISTS idx_todo_resolution_time ON todo_resolution_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_resolution_scope ON todo_resolution_log(scope_key, created_at DESC);

-- pending reminders queued while no active session (replayed on agent/session-start)
CREATE TABLE IF NOT EXISTS pending_reminders (
  id           TEXT PRIMARY KEY,     -- ULID
  todo_id      TEXT REFERENCES todos(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
  fire_at      INTEGER NOT NULL,
  payload      TEXT NOT NULL,        -- reminder text to inject
  scope_key    TEXT NOT NULL,
  session_hint TEXT                  -- preferred session to inject into (nullable)
);
CREATE INDEX IF NOT EXISTS idx_pending_fire ON pending_reminders(fire_at);

-- semantic-recall observability (v0.3.0): expansions/rerank/injection per assembly.
CREATE TABLE IF NOT EXISTS recall_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key     TEXT NOT NULL,
  session_id    TEXT,
  query         TEXT NOT NULL,
  expansions    TEXT,              -- JSON string[] of LLM-generated equivalent queries
  kept_keys     TEXT,              -- JSON string[] of injected row_type:row_id keys
  drop_reasons  TEXT,              -- JSON Record<key, reason>
  rerank_outcome TEXT,             -- JSON array of { key, keep, reason }
  latency_ms    INTEGER,
  source        TEXT NOT NULL,     -- user|system
  status        TEXT NOT NULL,     -- ok|empty|error
  error         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recall_time ON recall_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recall_scope ON recall_log(scope_key);
CREATE INDEX IF NOT EXISTS idx_recall_session ON recall_log(session_id) WHERE session_id IS NOT NULL;
-- FTS5 full-text index covering searchable text rows.
-- Verified on the supported Node 22/24 built-in SQLite runtimes (SQLite >= 3.34).
-- trigram gives good CJK recall for queries >= 3 chars. For 2-char queries trigram
-- falls back to substring scan (slower, may miss). M5 may switch to index-side bigram
-- if 2-char recall becomes a problem in practice.
CREATE VIRTUAL TABLE IF NOT EXISTS yolo_fts USING fts5(
  row_type,        -- todo|milestone|goal|preference|event
  row_id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);

-- Resolver-only index. Unlike yolo_fts, it intentionally retains completed,
-- cancelled and merged records so the candidate set can include terminal
-- occurrences and historical aliases without changing ordinary recall.
CREATE VIRTUAL TABLE IF NOT EXISTS todo_identity_fts USING fts5(
  record_id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);

-- triggers keep FTS in sync with row writes (one direction: row -> fts).
-- delete handled in repository.ts on update/delete to keep it explicit.
CREATE TRIGGER IF NOT EXISTS trg_todos_ai AFTER INSERT ON todos BEGIN
  INSERT INTO yolo_fts(row_type, row_id, title, body)
  VALUES ('todo', new.id, new.title, COALESCE(new.detail,''));
END;
CREATE TRIGGER IF NOT EXISTS trg_todo_identity_ai AFTER INSERT ON todos BEGIN
  INSERT INTO todo_identity_fts(record_id, title, body)
  VALUES (new.id, new.title, COALESCE(new.detail, ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_todo_identity_au AFTER UPDATE OF title, detail, record_status, merged_into_id ON todos BEGIN
  DELETE FROM todo_identity_fts WHERE record_id = old.id;
  INSERT INTO todo_identity_fts(record_id, title, body)
  SELECT new.id, new.title,
    trim(COALESCE(new.detail, '') || ' ' || COALESCE((
      SELECT group_concat(excerpt, ' ') FROM todo_evidence
      WHERE todo_id = new.id AND excerpt IS NOT NULL
    ), ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_todo_identity_ad AFTER DELETE ON todos BEGIN
  DELETE FROM todo_identity_fts WHERE record_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_milestones_ai AFTER INSERT ON milestones BEGIN
  INSERT INTO yolo_fts(row_type, row_id, title, body)
  VALUES ('milestone', new.id, new.title, COALESCE(new.description,''));
END;
CREATE TRIGGER IF NOT EXISTS trg_goals_ai AFTER INSERT ON goals BEGIN
  INSERT INTO yolo_fts(row_type, row_id, title, body)
  VALUES ('goal', new.id, new.title, COALESCE(new.description,''));
END;
CREATE TRIGGER IF NOT EXISTS trg_preferences_ai AFTER INSERT ON preferences BEGIN
  INSERT INTO yolo_fts(row_type, row_id, title, body)
  VALUES ('preference', new.id, new.key, new.value);
END;
CREATE TRIGGER IF NOT EXISTS trg_events_ai AFTER INSERT ON events BEGIN
  INSERT INTO yolo_fts(row_type, row_id, title, body)
  VALUES ('event', new.id, new.summary, COALESCE(new.detail,''));
END;
CREATE TRIGGER IF NOT EXISTS trg_todo_evidence_identity_ai AFTER INSERT ON todo_evidence BEGIN
  DELETE FROM todo_identity_fts WHERE record_id = new.todo_id;
  INSERT INTO todo_identity_fts(record_id, title, body)
  SELECT todos.id, todos.title,
    trim(COALESCE(todos.detail, '') || ' ' || COALESCE((
      SELECT group_concat(excerpt, ' ') FROM todo_evidence
      WHERE todo_id = todos.id AND excerpt IS NOT NULL
    ), ''))
  FROM todos WHERE todos.id = new.todo_id;
END;
