# WorkBuddy（dsh-yolo）v0.3.3 代码 / UI 评审报告

> 性质：**评审/分析报告，非排期**。排期仍以
> [`roadmap-ux-priorities.md`](roadmap-ux-priorities.md) 与
> [`development-plan.md`](development-plan.md) 为单一事实源；本文供其输入。
>
> 方法：5 路并行深读（panel UI / design+sidebar / storage / reminder+extract / ui+memory+shared），
> 全部行号与当前源码逐行核对；P1 级发现均经第二人（主评审）在源码中复核。
> 基线：`pnpm check` ✅ · `pnpm test:run` ✅ 320/320（28 文件）。
> 标注：〔核〕= 主评审已亲自在源码验证；〔报〕= 评审代理报告、证据充分但未二次复核。

---

## 0. 一句话结论

工程质量整体较高：动作单一路径 + 审计、FTS 参数化无注入、提醒「绝不注入工作会话」红线成立、
失败降级意识普遍。剩余问题集中在四类：**多工作区链路**（漂移 + 单工作区扫描，P1）、
**长驻共享状态**（语义降级永不复位，P1）、**键盘/对比度等无障碍细节**（P1/P2）、
以及一批**聚合视图与竞态**的 P2。

---

## 1. P1 —— 建议立即修

### P1-1 〔核〕YOLO 线程回合会漂移「最新工作区」，看板/提醒/召回随之串库
- 证据：`src/ui/index.ts:55-58`（`agent/turn-stopping` 无 `isYoloSessionId` 守卫，而 :51 的
  `session-start` 有）；`src/reminder/index.ts:57-60`（同病）；`src/memory/index.ts:101-103`
  （`session/event` 对 YOLO 线程同样更新 `lastSessionCwd`）。
- 链路：工作区 B 的 `yolo-w-*` 常驻线程收到提醒并回合一回合 → 三个插件的「最新工作区」全部翻到 B
  → 之后 ① `quick_add` 等无 id 动作落库到 B（`ui/actions.ts:98`），② 提醒/简报/快照扫 B
  （`reminder/index.ts:94`），③ 召回注入读写 B 的记忆（`memory/index.ts:114`）。
- 修复：三处回调统一补 `isYoloSessionId` 守卫（与 `session-start` 对齐）。

### P1-2 〔核〕提醒/简报/快照调度器只扫「最新一个工作区」
- 证据：`src/reminder/scheduler.ts:88-93, 246-254, 261-272`——`runReminderTick`/`runBriefTick`/
  `maybeWriteDailySnapshot` 都只吃单一 `deps.cwd()`（= `latestCwd ?? process.cwd()`）；
  而 v0.3.3 看板已聚合所有工作区（`ui/dashboard.ts:243-247` 用 `listWorkspaceMeta()` 遍历）。
- 影响：多工作区用户只有「最新活跃」工作区的待办会到点提醒/出简报/写快照；其余工作区
  **静默漏提醒**（叠加 P1-1 时，哪个工作区被扫还会被 YOLO 线程自己带跑）。
  「说一遍就兜住」在多工作区下不成立。
- 修复：tick 内遍历 `listWorkspaceMeta()` 逐库跑 reminder/brief/snapshot（brief stamp 已按 cwd 隔离，可直接复用）。

### P1-3 〔核〕语义召回降级（degrade）一旦触发即永久失效，跨天不复位
- 证据：`src/memory/semantic.ts:188-194`（`rollDay` 只重置 `today/usedToday`）、`:201`
  （`shouldExpand` 首行 `if (this.degraded) return false` → 之后 `noteOutcome(true)` 永远不会执行）、
  `:229-232`（`resetDegrade` 定义了但全仓库无调用点）。
- 影响：连续 5 次扩写返回空（模型抖动/限流/超时都算）后，语义召回被**静默永久关闭**（直到进程重启），
  用户只感觉「召回变差」。
- 修复：`rollDay()` 里同时清 `consecutiveEmpty/degraded`，或每日首次 `shouldExpand` 复位。

### P1-4 〔核〕任务行键盘处理器拦截子按钮的 Space/Enter——键盘用户无法使用任何行操作，且会误完成任务
- 证据：`client/panel/KanbanView.tsx:734-739`——行级 `onKeyDown` 对冒泡上来的按键一律
  `preventDefault()` 并执行「完成」，没有 `e.target === e.currentTarget` 守卫。
  行内 `✓ / +1d / 编辑 / 聊一聊` 都是可 Tab 聚焦的原生按钮（:785-792）。
