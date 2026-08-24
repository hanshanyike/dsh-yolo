# `client/`：浏览器客户端

## 职责与边界

客户端把 YOLO 注册为全局侧栏入口和设置卡，在同一助手面板内呈现计划、通知和对话。它只通过
`src/ui/` 暴露的 JSON API 工作，共享 TypeScript 载荷类型，但不访问 SQLite，也不自行决定
领域状态、attention 分数或撤销真相。

## 文件结构

| 路径 | 职责 |
|---|---|
| `index.ts` | 注册 `settings.plugin.item` 与 `sidebar.footer.action` 两个 slot |
| `settings/SettingsCard.tsx` / `model.ts` | 设置表单、校验、宿主持久化与回读 |
| `sidebar/YoloSidebarDashboard.tsx` | 侧栏入口、轻量 badge 轮询和面板挂载 |
| `panel/YoloPanel.tsx` | 340px/全屏 shell、数据加载、主题、导航与通知聚焦 |
| `panel/KanbanView.tsx` | 看板视图、筛选、动作编排和 anchored chat 入口 |
| `panel/ChatPane.tsx` | resident/anchored 共用对话视图与请求构造 |
| `panel/chat/controller.ts` / `scroll.ts` | 跨组件重挂载请求控制器、单调状态水合和 near-bottom 滚动策略 |
| `panel/CaptureBar.tsx` | 快速新增输入 |
| `panel/ViewTabs.tsx` / `MoreMenu.tsx` | 主导航与低频入口 |
| `panel/state.ts` | 面板 UI 状态及当前 anchored thread 身份的模块级读写 |
| `panel/v2/` | Today 投影模型、助手判断、任务动作、学习回执、撤销和 API client |
| `design/` | Mono tokens、全局样式注入和单色图标 |
| `YoloLogo.tsx` | 产品标识组件 |

## 加载与刷新策略

- 面板是 session-independent 的全局表面，挂在侧栏 footer，而非某个工作会话 tab。
- 打开面板时请求一次 `GET /yolo/dashboard`；动作成功与手动刷新后重新拉取。
- 完整 dashboard 不做 30 秒轮询，避免持续重建跨工作区投影。
- 侧栏角标独立请求 `GET /yolo/badge`，面板关闭时也可更新。
- 面板状态只保存视图、筛选和展示偏好；领域数据始终以服务端返回为准。

## 动作与信任交互

所有变更通过 `postYoloAction()` 调用 `POST /yolo/actions`。客户端生成 `client_action_id`，处理
结构化错误，并只展示服务端返回的 `learning_receipt`。完成/推迟后的撤销使用服务端生成的
`undo` descriptor，必须在 `expires_at` 前通过同一动作端点提交，不能做客户端私有回滚。

首读未见过的 attention 判断后提交 `seen`；同一证据刷新/重开后显示紧凑形态。suppress 与
feedback 必须回传服务端给出的 `reason_version` 和 `evidence_fingerprint`。客户端不计算或
覆盖 score、reason、fingerprint。Today 的次级“需要关注”行只呈现主理由和去重后的其余结构化
evidence；完整 explanation 只保留给主助手判断，避免同一事实在一行内复读。

## 对话

无 anchor 的对话访问该工作区 resident thread；卡片“聊一聊”生成独立 thread key，并附带卡片
所属 `scope_cwd` 访问 anchored thread。模块级 `ChatConversationController` 按 conversation 保存
optimistic 用户行与 `client_request_id`；side/full 切换或面板重挂载先从宿主 GET 水合，不会重放
POST。只接受不小于当前 revision 的结果，避免旧 poll 把 completed 回退为 accepted。
侧栏使用 `.dock-msgs`、全屏使用 `.p-body` 作为各自真实 scroll owner；首载与 near-bottom 状态下
的发送/回复自动跟随，用户主动上翻后保留位置，只显示不抢焦点的“有新消息 · 回到最新”。

## Mono 设计约束

- 中性色加单一 indigo，总色数保持克制；层级主要由排版和间距表达。
- 使用发丝线结构，不增加过度隐喻装饰。
- 常规动效不超过 200ms，并尊重 reduced-motion。
- 340px 窄面板优先显示今天、即将、已完成；目标与台账放入 More。
- UI 变更必须按 `docs/testing.md` 执行适用的 W1–W8 真机验证。

## Bundle 构建契约

dsh 的 client registry 会解析 loader entry 对应包根的 `package.json` 并读取
`dsh.client: { platform: 'web' }`。以下条件缺一不可：

1. `cordis.patch.yml` 包含裸包名 `dsh-plugin-yolo` entry；仅有 `dist/src/*` 子路径时无法发现
   包根 manifest。
2. `dsh.client` 必须是对象，不是字符串。
3. client 先构建为 CJS，再由 `scripts/wrap-client.mjs` 包进
   `window.__ModuleLoader__.load({ id, factory })`。
4. classic script 环境没有 Node 全局，wrapper 必须提供 React CJS 所需的 `process` shim。
5. factory 最终返回 `{ apply, inject, name: 'yolo-client' }`。

加载与环境故障的集中排查见 [运行与装配](runtime.md)。
