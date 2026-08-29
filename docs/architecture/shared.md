# `src/shared/`：共享契约

## 职责与边界

`shared` 保存宿主插件与浏览器客户端共同使用的类型、领域动作入口和纯函数规则。它不是一层
完全无依赖的基础库：`actions.ts` 会调用存储服务并使用服务端看板投影，因此修改共享动作契约时
必须同时检查 `storage`、`ui`、`memory`、`extract` 与 `client`。

## 文件

| 文件 | 职责 |
|---|---|
| `constants.ts` | namespace、service 名、UI slot、prompt 顺序和代码默认值 |
| `dashboard.ts` | Dashboard v2 跨边界载荷、工作区标签、健康度和 todo 判定函数 |
| `due.ts` | date-only / datetime 的统一解析、到期、逾期、本地日期和排序事实 |
| `badge.ts` | 轻量角标载荷 `YoloBadgeData` |
| `actions.ts` | `YoloActionRequest`、结果/回执/撤销类型与 `applyYoloAction` |
| `filters.ts` | 看板日期范围、focus 分组、过滤、排序和分区纯函数 |
| `quality.ts` | `shouldDropExtracted` 写入质量闸门 |
| `session.ts` | 从 `session.header` 解析 cwd 与 session id |
| `text.ts` | 内容块转文本、标题归一化、本地日期和日边界工具 |
| `todo-identity.ts` | 抽取 turn、工具 call、事项 evidence 的版本化指纹与规范化请求哈希 |

## 关键契约

`dashboard.ts` 是 host 与 client 的载荷事实源。`YoloDashboardData` 包含 todos、goals、
milestones、events、preferences、ledger、notifications，以及 v2 的 attention、summary、
capabilities、workspaces、workspaceErrors 和 memory health。聚合行携带 `scope_cwd`/`ws`，
供服务端把动作安全地路由回原工作区；todo 行保留单个 `source` 兼容字段，并可携带不可变
`sources[]`、`source_count` 和 `related_session_count`。

`applyYoloAction(yolo, cwd, request)` 是统一动作入口，供模型工具、HTTP 端点和提取 updates
复用。它负责参数校验、状态分发、拒绝审计、幂等、学习回执与短时撤销描述；失败返回带
`code` 和 `httpStatus` 的结果，不把领域校验异常抛给调用者。

支持的动作覆盖：

- todo：`complete`、`start`、`cancel`、`postpone`、`remind_again`、`reopen`、`update`、
  `quick_add`、`consolidate`；
- goal/milestone：进度、状态、改名和放弃；
- notification：处理和作者通知；
- attention：`seen`、`suppress`、`feedback`。

非空 `client_action_id` 最长 128 字符。同一 key 与同一规范化请求会重放原结果；同一 key
配不同请求返回 `idempotency_conflict`。Attention 反馈必须携带当前
`reason_version + evidence_fingerprint`，旧证据返回 `stale_attention`。

## 规则与不变量

- `sessionCwd()` 读取 `session.header.cwd`，不要恢复不存在的 `session.meta.cwd`。
- 日期逻辑使用 `localDateStr()` / `dayBounds()`，不能用 UTC 日期切片代替本地日历日。
- `due_at` 只通过 `due.ts` 解释：date-only 表示本地当日结束，带时区 datetime 按绝对时刻，
  无时区 datetime 按本地精确时刻；看板、判断、筛选、摘要与提醒不得再自行切字符串比较。
- `filters.ts` 定义的是产品语义，客户端只消费结果；修改时必须同步单测。
- `shouldDropExtracted` 会拒绝确认词、裸元命令、空/单字标题和空偏好值，避免错误记忆触发错误提醒。
- `todo-identity.ts` 的 operation id 只回答“哪一次宿主操作”，request hash 用来发现同 id 不同载荷，
  evidence fingerprint 再绑定解析后的 canonical todo；三者不能用时间窗或普通 payload hash 相互替代。
- `DEFAULTS` 当前包含 extraction、reminder、brief、recall、semantic 和 ui 默认值；完整用户配置
  以 [看板服务端的配置](ui.md#配置) 为准。

## 相关文档

- [整体数据流](overview.md)
- [存储领域动作](storage.md)
- [助手判断绑定](attention.md)
- [看板服务端](ui.md)