- 复现：Tab 聚焦「聊一聊」按空格 → 预期打开对话，实际**任务被标记完成**。
- 修复：行级处理器加 `if (e.target !== e.currentTarget) return`。

---

## 2. P2 —— 高优先

### 多工作区 / 聚合
- 〔核〕**单库失败整板 500**：`src/ui/dashboard.ts:243-247` 对 `metas.map(buildDashboardData)`
  无逐工作区隔离，任一工作区库损坏/被锁 → 整个看板（含所有正常工作区）打不开。
- 〔核〕**聚合后台账/通知不是全局时间序**：`aggregateDashboards`（:183-189）按工作区分块拼接，
  客户端直接渲染（`KanbanView.tsx:657`）→ 「今日台账」跨工作区时序错乱；通知预览
  `slice(0,4)` 可能漏掉全库最新。`health` 只保留第一个工作区（:202 `{...base}`）。
- 〔报〕**scope_cwd 无校验**：`src/ui/actions.ts:98` 接受任意非空 `scope_cwd`，
  `resolve()` 会 mkdir + 建库 + 注册「幽灵工作区」（`storage/index.ts:80-92`）。
- 〔报〕**分支切换落错库**：`scope_cwd` 路由在动作时刻重新 `computeScopeKey`（含实时 git 分支，
  `storage/scope.ts:12-16`），看板加载与点击之间切分支 → 动作写进另一分支的库，报「todo not found」。

### 角标与通知
- 〔核〕**unhandled 只统计每工作区最近 12 条**：`src/ui/dashboard.ts:111` `listNotifications(cwd, 12)`
  + `:160/:214` 在切片内数 → 未处理 >12 时角标少报，极端情况显示 0。
  「角标 = 可视图」的验收（uiux-review §7）仍不成立。
- 〔报〕**简报卡永不自动清理且不投递**：`scheduler.ts:171-182` 简报只 `addNotification` 无 `deliver`；
  `repository.ts:446-447` 的自动清理只针对 `kind='reminder'` → 早/晚报卡只能手点「知道了」，
  否则角标持续累积；调度器深夜恢复时会一次补发「过期早报+晚报」。
- 〔报〕**reopen 不清 `last_reminded_at`**（`repository.ts:531-536`）：已提醒过的待办撤销完成后不再二次提醒。
- 〔核〕**双击「知道了」报错**：`shared/actions.ts:92-96` 幂等 no-op 返回 404，前端弹「操作失败」横幅。

### UI 交互
- 〔核〕**今日 face 丢 stale 行 + 空白页**：`partitionRows`（`KanbanView.tsx:105-115`）把 stale 行
  恒送入 stale 桶，而今日 face 只渲染 overdue+today（:346-349）→ 「今天到期但 7 天未动」的待办
  从今日页**消失**；若全部如此，页面空白且空态判断 `visibleToday.length===0`（:551）不触发。
  同时 hero/胶囊计数（`focusCounts` 含 stale）与可见行不符。
- 〔核〕**全屏聊天卸载看板**：`YoloPanel.tsx:323-327` 条件渲染与 :321-322 注释（display:none 保挂载）
  矛盾 → 进全屏对话丢编辑草稿、4s 撤销窗口、通知展开态。
- 〔核〕**ChatPane 线程切换竞态**：`ChatPane.tsx:68-85` 旧线程 in-flight 响应在切线程后落地覆盖新线程消息（≤4s 串台）。
- 〔核〕**发送失败留幻影消息**：`ChatPane.tsx:93-117` 乐观上屏 + 清空输入框，失败后消息仍显示已发出，
  「重试」只是重新 load 不补发。
- 〔核〕**加载失败无提示**：`YoloPanel.tsx:330-337` 已有数据时失败仅降透明度 0.6，无任何文案。

### 提醒 / 抽取
- 〔核〕**aheadMin 是「全局前锋窗口」**：`scheduler.ts:92-93` 用 `due_at <= now+aheadMin` 判到期，
  与 :199-205 注释承诺（绝不提前触发「5 分钟后提醒我」）矛盾；日期型 due 会在**前一晚**被提前提醒。
  默认 0 不触发，用户调大即踩。
- 〔报〕**偏好断链**：抽取 prompt 教模型存 `reminder-ahead`/`working-hours`（`extract/prompt.ts:42`），
  但提醒引擎只读 settings（`reminder/index.ts:89-107`）→「提前 1 小时提醒我」说了等于没说。
