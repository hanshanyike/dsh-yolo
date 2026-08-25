# 整体架构

YOLO 不是单个插件，而是**由五个相互协作的 Cordis 插件和一个浏览器客户端组成的插件包**，
运行在 deepseek-harness「一切皆插件」的微内核之上。本文说明其整体布局、数据流与背后的设计决策。

> **文档地图**——本文回答“为什么”（设计决策、数据流、已验证的平台行为）。各模块的文件、
> 类型和公开 API 见 [modules.md](modules.md)；使用方法见 [usage.md](../usage.md)；
> 测试方法见 [testing.md](../testing.md)。

## 设计目标

1. **零外部服务。** 记忆能力无需服务器、嵌入 API 或账号即可工作；存储使用 Node.js 内置 SQLite。
2. **Agent 拥有自己的记忆。** 记忆以模型可见工具和提示词上下文的形式暴露，而不只是后台日志。
3. **持久记录可由人审阅。** SQLite 是运行事实源，系统同时生成可读、可 diff 的 Markdown 快照作为审阅投影。
4. **工作区隔离。** 两个项目之间不会串入彼此的记录；同一 cwd 的 Git 分支共享一份连续计划。
5. **各部分均可替换。** 每项职责都以独立 Cordis 插件实现，并通过能力接缝协作；存储服务是唯一共享状态。

## 插件包布局

```
dsh-plugin-yolo
├── src/index.ts          # 包标识入口（仅加载标记）
├── src/storage/          # dsh-yolo-storage  — 提供 ctx.yolo 服务
├── src/extract/          # dsh-yolo-extract  — 对话 → 记录
├── src/memory/           # dsh-yolo-memory   — 工具 + 提示词注入
├── src/reminder/         # dsh-yolo-reminder — 调度器 + 可回复唤醒
├── src/ui/               # dsh-yolo-ui       — 设置 + 看板 API
├── src/attention/        # 确定性的 dashboard-v2 判断规则
├── src/shared/           # 常量、看板投影、文本工具
└── client/               # 浏览器包——侧栏看板、设置卡
```

`cordis.patch.yml` 连接各入口；`tsdown` 构建宿主插件（ESM，`@deepseek-ai/*` 保持为外部依赖，
由宿主在运行时提供），`tsdown.client.config.ts` 构建浏览器包（CJS，再由
`scripts/wrap-client.mjs` 包装进 `__ModuleLoader__.load`）。客户端构建契约见
[浏览器客户端模块](client.md)。

## 五个插件

| 插件 | 提供 | 依赖 |
|---|---|---|
| **storage** | `ctx.yolo` 服务：SQLite（WAL + FTS5 trigram）仓库、Markdown 快照、作用域解析；带事件审计和模糊标题查找器的**领域动作**（`applyTodoAction` / `applyTodoConsolidate` / `applyGoalProgress` / `applyMilestoneStatus`） | 无（叶子服务） |
| **extract** | 对话 → 结构化记录（新事项 **+ 状态变更 `updates[]`**） | `ctx.yolo`、`agent/pre-step`、`agent/turn-stopping`、`ctx.llm`、设置 |
| **memory** | `memory_search/write/forget` + `yolo_query` / `yolo_action` 工具、systemPrompt 的 section/context | `ctx.yolo`、`ctx.tools`、`ctx.systemPrompt`、`session/event` |
| **reminder** | 提醒/简报卡片，并尽力投递到对应工作区的 YOLO 常驻线程 | `ctx.yolo`、`ctx.agents`、`ctx.llm`、设置 |
| **ui** | dashboard-v2 聚合、轻量角标、动作和面板对话 JSON API；设置区 | `ctx.yolo`、`ctx.webServer`、`ctx.agents`、设置 |

## 模块依赖图

