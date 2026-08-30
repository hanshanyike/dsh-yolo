# `src/application/`：应用用例

## 职责与边界

`application` 是写入命令、摄取、读取投影、维护任务和 YOLO 会话行为的 owner。adapter 只负责输入输出；repository 只负责持久化。当前迁移阶段 application 仍通过 `Yolo` service 使用 concrete repositories，后续只能继续缩窄该接口。

## 目录

| 目录 | 唯一 owner |
|---|---|
| `commands/` | `applyYoloAction`、scope routing、单 store mutation 与动作 receipt |
| `ingestion/` | accepted extraction 的 state/evidence/event/log 组合；known-memory context |
| `read-models/` | dashboard、history、notifications、badge 的单 workspace 投影和跨 workspace 聚合 |
| `maintenance/` | daily/turn snapshot cadence use case |
| `conversation/` | 内部 resident delivery、顶层 fresh ephemeral chat、事项 episode 与 chat request registry |
| `workspace-scope.ts` | compatibility cwd 到稳定 workspace scope 的解析辅助 |

## 写入事务

- 一个 command 只能写一个 workspace store。
- current state、相应 event/evidence 和 idempotency receipt 在同一 SQLite transaction 中提交。
- catalog 写入与 workspace UnitOfWork 分离；catalog 注册必须幂等、可重放。
- 跨工作区 range/bulk command 是多个独立事务的编排，必须保留 partial failure，不能声明全局原子性。
- HTTP、memory tool 和 extract adapter 不应自行组合 repository 裸写入；旧入口必须立即转交 application handler。

## 读取投影

read model 无写入权，也不是第二份 current state。它们从 ready workspace stores 读取并生成 contracts；跨工作区聚合以 owner scope 去重、排序，并显式携带 partial/error。

`src/ui/dashboard.ts`、`history.ts`、`notifications.ts`、`badge.ts` 目前是薄 controller，并 re-export application projector 以兼容旧 import。

## 摄取与维护

extract adapter 决定何时运行 LLM，并把已接受结果交给 `applyExtractionResult`。ingestion use case 不拥有 direct-human observation；该事实来自 `ctx.yolo.observations`。

snapshot 是可重建投影。reminder adapter 只把 daily 或 turn cadence 交给 `application/maintenance`，不再自行定义投影逻辑。

## Conversation

`application/conversation` 定义 YOLO 会话和请求行为；`runtime/conversation-runtime.ts` 保证实际 dsh Agent handles 只有一个 owner 实例。`yolo-w-*` resident 只供内部投递，顶层“和助手聊聊”每次打开使用新的 `yolo-a-*` ephemeral thread，事项讨论则按事项 episode 复用。旧 `src/ui/session.ts` 与 `src/ui/chat-requests.ts` 仅兼容 re-export。

## 当前限制

- Plan command 尚未拆成多个 aggregate-specific files；当前 owner 已迁移，但物理细分仍可继续。
- `application/ingestion/todo-identity-policy.ts` 拥有默认关闭的 R2a 确定性准入；resolver prediction 只是输入证据，
  只有唯一开放候选的高置信 LINK 或明确 due_at UPDATE 能在显式开启后获得稳定 ID 写入资格。
- recall/proactivity/AgentWork 尚未形成完整 application module；现有 memory/reminder 行为保持兼容，Agent task 尚未实现。
- application 对 concrete `Yolo` service 的依赖是当前迁移事实，不应扩张为新的万能 service 调用。
