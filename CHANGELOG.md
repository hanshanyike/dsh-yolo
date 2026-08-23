# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> The user-feedback drop — maps to the `0.3.3` line per `docs/release.md`.

### Added — E2E 测试治理（test/e2e-standardization）

- **E2E 从 21.3 分钟（3 failed + 2 flaky）降到 ~67 秒全绿**（17 用例，含宿主拉起；
  同机实测）。根因与证据记录在 [docs/testing-e2e.md](docs/testing-e2e.md) 第四节。
- **api/ui 两个测试套件（按测试分层拆分）**：`tests/e2e/{api,ui}/`，
  `node scripts/e2e.mjs --suite api|ui`——api 套件为 HTTP 接口测试
  （无浏览器、秒级反馈）；`--spec` 支持 `--spec panel-flow` 空格形式。
- **性能修复 `perf(storage)`**：scope key 按 TTL 记忆化 —— 此前一次
  `GET /yolo/dashboard` 会孵化 ~15 个 `git rev-parse` 子进程（~3s，实测 15 次 = 2985ms），
  侧栏角标 30s 轮询与提醒调度器 tick 同样受益。
- **runner 修复**：bring-up 改为全局 dsh 优先（本地 host checkout 撞凭证格式差异会启动失败，
  AGENTS.md 早有警告）；不再对已捆绑插件的 profile 打 runtime patch（duplicate loader entry id）
  ；Windows 下按整棵进程树击杀宿主（此前 node 孙进程变孤儿占端口）；健康探测超时
  提到 15s；拉起前自动 DB 级清扫 `[E2E]` 夹具（此前靠手工跑 clean-test-data）。
- **夹具按 id 追踪清理**（`createFixtures`）：替代每个 test 前后两次全量看板扫描；
  角标用例改为「先种卡后开页」，去掉最长 45s 的轮询硬等。
- **文档**：新增 docs/testing-e2e.md（场景×用例矩阵、根因记录、agent 运行手册）；
  testing.md 单测清单修正为 29 文件/324 用例；README/usage/CONTRIBUTING/architecture
  中残留的 `dev:web*`/`dev.mjs` 死引用全部改指标准 dsh 流程。
### Fixed — v0.3.3 评审收敛（工作区归属 / 聚合看板 / 交互细节）

> 全量发现与证据见 `docs/code-review-v033.md`；版本号保持 `0.3.3` 不变。

- **YOLO 线程拥有自己的工作区。** `agent/turn-stopping`（ui、reminder）与 memory 的
  `session/event` 现在跳过 `yolo-w-*`/`yolo-a-*` 会话（对齐 session-start 已有守卫）：
  提醒回复回合不再把「最新工作区」带跑，quick_add 落库、提醒扫描、召回注入不再串库；
  线程内工具调用本就按线程自身会话 cwd 解析（`tools.ts`），行为不变。
- **提醒/简报/快照遍历所有已知工作区。** 调度器此前只扫「最新一个工作区」，其余工作区的
  到期待办静默漏提醒；现在每个 tick 按 `listWorkspaceMeta()` 逐库执行，单库失败不影响其它库。
- **语义召回降级跨天复位。** 连续空扩写触发的 `degraded` 此后永不复位（直到重启）；新的一天自动清零。
- **聚合看板更稳。** 单个工作区库打不开时跳过并在 `workspaceErrors` 上报（整板不再 500）；
  台账/通知聚合后按全局时间序重排；记忆健康指标跨工作区合并（计数求和、命中率按次数加权）。
- **角标诚实计数。** `unhandled` 改用全量未处理数（此前只统计最近 12 条展示切片，>12 时少报甚至归零）。
- **动作路由加固。** 未知 `scope_cwd` 返回 400（不再凭空创建「幽灵工作区」库）；
  已知工作区按注册表 scopeKey 钉住（新增 `Yolo.runInScope`），git 分支在「渲染行→点击」之间
  切换也不会把动作写进另一个分支的库。
- **键盘不误触。** 任务行键盘处理器加 `target` 守卫：焦点在子按钮上按 Space/Enter 触发该按钮，
  不再被行级处理器抢走误标完成。
