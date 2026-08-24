# `src/ui/`：设置与看板服务端

## 职责与边界

`ui` 是浏览器客户端的 host 半边：注册 Settings 配置，构建 Dashboard v2 与角标投影，处理
统一动作，并管理面板的 resident/anchored agent 会话。所有显式 cwd 都必须通过存储服务的
工作区注册表校验，HTTP 调用不能借此打开任意目录。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 配置归一化、设置 section、latest cwd 跟踪和各端点装配 |
| `config.ts` | schemastery `Config` 接口与默认值 |
| `dashboard.ts` | 单工作区投影、跨工作区聚合、memory health 和 dashboard 端点 |
| `badge.ts` | 不构建完整 dashboard 的轻量未处理数聚合 |
| `actions.ts` | 工作区白名单、scope pin 和 `POST /yolo/actions` |
| `session.ts` | `YoloSessions`、`YoloChatThreads` 与 messages/send 端点 |
| `workspace-scope.ts` | cwd 规范化和 registry 查找 |

## 配置归一化

loader 可能在 bundle 没有 config 段时传入 `undefined`，所以 `apply()` 必须先执行
`Config(config ?? {})` 再读取 `.enabled` 或嵌套字段。schemastery 默认值不会替代这一步。

## 配置

| 分组 | 键 | 默认值 |
|---|---|---|
| 总开关 | `enabled` | `true` |
| extraction | `enableLLM` / `model` | `true` / `deepseek-chat` |
| extraction | `minIntervalSec` / `minTurnChars` / `maxRunsPerDay` | `30` / `4` / `300` |
| reminder | `enabled` / `checkIntervalSec` / `aheadMin` | `true` / `300` / `0` |
| reminder | `quietHoursEnabled` / `quietStart` / `quietEnd` | `false` / `22:00` / `08:00` |
| brief | `enabled` / `morningTime` / `eveningTime` / `model` | `true` / `09:00` / `21:00` / `deepseek-chat` |
| storage | `scope` / `snapshotInterval` | `workspace` / `daily` |
| recall | `maxTokens` / `topK` | `512` / `5` |
| semantic | `enabled` / `model` / `expansionsPerQuery` | `true` / `deepseek-chat` / `3` |
| semantic | `rerankOn` / `maxRerankCandidates` | `true` / `8` |
| semantic | `dailyBudget` / `minQueryChars` / `degradeAfterEmpty` | `60` / `6` / `5` |
| ui | `aggregateAcrossWorkspaces` / `focusDefaultCount` | `false` / `0` |

`aggregateAcrossWorkspaces` 是兼容字段；当前 `GET /yolo/dashboard` 按产品约束始终聚合所有已登记
工作区，端点不再根据该值退回单工作区。`focusDefaultCount` 仍进入返回载荷。

浏览器端在 `settings.plugin.item` 中绑定 `settingsScope.bind({ namespace: 'yolo' })`。卡片对
extraction、reminder、brief 与 storage 快照节奏采用暂存后显式保存，宿主按 revision 持久化并
回读确认；失败必须保留输入并显示错误，不能只在静态说明中承诺配置。扫描 interval 在调度器
启动时固定，所以卡片明确标注“重启宿主后生效”。

配置 schema 与运行接线并不完全等价：`semantic.*` 会在每条用户消息预热前实时读取；
`storage.scope` 以及 `recall.maxTokens/topK` 目前尚未接入对应主链路，修改这些值不会改变实际
存储作用域或动态召回。各模块文档必须如实标注这种差异。

## Dashboard 与角标

`GET /yolo/dashboard` 遍历 `listWorkspaceMeta()`，用 registry 的 scope key 固定每次读取，再经
`aggregateDashboards()` 合并、全局排序并只保留一个 attention 判断。单工作区损坏会被跳过，
错误进入 `workspaceErrors` 且 `summary.partial = true`；仅当全部工作区均失败时返回 500。

Dashboard v2 是同一个存储上的聚合读投影，没有 v1/v2 双写。每行携带 `scope_cwd`/`ws`。
`GET /yolo/badge` 只聚合完整的未处理通知计数，不为角标构建 dashboard，也不能受 12 条卡片
展示切片影响而少算。

## 动作与会话端点

| 端点 | 作用 |
|---|---|
| `GET /yolo/dashboard` | 全工作区 Dashboard v2 |
| `GET /yolo/badge` | 轻量未处理角标 |
| `POST /yolo/actions` | 经白名单与 scope pin 后调用 `applyYoloAction` |
| `GET /yolo/session/messages` | 读取 resident 或 anchored 对话 |
| `POST /yolo/session/send` | 发送并推进对应 YOLO agent |

无 `thread` 时使用每工作区持久的 `yolo-w-*` resident thread；有 `thread` 时使用延迟创建、
LRU 限额的 `yolo-a-*` anchored 临时线程。两类内部 id 都不会移动 latest workspace。
显式 `cwd` 必须命中 registry。创建 agent 时传入宿主当前 provider/model 并安装 model selection，
否则程序化会话可能因缺少 `{{model}}` 而无法回复。

## 不变量

1. 未知 `scope_cwd` 返回 `unknown_workspace_scope`，不能解析或注册任意路径。
2. 看板行的动作固定到渲染时的 scope key，避免分支切换错写。
3. Dashboard 局部失败必须显式暴露 partial，不能静默伪装完整。
4. resident 与 anchored 历史严格隔离；卡片“聊一聊”从空的 anchored episode 开始。
