# `src/runtime/`：运行时与宿主装配

## 职责

`runtime` 拥有宿主配置归一化、YOLO session identity、跨插件 turn observation 和 YOLO conversation handle 生命周期。它不拥有计划 current state 或 HTTP 投影。

## 文件

| 文件 | 职责 |
|---|---|
| `config.ts` | `Config(config ?? {})` 归一化和 Cordis loader 兼容名 |
| `session-identity.ts` | 内部 resident 与 ephemeral YOLO session id 判定 |
| `turn-observation.ts` | per-session direct-human turn、最近 cwd/文本与 turn cadence 的单 owner |
| `conversation-runtime.ts` | `YoloSessions`/`YoloChatThreads` dsh Agent handle 单实例 |

## TurnObservationService

`ctx.yolo.observations` 是跨 storage/extract/memory/reminder/ui 的唯一实例。storage provider 只注册一组 `agent/session-start`、`session/event`、`agent/turn-stopping` listeners；其他插件消费 observation，不再各自维护 `latestCwd`、`lastUserText` 或 turn count。

关键语义：

- 以 `(sessionId, turn)` 隔离并发 session 的 direct-human capture；late steering 合并到同一 turn，消息 id 去重。
- `acceptedAt` 保留首次捕获时刻；`takeHumanTurn` 消费后删除。
- 同一 turn-stopping 重复观测幂等，不重复推进 snapshot cadence。
- `yolo-w-*` 与 `yolo-a-*` 流量在 provider 边界排除，不改变最近工作区、最近用户文本或 turn count。
- session 与 turn key 均有上限，避免进程期状态无限增长；`dispose` 时统一清理。

## ConversationRuntime

UI 与 reminder 通过 `ctx.yolo.conversations.get(...)` 取得相同的 sessions/threads handle。`YoloSessions` 管理 `yolo-w-*` resident，仅供提醒等内部投递；面板聊天全部由 `YoloChatThreads` 创建 `yolo-a-*` ephemeral handles。顶层“和助手聊聊”每次显式打开使用新的 thread key，不读取 resident 历史；事项讨论按事项 episode 复用，显式结束才释放。领域模块只使用 typed conversation reference，不拥有 dsh Agent 生命周期。

## 配置 owner

稳定配置 shape 在 `src/contracts/config.ts`，运行默认值与 schemastery 归一化在 `src/runtime/config.ts`。所有插件 `apply()` 必须先调用 `Config(config ?? {})`。`src/ui/config.ts` 只是旧 loader/import compatibility entry。

## Bundle 装配契约

YOLO 对外仍是五个宿主插件加一个浏览器 bundle：storage、memory、extract、reminder、ui 与 `./client`。`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，第一行是裸 client-discovery row，随后是五个 host plugin rows。

`tests/package-loader-contract.test.ts` 固定：

- package root、browser export 和五个 host subpath exports；
- storage default export 和全部插件的 `name/inject/apply`；
- `settingsNamespace('yolo')` 与完整默认配置；
- host ESM/client CJS build entry、ModuleLoader wrapper、process shim 与 `schema.sql` 资产。

## 构建与宿主约束

`pnpm build` 依次构建 host ESM、client CJS、包装浏览器 bundle并复制 schema。真实验证使用官方 `dsh plugin --profile web add .` 与标准 `dsh web`，不能用自建 host checkout 代替。

- `ctx.llm.stream()` 返回 `AsyncIterable<StreamChunk>`，由 `BlockAssembler` 收集。
- `Agent.followup` 的 user message 必须带 source；程序化 Agent 必须安装 host model selection。
- SQLite 使用 `node:sqlite`；迁移不能使用 `ADD COLUMN IF NOT EXISTS`。
- Windows ACL、端口和 linked bundle 验证见 [测试指南](../testing.md) 与 [E2E 指南](../testing-e2e.md)。

## 不变量

1. 同一类宿主观察只能有一个 owner listener 集合。
2. adapter 不能绕开 observation service 保存竞争状态。
3. YOLO 自有会话永远不计入工作会话 observation。
4. package/patch/build 兼容由自动 contract test 与真实宿主共同证明。