```
┌────────────────────────────── deepseek-harness 宿主 ──────────────────────────────┐
│                                                                                    │
│   src/index.ts   包标识（仅加载标记）                                                │
│                                                                                    │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│   │ src/storage  │◄──│ src/extract  │   │ src/memory   │   │ src/reminder │        │
│   │ ctx.yolo     │   │ 语义提取      │   │ 工具+上下文   │   │ 调度器+提醒   │        │
│   │ （服务）      │   └──────────────┘   └──────────────┘   └──────────────┘        │
│   └──────┬───────┘                            ▲                    ▲               │
│          │ 注入 ctx.yolo                      │                    │               │
│   ┌──────▼───────┐   ┌──────────────┐   ┌─────┴──────────┐        │               │
│   │ src/ui       │   │ src/shared   │   │ client/        │        │               │
│   │ 设置+看板API  │   │ 常量/投影/文本 │   │ 侧边栏看板+设置卡 │        │               │
│   └──────────────┘   └──────────────┘   └────────────────┘        │               │
│                                                                                    │
│   scripts/e2e.mjs / wrap-client.mjs / copy-assets.mjs   测试与构建                   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- `storage` 是叶子服务，没有 YOLO 内部依赖（仅依赖 `shared/text`）。
- `extract` / `memory` / `reminder` / `ui` 均声明 `inject: ['yolo']`。
- `attention` 是纯确定性领域模块：它只消费投影后的事实，从不读取 SQLite、调用 LLM 或信任客户端分数。
- `shared` 被所有模块使用，**优先采用增量式变更**（它的影响面最广）。
- `client/` 通过 HTTP JSON 与宿主 `ui` 插件通信，从不直接访问 SQLite。

各模块的文件地图、关键类型和公开 API 见 [modules.md](modules.md)。

## 数据流

### 写入路径——对话成为记忆

```
pre-step 捕获本轮直接用户消息（不含工具结果和插件上下文）
   │
   ▼
turn-stopping 只排队；等待 turn/end 与 agent 空闲后启动独立后台任务
   │
   ▼
extract：使用捕获的本轮用户消息（有长度上限，不从整段历史反推）
   │
   ▼
LLM 语义提取（闸门：minTurnChars 闲聊闸门
   │       + maxRunsPerDay 每日上限，全部实时读取设置；按会话串行）
   │   ▲ 已知记忆摘要（已存事项，包含状态/进度/截止时间）
   ▼
校验并规整 JSON
   │
   ├─► ctx.yolo.upsert*            （新事项；milestone_title → milestone_id 关联）
   ├─► applyYoloAction / apply*    （updates[]：通过领域动作变更状态）
   ▼
SQLite + FTS5 索引 ──► 每次状态变更同时写入时间线事件
   │                    （失败时写入 status='error' 的 extraction_log 行）
   └──►  Markdown 快照（每日 / 每 10 轮）
