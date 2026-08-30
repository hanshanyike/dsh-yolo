# `src/storage/`：存储服务

## 职责与边界

`storage` 是唯一共享状态服务，以 Cordis `Service` 暴露为 `ctx.yolo`。其余宿主插件通过
`inject: ['yolo']` 使用它；浏览器客户端不能直接访问 SQLite。SQLite 是当前运行事实源，
Markdown 快照只是可读、可 diff 的审阅投影；当前没有从快照解析并重建数据库的实现。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | `Yolo` 服务、scope handle 缓存、工作区注册表和对外 API |
| `db.ts` | 打开 SQLite、执行 schema 和兼容旧库迁移、meta 读写 |
| `migrate-scope.ts` | 将同一 cwd 的遗留分支库幂等合入 canonical 主库并修复冲突引用 |
| `schema.sql` | 表、索引、FTS5 虚表及 INSERT 触发器的事实源 |
| `repository.ts` | CRUD、去重、领域状态迁移、审计、通知、反馈和日志 |
| `scope.ts` | 工作区/用户/全局数据目录与 scope key |
| `search.ts` | FTS phrase、token/短 CJK 查询拆分和混合召回 |
| `snapshot.ts` | Markdown 渲染与原子写入 |
| `types.ts` | 存储领域类型与状态联合类型 |

## 作用域与生命周期

- workspace scope key 为 `sha1(canonical cwd).slice(0, 12) + '/default'`，与 Git 状态无关。
  Windows identity 忽略大小写，并归一化分隔符与 `..`；registry 保留解析后的 cwd 拼写用于 payload。
- workspace 数据位于 `<cwd>/.dsh/yolo/`；user/global 模式位于用户级 `.dsh/yolo/` 目录。
- `scope.ts` 虽支持 user/global，设置 schema 也暴露了 `storage.scope`，但当前业务调用均未把 mode
  传给 `resolve()`，实际主链路仍固定使用 workspace scope。
- DB 名为 `yolo-<scopeKey>.db`，路径分隔符会转为安全字符。
- `resolve()` 懒打开并缓存句柄；服务卸载时 `close()` 关闭全部连接。
- scope 计算不再执行 `git rev-parse`，因此没有 Git 探测 TTL。
- `runInScope(cwd, scopeKey, fn)` 在一次同步操作中钉住 registry 中的 canonical scope key，确保
  已渲染行和动作使用同一个已登记工作区。
- `listWorkspaceMeta()` 是跨工作区看板和提醒扫描的白名单来源。
- 首次打开 cwd-only 主库时，`migrate-scope.ts` 会逐个合入同目录遗留分支库。每个源库在目标库
  单事务导入并写入幂等 marker，源文件保留；相同 ID/不同内容会确定性改写 ID 并同步修复引用，
  包括 todo 的 `merged_into_id` 与 evidence 的 todo/scope 引用。同一 fingerprint 已迁入时跳过，evidence id
  冲突时确定性改写；同标题事项不会自动合并。偏好按 `updated_at` 选择当前值并保留其余历史。损坏或锁定的源库
  会带文件名报错，不能静默当成空库。

## Schema

当前表包括：`meta`、`user_profile`、`milestones`、`todos`、`goals`、`preferences`、
`preference_history`、`events`、`session_summaries`、`notifications`、`attention_feedback`、
`client_actions`、`extraction_log`、`todo_resolution_log`、`pending_reminders`、`recall_log`、
`todo_evidence`，以及 FTS5 虚表 `yolo_fts` 与 `todo_identity_fts`。`pending_reminders` 仅为兼容旧库保留，
当前主动提醒不再向工作会话回放它。

`notifications.seen_at` 表示投递是否已查看，驱动通知按钮；`handled_at` 表示提醒是否已经被用户回应或
关联事项动作消解，驱动首页提醒投影。两者不能互相回填。旧库首次增加 `seen_at` 时以迁移时刻建立阅读
基线，避免升级后把全部历史重放为新通知；跨 scope 导入的旧通知同样视为历史记录。

