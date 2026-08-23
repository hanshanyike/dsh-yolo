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
| `schema.sql` | 表、索引、FTS5 虚表及 INSERT 触发器的事实源 |
| `repository.ts` | CRUD、去重、领域状态迁移、审计、通知、反馈和日志 |
| `scope.ts` | 工作区/用户/全局数据目录与 scope key |
| `search.ts` | FTS phrase、token/短 CJK 查询拆分和混合召回 |
| `snapshot.ts` | Markdown 渲染与原子写入 |
| `types.ts` | 存储领域类型与状态联合类型 |

## 作用域与生命周期

- workspace scope key 为 `sha1(cwd).slice(0, 12) + '/' + gitBranch`，非 Git 目录回退 `default`。
- workspace 数据位于 `<cwd>/.dsh/yolo/`；user/global 模式位于用户级 `.dsh/yolo/` 目录。
- `scope.ts` 虽支持 user/global，设置 schema 也暴露了 `storage.scope`，但当前业务调用均未把 mode
  传给 `resolve()`，实际主链路仍固定使用 workspace scope。
- DB 名为 `yolo-<scopeKey>.db`，路径分隔符会转为安全字符。
- `resolve()` 懒打开并缓存句柄；服务卸载时 `close()` 关闭全部连接。
- scope key 缓存 TTL 当前为 5 秒，避免 Windows 下每次查询都执行 `git rev-parse`。
- `runInScope(cwd, scopeKey, fn)` 在一次同步操作中钉住 registry 中的 scope key，防止分支切换
  将已渲染行的动作误写到另一分支。
- `listWorkspaceMeta()` 是跨工作区看板和提醒扫描的白名单来源。

## Schema

当前表包括：`meta`、`user_profile`、`milestones`、`todos`、`goals`、`preferences`、
`preference_history`、`events`、`session_summaries`、`notifications`、`attention_feedback`、
`client_actions`、`extraction_log`、`pending_reminders`、`recall_log`，以及 FTS5 虚表
`yolo_fts`。`pending_reminders` 仅为兼容旧库保留，当前主动提醒不再向工作会话回放它。

旧库迁移由 `db.ts` 使用 `PRAGMA table_info` 后执行 `ALTER TABLE`；SQLite 不支持
`ADD COLUMN IF NOT EXISTS`，不能把迁移简化成该语法。

## 写入、状态与审计

基础 upsert 负责 todo、milestone、goal、preference、event 和 session summary。状态变化应走
领域动作而非调用方直接改列：

- `applyTodoAction`：start、complete、cancel、postpone、remind_again、reopen；
- `applyTodoUpdate` / `applyTodoConsolidate`：编辑与显式合并；
- `applyGoalProgress` / `applyGoalRename` / `applyGoalAbandon`；
- `applyMilestoneStatus` / `applyMilestoneRename`。

每次有效迁移写入 timeline event。拒绝事件、客户端幂等和学习/撤销编排由上层
[`applyYoloAction`](shared.md) 统一处理。标题引用先做归一化精确匹配，再在非终态候选中按活跃度
与新近度选择宽松匹配，避免命中任意第一条包含结果。

`client_actions` 以 `(scope_key, client_action_id)` 保存请求哈希和序列化结果；
`attention_feedback` 以 scope、todo、规则版本和证据指纹联合绑定。

## 搜索与快照

FTS5 使用 trigram tokenizer。`ftsRecallSearch` 合并整句查询、最多若干 token 的 OR 查询，
并为独立的 2 字 CJK 标题词增加 `LIKE` fallback，最后按 `(row_type, row_id)` 去重。
终态或软删除条目的 FTS 清理由 repository 显式同步，新增行由 schema trigger 写入。

`writeSnapshot` 先写同目录临时文件再 rename，避免中途失败留下半份快照。日快照和每 10 turn
快照的触发节奏由 [提醒模块](reminder.md) 负责，存储模块只负责渲染和写入。
`snapshotKeepDays` 当前没有清理任务消费，文档不能把它描述成已经生效的保留策略。

## 对外 API 分组

| 分组 | 代表方法 |
|---|---|
| scope | `resolve`、`runInScope`、`listWorkspaceMeta`、`close` |
| domain | `add/list/find*`、`applyTodo*`、`applyGoal*`、`applyMilestone*` |
| history | `add/listEvents*`、`upsert/listSessionSummaries` |
| notification | `add/list/count/markNotification*`、brief stamp |
| trust/idempotency | attention feedback、client action、`runIdempotentAction` |
| recall/extract | `search`、`logRecall`、`logExtraction` 及计数/清理方法 |
| snapshot | `renderSnapshot`、`writeSnapshot`、snapshot date meta |

所有面向业务的公开方法都显式接收 `cwd`，调用方不得自行持有 DB 连接。
