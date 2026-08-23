# 测试文档（Testing Guide）

> 面向开发者的测试体系说明：如何运行、每个测试文件测什么、测试手法、如何新增测试。
> 当前状态：**单测 29 文件 / 324 用例全绿（~15s）**，E2E **api+ui 双车道 17 用例 ~1 分钟**
> （见 [testing-e2e.md](testing-e2e.md)），`tsc --noEmit` clean。

---

## 目录

1. [如何运行](#一如何运行)
2. [测试配置](#二测试配置)
3. [测试文件清单](#三测试文件清单)
4. [测试手法与模式](#四测试手法与模式)
5. [浏览器端到端测试（E2E）](#五浏览器端到端测试e2e)
6. [如何新增测试](#六如何新增测试)
7. [覆盖率](#七覆盖率)
8. [真机端到端验证](#八真机端到端验证)

---

## 一、如何运行

```bash
pnpm check       # tsc --noEmit（类型检查，改代码后必跑）
pnpm test        # vitest 监听模式（开发时用）
pnpm test:run    # vitest 跑一遍并退出（CI / 提交前用）
pnpm test:run -- --coverage   # 带覆盖率报告（输出到 ./coverage/）
```

> 测试只跑 `tests/**/*.test.ts`，**不依赖宿主**（无需启动 dsh web）。
> 依赖已全部来自 npm registry，一条 `pnpm install` 即可跑测试。

---

## 二、测试配置

`vitest.config.ts` 关键点：

- **include**：`tests/**/*.test.ts`（只跑 YOLO 自己的测试）。
- **exclude**：`host/**`、`node_modules/**`、`dist/**` —— **必须排除 `host/deepseek-harness/**`**：
  dev host 里带 200+ spec 文件，在 Windows 上会挂起导致"空输出/任务被杀"。
- **pool**：`forks` + `singleFork: true`（Windows 上比 worker threads 稳定）。
- **coverage**：provider `v8`；只统计 `src/**` 与 `client/**`（绝不把 dev host 计入）；
  reporter `text` + `text-summary`；输出目录 `./coverage`。

---

## 三、测试文件清单

| 测试文件 | 用例数 | 测什么 |
|---|---|---|
| `storage-actions.test.ts` | 33 | **领域动作**：状态迁移、FTS 软删、事件写入、撤销完成（reopen）、标题模糊匹配边界、合并/目标/里程碑动作 |
| `storage.test.ts` | 25 | 存储层纯函数：建表、去重、状态流转、FTS 搜索与软删、快照渲染、待提醒、抽取日志（用**内存 SQLite**） |
| `filters.test.ts` | 21 | **看板筛选（v0.3.0 E）**：预设 Tab / 焦点桶 / 组合筛选的纯逻辑解析、时段预设区间（今天/本周/本月）、自定义起止、区间 chip 标签与匹配 |
| `recall-policy.test.ts` | 20 | 召回策略：阈值、降级、时间窗与来源权重（M9） |
| `semantic.test.ts` | 17 | 语义层：嵌入召回、混合排序、空结果回退 |
| `memory-tools.test.ts` | 16 | 5 个模型可见工具的 `execute()`：读写各类记忆、搜索、软删、状态流转、快照、待提醒、`yolo_action` 分支 |
| `extract-index.test.ts` | 15 | extract 插件接线：turn 结束抽取、节流、配置开关、去重摘要、失败隔离 |
| `reminder.test.ts` | 15 | 提醒逻辑：到期文本（含可回复指引）、注入/排队、每日快照、N 轮快照 |
| `ui-actions.test.ts` | 15 | **`POST /yolo/actions`**：正常/坏 JSON/未知动作/not-found/reopen 撤销 |
| `shared-dashboard.test.ts` | 13 | 看板载荷：行投影形状（含 overdue/stale/milestone_title）、todoSummary、空载荷往返 |
| `memory-recall.test.ts` | 12 | 动态召回：section/context 注册、偏好渲染、FTS 命中渲染 |
| `extract-updates.test.ts` | 11 | **状态变化提取**：prompt 含状态摘要、validateExtraction 强转、mergeExtraction 应用 updates + milestone 关联 |
| `memory-index.test.ts` | 11 | memory 插件接线：注册工具与 prompt、跟踪最新用户消息、FTS5 语法字符回归 |
| `reminder-brief.test.ts` | 10 | 早晚报：要素收集、每日一次 + 补发、配置开关与时间越界 |
| `reminder-scheduler.test.ts` | 10 | 调度器生命周期：间隔 tick、失败隔离、cleanup |
| `extract-llm.test.ts` | 8 | LLM 提取核心：JSON 解析容错、stream 折叠、畸形条目处理 |
| `scope.test.ts` | 8 | 作用域解析：scope key、数据目录、DB 文件名、git 分支回退 |
| `shared-quality.test.ts` | 8 | 抽取质量护栏：自指/低信息条目拦截等 |
| `shared-text.test.ts` | 8 | 文本工具：内容块拼接、标题归一化、本地日期 |
| `ui-dashboard.test.ts` | 7 | 看板投影：五类数据投影、台账/通知载荷、JSON 序列化、端点 200/500 |
| `extract-prompt.test.ts` | 7 | 提取提示词：日期内嵌、JSON-only 约束、scheduled commitments 分类、去重摘要上限、updates[] |
| `dashboard-aggregate.test.ts` | 6 | 跨工作区聚合：mergeRows 去重、workspace 计数、unhandled 汇总 |
| `ui-index.test.ts` | 5 | ui 插件接线：`config: undefined` 回归、端点注册、scope 跟随最近会话 |
| `memory-health.test.ts` | 4 | 记忆健康指标：召回成功率、抽取错误、重复候选 |
| `reminder-index.test.ts` | 4 | reminder 插件接线：session-start 回放、turn 快照触发 |
| `shared-session.test.ts` | 4 | **session 工具**：`sessionCwd`/`sessionId` 从 header 读取、legacy `meta` 形状不复活 |
| `ui-session-threads.test.ts` | 4 | 面板会话线程：锚定/常驻线程路由（v0.3.2） |
| `storage-scope-cache.test.ts` | 4 | **scope key 记忆化回归**：TTL 内只算一次、过期重算、非 workspace 模式不缓存、close 清缓存 |
| `ui-config.test.ts` | 3 | 配置 schema：默认值、覆盖、越界校验 |
| **合计（29 文件）** | **324** | |

> `tests/fixtures/` 目前是空目录（保留给未来的测试夹具）。

---

## 四、测试手法与模式

### 三类被测对象

1. **纯函数单测**（无 SQLite）：`extract-prompt`、`extract-llm`、`shared-*`、`scope`、`ui-config`。
   直接构造输入调用导出函数，断言输出。

2. **真实 `Yolo` 服务 + 临时目录**：`extract-index`、`memory-index`、`memory-tools`。
   ```ts
   import { mkdtempSync } from 'node:fs'
   const dir = mkdtempSync(join(tmpdir(), 'yolo-test-'))
   vi.spyOn(process, 'cwd').mockReturnValue(dir)
   // beforeEach 建目录、afterEach 删目录（Windows 上先 close() DB 再删，避免 EBUSY）
   ```

3. **存储层用真实内存 SQLite**：`storage.test.ts` 用 `openDb(':memory:')` 直接测
   repository/search/snapshot 纯函数，不依赖 Cordis host。

### context 构造（不依赖真实 host）

手写 ctx stub：

```ts
// on() 用 Map 捕获 handler，测试里手动触发
const handlers = new Map<string, Function>()
const ctx = { on: (ev, fn) => { handlers.set(ev, fn) }, ... }
// 触发：await handlers.get('agent/turn-stopping')!({ agent, turn: 1 })
```

- `tools.register` / `systemPrompt.section/context` → 捕获注册项到数组再断言。
- `settings.get` / `webServer.register` / `inject` → `vi.fn()`。
- LLM：mock `LlmRuntime.stream` 返回生成器构造的 `AsyncIterable<StreamChunk>`。

### 时间控制

- `vi.useFakeTimers()` + `advanceTimersByTimeAsync`（scheduler 测试）。
- `vi.spyOn(Date, 'now')` 拨快时间（节流测试）。

### 重点回归（改这些地方务必跑对应测试）

- **FTS5 语法字符**：`<div>`、`a<b`、引号、`AND OR NOT`、`C:\Users\x*y` 等不能崩 turn
  （`memory-index`、`storage` 的 `it.each`）。
- **`config: undefined`**：loader 不传 config 时 `apply(ctx, undefined)` 不抛（`ui-index`）。
- **失败隔离**：模型/存储抛错时 handler 不向 agent 循环抛（`extract-index`、`reminder-index`、`reminder-scheduler`）。
- **领域动作与审计**：任何状态迁移必须写事件、完成/取消要 FTS 软删（`storage-actions`）。
- **session 作用域**：`sessionCwd`/`sessionId` 只认 `header`，`meta` 形状必须返回 `undefined`
  （`shared-session`，防 scope 失效回归）。
- **三入口动作一致性**：`yolo_action` 工具、`POST /yolo/actions`、提取 updates 走同一条
  `applyYoloAction`（`tools-action`、`ui-actions`、`extract-updates`）。

---

## 五、浏览器端到端测试（E2E）

单测用 mock / 内存 SQLite 验证纯逻辑与接线，验证不了真实宿主 + 真实浏览器下的
表达层与宿主集成。E2E 用 **Playwright 驱动一个真实运行的 dsh web 宿主**，走真实的
`GET /yolo/dashboard` + `POST /yolo/actions` 端点与真实的 SQLite 存储。

- **双车道**（2026-08 治理后）：`tests/e2e/api/`（HTTP 契约，无浏览器，秒级）
  与 `tests/e2e/ui/`（真实 Edge，看板交互/主题/锚定对话）。全套 17 用例 ~1 分钟。
- 它是一条**本地补充车道**：CI 只跑免 key 的单测套件（提醒/简报/调度器触发逻辑
  已在单测覆盖），E2E 依赖本地已拉起并配好 LLM 的宿主，不在 CI 强制。
- 依赖系统安装的 Edge/Chrome（无需下载浏览器），`channel: msedge`，`workers: 1`
  （共享宿主进程 + 共享 SQLite，串行是正确性约束）。

### 如何运行

```bash
node scripts/e2e.mjs                 # 拉起/复用宿主后跑全部车道
node scripts/e2e.mjs --lane api      # 仅 HTTP 车道（改 src/** 后的秒级反馈）
node scripts/e2e.mjs --lane ui       # 仅浏览器车道
node scripts/e2e.mjs --spec panel-flow   # 单个 spec
```

runner 全局 `dsh` 优先（AGENTS.md 标准）；拉起自己的宿主前自动 DB 级清扫 `[E2E]`
夹具行；复用已有宿主时绝不触碰其数据库。完整场景 × 用例矩阵、慢因根因记录、
失败归因决策树与 agent 运行手册见 **[testing-e2e.md](testing-e2e.md)**。

### 手法与稳健性约定

- **真实端点**：夹具通过 `POST /yolo/actions` 种入，**不 mock 存储**；「提醒」卡用
  `author_notification` 动作经与调度器相同的存储路径确定性产生。
- **按 id 清理**：`createFixtures(api)` 追踪每条夹具，`afterEach → dispose()` 精准
  处理 —— 不做全量看板扫描（那是 2026-08 治理前的最大开销之一）。
- **用语真实（回归约束）**：夹具必须是**贴合真实场景的用户句子**（如「提醒我把
  演示稿发给研发」），禁止「更新测试文档」「提醒处理」这类自指措辞；
  机器前缀 `[E2E]` 除外。
- **首屏竞态**：面板主体等首个 dashboard 载荷后才渲染；`openYoloPanel` 会像真实
  用户一样点「立即刷新」重打。
- **断言持久元素**：落在看板行而非易消失的 toast；不要靠调大超时吸收慢——先查
  testing-e2e.md 第四节的根因是否回归。

---

## 六、如何新增测试

1. **放对位置**：新测试放 `tests/<模块>-<功能>.test.ts`，命名与现有文件一致
   （如 `extract-*`、`memory-*`、`reminder-*`、`ui-*`、`shared-*`、`storage`、`scope`）。
2. **选对手法**：
   - 纯函数 → 直接调用断言；
   - 涉及存储 → 真实 `Yolo` + 临时目录，或 `openDb(':memory:')`；
   - 涉及插件接线 → 手写 ctx stub 捕获 handler。
3. **覆盖回归**：如果改动涉及 FTS5 语法字符、config 归一化、失败隔离，务必补对应回归用例。
4. **验证**：`pnpm check && pnpm test:run` 全绿；如改动了 README 里的测试徽章数字，同步更新。

---

## 七、覆盖率

```bash
pnpm test:run -- --coverage
```

- 只统计 `src/**` 与 `client/**`（dev host 不计入）。
- 当前基线：Statements 73.94% / Branches 86.25%（领域动作与 HTTP 分支加入后
  语句覆盖略降、分支覆盖上升；README 徽章同步为 74% stmts / 86% branches）。
- CI（`.github/workflows/ci.yml`）在 Linux 与 Windows 上跑 typecheck + tests + build，
  并上传覆盖率报告产物。

---

## 八、真机端到端验证

单测与 tsc 验证不了表达层——布局塌陷、主题残留、动效越界、宿主集成断裂只有
真机能暴露。因此**提交门槛是三件套**：`pnpm check` + `pnpm test:run` + 真机走查（触发范围内）。

### 触发范围（改了就必须走查）

- `client/**` — 面板表达层的任何改动（组件、样式、图标、动效、状态持久化）；
- `src/ui/**`，或 `GET /yolo/dashboard` / `POST /yolo/actions` 的载荷形状；
- `client/design/**`（设计系统）或主题判定逻辑；
- 切版本发布前（UI 相关版本，见 [release.md](release.md) 前置条件）。

纯 `src/**` 后端逻辑（存储 / 提取 / 提醒）且不触碰上述范围的改动，可免走查，
靠单测 + tsc 兜底。

### 如何运行

```bash
pnpm build        # dist 是宿主实际加载的产物，改完必须重建
pnpm dsh web --no-open --port 4080   # 启动 dsh web 宿主（全局 CLI，标准方式）
```

打开 <http://127.0.0.1:4080>（或默认 3080），选择工作区，点击**左侧边栏底部 YOLO 按钮**打开面板。
bundle 按文件名静态服务，重建后刷新页面即拿到新版本。

### 核心清单（面板改动通用，W1–W8）

| # | 场景 | 通过标准 |
|---|---|---|
| W1 | 打开面板（亮色） | 骨架短暂出现后完整渲染；无控制台报错；无 Emoji 字形残留（图标全部为 SVG） |
| W2 | 工具条 | 预设 Tab 切换 + 下划线指示；焦点胶囊过滤与计数一致；筛选菜单开合；时段 chip 出现 / ✕ 清除 |
| W3 | 任务行 | hover 浮现操作组；完成 → retire → 撤销 toast 全链路；行内编辑表单开合 |
| W4 | 捕获条 | 回车入库、默认今日到期；中文输入法组合态回车不误触 |
| W5 | 侧栏对话 ⇄ 全屏 | 340px 停靠栏开合；消息发送气泡正常；全屏展开 / 收回；Esc 逐级退出（全屏 → 侧栏 → 关闭面板） |
| W6 | 暗色主题 | 宿主切暗色后重开面板：深底浅字、无亮色残留、强调色可读 |
| W7 | 窄面板（<480px） | 对话直接进入全屏态；无横向滚动；Esc 逐级退回 |
| W8 | 今日台账 | 记录数 / 会话数正确；来源徽标渲染，可跳转态有 hover 样式 |
| W9 | 看板打开时切换会话（v0.3.2） | 打开看板后，点击侧边栏其它会话：会话切换到前台且看板自动收起（不会“点了没反应”） |
| W10 | 「聊一聊」全新对话（v0.3.2） | 卡片「聊一聊」打开的是**全新**对话（无历史）；常驻会话的旧历史不出现；发送后能收到 YOLO 回答到该锚定对话 |

功能场景的深度走查按需引用既有验收表：

- 产品行为（提醒 / 台账 / 简报 / 编辑）：[product-design.md](product-design.md) 第八节 TA/TB/TC/TD/TE 系列；
- 视觉与动效（主题 / 动效 / 空态 / reduced-motion）：[frontend-redesign.md](frontend-redesign.md) 8.6 VA-1~VA-8。
- 改动引入的**专项人工验证**（如 scope key 缓存的行为复核、E2E runner 抽查）：
  [testing-e2e.md](testing-e2e.md) 第八节人工验证清单。

### 通过标准与记录

- 清单全部 PASS 才能提交；FAIL 项修复后重走对应场景（不必全量重走）。
- 走查结论记入**提交说明**；重大 UI 版本（如 v0.3.2）同步写入 CHANGELOG。
- 无法在当前环境验证的场景（如 reduced-motion、特定 DPI）标注 **SKIP + 原因**，
  不得默认放行；连续两次 SKIP 的场景应在下个版本补真机验证。

