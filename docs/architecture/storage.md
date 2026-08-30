# `src/storage/`：workspace SQLite 与兼容服务

## 职责与边界

`storage` 持有每个 workspace 的 SQLite current state、repository、FTS、迁移和 snapshot I/O，并以 Cordis `ctx.yolo` 暴露兼容 façade。应用写入语义已迁到 `src/application/`；`ctx.yolo` 当前仍承载 repository、single-store UnitOfWork、scope/catalog bridge 与 runtime provider，不能再把新的跨模块 use case 加回这里。

## 文件

| 文件 | 当前职责 |
|---|---|
| `index.ts` | `Yolo` service、DB handle cache、catalog bridge、`ScopeRef` 解析、single-store UoW、compatibility API、observation/conversation runtime provider |
| `db.ts` | SQLite 打开、schema/列迁移、meta、transaction helper |
| `repository.ts` | current state、audit/evidence、notification、日志与 idempotency repositories |
| `schema.sql` | workspace store 表、索引、FTS 和 trigger 事实源 |
| `migrate-scope.ts` | legacy branch DB 到 canonical workspace store 的幂等合并 |
| `search.ts` | recall 与 identity FTS 查询 |
| `snapshot.ts` | Markdown snapshot 渲染与原子写入 |
| `scope.ts` | `domain/scope.ts` compatibility re-export 加数据目录/文件名 codec |
| `types.ts` | `domain/types.ts` compatibility re-export |

## 数据拓扑与 durable catalog

workspace 数据仍位于 `<cwd>/.dsh/yolo/yolo-<scopeKey>.db`。user-local `control.db` 由 [infrastructure](infrastructure.md) 拥有，只保存 workspace discovery，不复制计划事实。

`Yolo` 启动时从 catalog 恢复 ready workspaces；内存 `knownWorkspaces` 只是当前进程 cache。workspace store 打开时：

1. 规范化 cwd 并解析兼容 scope key；
2. 打开/迁移 workspace DB；
3. 独立幂等注册 catalog；
4. 把 `workspace_id`、`workspace_scope_key`、`workspace_identity` marker 写入 workspace meta；
5. 更新 ready cache。

catalog 写入失败不会关闭已经可用的 workspace DB，但会记录警告并降低 durable discovery 保证。`dispose()` 关闭 DB handles、observation state 与 catalog；`close()` 只关闭 workspace handles，保留兼容的可重开语义。

## Stable WorkspaceId 与 ScopeRef

- `WorkspaceId` 由 catalog 分配并持久化，是 opaque identity，不等于 cwd 或 `scope_key`。
- `scopeRefForCwd` 只为已注册 workspace 返回 `{ kind: 'workspace', workspaceId }`。
- `resolveScope/runInScopeRef` 用 WorkspaceId 找回 catalog row；未知 workspace 明确失败。
- workspace commands 不接受 user scope；user scope 不能被隐式解释为跨 workspace 写入。
- `runInScope(cwd, scopeKey, fn)` 只为旧 payload/投影钉住已经登记的确切 store，是 compatibility operation guard。

## Single-store UnitOfWork

`runWorkspaceTransaction(cwd, execute)` 只对一个 workspace SQLite 开事务。动作、提取写入和 idempotency receipt 必须在该事务中保持一致。catalog 或另一个 workspace DB 永远不加入同一 UnitOfWork；跨 workspace 操作逐 store 执行并保留 partial result。

当前 `repository.ts` 仍是较大的 concrete implementation，application 也仍通过 `Yolo` 调用它。这是已知兼容迁移状态：新 adapter 不得直接调用裸 `set*` 方法，新 use case 应进入 application command/ingestion owner。

## Schema 与事实语义

当前 workspace schema 包括 plan current state、preferences、events、session summaries、notifications、attention feedback、client actions、extraction/recall/resolution logs、todo evidence 与两个 FTS index。完整清单和列定义以 [`schema.sql`](../../src/storage/schema.sql) 为准。

- SQLite row 是 current state；events/evidence 是追加审计，不做 event sourcing。
- `todos.source_excerpt/source_turn` 是首来源兼容投影；完整多会话来源链在不可变 `todo_evidence`。
- `record_status` 与业务 `status` 分离；merge 不伪装为 cancel。
- `seen_at`、`handled_at` 和 todo status 分离。
- `client_actions` 以 scope + client action id 保存请求 hash 和结果，和业务写入同库。
- `todo_identity_feedback` 追加用户对已应用 R2 决策的纠错；原 `todo_resolution_log` 与 `todo_evidence` 不改写，
  被纠错 evidence 通过投影排除，自动截止时间只在无后续写入冲突时恢复。
- `pending_reminders` 只为旧库兼容保留，当前不向普通工作 session 回放。
- FTS 是可重建索引，不是独立事实源；identity resolver 的模型输出不能直接执行写入。R2a 的独立、
  默认关闭策略只允许受控稳定 ID LINK/due_at UPDATE，并把计划与实际结果写入
  `todo_resolution_log.application_json`；该 nullable 列对旧库和旧 shadow log 幂等迁移。

## Legacy scope migration

首次打开 canonical store 时，`migrate-scope.ts` 幂等合并同 cwd 的旧分支库。每个来源在目标单库 transaction 中导入并写 marker；冲突 id 确定性改写且同步修复引用，源文件保留。损坏或锁定必须显式报错，不能当成空库。

## Snapshot 与搜索

storage 只负责 snapshot 渲染/原子 rename；daily/turn cadence owner 已移到 `application/maintenance`。FTS recall 保留 token/短 CJK fallback 与确定性去重；semantic 层失败时可以回退 FTS。

## Compatibility façade

现有五插件、HTTP、tool 与测试仍通过 `ctx.yolo` 调用明确方法，因此该 service 名和 package default export 保持稳定。新代码应优先使用：

- `domain/*` 类型与 scope；
- `application/commands|ingestion|read-models|maintenance`；
- `contracts/*` DTO；
- `ctx.yolo.observations/conversations` 的 runtime owner。

删除或缩小 façade 前必须确认所有消费者、package loader contract、真实宿主与数据迁移门禁。
