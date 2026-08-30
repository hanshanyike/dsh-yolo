# `src/shared/`：纯规则与兼容入口

## 职责与边界

`shared` 是迁移期目录，不再拥有 application 编排或跨边界 DTO 的最终定义。它保留仍被 host/client 共同复用的纯函数，并为旧 import path 提供 compatibility re-export。

## 当前内容

- 日期、到期、筛选、质量、文本、session 字段解析等纯规则。
- Dashboard/history/badge/chat 等旧 DTO 定义；稳定消费者通过 `src/contracts/*` 使用它们。
- `actions.ts` 仅 re-export `application/commands` 与 `contracts/actions`，不再依赖 UI 或存储编排。
- `dashboard-surfaces.ts` 与 todo identity/range helpers 仍是确定性纯规则，不拥有数据库事实。

## 已移出的 owner

| 旧位置 | 当前 owner |
|---|---|
| `shared/actions.ts` 动作编排 | `application/commands/apply-yolo-action.ts` |
| action request/outcome types | `contracts/actions.ts` |
| storage domain types | `domain/types.ts` |
| dashboard/history HTTP projector | `application/read-models/*` |

## 架构约束

- 禁止新增依赖 UI、HTTP、SQLite 或 dsh runtime 的 shared module。
- 禁止把“多个 adapter 都想调用”作为把 use case 放入 shared 的理由；use case 属于 application。
- client 应依赖 contracts，而不是 `shared/actions.ts`、storage types 或 UI config。
- `tests/architecture-dependencies.test.ts` 强制 `shared -> ui` 为零，legacy allowlist 当前为空。

## 纯规则不变量

- `due_at` 统一通过 due helpers 解释，不能对混合 date/datetime 文本直接排序。
- 本地日历日使用 `localDateStr`/`dayBounds`，不能用 UTC 字符串切片代替。
- operation id、request hash 与 evidence fingerprint 是不同层次，不能互相替代。
- compatibility re-export 不能发展成第二个 owner；移除前必须先迁完消费者并通过 package/host 门禁。