单库 schema 迁移由 `db.ts` 使用 `PRAGMA table_info` 后执行 `ALTER TABLE`；跨分支库合并由
`migrate-scope.ts` 负责。SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，不能把列迁移简化成该语法。

`todos.source_excerpt` 与 `todos.source_turn` 是首条来源的兼容投影；完整来源链保存在不可变
`todo_evidence` 中。每条 evidence 记录事项、来源 scope、session/turn、来源类型、关系、摘录、发生时间和
全库唯一的 `source_fingerprint`。同一个事项可包含多个会话的 origin、mention、update、correction、
completion claim 或 discussion，后续提及不会覆盖首条来源。

只有 `source=llm`、存在 `session_id`、轮次有效且摘录非空时，直接用户原话才进入兼容投影；摘录规范化
空白并按 Unicode code point 截断到 400 字符。manual/tool 调用即使传入伪造字段也会落为 NULL。
旧库打开时会用 `legacy:todo:<id>:origin` 幂等回填首条 evidence；legacy scope 合并也复制 evidence 并处理
指纹/id 冲突。旧字段缺失时降级为 NULL，重复打开或重复迁移不能再次生成证据。

`todos.status` 表示用户可理解的业务状态（pending/in_progress/done/cancelled）；`record_status` 表示记录身份
（canonical/merged/rejected），`merged_into_id` 指向规范事项。业务状态与记录身份相互独立：合并不会把
来源事项伪装成 cancelled，也不会改写目标的完成/取消状态。

`events` 是追加式历史事实。新领域事件写入 `subject_type + subject_id + subject_title`，并把字段前后值保存到
`change_json`；合并等关系还保存 related subject。主体列不设置级联外键，保证事项删除或合并后历史仍可读。
旧事件没有稳定主体时保持 NULL，只进入时间线，不按摘要标题回填。按事项查询使用
`(scope_key, subject_type, subject_id, occurred_at)` 索引；跨工作区身份始终包含 owner scope。

主 Agent 可能在同一轮先调用 `memory_write`：这类 tool 行会带调用 session。后台抽取使用
相同 `source_turn` 将同 session 的 provisional tool 行升级为 LLM 来源并补齐 excerpt/turn；旧宿主没有
turn 时才退回 `acceptedAt..backgroundStartedAt` 闭区间。即使辅助模型因已知事项而返回合法 `empty`，
来源证据也不会丢失。不同 session、不同 turn、窗口外兼容行和已有 LLM/manual 来源均不会被覆盖。

## 写入、状态与审计

基础 upsert 负责 todo、milestone、goal、preference、event 和 session summary。状态变化应走
领域动作而非调用方直接改列：

- `applyTodoAction`：start、complete、cancel、postpone、remind_again、reopen；
- `applyTodoUpdate` / `applyTodoConsolidate`：编辑与显式合并；
- `cancelTodosInRange` / `deleteTodoPermanently` / `deleteTodosInRange`：日期范围取消与不可逆删除；
- `applyGoalProgress` / `applyGoalRename` / `applyGoalAbandon`；
- `applyMilestoneStatus` / `applyMilestoneRename`。

每次有效迁移写入 timeline event。拒绝事件、客户端幂等和学习/撤销编排由上层
[`applyYoloAction`](shared.md) 统一处理。

范围取消只选择 open canonical todo，并在单工作区事务中逐条复用 `applyTodoAction(cancel)`，因此
FTS、提醒处理、反馈计数和每条 `todo_cancelled` 审计与单条操作一致。永久删除选择 canonical todo 的
完整身份链，同时移除其 merged 别名、`todo_evidence`、notification、pending reminder、attention feedback、
todo FTS 和直接保存该 id 的 client action / recall 投影；写入一条不包含事项正文的 `todo_deleted` 审计。
既有 timeline 和原始宿主会话属于独立审计/来源边界，不随事项永久删除；需要全库擦除时仍须停机删除
整个 `.dsh/yolo/` 数据目录。