```

提取机制**按设计只使用 LLM**。早期逐消息运行的正则快速路径已经移除：正则无法判断语义，
既会制造噪声（每句偶然匹配模式的问候都会入库），也会漏掉不常见的表达方式。业界已趋向相反做法——
[Mem0](https://github.com/mem0ai/mem0) 与 Claude Code 的自动记忆都在一次有效交互*之后*
运行一次 LLM，而不是逐消息运行。YOLO 采用同样形态：每轮做一次结构化提取，并把已存内容的精简摘要
交给模型去重（“不要重复提取未变化的事实”），因此重复轮次只有在内容确实变化时才消耗提取 token。

同一次提取还会输出 `updates[]`：对*已知事项*的变化（完成、开始、推迟、进度陈述）以状态变更返回，
而不是生成重复事项。摘要携带每个事项的状态、进度和截止时间，使模型能判断发生了什么变化。
`mergeExtraction` 先 upsert 新事项，再应用更新，因此“同一轮创建并完成”也能正确处理；每项更新通过
模糊标题匹配定位，无法匹配的更新会被静默丢弃（模型臆造标题是常态，不应视为系统错误）。

### 读取路径——记忆到达模型

```
┌── 静态： systemPrompt section "yolo-prefs"     （偏好，始终启用）
├── 动态： systemPrompt context "yolo-recall"    （最新用户文本的 FTS 召回）
├── 按需： yolo_query / memory_search 工具        （agent 主动拉取视图）
└── 推送： 提醒调度器 → agent.followup(msg)       （到期待办唤醒 agent）
```

动态召回会把最新用户消息交给**混合多查询 FTS**（`ftsRecallSearch`）：将整句匹配（适合精确追问）
与提取 token 的 OR 表达式合并（不少于 3 个字符的拉丁词 + CJK 滑动三元组，最多 8 个），
再为独立的 2 字 CJK 词补充 `title LIKE` 降级路径；随后按 `(row_type, row_id)` 去重，
并以 `recallTopK` 限制结果数。满足门控时，后台还会用宿主 LLM 异步扩写同义/跨语言查询并重排
候选；预热未完成、失败或当天降级时，提示词组装直接使用确定性 FTS 结果。命中结果最终都要经过
确定性的**召回策略**（`applyRecallPolicy`）：
过滤已经注入的事项，将每类记录限制在 `recallKindQuota` 以内，并在按 `recallMaxTokens` 换算的
近似字符预算中贪心装入剩余行；单条过长记录会被跳过，而不会截断其后的全部内容。每一条注入内容都会
转义 `{{`（宿主会严格插值提示词模板），偏好前言只保留最新的 `recallPrefsMax` 条。单个会话中，
`RecallDedupTracker` 只在下一条用户消息到来时提交上一轮保留的键，因此一条记忆在一次对话中只注入一次，
同一轮内重复组装仍保持字节稳定，有利于前缀缓存。提醒卡片是保证可见的界面；向 YOLO 常驻线程的投递
采用尽力而为策略。任何内容都不会重放进工作会话。

推送是*可回复的*：提醒正文只携带用户可读的标题和到期时间；处理规则位于
`yolo-instructions` system section。agent 针对自然语言回复（「已完成 / 推迟到明天 / 再提醒一次」）
按标题调用 `yolo_action`，并通过统一领域动作链完成状态迁移与审计。

### 界面路径——记忆到达用户

```
工作区注册表 ──► GET /yolo/dashboard
                ├─ 固定到各工作区的 v2 投影
                ├─ 聚合数据行 + 全局排序出一项重点判断
                └─ 跳过不可读工作区并标记 summary.partial
ctx.yolo ──► GET /yolo/badge（轻量聚合未处理数）
         ──► POST /yolo/actions（白名单作用域路由 + 领域动作）
YOLO agent ──► GET /yolo/session/messages + POST /yolo/session/send
client ──► 340px 助手面板：今日 / 即将 / 已完成 + 对话界面
```

面板是**全局界面，而不是单会话界面**：记忆的寿命长于任何一次对话，因此入口位于侧栏底部，
不依赖会话；`GET /yolo/dashboard` 始终合并 `listWorkspaceMeta()` 记录的所有工作区。
每一行都携带 `scope_cwd`/`ws`，动作会路由回对应的已注册工作区，并固定到原 `scopeKey`。
如果请求中的 `scope_cwd` 不在注册表内，服务端会返回 `unknown_workspace_scope`，HTTP 调用方
因而无法借此端点打开任意路径或创建幽灵存储。单个工作区被锁定或损坏时会跳过，并通过
`workspaceErrors` 和 `summary.partial=true` 暴露；只有所有工作区都失败时，端点才返回 500。

Dashboard v2 是**单一聚合读取投影**，以 `ui_contract_version: 2` 标识；它不是第二条持久化路径，
也不存在 v1/v2 双写。`src/attention/index.ts` 只从可审计事实（截止时间、提醒、优先级、推迟、
停滞时间、里程碑状态）推导候选项，以稳定的并列决胜规则排序，并且最多发布一项全局判断。
`reason_version`（`attention-v1`）、文案、分数和确定性的 `evidence_fingerprint` 均由服务端掌控；
客户端不能提交自己的分数。已读、抑制和原因反馈必须回传精确的
`(todo_id, reason_version, evidence_fingerprint)` 绑定。因此证据变化后会成为一项新的未读判断，
过期响应则以 `stale_attention` 拒绝。浏览器完整展示未读判断，紧凑展示已读判断。

看板是*可操作的*：浏览器的每次变更都向 `/yolo/actions` 发起 POST，并通过与模型工具
`yolo_action` 相同的 `applyYoloAction` 路径分发。非空 `client_action_id`（最长 128 个字符）
会连同规范化请求哈希和序列化结果存入 `client_actions`：同一个键与载荷即使跨重启也会重放原结果，
同一个键配不同载荷则返回 409 `idempotency_conflict`。

成功变更可以返回可审计的 `audit_event_id`、精确说明发生了什么变化的类型化
`learning_receipt`（尤其会明确没有学到偏好的情况），以及真实、短时有效的 `undo` 描述。
完成动作返回 `reopen`；推迟动作返回用于恢复原日期的 `update`。客户端通过同一动作端点发送撤销，
并遵守服务端的 `expires_at`；不存在仅由客户端推测执行的回滚。

`applyYoloAction` 同时也是**拒绝闸门**（M9 / P34）：每次校验失败都会先写入一条
`action_denied` 时间线事件，再返回 `{ok:false}`；唯一静默拒绝的是幂等的“已处理”空操作。
唯一明确的合并路径是 `consolidate`（M9 / P35）：来源待办的出处会写入目标详情，确定性字段会按规则
继承（补齐缺失的截止时间、采用更高优先级），来源待办会在相关通知处理完毕后取消，并由单条
`todo_consolidated` 事件记录此次合并。`memory_forget` 也通过同一动作路径路由
（cancel / set_status abandoned / abandon），因此没有任何变更可以绕过审计轨迹。

### v0.3.2——管理型助手能力细化

- **对话线程（R19）。** `registerSessionEndpoints` 为 `GET /yolo/session/messages` 和
  `POST /yolo/session/send` 都增加了可选 `thread`。无锚点的“对话”页仍指向每个工作区的
  **常驻**线程（`yolo-w-*`、`YoloSessions`）。卡片上的“聊一聊”会传入新的临时 `thread` 键，
  由 `YoloChatThreads` 解析到可丢弃的 agent 会话（`yolo-a-*`）；该会话在首次发送时延迟创建，
  并按工作区设置 LRU 上限（最旧会话被逐出并释放）。因此面板初始为空，形成一段不会继承常驻线程历史的
  聚焦对话。`yolo-w-*` 与 `yolo-a-*` 都属于 YOLO 内部会话（`isYoloSessionId`），所以提取器和
  工作区跟踪器会跳过它们。两个端点也接受显式工作区（查询参数或请求体中的 `cwd` 字段），但只有与
  `listWorkspaceMeta()` 匹配时才接受；锚定对话因此始终绑定到卡片所属工作区。没有 `thread` 表示
  持久常驻通道，有 `thread` 则表示一段全新、隔离的锚定会话。
- **创建 agent 时选择模型（v0.3.3）。** `YoloSessions` 和 `YoloChatThreads` 现在都从
  `agentDefaultModel.currentSelection()` 取得并传入 `agentOptions: { provider, model }`，同时在
  `setup` 中运行 `installModelSelection`（沿用无头运行器模式）。没有这一步，编程创建的 agent 会报错
  `prompt variable "{{model}}" has no value` 且永不回复；加入后，常驻线程和锚定线程都能真正执行模型轮次。
- **记忆范围（R20）。** 提取提示词现在明确面向*管理型*助手：只保留承诺（待办）、计划
  （目标/里程碑）和跟踪规则（偏好）；人格、品味、通用知识和生活细节记忆都明确不在范围内。
  `memory_write` 与 `yolo-instructions` system section 采用同样边界。
- **写入质量闸门（B3）。** `src/shared/quality.ts` 中的 `shouldDropExtracted` 会在
  `mergeExtraction` 落库前拒绝应答语（“好的/收到/ok”）、纯元命令（“记住这个”）、空标题、
  单字标题和空规则值；一条错误记忆可能触发一条错误提醒。
- **提醒静默时段（B5）。** `inQuietWindow` + `reminder.quiet*` 配置：窗口内暂存提醒
  （不执行 `mark reminded`），并在窗口结束后的第一次 tick 触发，从工程层面落实“绝不打扰”。
- **感知活跃度的标题定位（B6）。** `bestByTitle` 优先精确的规范化匹配，再按状态和新近程度
  对宽松匹配排序，确保标题引用不会落到任意一个率先命中的包含项上。
- **反馈计数器（B1 数据层）。** `todos.good_count`/`stale_count`（完成→good，取消→stale）
  以 `belief` 暴露在看板行上；stale 占优的行显示“常忘”标签。召回侧降权留待后续实现。
- **原子快照（B8）。** `writeSnapshot` 采用“临时文件 + 重命名”。

### 提醒与简报路径——主动，但仅限 YOLO 侧

```
调度 tick ──► 到期待办 ──► notifications 表（卡片 + 角标）
                       └──► followup 到工作区的 YOLO 常驻线程
简报 tick（每分钟）──► 按本地日期各生成一次早报/晚报 ──► 通知卡片
                  └──► 存储查询事实；可选 LLM 润色；Markdown 降级文案
```

工作会话保持**完全静默**：提醒和简报只通过 YOLO 面板（卡片 + 角标）与 YOLO 常驻线程
（`yolo-w-<sha1(cwd)/12>`，延迟创建，跨重启恢复）到达用户。旧版在 session-start 时将提醒重放到
下一个启动的任意工作会话的机制已经移除；`pending_reminders` 仅为兼容性保留在 schema 中，
不再有任何写入方。

## 存储设计

```
data/
├── yolo-<scope>.db     # SQLite：todos、milestones、goals、preferences、events，
│                       #   session_summaries, notifications, attention_feedback,
│                       #   client_actions
│                       #   + FTS5 虚拟表（trigram tokenizer）
└── snapshots/*.md      # Markdown：可读、可 diff 的审阅投影
```

- **作用域键** = `sha1(canonical cwd)/default`——每个工作区对应一个数据库，与 Git 状态无关；
  Windows 的路径比较忽略大小写并归一化分隔符和 `..`。
- **FTS5 trigram** 无需特定语言的分词器，就能为 CJK 与 ASCII 提供子串匹配；召回路径叠加
  整句查询、token OR 查询与二字中文标题 `LIKE` 降级。
- **SQLite 是运行事实源**：当前没有从 Markdown 解析并重建数据库的实现。快照按配置选择每天一次
  或每 10 个真实工作会话轮次一次，并采用临时文件加重命名的原子写入；
  `snapshotKeepDays` 目前只是常量，尚无自动清理任务消费它。
- **会话归属（v0.3.0）**——`events.session_id`（来源 dsh 会话）与 `events.source`
  （`llm|tool|manual`）共同生成今日台账的来源标记；`session_summaries` 保存提取时写入的每个会话
  单行摘要。`notifications` 保存提醒/简报卡片；侧栏角标显示未处理行数。
- **判断信任状态**——`attention_feedback` 以
  `(scope_key, todo_id, reason_version, evidence_fingerprint)` 为键，只为对应的不可变判断版本保存
  已读、抑制和原因反馈。
- **变更幂等性**——`client_actions` 以 `(scope_key, client_action_id)` 为键，持久保存请求哈希与结果；
  它不会复制领域数据行，也不会建立一条平行的看板写入路径。
- **带事件审计的领域动作**——状态不再通过直接写列改变。待办通过 `applyTodoAction`
  （`complete` / `cancel` / `postpone` / `remind_again` / `start`），目标通过
  `applyGoalProgress`（0–100，达到 100 时自动完成），里程碑通过 `applyMilestoneStatus`；每次迁移都会
  写入时间线事件（`todo_completed/cancelled/postponed/started`、`todo_remind_again`、
  `goal_progress`、`milestone_status`）。`events.kind` 列是自由格式（没有 CHECK 约束），
  因此新增事件类型无需 schema 迁移。事项使用标题而非 id 引用时，`findTodoByTitle` /
  `findGoalByTitle` / `findMilestoneByTitle` 会通过规范化包含匹配定位（仅搜索非终态事项）。

关键设计决策及理由：

| 决策 | 理由 |
|---|---|
| SQLite + FTS5，而非向量存储 | 零外部服务、结果确定，并提供对 CJK 友好的子串召回；现有语义增强通过宿主 LLM 做查询扩写与候选重排，不另设向量库 |
| 只用 LLM 提取，不设正则快速路径 | 正则无法判断语义，会同时引入噪声和漏检；每轮执行一次模型提取，并用已知记忆去重，符合 Mem0、Claude Code 自动记忆等业界模式 |
| 全局侧栏看板，而非单会话页签 | 记忆天然跨会话；为每个会话生成快照会把数据重复写入各会话日志 |
| 服务端掌控的确定性重点判断 | 从可审计事实中选出的唯一、可解释候选项可在刷新间保持稳定；不可变指纹避免反馈绑定到已经变化的证据 |
| 聚合读取，写入固定到工作区 | 用户看到一份跨工作区计划；同时将 `scope_cwd` 限制在 canonical cwd 注册表内，确保动作安全且等价路径不会生成幽灵库 |
| 以 SQLite 为事实源、Markdown 为审阅投影 | SQLite 承担查询与事务；快照便于 git 比较和人工审阅，但当前不承担数据库恢复 |
| 只按 canonical cwd 划分作用域 | 会话不一定属于 Git 仓库；同一工作区切分支仍是同一计划，且省去周期性 Git 子进程探测 |
| 共享常量模块 | dsh 尚处 v0.1.0-rc；API 漂移应只需修改一处 |
| 带事件审计的领域动作 | 提取、对话回复和看板共享同一条状态迁移路径，使行为和审计保持一致；时间线也成为“到哪了”的可审计答案 |
| 可回复的提醒 | 用户可读正文只含标题/到期时间；system section 提供处理规则，agent 按标题调用统一动作入口 |
| 更新采用模糊标题匹配 | LLM 输出很少逐字复现已存标题；规范化包含查找无需 id 即可定位事项，未匹配更新则静默丢弃——臆造标题是常态，不是错误 |
| YOLO 常驻线程，工作会话静默 | 把主动消息投递到下一个碰巧启动的会话会在用户编码时造成惊扰（M8 的教训）；专用 `yolo-w-*` 线程让提醒有固定归宿、面板对话保持状态，同时不触碰工作会话 |
| 与测试共享的纯筛选模块 | 看板筛选语义（今日 = 逾期 + 今日到期等）属于产品行为；将其固定在 `shared/filters.ts`，可保持界面层简单并让规则可验证 |

## 使用的扩展点

| dsh 扩展点 | 使用方 | 用途 |
|---|---|---|
| `ctx.effect` / service provide | storage | 提供 `ctx.yolo` 服务 |
| `session/event`（`user/message` 等） | memory | 跟踪最新用户文本，以供动态召回 |
| `agent/pre-step` | extract | 在宿主接受 step 后快照本轮直接用户消息，避免从裁剪后的完整历史反推 |
| `agent/turn-stopping` | extract、reminder、ui | extract 只排队，待 `turn/end`/空闲后后台提取；reminder/ui 跟踪快照/工作区；均忽略 YOLO 内部线程 |
| `ctx.llm.stream` | extract | 结构化提取提示词（`purpose: 'session-title'` 用于隔离辅助流量） |
| `ctx.tools.register` | memory | 注册 `memory_*` + `yolo_query` + `yolo_action` |
| `ctx.systemPrompt.section/context` | memory | 注入偏好前言 + 动态召回 |
| `ctx.agents` + `Agent.followup` | reminder、ui | 管理 YOLO 常驻/锚定线程；主动投递从不指向工作会话 |
| `agent/session-start` | reminder、ui | 跟踪真实工作区；明确忽略 YOLO 常驻/锚定会话 id |
| `ctx.webServer`（前缀路由） | ui | 提供看板、角标、动作和会话 JSON API |
| `sidebar.footer.action`、`settings.plugin.item` 插槽 | client | 提供全局看板按钮 + 设置卡 |

## 已验证的平台行为（dsh v0.1.0-rc.8）

以下内容全部针对 deepseek-harness 宿主做过**运行时验证**，不是从文档中照录。官方文档未说明之处，
记录的是实际采用的降级方案。这些结论与已有假设冲突时，以此处为准。

### 加载与启动

| 事实 | 影响 |
|---|---|
| 插件模块必须**默认导出**插件（函数，或带 `apply` 的对象/类） | 只提供具名导出（`export class Yolo`）会让加载器传入整个模块命名空间，导致 `invalid plugin, expect function or object with an "apply" method` |
| Windows 下入口 `name` 必须是 `file:///` URL | 直接使用 `D:/...` 会抛出 `ERR_UNSUPPORTED_ESM_URL_SCHEME`（Node 会把 `d:` 当作 URL scheme） |
| 插件模块上的 `export const inject: string[] = [...]` 会生效 | patch 行只需包含 `id` + `name` |
| `ctx.logger.info` **不会**输出到宿主终端 | dsh 会把 logger 输出路由到其他位置；需要终端可见标记时使用 `console.log` |
| 运行 `pnpm dsh web` 前必须先运行 `pnpm run build` | `dsh-web-app` 会解析预构建的前端 `dist`，否则抛出 `frontend dist not built` |
| pnpm 的 `safe-delete` 回收站操作在 Git Bash 下失败 | 安装及任何会触碰临时目录的启动操作都应通过 **PowerShell** 运行 pnpm |
| Web 端口报 `EADDRINUSE` | 已终止但未清理的 dsh 进程仍占用端口；用 `Get-NetTCPConnection -LocalPort <port> ... \| Stop-Process` 清理 |

### LLM

| 事实 | 影响 |
|---|---|
| `GenerateOptions.purpose` 是**封闭联合类型** `'compaction' \| 'session-title'` | 不存在自定义标签；YOLO 借用 `'session-title'` 隔离辅助流量 |
| `ctx.llm.stream()` 返回 `AsyncIterable<StreamChunk>` | 使用 `BlockAssembler` 折叠（先 `push(chunk)`，再 `blocks()`）；变体为 `block-start/text-delta/block-end/usage/finish` |

### 会话与 agent 事件

| 事实 | 影响 |
|---|---|
| `agent/pre-step` 是 waterfall，`next()` 返回宿主最终接受的消息；`agent/turn-stopping` 载荷为 `{ agent, turn, signal }` | extract 从 `pre-step` 的最终消息中只保留 `source.kind === 'user'` 的直接输入；`turn-stopping` 不等待辅助模型，后台在 `Agent.whenIdle()` 后确认对应 `turn/end` 再提取。作用域 cwd 通过 `sessionCwd()` 读取 `session.header.cwd` |
| `session/event` 发出 `(session, event)` | `event.type: 'user/message' \| 'assistant/message'` 携带 `event.data.content: ContentBlock[]` |
| `AssembleContext` **只有** `{ scope?, signal? }`，没有 `userMessage` | memory 插件通过 `session/event` 缓存最新用户文本，召回上下文读取该缓存 |
| `agent/session-start` 载荷为 `{ agent, source }` | reminder/ui 只用它跟踪真实工作区；旧的工作会话提醒回放已经删除 |
| `Agent.inject/followup/steer` 接收 `UserMessage` | `createUserMessage` **必须**包含 `source`（`{ kind: 'user' }`），否则类型检查失败；提醒使用 resident agent 的 `followup(msg)`，不指向工作会话 |
| `AgentRegistry` 没有“列出活跃 agent”的 API | reminder 通过 `YoloSessions` 按工作区延迟创建并复用 resident agent，不再维护 `latestAgent` 投递目标 |
| `ctx.systemPrompt.section({name, order, text, complete?})` / `.context({name, order, text})` | 重复 `name` 会抛错；YOLO 排序为：110 instructions / 120 prefs / 220 recall |
| `ctx.effect(() => start())` 返回清理函数 | 已确认 cordis effect 的清理契约 |

### 设置与客户端包

| 事实 | 影响 |
|---|---|
| 设置宿主侧使用 `@deepseek-ai/dsh-settings` 的 `installSettingsSection(ctx, ns, Config, config, { setSource?, onChange?, validate? })` | `settingsNamespace('yolo')` 是连接客户端侧的键；无需 `inject: ['settings']` |
| schemastery 的 `z<Config>` 模式 | 此构建中**不能使用** `z.literal` / `z.union` / `z.infer`，应使用 `z.string()` + min/max/default |
| 客户端包发现：`ClientModuleRegistry` 扫描加载器入口并调用 `require.resolve('<entry>/package.json')` | 必须同时满足三个条件——（1）入口名能解析到包（`dsh-plugin-yolo/dist/src/...` 子路径 + 一个裸 `dsh-plugin-yolo` 入口，并在 `~/.dsh/profiles/node_modules/dsh-plugin-yolo` 建立 junction）；（2）`dsh.client` 是**对象** `{ platform: 'web' }`，字符串会被 `parseDshClient` 拒绝；（3）产物是 CJS，以 `window.__ModuleLoader__.load({id, factory})` 包装，并带 `process` shim（React CJS 入口） |
| **插件包 patch 必须包含裸包入口。** 除各子路径行外，`cordis.patch.yml` 还需要一行 `{ id, name: 'dsh-plugin-yolo' }`。注册表会把每个入口的 *name* 解析为 `<name>/package.json`；子路径入口（`dsh-plugin-yolo/dist/src/storage`）只能解析到没有 package.json 的子路径，因此**不是**客户端行。只有裸包名能解析到包根目录，并由其中的 `dsh.client` 声明 Web 包；所以仅含子路径行的 patch 虽能挂载宿主插件，却不会在普通 `dsh web` 中显示侧栏按钮/面板。`cordis.dev.yml` 包含裸入口（因此 patch-local 宿主能渲染），`cordis.patch.yml` 原本没有，导致通过 `dsh plugin add` 安装的包能访问 `/yolo/dashboard` 却没有面板。 |
| 客户端包以经典 `<script>` 提供 | 必须是 CJS（`module.exports`）；ESM `export {}` 会留下空 factory，导致 `loaded without registering`；也不能裸用 Node 全局变量（`process is not defined`） |

### 存储与运行时

| 事实 | 影响 |
|---|---|
| Node.js 内置 SQLite 的 FTS5 trigram | 对不少于 3 个字符的查询有良好的 CJK 召回；M9 的 `ftsRecallSearch` 增加 token-OR 多查询和 `title LIKE` 降级路径，使 2 字 CJK 词也能命中 |
| 开发工具仍有构建脚本 | `pnpm-workspace.yaml` 只需允许 `esbuild`，并保持 `nodeLinker: hoisted`；发布包运行时不需要安装原生依赖 |
| SQLite 不支持 `ADD COLUMN IF NOT EXISTS` | `openDb()` 会对旧数据库检查 `PRAGMA table_info(...)` 并执行 `ALTER TABLE` |

### Windows 环境

| 现象 | 原因与修复 |
|---|---|
| `SetNamedSecurityInfoW failed (Win32 5): grantWrite(<workspace>)` | dsh 沙箱需要工作区的 `WRITE_DAC` 权限来添加持久 ACE；如果目录所有者是 `BUILTIN\Administrators`，授权会失败。修复方法：以管理员身份运行一次 dsh、取得目录所有权，或把工作区移到 `%USERPROFILE%` 下。如果同时出现 `Rc55: syntax error near '<'`，后者是下游 shell 解析失败 |
| pnpm 报 `[safe-delete] trash operation ... aborted` | Git Bash 回收站 API 失败，应通过 PowerShell 运行 pnpm |

### 设计决策：为何不使用动态 Cordis 插件

YOLO 有意**不使用**动态插件机制（`cordis_define` + `cordis_run`）：动态插件的 `code.host` 是纯 JS
函数体，不支持模块解析、`fs` 或 `node:sqlite` 导入，无法承载 TypeScript + SQLite 项目。
标准本地运行路径是使用已安装的 `dsh` CLI 与 web profile
（`dsh plugin --profile web add .` + `dsh web`）。

## 修改某项能力时从哪里入手

| 想修改的内容 | 起点 |
|---|---|
| schema / 索引 / FTS | `src/storage/schema.sql` + `repository.ts` |
| 领域动作 / 事件审计 / 标题查找器 | `src/storage/repository.ts` + `src/storage/index.ts` |
| 共享动作契约（工具 + HTTP + 提取） | `src/shared/actions.ts` |
| 会话作用域 / id 辅助函数 | `src/shared/session.ts` |
| 提取提示词 / 分类体系 / `updates[]` | `src/extract/prompt.ts` |
| 提取触发 / 节流 / 合并 | `src/extract/index.ts` + `llm-extract.ts` |
| 模型可见工具 | `src/memory/tools.ts` |
| system prompt 注入 / 动态召回 | `src/memory/recall.ts` |
| 提醒调度 / 可回复文案 / 快照节奏 | `src/reminder/scheduler.ts` + `index.ts` |
| 配置 schema / 默认值 | `src/ui/config.ts` + `src/shared/constants.ts` |
| 看板 JSON 结构 | `src/shared/dashboard.ts` + `src/ui/dashboard.ts` |
| 确定性判断 / 证据指纹 | `src/attention/index.ts` |
| 判断反馈 / 持久动作幂等性 | `src/storage/schema.sql` + `src/shared/actions.ts` |
| 看板动作 API | `src/ui/actions.ts` |
| 常驻与锚定面板对话 | `src/ui/session.ts` + `client/panel/ChatPane.tsx` |
| 轻量角标 | `src/shared/badge.ts` + `src/ui/badge.ts` + `client/sidebar/YoloSidebarDashboard.tsx` |
| 助手面板界面 | `client/panel/YoloPanel.tsx` + `client/panel/KanbanView.tsx` + `client/panel/v2/` |
| 构建 / 测试 / 运行 | `scripts/e2e.mjs`、`wrap-client.mjs`、`copy-assets.mjs`；使用已安装的 `dsh` CLI 走标准运行路径 |
| 新增测试 | [testing.md](../testing.md) |

完整的逐模块参考（文件、类型、公开 API、易错点）见 [modules.md](modules.md)。
