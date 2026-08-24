# E2E 测试规范（场景 · 用例 · 套件）

> 浏览器端到端测试的单一事实源：有哪些场景、怎么跑、为什么之前慢/不稳定、
> agent 如何按规范执行与归因。运行/配置总览见 [testing.md](testing.md) 第五节。
> 本文由 2026-08 的 E2E 治理（分支 `test/e2e-standardization`）落地并实测背书。

---

## 一、测试分层与套件划分

按标准测试分层（自下而上）：单元测试 → 集成测试（HTTP 接口）→ 端到端测试（浏览器）→ 手工验收走查。
中间两层合称 E2E，按载体拆成两个可独立运行的套件：

| 分层 | 套件 | 位置 | 载体 | 验证什么 | 期望耗时 |
|---|---|---|---|---|---|
| 单元测试 | vitest | `tests/**/*.test.ts` | 内存 SQLite / ctx stub | 纯逻辑、领域动作、插件接线 | ~15s 全量 |
| 集成测试（HTTP 接口） | **api** | `tests/e2e/api/` | 真实宿主 HTTP（无浏览器） | 端点契约：dashboard 形状、动作路由、审计事件 | **< 10s** |
| 端到端测试（浏览器） | **ui** | `tests/e2e/ui/` | 真实宿主 + Edge（Playwright） | 表达层与宿主集成：看板交互、主题、锚定对话 | ~1min |
| 手工验收走查 | — | [testing.md](testing.md) 第八节 | 人肉清单 | 自动化盲区（IME、动效观感、DPI…） | 按触发范围 |

选择原则：**能跑低层就不跑高层**——接口层的问题不进浏览器，交互问题才上真机。
断言落在持久元素（看板行）而非易消失的 toast；夹具经真实端点种入，绝不 mock 存储。

## 二、场景 × 用例矩阵

### api 套件 · HTTP 接口测试

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `api/dashboard-scope.spec.ts` | `GET /yolo/dashboard?scope=all` 返回 200 与合法看板形状（todos/notifications 数组、无 error、聚合标记带 workspace 信息） | v0.3.0/v0.3.3 聚合 |
| `api/due-semantics.spec.ts` | date-only、精确 datetime 与终态的 overdue/attention/summary 事实一致，快速记录不会立即生成提醒 | rc.3 到期语义 |
| `api/actions-consolidate.spec.ts` · P35 | 合并两条待办：保留方继承字段、被并方退场、台账留 `todo_consolidated` | product-design P35 |
| `api/actions-consolidate.spec.ts` · P34 | 非法动作 400 且落 `action_denied` 审计——拒绝绝不静默 | product-design P34 |

