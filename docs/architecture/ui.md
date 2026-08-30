# `src/ui/`：设置与 HTTP adapters

## 职责与边界

`ui` 是浏览器客户端的 host adapter：安装 Settings section、校验请求、解析 compatibility cwd/scope、调用 application use case/read model，并序列化 `/yolo/*` 响应。它不再拥有配置 shape、Dashboard/History 投影、动作语义或 session runtime。

## 文件与 owner

| 文件 | 当前职责 |
|---|---|
| `index.ts` | 配置归一化、settings 与 endpoints 装配；从 `ctx.yolo.observations` 读取 current cwd |
| `actions.ts` | `/yolo/actions` 请求校验、workspace allowlist、`ScopeRef` 解析与 command 调用 |
| `dashboard.ts` | 薄 HTTP controller；投影 owner 在 `application/read-models/dashboard.ts` |
| `badge.ts` | 薄 HTTP controller；投影 owner 在 application |
| `history.ts` | 薄 HTTP controller；投影 owner 在 application |
| `notifications.ts` | 薄 HTTP controller；投影 owner 在 application |
| `config.ts` | `runtime/config.ts` compatibility re-export |
| `session.ts` | `application/conversation` compatibility re-export |
| `chat-requests.ts` | application chat request compatibility re-export |
| `workspace-scope.ts` | application scope helper compatibility re-export |

## 请求路由

显式 `scope_cwd` 必须命中 durable catalog 的 ready workspace；adapter 把它转换为 `{ kind: 'workspace', workspaceId }` 后再进入 application。未知、stale 或 ambiguous workspace 返回 typed error，不能自行打开任意目录或退回另一个 workspace。

`GET /yolo/dashboard`、history、notifications 和 badge 使用 application projector 聚合 ready workspaces。单 workspace 失败时返回其他结果并显式设置 partial/error；全部失败才返回整体错误。

`POST /yolo/actions` 与模型工具复用 `application/commands/apply-yolo-action.ts`。HTTP 不直接调用 repository 裸 mutation，也不重新实现 idempotency、evidence 或 attention trust binding。

R3 开启时，dashboard 只投影同工作区的确定性重复候选。事项详情先展示两侧状态和字段结果，用户选择保留项后
才发送带 `CONFIRM_CONSOLIDATE` 的动作；合并后可从即时回执或历史事项发送 `undo_consolidate`。关闭开关时
候选数组为空，后台不执行自动合并。

## 对话端点

session messages/send 通过 `application/conversation` 与 `ctx.yolo.conversations` 使用统一 runtime。无 `thread` 的 resident 路径只为提醒等内部兼容投递保留；面板总是传入 thread：顶层“和助手聊聊”每次显式打开生成新的 ephemeral key，事项讨论按事项 episode 复用。请求 registry 仍是宿主生命周期状态而非持久账本；重复 `client_request_id` 返回同一 request，不重复 `followup`。

## 配置

UI 只渲染和保存 `contracts/config.ts` 定义的 `yolo` 设置。运行时 `Config(config ?? {})`、默认值和 schema owner 已迁到 `runtime/config.ts`。`aggregateAcrossWorkspaces` 保留兼容字段；Dashboard 产品行为仍固定聚合所有已登记工作区。

## 稳定端点

- `GET /yolo/dashboard`
- `GET /yolo/badge`
- `GET /yolo/notifications`
- `GET /yolo/history`
- `GET /yolo/identity-receipts`
- `POST /yolo/notifications/seen`
- `POST /yolo/actions`
- `GET /yolo/session/messages`
- `POST /yolo/session/send`

## 不变量

1. UI adapter 不拥有 current state 或 read-model 写入。
2. cwd 只作为 compatibility input；application identity 使用 stable WorkspaceId。
3. `seen_at`、`handled_at` 和事项状态保持分离。
4. old UI module paths 仅为 compatibility；新代码直接 import application/contracts/runtime owner。