- **今日面不再吞掉滞留行。** stale 行按到期日留在「今日」分区（保留「N 天未动」标签），
  计数与可见一致；全部滞留时也不再出现无空态的空白页。
- **对话可靠性。** 切换「聊一聊」线程丢弃旧线程 in-flight 响应（不再串台 ≤4s）；
  发送失败回滚幻影消息并把文本还输入框；全屏聊天期间看板保持挂载（编辑草稿/4s 撤销窗口不丢）。
- **可读性与动效。** amber 作文字色的 11 处高亮改用新的 `--y-accent-text`（亮/暗分别向墨色/白色
  混合，≥5:1 达 AA）；≤12px 信息性灰字升到 label-secondary；toast 文字随主题翻转
  （`--y-toast-ink`）；刷新旋转降到 200ms；reduced-motion 覆盖面板根元素。
- **杂项。** 通知卡「+1d」按实际到期日推迟；铃铛 0 条不再显示数字 0；删除确认期间按钮正确禁用；
  「知道了」重复点击返回幂等成功（不再弹「操作失败」）。

### Added — v0.3.3 用户反馈收敛

- **对话用 harness 自身会话能力（V1）。** Agent 创建/恢复时传入
  `agentDefaultModel.currentSelection()` 并在 `setup` 里
  `installModelSelection`（headless 同款），因此 `{{model}}`/`{{provider}}` 绑定，
  YOLO 常驻与「聊一聊」锚定会话真正能回复模型（此前报 `prompt variable "{{model}}" has no value`）。
- **去掉 `dev.mjs`（V2）。** 改用标准 dsh 流程：`pnpm dsh plugin add . --profile web`（一次性链接）
  + `pnpm dsh web --profile web --no-open --port 4080`；`package.json` 移除 `dev:web*` 脚本。
- **看板不再显示「记忆健康」（V3）。** 移除健康折叠与 footer 文本。
- **不区分工作区（V4）。** 看板始终 `GET /yolo/dashboard?scope=all`（移除「当前/全部」切换），
  聚合所有已知工作区；每行带 `ws.cwd`，`POST /yolo/actions` 支持 `scope_cwd` 按行路由到对应工作区
  ——跨工作区行不再只读。
- **会话来源可跳回（V5）。** 台帐来源徽标点击先收起看板再 `ctx.sessions.open`，回到该会话。
- **面板打开时不轮询（V7）。** 移除打开时的 30s 刷新；动作 / 手动「立即刷新」才重新拉取；
  侧栏角标在关闭时仍独立轮询。

### Added — v0.3.2 真机反馈收敛 + 记忆收窄 + 借鉴落地

- **看板打开时侧边栏会话可点 / 自动收起（R18）。** 面板描边改为从侧栏右缘
  （`left: anchorLeft`）开始，不再整屏拦截点击；点侧栏其它会话会话切到前台、看板自动让位。
- **「聊一聊」= 全新锚定对话（R19）。** 新增 ephemeral 线程 `yolo-a-*`
  （`YoloChatThreads`，按工作区 LRU 上限 + 处置）：每张卡片一次全新对话，不再混入常驻会话的旧历史；
  常驻会话（`yolo-w-*`）保持不变。
- **记忆收窄为「管理而非代办」（R20）。** 抽取提示词改为「管理助手」：只留承诺（todos）、计划
  （goals/milestones）与跟踪规则（preferences），明确不要人物画像、通用偏好、知识、生活细节；
  `memory_write`、system 段文案同步。
- **写入质量闸门（B3）。** `src/shared/quality.ts`：确认词（好的/收到/ok）、裸元命令（记住/记录下来）、
  空/单字标题、空值规则在 `mergeExtraction` 落库前被过滤，避免错误记忆触发错误提醒。
- **提醒安静时段（B5）。** `reminder.quietHoursEnabled/quietStart/quietEnd` + `inQuietWindow`：
  安静时段内到点的提醒先按住（不 `mark reminded`），窗口结束后补发——把「绝不打扰」落到机制层。
- **改删定位精确匹配优先（B6）。** `bestByTitle` 在精确归一化标题上直接命中，否则按状态活动度/最近更新排序，
  避免动作落在无关的首个包含匹配上。
