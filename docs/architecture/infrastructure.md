# `src/infrastructure/`：基础设施

## 职责与边界

当前 infrastructure 模块拥有 user-local durable workspace catalog。workspace 计划事实仍由 `src/storage/` 的 SQLite 实现持有；catalog 不复制 todo/goal/milestone 等 current state。

## WorkspaceCatalog

`src/infrastructure/catalog/workspace-catalog.ts` 默认使用 `$DSH_HOME/yolo/control.db`，测试可显式传入路径或使用内存库。记录包含：

- opaque `workspace_id`；
- canonical cwd；
- 兼容 `scope_key`；
- `last_seen_at`；
- stale/invalid health 信息。

## 生命周期

1. 创建/打开 catalog 并检查 schema version。
2. 文件损坏时先隔离原 DB/WAL/SHM，再建立新 catalog；不修改 workspace 数据库。
3. `register` 校验 cwd 推导的兼容 scope key，重复注册刷新 last-seen 并保持 WorkspaceId。
4. `list` 只把 workspace DB 存在且 meta markers 全部吻合的记录判为 ready；缺失为 stale，路径或 marker 异常为 invalid。
5. `relocate` 只接受能由原 `workspace_id` 与 `scope_key` marker 证明的已移动 store，并保持稳定身份。
6. `forget` 只删除 discovery row，绝不删除 workspace DB 或 snapshot。

## 事务边界

catalog 和任一 workspace SQLite 是两个 store，不存在跨库 UnitOfWork。workspace 首次打开时：

- workspace DB 自己在 single-store transaction 中维护计划事实；
- catalog 注册独立、幂等、可重放；
- catalog 暂时不可用不能使已经打开的 workspace store 不可读写，但聚合发现能力会降级并记录警告。

## 当前边界

control DB 目前只存 workspace discovery。user-level tracking rule、Agent task 投影和 acceptance 尚未实现，不能当成已有 catalog 表或能力。