- 〔报〕**事件 occurred_at 用 UTC 解析**（`extract/index.ts:117` `Date.parse('YYYY-MM-DD')`=UTC 午夜），
  晚报按本地日界聚合 → 负时区用户当日事件落到前一天。
- 〔报〕**提醒 tick 无按 todo 异常隔离**（`scheduler.ts:103-126`）：单条坏记录中断整轮，
  且「出卡成功、置 reminded 失败」时下轮重复出卡。

### 存储
- 〔报〕**FTS 终态回迁丢失**：`repository.ts:78-84` 里程碑 done/abandoned 时删 FTS 行，
  回迁 planned/active 不重插 → 该里程碑从召回里静默消失（`applyGoalAbandon` 同型）。
- 〔报〕**upsertTodo 列与索引分叉**：`repository.ts:122-132` 更新分支不改 `todos.title`
  却用新标题重写 FTS → 搜索结果与看板行标题不一致。
- 〔报〕**多步写无事务**：`repository.ts:506-635, 293-307`（complete/consolidate/upsertPreference）
  状态迁移 + 审计 + FTS 同步非原子，与「审计可追溯」红线有落差。

### 会话 / 召回
- 〔报〕**线程并发竞态**：`ui/session.ts:158-191` `YoloChatThreads.ensure` 无 in-flight 去重；
  UI 与 reminder 各持一个 `YoloSessions` 实例（`ui/index.ts:73` / `reminder/index.ts:73`）互不协作。
- 〔报〕**发送 fire-and-forget**：`ui/session.ts:316-319` `agent.followup` 不等待，
  模型未绑定/回合失败用户仍看到「已发送」。
- 〔核〕**semantic 缓存无上限无 TTL**：`semantic.ts:169-170, 238-268` 两 Map 只增不减，长驻进程缓慢泄漏。

### 设计系统 / 可访问性
- 〔核〕**amber 作文字色对比度 ≈1.9:1**：`tokens.ts:115/134/143/207/236/273/322/341` 等
  `color: var(--y-accent)`（warn-amber）落在 `--y-accent-soft` 浅底上，远低于 AA；
  高亮的「进行中/已选中」语义几乎不可读。应改用 `--y-accent-ink` 或加深文字 token。
- 〔核〕**`--y-text-3`（≈#83888F，3.57:1）大量用于 11-12px 小字**（日期/提示/占位符，tokens.ts
  :99/:150/:178/:194/:217/:361 等），不达 AA。
- 〔报〕**toast 文字用静态白**（`tokens.ts:396`）配主题翻转背景，暗色下可能不可读。
- 〔核〕**侧栏角标轮询不轻量**：`YoloSidebarDashboard.tsx:53` 每 30s 拉全量聚合 dashboard
  （全部工作区 + health 快照），只为一个角标数字。

---

## 3. P3 —— 体验细节 / 打磨

- 〔核〕通知卡正文仍只渲染第一行（`KanbanView.tsx:477` `split('\n')[0]`），规范 5.3 的
  「多行 clamp + 展开」未兑现（CSS 的 line-clamp:2 因此无效）。
- 〔核〕通知卡「+1d」写死 `nextDayStr(null)`（:485），忽略该卡对应 todo 的实际到期日
  （行内 +1d 是按 due 算的）——提前量触发或未来到期时会把日期**改早**。
- 〔核〕`dataSig` 含 `d.at`（`YoloPanel.tsx:49`）→ 注释说 sweep「仅数据变化时跑」，实际每次刷新都跑。
- 〔核〕Esc 层级缺口：捕获条输入框（`CaptureBar.tsx`）按 Esc 直接关整个面板（草稿丢失）；
  里程碑气泡（`msPop`）无 Esc 关闭路径。
- 〔核〕ChatPane 空线程的引导气泡每 4s 随轮询 loading 闪烁（:144 条件含 `!loading`）；
  消息列表 `key={i}` 下标 key（:152-161）。
- 〔核〕「已完成」tab 把**取消**的待办也算进去（`YoloPanel.tsx:199` `!isTodoOpen` 含 cancelled）。
- 〔核〕头部铃铛在 0 条时也显示数字「0」（`YoloPanel.tsx:295`）。
- 〔核〕ViewTabs 有 `role=tablist/tab` 但无 ←→ 漫游、无 `aria-controls`（`ViewTabs.tsx:26-42`）。
- 〔核〕角标 `<span aria-label>` 无 role 不被读屏播报；按钮可访问名重复「YOLO logo YOLO」
  （`YoloSidebarDashboard.tsx:114-131`）。