- **快照原子写（B8）。** `writeSnapshot` 改为 tmp+rename，崩溃不再留下半截 Markdown。
- **用后反馈计数（B1 数据层）。** todos 新增 `good_count`/`stale_count`；完成→good、取消→stale；
  看板行显示「常忘」信号。召回层面的降权注入留待后续。
- **UI 细节打磨（R26）。** 任务行支持键盘漫游（Tab/↑↓/Space 完成/E 编辑）、触屏（`hover:none`）常显操作组、
  通知「查看全部」收件箱（角标==可视条数）、提醒卡显示相对到期时间 + 「再提醒」动作、完成行收起动效、
  删除确认「取消」修复、空态与面板头部微调（顶部 indigo 强调条/日期 pill/通知卡 hover）。

### Added — v0.3.0 semantic recall + cross-workspace aggregation

- **Host-LLM semantic recall (`semanticRecall`).** On each user message an async
  prewarm runs a host-LLM query expansion (paraphrase + cross-language, e.g.
  季度总结 → Q3 report) and an optional candidate rerank, cached per session/query
  and budgeted (`dailyBudget` / `minQueryChars`). The read path widens the
  deterministic `ftsRecallSearch` pool with cached expansions and applies the
  cached rerank verdicts — with a hard deterministic floor so a rerank that
  judges everything irrelevant can never empty the context. No embedding/vector
  dependency; the host LLM is reused (`purpose: 'session-title'`), and any LLM
  failure degrades silently to deterministic recall.
- **`semanticRecall` config namespace** (`enabled` / `model` /
  `expansionsPerQuery` / `rerankOn` / `maxRerankCandidates` / `dailyBudget` /
  `minQueryChars`) surfaced in Settings.
- **`recall_log` observability table** — every semantic attempt records
  query/expansions/rerank verdicts/latency/status (`logRecall`,
  `countRecallSince`, `listRecentRecall`, `pruneRecallLog`), feeding the memory
  health metrics and budget tuning.
- **Cross-workspace aggregation (read-only, opt-in).** `GET /yolo/dashboard`
  gains `?scope=current|all`; the ui plugin tracks the workspace scopes it has
  opened (`listWorkspaceMeta`) and, when `ui.aggregateAcrossWorkspaces` is on,
  unions all known workspaces' dashboards — each row tagged with its owning
  workspace (`ws`), plus `workspaces`/`workspaceCount`. Default `current`,
  actions stay current-scope (isolation intact); the panel header gains a
  当前/全部 scope toggle that persists across close/reopen.
- **`ui.aggregateAcrossWorkspaces` config.** Default `false` (isolation by
  default); aggregation is a view-only union, never a write path.

### Added — roadmap UX/robustness follow-ups (docs/roadmap-ux-priorities.md)

- **R3 — reminder lead semantics.** `reminder.aheadMin` default is now `0`
  (fire at/after the due time, honoring "到点就触发"); a positive value opts
  into an early lead. Prevents "5 分钟后提醒我" from firing on the next tick.
  `validate` accepts `0`; the settings wording and `docs/usage.md` were clarified
  (扫描间隔 is read at startup; 提前量 is live).
- **R8 — memory-health fold.** The panel's memory-health surface is now an
  expandable fold: recall hit-rate / errors / rejected actions, plus near-duplicate
  todo candidates with a one-click `consolidate` (merge) action. `listDuplicateTodos`
  now returns richer `{a,b,aTitle,bTitle}` pairs so the UI can render both sides.
- **R9 — configurable focus cap.** `ui.focusDefaultCount` (default `0` = show all)
  gates the default board view: top-N most-important open rows are surfaced and
  the rest fold into an expandable "其余 N 条" section, so a busy board opens quiet.
- **R14 — preference time-validity + supersede provenance.** `preferences` gain
  `valid_at`/`invalid_at`/`session_id`; a changed value supersedes the old one in
  place and records the superseded fact in a new append-only `preference_history`
  table (evidence trail). Injection and FTS recall only see current values
  (auto-expire); extraction threads the originating `session_id` for provenance.
- **R15 — semantic auto-degrade guard.** `semanticRecall.degradeAfterEmpty`
  (default `5`) hardens the read path: after that many consecutive empty LLM
  expansion runs, semantic widening is silenced for the day (deterministic FTS
  only), auto-recovering on a successful run or via `resetDegrade`.
