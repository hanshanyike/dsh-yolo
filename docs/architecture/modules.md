# 模块架构索引

本目录描述当前已实现的稳定架构。本文是模块文档的**唯一索引**；各模块的职责、依赖与事实 owner 只在对应正文维护，不在其他索引重复定义。

## 分层模块化单体

YOLO 是一个随 dsh 装载的本地模块化单体。稳定依赖方向是：

```text
dsh / HTTP / scheduler / React adapters
                 ↓
            application
                 ↓
              domain

contracts  ← 跨边界 DTO 与配置形状
runtime / infrastructure / storage ← application 使用的现有实现与兼容服务
```

Phase 0–4 已把配置、命令、读取投影、摄取、维护、会话运行态、turn 观察和工作区目录迁到明确 owner；旧 import path 与 `ctx.yolo` 仍作为兼容 façade。当前没有引入微服务，也没有改成 event sourcing。

## 模块正文

| 模块 | 正文 | 当前唯一职责摘要 |
|---|---|---|
| 整体装配 | [overview.md](overview.md) | 全景依赖、端到端数据流、事实 owner 与兼容边界 |
| `domain` | [domain.md](domain.md) | `ScopeRef`、稳定工作区身份与存储无关的领域类型 |
| `application` | [application.md](application.md) | command、ingestion、read model、maintenance、conversation 用例 owner |
| `contracts` | [contracts.md](contracts.md) | host/client/application 边界的稳定 DTO 与配置形状 |
| `runtime` | [runtime.md](runtime.md) | 配置归一化、turn observation、YOLO conversation runtime 与装载契约 |
| `infrastructure` | [infrastructure.md](infrastructure.md) | durable workspace catalog 与基础设施生命周期 |
| `storage` | [storage.md](storage.md) | workspace SQLite、single-store UnitOfWork、repository 与 `ctx.yolo` 兼容 façade |
| `extract` | [extract.md](extract.md) | dsh turn 捕获、LLM 提取与 ingestion use case 调用 |
| `memory` | [memory.md](memory.md) | 模型工具、召回与 prompt adapter |
| `reminder` | [reminder.md](reminder.md) | scheduler/brief/delivery adapter；快照调用 application maintenance |
| `attention` | [attention.md](attention.md) | 可审计的确定性判断纯策略 |
| `ui` | [ui.md](ui.md) | 设置与 `/yolo/*` 薄 HTTP adapters |
| `shared` | [shared.md](shared.md) | 迁移期兼容 re-export 与仍被复用的纯规则；禁止新增编排 owner |
| `client` | [client.md](client.md) | React shell、页面 controller、API 与 Mono 展示层 |

## 架构治理

- 新的 current-state 写入语义只能由 `application` command/ingestion owner 定义。
- `domain` 不依赖 dsh、SQLite、HTTP、React 或 application。
- UI、模型工具、extract、memory、reminder 是 adapters，不直接拥有同一份运行事实。
- `WorkspaceId` 是 catalog 分配的 opaque 稳定标识；cwd 只在 adapter/compatibility 边界解析。
- 跨工作区读取允许 partial result；写入 UnitOfWork 永远只覆盖一个 workspace store。
- `tests/architecture-dependencies.test.ts` 的 allowlist 只能收紧；`tests/package-loader-contract.test.ts` 固定发布和 Cordis 装载契约。
- 未实现的 dsh Agent task 观察/验收属于后续能力，不得在本文档标记为当前实现。