### ui 套件 · 浏览器端到端测试

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `ui/panel-flow.spec.ts` · TA-1/TA-2 | 打开助手看板按真实任务渲染今日行（到期槽读「今天」） | TA-1/TA-2, 5.2 |
| `ui/panel-flow.spec.ts` · TA-3 | 完成 → retire → toast 带 4 秒「撤销」→ 撤销恢复原位 | TA-3, 5.4 |
| `ui/panel-flow.spec.ts` · TA-4 | 逾期聚焦胶囊过滤：只留逾期行 | TA-4 |
| `ui/panel-flow.spec.ts` · W2/W11/W16 | 同日精确 datetime 到时后进入逾期事实与摘要，未来时刻不误报 | rc.3 到期语义 |
| `ui/panel-flow.spec.ts` · TA-2′ | 捕获条回车快速记一条并落入看板 | TA-2 快捷入口 |
| `ui/panel-flow.spec.ts` · TA-5 | 卡片「聊一聊」打开侧栏对话并锚定该任务 | TA-5 |
| `ui/panel-flow.spec.ts` · TA-6 | Esc 逐级退出：全屏对话 → 侧栏 → 关面板 | TA-6 |
| `ui/reminder-badge.spec.ts` · TB-3~6 | 未处理提醒驱动角标+通知卡；「知道了」后归零 | TB-3~TB-6 |
| `ui/theme-narrow.spec.ts` · W6 | 亮/暗宿主下 `--background` 解析为 light/dark | W6 |
| `ui/theme-narrow.spec.ts` · W7 | 窄面板(<480px)紧凑态、对话直接全屏、Esc 退回 | W7 |
| `ui/panel-v032.spec.ts` · W10 | 「聊一聊」全新锚定对话，无常驻历史泄漏 | R19/W10 |
| `ui/chat-scroll.spec.ts` · W5/W7/W10 | 长历史 side/full 使用真实滚动 owner；首载、发送、回复贴底跟随，上翻后只提示新消息，形态切换可继续 | rc.3 对话滚动 |
| `ui/chat-request-lifecycle.spec.ts` · W5/W7/W10 | 慢回复在 side/full、Esc 与面板重挂载后保持 accepted/stale，回复后完成且不二次 POST | rc.3 XP-08 |
| `ui/chat-responsive-actions.spec.ts` · W5/W7/W10 | 1029×742 medium、959/960 边界、wide side/full 双向、返回 Today 焦点与 draft 保留 | rc.3 XP-09 |
| `ui/panel-v032.spec.ts` · W9 | 看板描边从侧栏开始；侧栏区点击让面板让位 | R18/W9 |
| `ui/ledger-panel.spec.ts` | 合并事件进入今日台账并在台账 tab 渲染 | v5 台账面 |
| `ui/board-scope.spec.ts` | 面板头部保留工作区切换开关时可用 | v0.3.3 |
| `ui/accessibility-feedback.spec.ts` | 关闭筛选菜单不可聚焦、行内编辑字段可读名、对话发送状态持续到回复、通知正文多行保真 | W2/W3/W5 |
| `ui/settings-card.spec.ts` · W14 | 设置页修改 YOLO 提醒配置、保存并刷新回读；卡片无内部里程碑或错误入口说明 | rc.3 XP-06/W14 |
| `ui/today-tab-count.spec.ts` · W2/W7/W11/W16 | Today tab 按默认表面开放事项做 workspace+todo 去重；与自然日 dueToday 可不同，partial 明示只计已加载 | rc.3 XP-07 |

### 已知覆盖缺口（真机走查兜底）

W1 控制台零报错未断言 · W4 中文 IME 组合态回车（Playwright 无法模拟组合态）· W8 台账数字精确性 ·
reduced-motion / 特定 DPI。

### 真实语义对话手工回归（RM-DIALOG-01）

1. 在全新 dsh 宿主打开 YOLO →「对话」，发送“请记住：明天下午三点提醒我把客户访谈纪要发给产品组”。
2. 断言用户气泡立即出现，且回复到达前持续显示明确的处理中状态。
3. 等待助手回复，断言看板出现“把客户访谈纪要发给产品组”，到期时间为本地次日 15:00。
4. 继续发送“把刚才的「把客户访谈纪要发给产品组」标记完成”。
5. 断言助手确认完成、任务进入「已完成」、不再出现在待办/即将列表。
6. 记录两轮端到端时延及 console error/warn。用例数据需加 `[E2E]` 前缀，并在验证后清理。

## 三、如何运行

```bash
node scripts/e2e.mjs                 # 全部套件（拉起或复用宿主）
node scripts/e2e.mjs --suite api     # 仅 api 套件（秒级反馈，改 src/** 后首选）
node scripts/e2e.mjs --suite ui      # 仅 ui 套件
pnpm exec playwright test tests/e2e/ui/panel-flow.spec.ts  # 单个 spec 的当前可靠方式
node scripts/e2e.mjs --no-host       # 复用已在跑的宿主（绝不碰它的数据库）
node scripts/e2e.mjs --no-clean      # 跳过拉起前的 [E2E] 夹具清扫
```

环境变量：`YOLO_E2E_PORT`(默认 3080) · `YOLO_E2E_HOST` ·
`YOLO_E2E_PROBE_MS`(健康探测预算，默认 15000) ·
`YOLO_E2E_REPORT=<path>`(额外产出机器可读 JSON 报告)。

> 已知 runner 缺陷：`node scripts/e2e.mjs --spec panel-flow` 目前错误映射到
> `tests/e2e/panel-flow.spec.ts`，会报 `No tests found`；修复 `scripts/e2e.mjs` 的
> suite 目录映射前，请使用上面的 Playwright 精确路径命令。