- **Verified already present (no changes needed):** R1 (reminder→resident thread +
  notification card), R2 (unhandled badge), R4 (extraction `session_id`), R5
  (honest ledger labels), R6 (undo/reopen trail), R7 (human-readable reminder
  text), R10 (once-per-day brief + toggle), R11 (quick capture), R12 (inline
  edit/filters), R13 (semantic recall), R16 (section/context dual-track + session
  dedup), R17 (per-workspace resident thread with panel chat + reply-to-act).

### Added — M9 recall quality & mechanism hardening (v0.4.0 line, per `docs/design-m9-recall-quality.md`)

- **Hybrid multi-query recall (`ftsRecallSearch`).** The old single-phrase FTS
  match almost never hit real user messages; recall now merges the whole-phrase
  match with an OR expression of extracted tokens (latin words ≥3 chars, CJK
  sliding trigrams, capped at 8) plus a `title LIKE` fallback for 2-char CJK
  terms. A rephrased question now finds 「把演示稿发给研发」.
- **Recall policy + per-session injection dedup.** `applyRecallPolicy`
  deterministically drops hits (`already-injected` / `kind-quota` /
  `over-budget` reasons) — kind quotas prevent one row type flooding the
  context, and the byte budget now skips overlong singles instead of
  truncating everything after them. `RecallDedupTracker` injects each memory
  once per conversation (committed on the next user message, so repeated
  assemblies inside a turn stay byte-stable and prefix-cache friendly) and
  resets on session switch.
- **Prompt-template escaping + preference cap.** Every injected
  preference/recall line is `{{`-escaped (the host interpolates prompt
  templates strictly — raw memory text could throw and break assembly), and
  the preamble carries the 12 newest preferences instead of all of them.
- **`action_denied` audit (P34).** Every `applyYoloAction` validation failure
  writes a timeline event before returning — denials are never silent (the
  idempotent "already handled" no-op stays silent). `memory_forget` no longer
  bypasses the domain path: todo→cancel, milestone→set_status abandoned,
  goal→abandon, each with its audit event.
- **`consolidate` explicit atomic action (P35).** Merging two todos is one
  audited domain action: provenance lands in the target's detail, missing due
  / higher priority inherit deterministically, the source is cancelled with
  its notification cards resolved, and a single `todo_consolidated` event
  records it. Available through `yolo_action` and `POST /yolo/actions`.
- **Throttle gates actually wired (P44).** `reminder.checkIntervalSec` /
  `aheadMin` / `enabled` are read from settings (they were dead config);
  extraction gains a small-talk gate (`extraction.minTurnChars`, on the last
  user message) and a daily run cap (`extraction.maxRunsPerDay`), and LLM
  failures now write an `extraction_log` row with `status='error'` instead of
  vanishing.

### Added

- **Panel 1.0 (v0.3.0, per `docs/product-design.md` — 已评审定稿).** The sidebar
  button now opens a session-width full panel instead of the narrow drawer:
  看板 Tab (default) + 对话 Tab, plus a collapsible 侧栏对话 that anchors to the
  card you clicked 聊一聊 on (Esc/✕ collapses; the header 对话 toggle opens it
  board-wide). Tab, filter and side-chat state survive close/reopen via a
  module-scope UI store (`client/panel/state.ts`).
- **Kanban view with pure filtering logic.** Preset tabs 今日/全部/已完成, focus
  pills (逾期/今日/未来7天/滞留), and AND-combined detail filters (进行中/逾期/滞留/
  里程碑/关键词) all resolve in `src/shared/filters.ts` — pinned by tests, not UI
  code. Inline todo editing (title/due/priority/milestone), goal & milestone
  rename + status, delete-with-audit, and 快速记一条 (writes storage directly,
  today-due, no LLM roundtrip).
- **YOLO resident session (one thread per workspace).** Session id
  `yolo-w-<sha1(cwd)/12>`, created lazily, resumed across host restarts; the
  panel chat channel (`GET /yolo/session/messages`, `POST /yolo/session/send`)
  and reminder delivery both target it. Work sessions are 100% silent (TB-1).
