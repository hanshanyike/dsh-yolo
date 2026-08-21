# 模块设计文档（Module Reference）

> 面向开发者的**逐模块代码地图**：每个模块的职责、文件清单、关键类型、公开 API、依赖与实现细节。
> 改代码前先查这里，避免挨个翻源码。架构与数据流见 [architecture.md](architecture.md)；
> 运行时踩坑与构建契约见 [dev-notes.md](dev-notes.md)；测试体系见 [testing.md](testing.md)。

---

## 目录

1. [总览与依赖图](#一总览与依赖图)
2. [src/index.ts — 包入口](#二srcindexts--包入口)
3. [src/shared/ — 共享层](#三srcshared--共享层)
4. [src/storage/ — 存储服务（ctx.yolo）](#四srcstorage--存储服务ctxyolo)
5. [src/extract/ — 语义提取](#五srcextract--语义提取)
6. [src/memory/ — 记忆工具与上下文注入](#六srcmemory--记忆工具与上下文注入)
7. [src/reminder/ — 主动提醒](#七srcreminder--主动提醒)
8. [src/ui/ — 设置与看板 API](#八srcui--设置与看板-api)
9. [client/ — 浏览器端 bundle](#九client--浏览器端-bundle)
10. [scripts/ — 构建与运行脚本](#十scripts--构建与运行脚本)
11. [配置项速查](#十一配置项速查)
12. [改动时该看哪](#十二改动时该看哪)

---

## 一、总览与依赖图

YOLO 不是单个插件，而是 **5 个协作的 Cordis 插件 + 1 个浏览器 bundle**，通过
`cordis.bundle.yml` 装配。存储服务是唯一共享状态，其余插件都依赖它。

```
┌────────────────────────────── deepseek-harness host ──────────────────────────────┐
│                                                                                    │
│   src/index.ts  包入口（load marker，无逻辑）                                        │
│                                                                                    │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│   │ src/storage  │◄──│ src/extract  │   │ src/memory   │   │ src/reminder │        │
│   │ ctx.yolo     │   │ 语义提取      │   │ 工具+上下文   │   │ 调度器+提醒   │        │
│   │ (Service)    │   └──────────────┘   └──────────────┘   └──────────────┘        │
│   └──────┬───────┘                            ▲                    ▲               │
│          │ 注入 ctx.yolo                      │                    │               │
│   ┌──────▼───────┐   ┌──────────────┐   ┌─────┴──────────┐        │               │
│   │ src/ui       │   │ src/shared   │   │ client/        │        │               │
│   │ 设置+看板API  │   │ 常量/投影/文本 │   │ 侧边栏看板+设置卡 │        │               │
│   └──────────────┘   └──────────────┘   └────────────────┘        │               │
│                                                                                    │
│   scripts/dev.mjs / wrap-client.mjs / copy-assets.mjs  构建与运行                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**依赖规则**：

- `storage` 是叶子服务，不依赖任何 YOLO 内部模块（只依赖 `shared` 的 `text`）。
- `extract` / `memory` / `reminder` / `ui` 都通过 `inject: ['yolo']` 注入存储服务。
- `shared` 被所有模块共用，改动它影响面最大——**优先只加不改**。
- `client/` 通过 HTTP `GET /yolo/dashboard` 与 host 端 `ui` 插件通信，不直接碰 SQLite。

---

## 二、src/index.ts — 包入口

| 项 | 值 |
|---|---|
| 插件名 | `yolo` |
| 职责 | 让 `import 'dsh-plugin-yolo'` 有稳定身份 + 启动验证标记 |
| 逻辑 | 仅打印 `[yolo] plugin loaded`（`ctx.logger` + `console.log` 双保险） |

**注意**：真正的 5 个插件各自有独立 entry（`src/{storage,memory,extract,reminder,ui}/index.ts`），
`cordis.bundle.yml` 逐个引用。`src/index.ts` 只是 npm 包根入口。

---

## 三、src/shared/ — 共享层

被所有模块共用，**改动需谨慎**。

### 文件清单

| 文件 | 内容 |
|---|---|
| `constants.ts` | 命名空间、服务名、UI slot key、prompt 顺序、默认配置常量 |
| `dashboard.ts` | 看板 JSON 载荷类型（host 与浏览器共享的跨边界形状）+ `todoSummary` |
| `text.ts` | `contentBlocksToText` / `normalizeTitle` / `localDateStr` 文本工具 |

### 关键常量（constants.ts）

```ts
NAMESPACE = 'yolo'                      // settings 命名空间
SERVICE_NAME = 'yolo'                   // ctx.yolo 服务名
SLOT = { sidebarFooterAction: 'sidebar.footer.action',
         settingsPluginItem: 'settings.plugin.item' }
PROMPT_ORDER = { instructions: 110, preferencesPreamble: 120, recallContext: 220 }
DEFAULTS = {
  scope: 'workspace',
  reminderCheckIntervalSec: 300,        // 提醒扫描间隔
  reminderAheadMin: 60,                 // 提前量（分钟）
  extractionMinIntervalSec: 30,         // 抽取节流
  extractionTokenBudgetPerTurn: 2048,
  extractionTokenBudgetPerDay: 100_000,
  recallMaxTokens: 512,                 // 动态召回 token 预算
  recallTopK: 5,                        // 召回条数
  snapshotKeepDays: 90,
}
```

> `DEFAULTS` 是代码内默认值；用户在 Settings 里改的配置会覆盖它（见 [ui/config.ts](#八srcui--设置与看板-api)）。

### 关键类型（dashboard.ts）

```ts
YoloDashboardData = {
  scopeKey: string; cwd: string; at: number;
  todos: YoloTodoRow[]; goals: YoloGoalRow[]; milestones: YoloMilestoneRow[];
  events: YoloEventRow[]; preferences: YoloPreferenceRow[];
}
```

### 关键函数（text.ts）

| 函数 | 作用 |
|---|---|
| `contentBlocksToText(blocks)` | 把消息的 text 内容块拼成字符串（跳过非 text 块） |
| `normalizeTitle(s)` | 标题归一化（小写 + 去非字母数字）用于去重 |
| `localDateStr(d?)` | 本地时区 `YYYY-MM-DD`（**不要**用 `toISOString().slice(0,10)`，会差 UTC 偏移） |

---

## 四、src/storage/ — 存储服务（ctx.yolo）

**核心模块**。以 Cordis `Service` 形式暴露 `ctx.yolo`，是唯一共享状态。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | `Yolo extends Service` 类——对外 API 门面，懒打开并缓存 DB |
| `db.ts` | `openDb()` 打开/建库 + 应用 schema + 轻量迁移 + `getMeta/setMeta` |
| `repository.ts` | 各表的类型化 CRUD（upsert/列表/状态流转/FTS 同步） |
| `scope.ts` | scope key 计算（`sha1(cwd)/<branch>`）、数据目录解析、DB 文件名 |
| `search.ts` | FTS5 全文搜索（trigram），`toFtsPhrase` 转义 |
| `snapshot.ts` | Markdown 快照渲染与写入 |
| `types.ts` | 领域类型（Todo/Milestone/Goal/Preference/Event/…） |
| `schema.sql` | SQLite schema（建表 + 索引 + FTS5 + 触发器） |

### 领域类型（types.ts）

```ts
TodoStatus     = 'pending' | 'in_progress' | 'done' | 'cancelled'
MilestoneStatus= 'planned' | 'active' | 'done' | 'abandoned'
GoalStatus     = 'active' | 'achieved' | 'abandoned'
Priority       = 'low' | 'medium' | 'high' | 'urgent'
EventKind      = 'note' | 'decision' | 'milestone_reached' | 'reminder_fired'
Source         = 'rule' | 'llm' | 'tool' | 'manual'   // 记忆来源（审计+去重）
ScopeMode      = 'workspace' | 'user' | 'global'
RowType        = 'todo' | 'milestone' | 'goal' | 'preference' | 'event'
```

### 公开 API（ctx.yolo，全部带 `cwd` 参数）

| 分组 | 方法 |
|---|---|
| 作用域 | `resolve(cwd, mode?)` 返回 `{ db, scopeKey, dataDir }`；`close()` 关闭全部缓存 |
| todos | `addTodo` / `setTodoStatus` / `listTodos` / `listDueTodos` / `setTodoReminded` |
| milestones | `addMilestone` / `setMilestoneStatus` / `listMilestones` |
| goals | `addGoal` / `setGoalProgress` / `listGoals` |
| preferences | `addPreference` / `listPreferences` |
| events | `addEvent` / `listEvents` |
| search | `search(cwd, query, topK?, kinds?)` |
| extraction log | `logExtraction` / `lastExtractionAt` |
| pending reminders | `queueReminder` / `listPendingReminders` / `deletePendingReminder` |
| snapshot | `renderSnapshot` / `writeSnapshot` / `lastSnapshotDate` / `setSnapshotDate` |

### 关键实现细节

- **Scope key**：`sha1(cwd).slice(0,12) + '/' + git分支`，非 git 仓库回退 `default`。
  数据目录：workspace 模式 = `<cwd>/.dsh/yolo/`；user 模式 = `~/.dsh/yolo/`；global = `~/.dsh/yolo/global/`。
- **DB 文件**：`yolo-<scopeKey>.db`（路径分隔符替换为 `_`）。
- **去重**：todo 用 `dedup_key = 'todo:' + normalizeTitle(title)`；milestone/goal 按 `title+scope_key`；
  preference 按 `key+scope_key`；event 无 key，靠最近 30 条 summary 去重。
- **FTS 同步**：INSERT 由 schema.sql 触发器写入 `yolo_fts`；UPDATE/DELETE 在 repository.ts 里显式处理
  （`syncTodoFts` / 软删）。完成/取消的 todo、done/abandoned 的 milestone 会从 FTS 移除。
- **迁移**：`db.ts` 的 `migrate()` 用 `PRAGMA table_info` 检查列是否存在（SQLite 无 `ADD COLUMN IF NOT EXISTS`）。
- **快照是真相源**：DB 是可重建缓存；`snapshots/YYYY-MM-DD.md` 是持久、可 diff 的记录。

---

## 五、src/extract/ — 语义提取

**M7 起 LLM-only**：每轮对话结束时（`agent/turn-stopping`）把整轮消息交给大模型做一次结构化提取。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | 插件入口：turn 结束触发、节流、配置读取、结果合并、失败隔离 |
| `llm-extract.ts` | `llmExtract()` 调用 + `parseExtractionJson`/`validateExtraction` 防御式解析 |
| `prompt.ts` | `buildExtractionPrompt()` 系统提示词 + `buildKnownContext()` 去重摘要 |

### 数据流

```
agent/turn-stopping
  → messagesToText(session.deriveMessages(), 8k)   // 超长保尾部
  → 节流检查（lastExtractionAt + minIntervalSec）
  → knownDigest(yolo, cwd)                          // 已存记忆摘要（≤1500 字符）
  → llmExtract({ llm, provider:'deepseek', model, turnText, knownContext, signal })
  → mergeExtraction(yolo, cwd, result)              // upsert 入库 + 事件去重
  → logExtraction(...)                              // 审计日志
```

### 关键细节

- **触发**：仅 `agent/turn-stopping`，无逐消息正则路径。
- **节流**：每 session 每 `minIntervalSec`（默认 30s）最多一次 LLM 调用。
- **配置**：`extraction.enableLLM / model / minIntervalSec` 每轮从 settings 实时读取。
- **流量隔离**：`ctx.llm.stream` 的 `purpose` 借用 `'session-title'`（host 只接受 `compaction|session-title`）。
- **失败隔离**：handler 永不向 agent 循环抛异常，只记 warn。
- **分类学**：todos 覆盖 **scheduled commitments**（会议/出行/预约/交付），events 覆盖 scheduled plans。
- **JSON 解析**：容忍 ```json``` 围栏、周围杂音、畸形条目（丢弃畸形保留合法），全部失败返回空结果。

---

## 六、src/memory/ — 记忆工具与上下文注入

让模型能读/写/删记忆，并把偏好与相关记忆注入 system prompt。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | 插件入口：注册工具 + 跟踪最新用户消息与最新 session cwd |
| `tools.ts` | 4 个模型可见工具（`memory_search/write/forget` + `yolo_query`） |
| `recall.ts` | systemPrompt 的 section/context 注册（指令、偏好前置、动态召回） |

### 模型可见工具（tools.ts）

| 工具 | 参数 | 作用 |
|---|---|---|
| `memory_search` | `query`, `topK?`, `kinds?` | FTS 全文搜索记忆（CJK 建议 ≥3 字符） |
| `memory_write` | `kind`, `title`, `detail?`, `due_at?`, `target_date?`, `priority?`, `key?`, `value?` | 写入 todo/milestone/goal/preference/event |
| `memory_forget` | `kind`(todo/milestone/goal), `id` | 软删除（todo→cancelled，milestone→abandoned） |
| `yolo_query` | `view`(timeline/todos/goals/milestones/preferences), `status?`, `limit?` | 查询看板视图 |

> **坑**：工具 `execute` 回调运行时没有 live Session 在作用域内，cwd 回退 `process.cwd()`；
> 与 extract/reminder 优先用 `session.meta?.cwd` 不同。web profile 下两者解析到同一工作区。
> 工具输出必须包成 `{ rows: [...] }` 形状（output.schema 是 `{ type: 'object' }`，裸数组会被 host 拒绝）。

### systemPrompt 贡献（recall.ts）

| 名称 | 顺序 | 内容 |
|---|---|---|
| `yolo-instructions` | 110 | 能力引导：告诉模型无需为截止时间建文件/调工具，YOLO 已自动处理 |
| `yolo-prefs` | 120 | 持久偏好前置（`## User preferences`），无偏好时渲染空 |
| `yolo-recall` | 220 | 动态召回：对最新用户消息做 FTS 搜索，按 token 预算渲染 `## Related memory` |

> **坑**：rc.8 的 `AssembleContext` 没有 `userMessage`，动态召回靠 memory 插件通过
> `session/event` 缓存的"最新用户消息"。召回失败降级为空，绝不拖垮 system prompt 组装。

---

## 七、src/reminder/ — 主动提醒

时间触发的主动提醒 + 快照调度。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | 插件入口：session-start 回放、turn 快照触发、启动调度器 |
| `scheduler.ts` | `runReminderTick`（纯函数可测）+ `startReminderScheduler` + 快照写入 |

### 数据流

```
setInterval(reminderCheckIntervalSec=300s)
  → runReminderTick:
      listDueTodos(cwd, aheadIso)          // 本地时间比较（避免 UTC 偏移）
      → 有活跃 agent: agent.inject + followup（reminded++）
      → 无 agent: queueReminder 排队（queued++）
      → setTodoReminded（防重复触发）
  → maybeWriteDailySnapshot（每天一次，meta.last_snapshot_date 盖章）

agent/session-start
  → 回放 pending_reminders（最多 5 条）→ inject + followup → 删除
```

### 关键细节

- **到期比较用本地时间**：`localIso()` 生成 `YYYY-MM-DDTHH:mm:ss`（无时区后缀），
  否则 date-only 的 due_at 会因 UTC 偏移晚触发（UTC+8 最多差 8 小时）。
- **快照节奏**：`daily`（每天一次）或 `every_10_turns`（每 10 轮写 `turn-N-<iso>.md`），由配置 `storage.snapshotInterval` 控制。
- **`last_reminded_at`** 防重复触发；`aheadMin`（默认 60）决定提前多久算"到期"。

---

## 八、src/ui/ — 设置与看板 API

host 端 UI 半边：注册 Settings 配置 + 提供看板数据端点。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | 插件入口：配置归一化 + 设置 section + 跟踪最新 session cwd |
| `config.ts` | schemastery 配置 schema（`Config` 接口 + `Config` 校验器） |
| `dashboard.ts` | `buildDashboardData()` 投影 + `registerDashboardEndpoint()` 注册 `GET /yolo/dashboard` |

### 关键细节

- **配置归一化是必须的**：loader 在 bundle yml 无该插件 config 段时传 `undefined`，
  `Config(config ?? {})` 必须先执行再访问 `.enabled`（修复 "Cannot read properties of undefined"）。
- **看板 scope 跟随最近会话**：`agent/turn-stopping` 时记录 `session.meta.cwd`，
  无会话时回退 `process.cwd()`。
- **端点**：`GET /yolo/dashboard` → JSON（`YoloDashboardData`），失败返回 500 JSON。
  浏览器端打开期间每 30s 轮询。

---

## 九、client/ — 浏览器端 bundle

浏览器端 UI：侧边栏全局看板 + 设置卡片。CJS 构建 + `__ModuleLoader__` 包裹（见 dev-notes 第四节）。

### 文件清单

| 文件 | 内容 |
|---|---|
| `index.ts` | bundle 入口：注入 `settings.plugin.item` 与 `sidebar.footer.action` 两个 slot |
| `settings/SettingsCard.tsx` | 设置页里的 YOLO 说明卡片 |
| `sidebar/YoloSidebarDashboard.tsx` | 全局侧边栏看板（footer 按钮 + 全高抽屉） |

### 关键细节

- **全局而非会话级**：看板是跨会话的全局表面，挂在侧边栏 footer（`sidebar.footer.action` slot），
  不依赖任何 session。
- **数据通道**：`fetch('/yolo/dashboard')`，打开时加载 + 手动刷新 + 打开期间 30s 轮询。
- **交互**：待办角标、五板块（待办/目标/里程碑/偏好/时间线）、外点/Esc 关闭、锚定侧边栏右缘自适应宽度。
- **构建契约**：CJS + `window.__ModuleLoader__.load({id, factory})` + `process` shim（React 需要）。

---

## 十、scripts/ — 构建与运行脚本

| 文件 | 作用 |
|---|---|
| `dev.mjs` | 幂等一键运行：clone host → install → build → junction → 生成 patch → 启动 dsh web；含 Windows ACL 预检与 `--fix-acl` |
| `wrap-client.mjs` | post-build：把 client bundle 包进 `__ModuleLoader__.load` + 注入 `process` shim |
| `copy-assets.mjs` | post-build：把 `src/storage/schema.sql` 复制到 `dist/src/storage/`（db.ts 运行时按 `import.meta.url` 读取） |

`dev.mjs` 命令选项：

| 命令 | 作用 |
|---|---|
| `node scripts/dev.mjs` | 完整流程 + 前台启动（默认端口 4080） |
| `node scripts/dev.mjs --setup` | 只准备不启动 |
| `node scripts/dev.mjs --update` | 先 `git pull` host 再重装重构建再启动 |
| `node scripts/dev.mjs --port 4081` | 自定义端口 |
| `node scripts/dev.mjs --fix-acl` | UAC 提权修复工作区 ACL（Windows） |

---

## 十一、配置项速查

Settings 页面（`yolo` 命名空间）可配置项，全部有 schemastery 默认值：

| 分组 | 键 | 默认 | 说明 |
|---|---|---|---|
| 总开关 | `enabled` | `true` | 插件总开关 |
| extraction | `enableLLM` | `true` | 是否启用 LLM 语义提取 |
| extraction | `model` | `'deepseek-chat'` | 提取用模型 |
| extraction | `minIntervalSec` | `30`（≥10） | 每 session 抽取节流间隔 |
| reminder | `enabled` | `true` | 提醒开关 |
| reminder | `checkIntervalSec` | `300`（≥60） | 提醒扫描间隔 |
| reminder | `aheadMin` | `60`（≥5） | 提前量（分钟） |
| storage | `scope` | `'workspace'` | 作用域模式 |
| storage | `snapshotInterval` | `'daily'` | 快照节奏（`daily` / `every_10_turns`） |
| recall | `maxTokens` | `512`（≥64） | 动态召回 token 预算 |
| recall | `topK` | `5`（1–20） | 召回条数 |

---

## 十二、改动时该看哪

| 想改什么 | 看这里 |
|---|---|
| 存储表结构 / 索引 / FTS | `src/storage/schema.sql` + `repository.ts` |
| 存储 CRUD / 去重逻辑 | `src/storage/repository.ts` + `types.ts` |
| 提取提示词 / 分类学 | `src/extract/prompt.ts` |
| 提取触发 / 节流 / 合并 | `src/extract/index.ts` + `llm-extract.ts` |
| 模型可见工具 | `src/memory/tools.ts` |
| system prompt 注入 / 动态召回 | `src/memory/recall.ts` |
| 提醒调度 / 快照节奏 | `src/reminder/scheduler.ts` + `index.ts` |
| 配置 schema / 默认值 | `src/ui/config.ts` + `src/shared/constants.ts` |
| 看板 JSON 形状 | `src/shared/dashboard.ts` + `src/ui/dashboard.ts` |
| 侧边栏看板 UI | `client/sidebar/YoloSidebarDashboard.tsx` |
| 构建 / 运行 / ACL | `scripts/dev.mjs`、`wrap-client.mjs`、`copy-assets.mjs` |
| 运行时踩坑 / 构建契约 | [dev-notes.md](dev-notes.md) |
| 测试怎么加 | [testing.md](testing.md) |