宿主注入两条路径：

1. **标准（AGENTS.md）**：全局 `dsh` + web profile 捆绑本插件
   （一次性 `pnpm dsh plugin add . --profile web`）。runner 直接
   `dsh web --port <port>`，**不生成 runtime patch** —— profile 已注册全部
   yolo 行，再 insert 同 id 是致命的 duplicate loader entry 错误。
2. **回退**：没有全局 dsh 时才 checkout host 仓库构建（旧行为，含 junction +
   patch），仅作过渡。

失败产物：trace/截图在 `test-results/`，`pnpm exec playwright show-trace <zip>` 查看。

## 四、为什么之前慢且经常出问题 —— 根因记录

2026-08-23 实测基线（改造前，17 用例）：**21.3 分钟，3 failed + 2 flaky**；
单用例 13s–60s 不等，多个用例 60s 超时靠 retry 才过甚至重试仍挂。

| # | 根因 | 证据 | 修复 |
|---|---|---|---|
| 1 | `Yolo.resolve()` 每次调用都 `execSync git rev-parse`；一次 dashboard 请求触发 ~15 次 | 实测 15 次孵化 = 2985ms ≈ 端点延迟 | `perf(storage)` scope-key 按 TTL 记忆化（5s），一次请求 1 次孵化 |
| 2 | 每个 test 前后全量拉看板扫 `[E2E]` 行做清理（≥2 次完整 GET/用例 ×17） | cleanupPrefixed* 在 beforeEach/afterAll | `createFixtures` 按 id 追踪、O(创建数) 精准清理 |
| 3 | 健康探测超时 3s < 实际延迟 3s+，健康宿主被判死 → `--no-host` 报"没起来"、bring-up 报"not ready" | 4080 宿主 3117ms 响应 vs probe 3000ms | 探测超时提到 15s（`YOLO_E2E_PROBE_MS` 可调） |
| 4 | runner 生成的 patch 与 web profile 里 `dsh plugin add` 注册的同 id 行冲突 → **拉起必炸**(duplicate loader entry id: yolo) | 手动复现 boot stack | 标准 profile 捆绑路径不再打 patch；patch 只留给无标准安装的回退路径 |
| 5 | host-checkout 方式启动撞凭证格式差异(`.credentials.yaml version` 类型) → 启动即崩 | AGENTS.md 早有警告，本次实锤复现 | bring-up 改为**全局 dsh 优先**，checkout 构建降级为回退 |
| 6 | `child.kill()` 只杀 pnpm 外壳，node 孙进程变孤儿占端口 → 下次拉起 EADDRINUSE/ECONNREFUSED 漂移 | 4090 孤儿存活观察 | `killTree`（Windows `taskkill /T /F`） |
| 7 | 角标 30s 轮询节奏被测试硬等 ≤45s | reminder-badge 旧版 timeout 45s | 卡片先种后开页面：角标 mount 即拉取，断言即时确定 |
| 8 | `[E2E]` 夹具跨 run 累积膨胀载荷(57KB→清理后 6KB)、拖慢一切 | AGENTS.md 手工清理习惯 | runner 拉起前自动 DB 级清扫（只动 `[E2E]` 行）；`--no-clean` 可关 |
| 9 | 忙等 `sleep()` 自旋烧 CPU | e2e.mjs 旧 while 循环 | 真 `setTimeout` 异步休眠 |

效果（同机复测，改造后）：api 套件秒级、ui 套件分钟级；详见提交记录中的
前后对照数据。根因 #1 同时是产品修复 —— 侧栏角标每 30s 轮询、提醒调度器
周期 tick 此前都在反复孵化 git 进程。

## 五、夹具与清理约定

- **前缀即契约**：机器夹具一律 `[E2E]` 唯一前缀（`uid()`），与真实用户数据互不侵扰，
  也是 DB 清扫与「用语真实」检查的豁免标记。夹具句子必须贴合真实用户语境
  （如「提醒我把演示稿发给研发」）。