- **Day ledger (今日台账).** The kanban bottom section lists today's events with
  source badges — each session gets a one-line summary at extraction time
  (`session_summaries`), quick-capture rows read 快速记一条, older rows read
  早期记录 (`events.source` column drives the label).
- **Daily briefs (早报/晚报).** Configurable times (Settings, defaults 09:00 /
  18:00), once per local day with catch-up; facts come from deterministic
  storage queries, one optional LLM call polishes them, and any failure falls
  back to the plain markdown fact list (TD-6).
- **Notification cards + sidebar badge.** `notifications` table: due reminders
  and briefs surface as cards at the kanban top with quick actions (✓ 完成 /
  +1d / 聊一聊 / ✕ handled); the sidebar badge shows the unhandled count and
  decrements as cards are handled (TB-3).

### Changed

- **Automated browser E2E suite (Playwright + real host).** `tests/e2e/*.spec.ts`
  drive a running dsh web host (`:4080`) through the real
  `GET /yolo/dashboard` + `POST /yolo/actions` endpoints and real SQLite in a
  real browser (`channel: msedge`, `workers: 1`), covering TA-1~TA-6 core panel
  interactions (incl. the complete→撤销 round-trip, 5.4), TB-3~TB-6 reminder/
  badge closure, and W6/W7 theme + narrow-panel behavior. `scripts/e2e.mjs`
  idempotently ensures a host and reuses one already up; fixtures carry a
  unique `[E2E]` prefix and self-clean in `afterAll`. It is a local lane — CI
  still runs the keyless unit suite only. `docs/testing.md` gains a §五 E2E
  chapter; `pnpm test:e2e` wires it up.
- **Test wording realism sweep.** Test fixtures now read like real user
  sentences (e.g. 提醒我把演示稿发给研发) instead of self-referential test-ese
  ("更新测试文档""撤销测试任务"…); the rule is pinned as a regression constraint
  in `docs/testing.md` §五 and `AGENTS.md`; machine fixtures keep the `[E2E]`
  prefix. The panel also gains a deterministic `author_notification` action so
  reminder/brief cards can be seeded through the same storage path the
  scheduler uses.
- **AGENTS.md added.** Agent/collaborator runbook for this repo: what the
  project is, tech-stack + design-system (Mono) conventions, common commands,
  memory/reminder/dashboard core mechanics, testing rules (unit/E2E/真机 W1–W8),
  and the pre-commit checklist.
- **Checkpoint commits required.** CONTRIBUTING now pins the rule: commit at
  logical checkpoints (fix + tests + docs together), never batch unrelated
  changes into one mega-commit — history, bisect and reverts depend on it.
- **Complete-flow undo (v0.3.3, design spec 5.4).** Completing a task now ends
  in a toast carrying a 撤销 button (4s window); undo POSTs the new `reopen`
  action through `POST /yolo/actions` — the row returns to pending,
  `completed_at` clears, the FTS entry is restored, and a `todo_reopened`
  audit event lands in the ledger. Done rows show their completion time
  (「完成 HH:MM」) in the due slot; `completed_at` joins the dashboard payload.
  Verified live (W3 walkthrough, 2026-08-22).
- **Live E2E verification in the dev process (v0.3.3).** `docs/testing.md` §七
  pins the real-machine walkthrough: trigger scope (any `client/**` /
  design-system / API-shape change), run instructions, the W1–W8 checklist
  and pass/skip rules. `CONTRIBUTING.md` gates UI changes on the walkthrough
  and `docs/release.md` gates UI releases; the README quality bar states it.