- 〔报〕`prefers-reduced-motion` 用 `.yolo-scope *` 不覆盖面板根自身的入场动画（`tokens.ts:407-409` vs :91）；
  `.hbtn.spin` 600ms、shimmer 1.5s 超 ≤200ms 约束（:103/:363）。
- 〔核〕YoloLogo 渐变 `#6366F1→#06B6D4` 硬编码，绕开单色 token 约束（`YoloLogo.tsx:27-28`）。
- 〔核〕SettingsCard 纯静态，仍写「本卡片在 M4b 接入可编辑配置」（`SettingsCard.tsx:26`）——预期落差。
- 〔核〕过期注释：`client/index.ts:30-31` 仍写「30s poll while open」（v0.3.3 已移除）。
- 〔核〕删除确认期间 busy key 不匹配（`edit-` vs `del-`，`KanbanView.tsx:412/:422`）可重复提交。
- 〔报〕`milestone_title` 未命中时静默保留旧里程碑（`shared/actions.ts:189-191` → undefined 视为不变）；
  `toPriority` 非法值会**清空**优先级而非拒绝（:48-51/:188）。
- 〔报〕rerank 是独立 LLM 调用但不计入 `dailyBudget`（`memory/index.ts:65-76`），实际用量约 2×预算。
- 〔报〕抽取「empty」判定漏 preferences/events/session_summary（`extract/index.ts:219-220`）。
- 〔报〕死配置：`extractionTokenBudgetPerTurn/PerDay`（`constants.ts:33-34` vs `llm-extract.ts:179` 硬编码 2048）；
  `ui.aggregateAcrossWorkspaces`（`config.ts:99`）在 v0.3.3 端点里已不起作用
  （`dashboard.ts` 无条件聚合，`allowAggregate` 成死参数）。
- 〔报〕`dayBounds` 用固定 DAY_MS（`shared/text.ts:37-40`），DST 时区日界偏移（对 UTC+8 无实害）。

---

## 4. 待确认（疑点，未定级）

1. rerank 缓存键写入（去重后候选）与读取（未去重）可能不一致 → 命中失效退化为无 rerank
   （`memory/index.ts:67` vs `memory/recall.ts:195`）。
2. `YoloSessions.start` 的 resume catch 吞掉一切异常静默转 create（`ui/session.ts:119-121`）。
3. `.p-head` 在极窄面板宽度下可能横向溢出（无 wrap/overflow 兜底，`tokens.ts:95-100`）。
4. 原生 `<select>`/`<input type=date>` 弹层点击是否会被 `useDismissOnOutsidePointer` 误判关面板（平台相关）。
5. `listTodos` / 已完成列表无上限，长期使用的 payload 与渲染量增长（`ui/dashboard.ts:76`）。
6. `detectYoloTheme` 仅挂载时求值（`YoloPanel.tsx:70`），宿主中途切换主题时 `color-scheme` 不跟随。

---

## 5. 红线与安全核查（通过项）

- **提醒绝不注入工作会话**：投递路径唯一（`reminder/index.ts:81-85` → `yolo-w-*` 常驻线程），
  全仓库无向工作会话注入提醒的代码路径。✅
- **SQL/FTS 注入**：全参数化查询；FTS `MATCH` 用绑定参 + `"` 翻倍转义，LIKE 有 `ESCAPE`，
  用户输入（含 `<div>`、`AND OR NOT`、`C:\Users\x*y`）有单测覆盖。✅
- **文案红线**：未发现「记忆助手/记忆看板」措辞。✅
- **动作统一路径**：看板点击与 `yolo_action` 工具同走 `applyYoloAction`，契约两端字段一致。✅
- 基线：`pnpm check` ✅ · `pnpm test:run` ✅ 320/320。

---

## 6. 建议修复顺序（Top 6）

1. **P1-1 + P1-2**（工作区漂移守卫 + 调度器遍历所有工作区）——多工作区下「提醒兜不住」的根子。
2. **P1-3**（degrade 跨天复位）——一行修复，挽回语义召回。
3. **P1-4**(行键盘 target 守卫)——一行修复，消除误完成。
4. **P2 今日 face stale 行/空态/计数一致性** + **unhandled 12 条上限**——主看板可信度。
5. **对比度两件**（amber 文字、text-3 小字）——一次 token 层修改全局生效。
6. **聚合健壮性**（单库失败隔离 + 台账全局排序 + health 合并）。