- **谁创建谁销毁**：用例通过 `createFixtures(api)` 创建/追踪夹具，
  `afterEach → fx.dispose()` 按 id 精准处理；浏览器内产生的行（捕获条）
  用 `fx.trackTodo(id)` 补登记。**禁止**再引入全量看板扫描式清理。
- **DB 级兜底**：runner 自己拉起宿主时，启动前对 `.dsh/yolo/` 与 `~/.dsh/yolo/`
  的 `yolo-*.db` 做 `[E2E]` 行清扫（此刻必然无宿主持锁）。手动等价物：
  `node scripts/clean-test-data.mjs`。
- **共享宿主礼貌**:`--no-host` 或复用已应答宿主时，runner 绝不触碰其数据库;
  需要干净状态就自己换端口拉一个。

## 六、测试 agent 运行手册

给任何要跑 E2E 的编码 agent（人或自动化）：

```bash
# 1) 快速反馈（改了 src/storage|shared|memory 后）
node scripts/e2e.mjs --suite api

# 2) UI 准出（改了 client/**、src/ui/**、payload 形状后）
node scripts/e2e.mjs --suite ui

# 3) 发布前全量 + 机器可读报告
YOLO_E2E_REPORT=.tmp-e2e/report.json node scripts/e2e.mjs
```

失败归因决策树：

1. **`--no-host but nothing answering` / bring-up not ready**
   → 宿主没起来或太慢：先 `curl <host>/yolo/dashboard` 手测；慢但 200 则调高
   `YOLO_E2E_PROBE_MS`；拒绝连接则换 `YOLO_E2E_PORT` 重跑让 runner 自己拉起。
2. **`duplicate loader entry id: yolo`**（手动 patch 启动时）
   → profile 已捆绑插件，去掉 `--patch`。
3. **assertion 超时**
   → 打开该用例 `test-results/*/trace.zip`（show-trace）定位是数据没渲染还是
   选择器漂移；数据缺失先查 `GET /yolo/dashboard` 是否含夹具行。
4. **偶发 ECONNRESET**：helpers 已内置一次退避重试；连续出现说明宿主不稳，
   回到分支 1。
5. **报告解读**：JSON 的 `stats.expected/unexpected/flaky/skipped/duration`；
   `unexpected > 0` 即红，不要靠 retry 掩盖——先归因再放行。

红线：不要为吸收慢而调大断言超时（那是症状缓解）；先确认是否踩了第四节
某个根因的回归。

## 七、变更触发范围（何时必须跑哪层）

| 改动 | 必须 |
|---|---|
| `src/storage/**`, `src/shared/**`, `src/memory/**`, `src/extract/**`, `src/reminder/**` | 相关单元测试 + `--suite api` |
| `client/**`, `src/ui/**`, dashboard/actions payload 形状 | 单元测试 + `--suite ui` + 本文第八节对应组人工走查 |
| `playwright.config.ts`, `tests/e2e/**`, `scripts/e2e.mjs` | 全套 E2E 自证 |
| 版本发布（UI 相关） | 全量 E2E + 真机走查 |

## 八、人工验证清单（全场景）

> 自动化（E2E api/ui 两套件 + 单测）覆盖契约与交互回归；本清单汇总**所有需要人眼 / 真机 /
> 长周期等待**确认的场景，按用户旅程分组，是产品全量的人工走查底表。
> 标记说明：🤖 = E2E/单测已自动化（人工只需真机抽验观感）；👤 = 仅人工可验。
> 规则沿用 testing.md 第八节：全部 PASS 才收口；无法验证的项标 SKIP + 原因，
> 连续两次 SKIP 的项排进下个版本补验；走查结论记入提交说明。
> 来源：testing.md §八 W1–W16 · product-design.md §八 TA/TB/TC/TD/TE ·
> v0.3.x 交付项（R/P/V 系列）。

### 8.1 面板骨架与工具条