事项写入先用 `source_fingerprint` 查询 evidence；命中时解析并返回首次写入的 canonical 事项，不重复生成
事项或证据；同一 fingerprint 若被要求绑定到另一个 canonical 事项则显式报冲突。未命中时，标题 dedup
只检索同 scope 的 open canonical 行，并按 `created_at ASC, id ASC`
确定性选择；终态行和 merged/rejected 记录不能抢占候选。没有稳定来源 id 的旧调用仍可使用兼容指纹或
事项自身 origin 指纹，但不能据此声称已经实现语义近义自动合并。

`applyTodoConsolidate` 允许 canonical 记录之间显式合并，包括业务终态记录。目标事项的业务状态保持权威；
来源只改为 `record_status=merged` 并指向目标，来源 evidence 与旧事件不被重写。普通列表、标题查找、到期
扫描、重复检查、FTS 和看板只暴露 canonical 事项；旧 merged id 会沿链解析到 canonical id，普通 reopen
不能让副本复活。`listTodoRecords` 是审计/迁移用的全记录入口，不得用作用户开放事项列表。

`client_actions` 以 `(scope_key, client_action_id)` 保存请求哈希和序列化结果；
`attention_feedback` 以 scope、todo、规则版本和证据指纹联合绑定。

`todo_resolution_log` 是 R1 的追加式 shadow 观测：保存 session/turn、operation id、输入 fingerprint、
1000 字符有界输入摘录、resolver/model 版本、候选与裁决 JSON、状态、错误、token 和耗时。其 schema 不含
任何领域动作或已执行结果字段，`logTodoResolution` 遇到同一 `(session, turn, resolver_version)` 重放只保留
首条记录。跨 scope 迁移会改写候选/裁决 JSON 内发生 ID 冲突的 todo id，避免日志引用旧分支中的失效 id。

## 搜索与快照

FTS5 使用 trigram tokenizer。`ftsRecallSearch` 合并整句查询、最多若干 token 的 OR 查询，
并为独立的 2 字 CJK 标题词增加 `LIKE` fallback，最后按 `(row_type, row_id)` 去重。
终态或软删除条目的 FTS 清理由 repository 显式同步，新增行由 schema trigger 写入。

`todo_identity_fts` 与普通召回隔离：它故意保留 open、done、cancelled 和 merged todo，并把有界 evidence
摘录放入检索正文。`recallTodoIdentityCandidates` 对整句、token OR 和二字标题 fallback 做混合召回，再把
merged 记录解析到 canonical 稳定 id、折叠历史 alias、按 rank/id 确定性排序。该索引只服务 shadow
resolver；终态项仍不会重新进入 `yolo_fts`、模型日常召回、提醒或看板开放集合。

`writeSnapshot` 先写同目录临时文件再 rename，避免中途失败留下半份快照。日快照和每 10 turn
快照的触发节奏由 [提醒模块](reminder.md) 负责，存储模块只负责渲染和写入。
`snapshotKeepDays` 当前没有清理任务消费，文档不能把它描述成已经生效的保留策略。

## 对外 API 分组

| 分组 | 代表方法 |
|---|---|
| scope | `resolve`、`runInScope`、`listWorkspaceMeta`、`close` |
| domain | `add/list/find*`、`applyTodo*`、`applyGoal*`、`applyMilestone*` |
| todo identity | `addTodoEvidence`、`listTodoEvidence`、`resolveCanonicalTodo`、`listTodoRecords`、`recallTodoIdentityCandidates`、`log/listTodoResolutions` |
| history | `add/listEvents*`、`upsert/listSessionSummaries` |
| notification | `add/list/count/markNotification*`、brief stamp |
| trust/idempotency | attention feedback、client action、`runIdempotentAction` |
| recall/extract | `search`、`logRecall`、`logExtraction` 及计数/清理方法 |
| snapshot | `renderSnapshot`、`writeSnapshot`、snapshot date meta |

所有面向业务的公开方法都显式接收 `cwd`，调用方不得自行持有 DB 连接。
`listDueTodos` 先从 SQLite 取 open、未提醒候选，再使用共享 `due.ts` predicate 按实际时刻过滤和排序；
SQLite 不直接比较混合格式的 `due_at` 文本。