- **Detail polish (v0.3.1, per user review).** Four pass-quality fixes:
  (1) copy no longer leaks implementation details — the quick-add placeholder
  reads `+ 快速记一条，回车保存（默认今日到期）` and the panel footer just says
  看板每 30 秒自动刷新 (no "不经大模型" / no LLM-extraction mention);
  (2) one chat surface — the 看板/对话 tab bar is gone; the single 侧栏对话
  toggles from the header and expands to fullscreen and back, with Esc
  unwinding fullscreen → side chat → closed panel;
  (3) ledger stats made legible — `今日台账 · N 条记录` + `来自 M 个会话`
  (unique sessions among the day's events, tooltip explains both), ledger
  badges are now jump buttons (slot-injected `sessions.open`), and the
  missing-summary fallback label reads 来源会话 instead of the misleading
  已删除会话;
  (4) due-date range filter — 时段 presets (今天/本周/本月) plus custom
  from/to date inputs; the active range shows as a removable chip
  (`rangeOfPreset` / `matchRangePreset` / `rangeLabel` in
  `src/shared/filters.ts`, all test-pinned).
- **Mono design system (v0.3.2, per `docs/frontend-redesign.md`).** Full
  visual redesign of the panel's expression layer, zero functional change:
  a scoped design-token stylesheet (`client/design/tokens.ts`, injected once
  per document, every selector under `.yolo-scope`) with light/dark parity —
  the theme resolves from the host's `--background` luminance; a hand-drawn
  16px SVG icon set (`client/design/icons.tsx`) retiring all Emoji glyphs
  (💬 ✕ ✓ 🚩); de-carded hairline task rows and typography-driven hierarchy
  (neutral palette + one indigo accent); motion capped at 200ms with full
  prefers-reduced-motion degradation; a refresh sweep that runs only when
  polled data actually changed; and the sidebar entry badge restyled as a
  mono dot (the count moved into the tooltip/aria-label). The interactive
  prototype ships as `docs/frontend-redesign-prototype.html`; the rejected
  v1 (Track Hall, too decorative) is archived alongside.
- **Reminder delivery rerouted to the YOLO side.** Due todos now write a
  notification card + deliver into the workspace's YOLO resident thread; the
  old session-start replay into whatever work session started next is gone
  (`pending_reminders` stays in the schema for compatibility, nothing feeds it).
  The delivered text is human-readable only — reply-handling rules moved into
  the `yolo-instructions` system section so no agent instructions leak into
  the visible chat history.
- **Dashboard API extended** (`GET /yolo/dashboard`): `ledger`, `ledgerDay`,
  `ledgerSessions`, `notifications`, `unhandled`; todo rows carry
  `session_label`. Actions API gained `update` / `rename` / `abandon` /
  `quick_add` / `handled` (notification).

### Added (stateful plan)

- **Stateful plan (Organizer): the plan is now stateful.** Three entrances —
  automatic extraction, in-chat replies, dashboard clicks — converge on one set
  of storage-layer domain actions, and every action writes a timeline event.
  Todos flow `pending → in_progress → done/cancelled` (plus `start` /
  `postpone` / `remind_again`), goals track 0–100 progress (≥100 auto-achieves),
  milestones carry status. New event kinds: `todo_completed/cancelled/postponed/
  started`, `todo_remind_again`, `goal_progress`, `milestone_status` — the
  timeline is now the auditable answer to "到哪了".
- **State-change extraction.** The extraction prompt outputs an `updates[]`
  array (status / progress / due-date changes for already-known items) and the
  known-memories digest now carries each item's status, progress and due date,
  so the model can spot what changed instead of re-extracting. `mergeExtraction`
  applies updates *after* upserting new items (so "created and finished in the
  same turn" works), resolving each by fuzzy title match — unmatched updates
  drop silently, because hallucinated titles are the norm, not the exception.
  `milestone_title` on new todos/goals now links to the milestone, so the plan
  hierarchy actually forms.
- **`yolo_action` model tool + reply-able reminders.** Reminder messages carry
  the todo id and explicit routing instructions, so a natural-language reply —
  「已完成 / 推迟到明天 / 再提醒一次」— makes the agent call `yolo_action` in
  place. The same request shape (`applyYoloAction`, `src/shared/actions.ts`)
  serves the model tool and the HTTP API, keeping behavior and audit identical.
- **Actionable dashboard.** The sidebar dashboard is no longer read-only: open
  todos carry ✓ 完成 / +1d / ✕ buttons that POST the new `/yolo/actions`
  endpoint; rows show state badges (进行中 / 逾期 / 滞留), milestone labels and
  goal progress bars; the timeline labels the new state-flow event kinds.
  `YoloTodoRow` gained `milestone_title` / `updated_at` / `overdue` / `stale`.
- **Documentation suite.** New `docs/README.md` index plus three new guides so
  contributors stop having to read the source to find things: `docs/architecture/modules.md`
  (per-module reference — files, key types, public APIs, gotchas), `docs/usage.md`
  (user guide — install, config, features, data storage) and `docs/testing.md`
  (test suite — how to run, what each file covers, how to add tests).
  `docs/architecture/overview.md` gained a module dependency graph and a "where to look
  when changing X" table; README/CONTRIBUTING now link the new docs.

### Changed

- **Docs consolidated — the two "working log" docs are gone.** `docs/extension-points.md`
  and `docs/dev-notes.md` were milestone/session scrapbooks full of stale entries
  (hybrid extraction, the per-session dashboard, the retired `link:` dependency
  scheme). Their still-valid knowledge was folded into the maintained docs:
  verified platform behavior now lives in `docs/architecture/overview.md` ("Verified
  platform behavior" section), the client-bundle build contract and a
  troubleshooting table now live in `docs/architecture/modules.md`, and Windows environment
  fixes moved into `docs/usage.md` FAQ. All cross-references (README, docs index,
  CONTRIBUTING, release, `scripts/dev.mjs`) were updated to point at the new homes.
- **LLM-only semantic extraction.** The per-message regex fast path (rules / candidate buffer / merge) was removed entirely: regexes cannot judge semantics, produced noise, and missed anything phrased unusually. Extraction is now a single LLM structured pull at every `agent/turn-stopping`, following the industry pattern (Mem0, Claude Code auto-memory). The extraction prompt was rewritten around durable-knowledge selection, and the model now receives a compact **known-memories digest** so it never re-extracts unchanged facts. Live-session testing exposed a taxonomy gap in the first prompt cut — scheduled commitments (trips, appointments) fell between "task" and "decision" and were silently dropped — the todo/event definitions now explicitly cover them (verified against the real API both ways: extracts the trip, still respects "don't record this").
- **Global sidebar dashboard.** The per-session dashboard tab (conversation view builder, chat node, header button, `/yolo` command, `yolo/snapshot` durable events) was removed — memory is cross-session by nature, so the dashboard now lives in the sidebar footer: a full-height drawer with open-todo badge, five sections, manual refresh and a 30s poll while open. Data comes from a new host endpoint `GET /yolo/dashboard` whose scope follows the most recent session's workspace.

### Fixed

- **Workspace scoping was broken end-to-end** (found during live testing):
  every plugin read `session.meta?.cwd`, a property that never existed on the
  host's `Session` class, so all memory silently landed in the harness-root
  scope via the `process.cwd()` fallback. Scope resolution now goes through
  `sessionCwd()` / `sessionId()` (`src/shared/session.ts`), which read
  `session.header.cwd` / `session.header.id`.
- **Reminders never actually woke the agent**: `agent.inject()` parks context
  without waking the driver, and a bare `followup()` throws — silently swallowed
  by the try/catch, so `last_reminded_at` was never stamped. The scheduler and
  the session-start replay now send a single `followup(msg)`.
- Chat-triggered actions left no trace of *which session* did them —
  `yolo_action` now stamps the originating session id on the audit event.
- The dashboard "+1d" button always meant "tomorrow", so a todo due next Friday
  would jump *backwards*. It now postpones to one day after the later of today
  and the current due date.
- `Cannot read properties of undefined (reading 'enabled')` on boot when the bundle yml has no config stanza for the ui plugin — config is now normalized with `Config(config ?? {})` before any property access.
- `SetNamedSecurityInfoW failed (Win32 5)` on Windows when the workspace directory is owned by `BUILTIN\Administrators` — `scripts/dev.mjs` now runs an ACL preflight (`icacls`) before the host's sandbox grant, prints exact repair commands, and offers `--fix-acl` for an elevated one-shot repair (`takeown` + `icacls /grant`).
- The memory plugin crashed when a `session/event` payload arrived without a session object — the cwd tracking is now defensive.
- User messages containing FTS5 syntax characters (`<`, quotes, parens, operators) crashed
  the whole turn with `fts5: syntax error near "<"` — search queries are now wrapped as
  quoted FTS5 phrases (every character literal) and capped at 64 chars; recall additionally
  degrades to empty instead of failing system-prompt assembly on storage errors.

### Removed

- `src/extract/rules.ts`, `src/extract/buffer.ts`, `src/extract/merge.ts`, `src/shared/events.ts`, `client/tab/`, `client/node/DashboardNode.ts`, `client/trigger/HeaderButton.ts` and the `extraction.enableRules` setting.

## [0.2.0-alpha.1] — 2026-08-21

Name-claiming pre-release of the M6 line — same content as 0.1.0 plus release
engineering. Published under the `alpha` dist-tag; `npm install dsh-plugin-yolo`
resolves only after the stable `0.2.0`. Use `npm install dsh-plugin-yolo@alpha`
to try it early.

### Added

- GitHub Actions CI (`.github/workflows/ci.yml`): typecheck + tests + build + `npm pack` verification on Linux & Windows, plus a coverage job uploading the report artifact.
- Community files: bug report / feature request issue templates and a pull request template.
- README CI badge; `docs/release.md` (publish checklist, artifact contents, versioning policy).

### Changed

- **Dependencies now come from the npm registry** (`@deepseek-ai/*@0.1.1-rc.2` line) instead of `link:` paths into a local deepseek-harness checkout — `pnpm install` alone is enough for typecheck/tests/build, no host clone required; `pnpm-lock.yaml` is committed and CI installs with `--frozen-lockfile`.
- npm-ready manifest: `files` whitelist, `repository`, `keywords`, `publishConfig` (public access).
- Rewrote README around a clear product identity (slogan + logo) and corrected the Quick Start to the one-command `dev.mjs` flow; roadmap now lists future milestones M6–M9.
- Restructured docs: added `docs/architecture/overview.md` (data flow + design decisions), migrated the session change record to `docs/dev-notes.md`, and introduced this standard CHANGELOG.

### Fixed

- Reminder due-date comparisons drifted across timezones — dates now compare in local time.
- Completed milestones stayed searchable — FTS rows are now soft-deleted when milestones complete.
- Events returned numeric rowids instead of stable ids — event creation now returns the generated UUID.
- LLM extraction accepted invalid priority values — unknown priorities now coerce to `null`.
- Tool outputs didn't match the declared schema — memory tools now return `{ rows: [...] }` shaped results.
- Dead `toPosix`/`posixJoin` helpers removed after the first Linux CI run exposed their platform-dependent behavior.

### Removed

- Stray artifacts and immature leftovers (install logs, sdk-client remnants, generated `dist/` tracking).

## [0.1.0] — 2026-08-21

First working milestone set: the full memory loop (capture → store → recall → remind → visualize).

### Added

- **M0 — scaffold.** Cordis plugin bundle layout, tsdown build, dev-host patch overlay; plugin loads in deepseek-harness.
- **M1 — storage.** `ctx.yolo` service: SQLite (WAL) repository with FTS5 trigram search, Markdown snapshots, workspace+branch scoped data dirs; memory tools (`memory_search` / `memory_write` / `memory_forget` / `yolo_query`).
- **M2 — extraction.** Hybrid extractor: per-message rule capture (todo / deadline / milestone / goal / preference signals) + turn-end LLM structured pull, with candidate buffering, title-normalized dedup and throttling.
- **M3 — injection.** systemPrompt preferences preamble + dynamic FTS recall against the latest user message; proactive reminders via `agent.inject` + `followup`, with queue-and-replay on `agent/session-start`.
- **M4 — UI.** Host settings section + Config; client bundle with dashboard tab, settings card and sidebar button; live data channel via durable `yolo/snapshot` events; `/yolo` command.
- **M5 — hardening.** Snapshot cadence (daily + every 10 turns), scheduler hardening, release build, test coverage push.
- One-command dev setup: `scripts/dev.mjs` (clone → install → build → patch → boot), CJS client-bundle build contract with `__ModuleLoader__` wrapping and browser `process` shim.

[Unreleased]: https://github.com/hanshanyike/dsh-yolo/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/hanshanyike/dsh-yolo/compare/v0.1.0...v0.2.0-alpha.1
[0.1.0]: https://github.com/hanshanyike/dsh-yolo/releases/tag/v0.1.0