- [ ] 👤 **W1 首开渲染**：骨架短暂出现后完整渲染；控制台零报错；无 Emoji 字形残留（图标全 SVG）
- [ ] 🤖 **W2 工具条**：预设 Tab 切换 + 下划线指示；焦点胶囊过滤且计数一致；筛选菜单开合；时段 chip 出现 / ✕ 清除
- [ ] 🤖 **TA-1 打开面板**：点侧栏 YOLO 按钮，默认看板 Tab，筛选条/聚焦/任务/台账完整
- [ ] 👤 **TA-6 状态保持**：做过筛选与编辑后关闭再打开面板——Tab、筛选条件、侧栏收起态均保持
- [ ] 👤 **VA-7 空库首启**：新库首启出现引导块、空态、捕获条自动聚焦，不白屏不报错

### 8.2 任务行操作

- [ ] 👤 **W3 hover 操作组**：悬停浮现操作组，移出收起
- [ ] 🤖 **TA-3 完成→撤销**：勾选完成 → retire → toast 带 4 秒「撤销」→ 撤销后原位恢复（5.4）
- [ ] 👤 **TE-4 行内改标题**：改字回车即时刷新、快照同步、台账出现改名事件
- [ ] 👤 **TE-5 改截止日**：逾期任务改到下周 → 移出逾期分类，胶囊计数 −1
- [ ] 👤 **TE-6 删除确认**：删除弹确认层；确认后条目消失且 `todo_cancelled` 事件落库
- [ ] 👤 **TE-7 进度只读**：目标折叠区无任何手动进度编辑控件
- [ ] 👤 **TE-8 快照一致**：任意编辑后 Markdown 快照与看板一致

### 8.3 捕获条与快速记一条

- [ ] 🤖 **TA-5 快速记一条**：「周五取快递」回车入库——今日到期、来源=快速记一条、快照同步、**无 LLM 抽取调用**（查提取日志确认）
- [ ] 👤 **W4 IME 组合态**：中文输入法组合态回车不误触发（自动化无法模拟组合态）

### 8.4 提醒与角标（TB）

- [ ] 👤 **TB-1 静默红线（核心）**：造 1 分钟后到期待办，另开工作会话等到期——工作会话全程无任何新增消息，提醒只出现在 YOLO 侧
- [ ] 🤖 **TB-2 面板内通知卡**：面板开着等到期 → 看板顶部出现含标题与快捷操作的通知卡
- [ ] 🤖 **TB-3 角标计数**：关面板等到期 → 角标数字=未处理数，处理后递减归零隐藏
- [ ] 👤 **TB-4 对话处理提醒**：从通知卡「聊一聊」回复「推迟到明天」→ 待办改期、卡片消失、审计事件落库
- [ ] 👤 **TB-5 重启恢复**：提醒已投递未处理时重启插件 → 未处理提醒回放（卡/角标仍可见）
- [ ] 👤 **TB-6 并发到期**：同一 tick 两条待办同时到期 → 各自成卡、计数正确

### 8.5 早晚报（TD）

- [ ] 👤 **TD-1 早报准点**：`morningTime` 设为下一分钟 → 到点出早报卡，含今日到期/逾期/昨日遗留/目标变化四要素
- [ ] 👤 **TD-2 晚报内容**：到点出晚报卡，含今日完成/新增记录/还挂着的事
- [ ] 👤 **TD-3 开关生效**：关闭晚报开关后到点不再生成，日志有跳过原因
- [ ] 👤 **TD-4 简报追问**：早报卡「聊一聊」→ 首条上下文携带简报全文可追问
- [ ] 👤 **TD-5 面板未开**：简报生成时面板关闭 → 打开后通知卡可见、角标计入
- [ ] 👤 **TD-6 空事项日**：无任何到期/完成/遗留 → 显示「今天没有到期事项」，不空白不报错

### 8.6 今日台账与来源（TC）

- [ ] 👤 **TC-1 完成入账**：勾选完成 → 台账「✓ 完成…」带来源徽标、头部计数 +1
- [ ] 👤 **TC-2 对话记录入账**：工作会话说「记一下：周五体检」→ 台账「＋记录新待办」来源为该会话摘要
- [ ] 👤 **TC-3 来源可区分**：多个会话各产生事件 → 徽标显示各自摘要，肉眼可辨
- [ ] 👤 **TC-4 跨天边界**：23:59 与 00:01 各一条事件 → 分属两个自然日台账
- [ ] 👤 **TC-5 旧数据迁移**：0.2→0.3 升级旧事件不丢，无 session 归属的显示「早期记录」
- [ ] 👤 **TC-6 数据一致**：sqlite 直查 events 当日记录与台账比对一致
- [ ] 🤖 **P35 合并入账**：合并两条待办 → 台账 tab 出现「合并：」条目（真机面）

