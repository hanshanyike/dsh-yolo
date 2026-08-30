# `src/contracts/`：跨边界契约

## 职责与边界

`contracts` 统一 host、application、HTTP 与 client 共享的数据形状。它不拥有业务编排、数据库访问或 UI 状态。

## 文件

| 文件 | 契约 |
|---|---|
| `config.ts` | `yolo` settings namespace、稳定配置 shape |
| `actions.ts` | typed action request/outcome、undo 与 learning receipt |
| `dashboard.ts` | Dashboard v2 DTO 与 workspace owner 信息 |
| `history.ts` | history query/response DTO |
| `notifications.ts` | notification query/response DTO |
| `badge.ts` | 侧栏角标 DTO |
| `chat.ts` | chat message 与 request snapshot |
| `extraction.ts` | LLM extraction result 与 update shape |

## 兼容策略

当前部分 contracts 从 `shared` 的既有纯类型 re-export，以保持 client 与宿主载荷不变。这是类型归属迁移，不是双重 owner；新跨边界消费者应 import `contracts/*`。

配置默认值的运行时归一化由 `runtime/config.ts` 实现；`ui/config.ts` 只保留 loader 与旧 import 兼容。

## 版本与门禁

- Dashboard 继续携带 `ui_contract_version: 2`。
- HTTP 路径、模型工具形状、Cordis plugin entry 与现有 client payload 在本次内部重构中保持兼容。
- client 不得 import `src/storage/types.ts`、`src/shared/actions.ts` 或 `src/ui/config.ts`；dependency fitness test 强制这一点。
- contract 的破坏性变化必须先定义迁移、E2E 与版本策略，不能用内部 refactor 名义偷改。