### 8.7 对话与会话（v0.3.2/v0.3.3）

- [ ] 👤 **W9 会话切换让位**：看板打开时点侧栏其它会话 → 会话切前台、看板自动收起
- [ ] 🤖 **W10 聊一聊全新对话**：无历史泄漏；发送后能收到回复到锚定对话
- [ ] 👤 **TA-2 双视图同线程**：看板 ⇄ 对话来回切换，历史不重不漏
- [ ] 👤 **V1 会话能力**：常驻与锚定会话真实回复模型（`{{model}}` 绑定生效）

### 8.8 记忆抽取与召回（M9）

- [ ] 👤 **抽取入库**：会话说截止时间/目标 → 时间线与看板出现对应条目，LLM 语义提取（非正则）
- [ ] 👤 **写入质量闸门（B3）**：「好的/收到」「记住这个」等自指/低信息句不落库
- [ ] 👤 **动态召回**：新会话提到相关主题 → 偏好/承诺注入 system 段（yolo-instructions 可查）
- [ ] 👤 **偏好时效（R14）**：过期偏好不再注入；被替代的偏好带出处历史
- [ ] 👤 **空召回降级（R15/P39）**：连续空召回触发保护性降级而非反复空跑

### 8.9 跨工作区聚合（v0.3.x）

- [ ] 👤 **多区同板**：多工作区行聚合展示，`ws` 标签正确
- [ ] 🤖 **跨区可操作**：直接完成/推迟其它工作区的行（`scope_cwd` 路由）
- [ ] 👤 **分支隔离（A3）**：切分支记的待办不串到原分支看板（scope key 含 git 分支）

### 8.10 视觉与动效（VA，亮/暗各一轮）

- [ ] 👤 **VA-1** 暗色 IDE 打开面板：无亮色残留，对比度实测通过
- [ ] 👤 **VA-2** 早晨首开：早报块淡入，首屏 ≥3 任务行，骨架 ≤300ms
- [ ] 👤 **VA-3** 完成一项：填充→retire→撤销 toast 全链路顺滑可撤销
- [ ] 👤 **VA-4** 通知到达（面板开启中）：淡入+计数 crossfade，零布局跳动
- [ ] 👤 **VA-5** 窄面板对话：全屏态无横向滚动，Esc 逐级退回并归还焦点
- [ ] 👤 **VA-6** 轮询刷新：数据变化时 refresh-sweep 出现一次，未变化完全静止
- [ ] 👤 **VA-7** 空库首启：引导块+空态+捕获条聚焦
- [ ] 👤 **VA-8** reduced-motion：动效退化为即时切换，功能零损失

### 8.11 性能与资源（本轮治理引入的行为复核）

- [ ] 👤 **A1 看板响应体感**：`/yolo/dashboard` 数百 ms 到达，无 ~3s 停顿
- [ ] 👤 **A2 无 git 进程轮询孵化**：角标 30s 周期内任务管理器无 `git.exe` 闪现

### 8.12 E2E 工具链抽查（runner 行为）

- [ ] 👤 **B1 api 套件秒级反馈**：`--suite api` 数秒全绿，结束自动停自拉宿主
- [ ] 👤 **B2 无孤儿进程**：跑完后端口无 LISTEN 残留
- [ ] 🤖 **B3 ui 套件全套**：~1 分钟全绿
- [ ] 👤 **B4 自动清扫**：runner 拉起宿主时日志出现 `fixture sweep ... removed N rows`
- [ ] 👤 **B5 复用宿主不碰库**：`--no-host` 日志显示 `database is NOT touched`
- [ ] 👤 **B6 探测超时可诊断**：宿主不在时报错含 probe budget 与 `YOLO_E2E_PROBE_MS` 提示
