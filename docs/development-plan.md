# WorkBuddy（dsh-yolo）开发计划

> **当前批：v0.3.3**（2026-08-23）· 主题：**用户反馈收敛 + 助手看板信息重构**。
> 上一批（v0.3.2：真机反馈 + 记忆收窄 + 借鉴落地）已交付，保留在下方。
> 红线不变：**管理而非代办；绝不打扰工作会话；本地优先；类型安全 + 真机验证。**

---

## 一、v0.3.3 批范围与状态

| 项 | 改动 | 落点 |
|---|---|---|
| V1 对话用 harness 会话能力 | agent 创建/恢复时传 `agentDefaultModel.currentSelection()` + `installModelSelection`（headless 同款），`{{model}}` 绑定，常驻/锚定进程真回复 | `src/ui/session.ts` · `src/ui/index.ts` · `src/reminder/index.ts` · `package.json` |
| V2 去掉 dev.mjs | 删除 `scripts/dev.mjs`；改用标准 `pnpm dsh plugin add . --profile web` + `pnpm dsh web --profile web` | `package.json` · `README.md` · `AGENTS.md` |
| V3 去「记忆健康」 | 移除看板健康折叠 + footer | `client/panel/KanbanView.tsx` · `YoloPanel.tsx` |
| V4 不区分工作区 | 看板始终聚合所有已知工作区；每行带 `ws.cwd`，动作按 `scope_cwd` 路由 | `src/ui/{dashboard,actions}.ts` · `src/shared/dashboard.ts` · `client/panel/{YoloPanel,state,KanbanView}.tsx` |
| V5 会话来源可跳 | 台帐来源徽标先关面板再 `ctx.sessions.open` 跳回 | `client/panel/YoloPanel.tsx` |
| V7 打开不轮询 | 面板打开时去 30s poll；关闭时角标独立轮询 | `client/panel/YoloPanel.tsx` · `client/sidebar/YoloSidebarDashboard.tsx` |
| V9 Today 信息架构 | 今日标题 → 快速记录 → 唯一助手判断 → 需要关注 → 今天 → 今日进展 → 收束；判断项不在列表重复 | `client/panel/v2/TodaySurface.tsx` · `today-surface-model.ts` |
| V10 确定性判断 | 服务端评分、evidence、reason version/fingerprint；首次完整、seen 后紧凑；无候选不渲染空卡 | `src/attention/index.ts` · `src/ui/dashboard.ts` · `src/shared/dashboard.ts` |
| V11 可信反馈闭环 | seen/suppress/feedback 持久化并绑定不可变证据；`client_action_id` 跨重启幂等；客户端只展示服务端学习回执与 undo | `src/shared/actions.ts` · `src/storage/{schema.sql,repository.ts}` · `client/panel/v2/{api,LearningReceipt}.tsx` |
| V12 事项处理面板 | 依据与来源 → 快速处理 → 服务端回执 → 编辑 → 二次确认取消；支持焦点圈、Esc、焦点恢复 | `client/panel/v2/TaskActionPanel.tsx` · `client/panel/KanbanView.tsx` |
| V13 正式响应式形态 | `<480px` 仅今天/即将/已完成；辅助视图进 More；中等宽度单列对话；`>=960px` 可并列 340px 对话 | `client/panel/{YoloPanel,ViewTabs,MoreMenu}.tsx` · `client/design/tokens.ts` |
| V14 跨工作区安全 | 每个动作显式携带行 `scope_cwd`；重复 todo id 不再通过全局 id map 猜作用域；锚定对话 GET/POST 同 scope 且服务端白名单校验 | `client/panel/{KanbanView,ChatPane}.tsx` · `src/ui/{actions,session,workspace-scope}.ts` |
| V15 终态分离 | `cancelled` 不计入已完成；已完成/已取消二级切换；两类都可重新打开并恢复 FTS/审计 | `src/shared/filters.ts` · `src/storage/repository.ts` · `client/panel/KanbanView.tsx` |
| V16 回归与真机门禁 | Node 22 check/unit/build；API/UI E2E；W1–W16；真实常驻对话创建并完成事项；通过后才推送 | `tests/**` · `docs/manual-validation-2026-08-23.md` |

## 二、明确说明

- **存储仍按工作区分库**（数据位置不变、不迁移、不丢）。「不区分工作区」指**看板视图**始终聚合；动作按行归属路由到对应库，因此跨工作区行也可操作（v0.3.0 的「跨工作区只读」限制随本次放开）。
- `scripts/dev.mjs` 删除后，本地开发用标准 dsh 流程（见 README / AGENTS.md）；`scripts/e2e.mjs` 仍用于 E2E 自助拉起宿主。
- V9–V16 的产品事实源为 `docs/prd-assistant-dashboard-rearchitecture.md`；版本仍留在 v0.3.3，本批不发布、不打 tag、不 bump package version。

---

## 三、上一批（v0.3.2）历史背景


本批对应三件事：把真机暴露的交互问题修掉、把「啥都记」的记忆收窄成领域化的管理记忆、把调研里「借了但没落地」的成熟做法真正落到代码。全部改动均已通过 `pnpm check` / `pnpm test:run`；涉及 `client/**`、设计系统、API payload 的已触发真机 W1–W8（含新增 W9/W10）。

| 项 | 改动 | 落点 |
|---|---|---|
| R18 看板打开时切换会话 | 面板描边改为 `left: anchorLeft` 起，不再整屏拦截；点侧栏会话即切换并收起看板 | `client/sidebar/YoloSidebarDashboard.tsx` |
| R19 「聊一聊」= 全新对话 | 新增 ephemeral 线程 `yolo-a-*`（`YoloChatThreads`），每卡片一次全新对话 | `src/ui/session.ts` · `client/panel/{YoloPanel,ChatPane}.tsx` |
| R20 记忆收窄 | 抽取提示词改为「管理助手」，只留承诺/计划/跟踪规则；`memory_write`/system 段同步 | `src/extract/prompt.ts` · `src/memory/{tools,recall}.ts` |
| R21 写入质量闸门 (B3) | `shared/quality.ts` + `mergeExtraction` 过滤确认词/裸元命令/空标题/空值 | `src/shared/quality.ts` · `src/extract/index.ts` |
| R22 提醒安静时段 (B5) | `reminder.quiet*` + `inQuietWindow`；安静时段到点先按住、窗口后补发 | `src/reminder/{scheduler,index}.ts` · `src/ui/config.ts` · `src/shared/constants.ts` |
| R23 改删定位精确匹配 (B6) | `bestByTitle`：精确归一化标题优先，再按状态/最近更新 | `src/storage/repository.ts` |
| R24 快照原子写 (B8) | `writeSnapshot` 改 tmp+rename | `src/storage/snapshot.ts` |
| R25 用后反馈计数 (B1 数据层) | todos 增 `good_count`/`stale_count`；完成→good、取消→stale；看板行「常忘」信号 | `src/storage/{schema.sql,db.ts,repository.ts}` · `src/shared/dashboard.ts` · `src/ui/dashboard.ts` |
| R26 UI 细节打磨 | 行键盘漫游 / 触屏常显 / 通知收件箱 / 相对到期 / 再提醒 / 完成收起动效 / 删除确认修复 / 空态头部微调 | `client/panel/KanbanView.tsx` · `client/design/tokens.ts` |

## 二、本批明确「不做 / 下批再做」

- **B1 召回排序民主化**：数据层（good/stale 计数 + 看板信号）已落地；把高 `stale` 的记忆在 `applyRecallPolicy`/`ftsRecallSearch` 里降权注入是下批（需给 `SearchHit` 带 belief，影响面在召回）。
- **B2 召回基准**、**B4 价值分层 TTL**、**B7 跨工具只读继承**：列为下批。
- **改删歧义报候选清单**：本批只做「精确匹配优先 + 活动度排序」（R23）；完整的 `ambiguous + 候选清单` 错报警告作为后续增强。

---

## 三、上一批（v0.3.0）历史背景

> v0.3.0：语义召回（宿主 LLM 扩写 + 重排 + 兜底 + `recall_log`）与跨工作区只读聚合（`?scope=all`），加上 M9 收尾。以下为当时的计划文本，保留作历史。


dsh-yolo 已完成原型：跨会话长期记忆 + 主动提醒 + 看板式管理。当前代码实况：

- **已实现但未发布**：v0.3.x（面板 1.0 / 有状态计划 / Mono 设计系统 / 完成→撤销 / 早报晚报 / 通知卡与侧栏角标），`package.json` 仍为 `0.2.0-alpha.1`，`CHANGELOG` Unreleased 未收口。
- **已在工作区实现但未提交**：M9「召回质量与机制加固」（`docs/design-m9-recall-quality.md` + 一批 `src/**`、`tests/**` 为未暂存改动）——混合多路召回 `ftsRecallSearch`、`applyRecallPolicy`、会话内注入去重、`{{` 转义、`action_denied` 审计、`consolidate` 原子动作、频控参数接线。
- **调研结论**：长期记忆 + due 调度 + 看板状态机 + 审计的三位一体在公开生态里几乎无人占据，是 dsh-yolo 的差异化位；下一步最该盯 **语义召回** 与 **跨工作区聚合**。

本计划在已定稿的 `design-m9-recall-quality.md` 之上增量，把「真正语义召回」与「跨工作区聚合」落地，并把现有未提交改动收进同一个 `v0.3.0` 发布。

## 二、v0.3.0 批次总览

```
M9 收尾（先立基线）
      │
      ▼
语义召回（宿主 LLM 扩写 + 重排）        ← 本批次主线
      │
      ▼
跨工作区聚合（只读，视图级）            ← 实现范围边界
      │
      ▼
记忆健康度入口（consolidate 候选 + 健康指标）
      │
      ▼
一次 v0.3.0 发布（check/test/build + E2E + W1–W8 全绿后）
```

四个改动块彼此文件不相交，可并行推进；提交按「逻辑检查点」切分，不合并无关改动（`CONTRIBUTING.md` 铁律）。

## 三、M9 收尾（先立基线）

1. 跑通当前未提交的 M9 树：`pnpm check` → `pnpm test:run` → `pnpm build`，确认可编译可测。
2. 把 `docs/design-m9-recall-quality.md` 顶部版本线由 `v0.4.0` 校对为 `v0.3.0`，避免文档与发布不一致。
3. 本块不单独发版，纳入 `v0.3.0` 统一提交。

## 四、语义召回（宿主 LLM 扩写 + 重排）

> 目标：解决“语义同但措辞异”（含跨语言），如搜「季度总结」能命中 `Q3 report`。复用宿主 `ctx.llm`，**不引入 embedding/向量库**，守住零外部服务红线。

### 4.1 数据流

```
用户消息 (session/event 缓存 lastUserText)
      │
      ▼
确定性混合多路召回 ftsRecallSearch        ← 永优先级第一，零成本，确定性
      │  hits + drops（保持现有）
      ▼
语义查询扩写 (ctx.llm)                  ← 1-3 条等价查询 → 并入候选池，去重 (row_type,row_id)
      │   〔gated: minQueryChars / dailyBudget / 缓存命中 / 冷启动跳过〕
      ▼
候选重排 (ctx.llm)                      ← 排序 + keep/drop + reason；只做顺序过滤
      │   〔至少保留确定性 top-K；绝不绕过 applyRecallPolicy〕
      ▼
applyRecallPolicy                       ← kind 配额 / 字节预算 / 会话内去重（不改）
      ▼
注入文本 {{ 转义 + 偏好上限 + RecallDedupTracker（不改）
      ▼
recall_log 落账（query/expansions/drop原因/重排结果/latency）
```

### 4.2 新增模块 `src/memory/semantic.ts`

导出三个纯 / 半纯函数，全部可单测：

- `expandQuery(ctx, text, topK)` → 用宿主 LLM（`purpose:'session-title'` 辅助通道，与 brief 同模式）把用户消息扩成 1–3 条语义等价查询；返回 `{ expansions: string[], latencyMs, ok }`。
- `rerankCandidates(ctx, query, candidates)` → 对候选池逐条给 `{ key, keep, reason: 'confident'|'related'|'weak'|'irrelevant' }`；返回排序后的候选 + reason 分布。
- `semanticRecallEnabled(config, text, cache)` → 门控：低于 `minQueryChars`、命中缓存、超出 `dailyBudget`、寒暄/冷启动时返回 `false`。

实现要点：

- **扩写提示**：给出用户原文 + 现有候选标题（若命中过）+ 要求生成 1–3 条「跨语言/换说法/聚焦 milestone-goal-todo」的等价查询，禁止编造不存在的实体。
- **重排提示**：给用户查询 + 候选（title/due/kind 紧凑展示），要求按相关度排序并给 keep/drop + 机器可读 reason。
- **缓存**：`Map<sessionId, { query, expansions, expiresAt }>`（会话内）+ 全局短 TTL 缓存 `Map<query, { expansions, expiresAt }>`；重排同理，避免每轮重复调用。
- **兜底**：LLM 失败 / 超时 → 跳过扩写与重排，回到确定性 `ftsRecallSearch` 结果（自动降级，绝不静默置空）。
- **确定性护栏**：重排后 `kept = max(rerankKeep, deterministicTopK)`——重排可以把分低的候选往后退，但保留至少确定性 top-K，防止“重排都说无关导致空注入”。

### 4.3 接线：`src/memory/recall.ts` + `src/memory/index.ts`

- `recall.ts`：新增 `semanticHint` 入口，在 `ftsRecallSearch` 之后、`applyRecallPolicy` 之前调用扩写 + 重排；合并候选池（按 `(row_type,row_id)` 去重）再交给既有 policy。
- `index.ts`：在 `session/event` 的 `user/message` 处理器里异步预热语义扩写（与现 `lastUserText` 缓存同一粒度），让 systemPrompt 装配时能命中缓存；`RecallDedupTracker` 行为不变（每 session 一次注入）。
- 语义会话一次注入约束同样适用：扩写/重排只影响“候选是否进来”，不绕过“是否重复注入”。

### 4.4 配置（settings schema + `src/shared/constants.ts` `DEFAULTS`）

新增 `semanticRecall` 命名空间：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关（扩写+重排）；关掉则完全回到确定性 FTS 混合召回 |
| `expansionsPerQuery` | `3` | 每次扩写最多生成的等价查询条数 |
| `rerankOn` | `true` | 是否启用候选重排（关闭则只扩写，靠 BM25/policy 排序） |
| `maxRerankCandidates` | `8` | 参与重排的候选上限（超出的不重排） |
| `dailyBudget` | `60` | 当日语义调用上限（本地日界，越界后直接确定性兜底） |
| `minQueryChars` | `6` | 低于该字符数的查询跳过语义（寒暄/过短不烧 token） |
| `recallLogRetentionDays` | `30` | `recall_log` 保留天数 |

另加 `ui.aggregateAcrossWorkspaces`（默认 `false`），见第五节。

### 4.5 `recall_log` 表（可观测底料）

新表，字段：`id`、`scope`、`session_id`、`query`、`expansions`(JSON)、`kept_keys`(JSON)、`drop_reasons`(JSON)、`rerank_outcome`(JSON)、`latency_ms`、`source`(`user`/`system`)、`created_at`、`status`(`ok`|`error`)。写于每次装配后；供记忆健康度、预算调优、召回命中率观测。

## 五、跨工作区聚合（只读，视图级）

> 目标：让用户能“总揽所有工作空间”的关键事项（逾期/今日/重要紧急），**默认隔离**，聚合作一次性只读视图。

### 5.1 查询层：`GET /yolo/dashboard?scope=current|all`

- 默认 `scope=current`，行为与现状完全一致。
- `ui.aggregateAcrossWorkspaces=true` 才接受 `scope=all`；否则 `scope=all` 回落 `current`，避免用户误开导致大查询。
- `scope=all`：枚举 `data/yolo-*.db`（排除当前 scope），只读打开，执行与 `current` 同构的 dashboard 查询，union 投影，逐行带 `wsSlug`（`sha1(cwd)/branch` 的友好名）与 `wsLabel`，按 `(scope,row_type,row_id)` 去重；响应增加 `scope`、`workspaces: [{slug,label,count}]`、`workspaceCount`。
- 实现文件：`src/ui/dashboard.ts`（聚合入口 + `aggregateDashboard`）、`src/shared/dashboard.ts`（`scope`/`ws` 字段与 projection 类型）、`src/storage/scope.ts`（枚举 DB 文件、读 scope 名）。

### 5.2 UI：看板头部切换

- Headbar 加「当前工作区 / 全部工作区」分段（`state.ts` 持久化，跨开关保留；`client` 侧）。
- 侧栏角标在 `aggregateAcrossWorkspaces` 开启时可计入全部工作区未处理数（独立轻量轮询）。
- 触发宽度：只改动 `client/panel/**` + API payload → **必跑 W1–W8**。

### 5.3 动作纪律（隔离红线）

- 跨工作区视图**只读**：`POST /yolo/actions` 本轮**不改**，不接受 `scope` 参数。
- 外来工作区行仅查看，不提供 ✓/推迟/取消等操作；如需操作，提示先切换到对应工作区。
- 跨工作区动作留待「条目 ID 锚点 + 三方合并」同步纪律落地后作为后续扩展（见 §十一）。

## 六、记忆健康度入口

> 呼应 P26（让用户“看得见系统记住了什么、质量如何”）与 P35（合并是显式动作，不做隐式魔力）。

1. 从 `recall_log`、`extraction_log`、`action_denied` 聚出指标：重复率（近重复候选数）、drop 原因分布（`over-budget`/`kind-quota`/`already-injected`）、召回命中率、抽取错误数。
2. 基于近重复检测给出 `consolidate` 候选清单；看板/设置页提供「去重」入口，复用现有 `applyYoloAction` 的 `consolidate` 路径（`src/shared/actions.ts` 已支持）。
3. 默认低打扰：健康页为可展开/详情入口，不做弹窗打断。

## 七、发布流程（一次 v0.3.0）

待 三–六 完成且全绿（`pnpm check`、`pnpm test:run`、`pnpm build`、E2E、W1–W8）：

1. `git checkout main`、`git pull`、确认 CI 绿。
2. 合并 `CHANGELOG` Unreleased 为 `## [0.3.0] — <today>`，补 compare 链接。
3. `npm version 0.3.0`（或 `pnpm version 0.3.0`）。
4. `pnpm build` + `npm pack --dry-run`（校验 `files` 白名单）。
5. `npm publish --access public`。
6. `git push --follow-tags`，重新开 `## [Unreleased]`。

> 版本策略按 `docs/release.md`：0.x 下 minor 承载特性（面板/有状态计划 → v0.3.0）。**本批次内不 bump 版本**。

## 八、公开 API / 接口 / 类型变更

| 变更 | 位置 |
|---|---|
| 新增 `semanticRecall` 配置命名空间 + `ui.aggregateAcrossWorkspaces` | `src/ui/config.ts`、`src/shared/constants.ts` `DEFAULTS`、`client/settings/SettingsCard.tsx` |
| `GET /yolo/dashboard` 新增 `scope` 查询参数 | `src/ui/dashboard.ts`、`src/shared/dashboard.ts` |
| 聚合响应新增 `scope`/`ws`/`workspaces`/`workspaceCount` | projection 类型 |
| 新增 `recall_log` 表 + 迁移 | `src/storage/schema.sql`、`src/storage/db.ts` |
| 事件种类必要时追加（`recall_*`） | `events.kind` 自由字段 |
| `POST /yolo/actions` **本轮不变**（跨工作区只读） | — |

**不新增运行时依赖**：语义召回复用宿主 `ctx.llm`，不引入 embedding/向量库。

## 九、测试计划

### 单测（`pnpm test:run`，内存 SQLite，不依赖宿主）

- 语义扩写：触发门控（`minQueryChars`/缓存命中/`dailyBudget` 越界）、输出形状、LLM 失败兜底、`recall_log` 落账。
- 候选重排：预算（`maxRerankCandidates`）、「至少保留确定性 top-K」不变式、keep/drop 到 policy 映射、兜底排序。
- 组合不变量：扩写+重排后仍满足 `applyRecallPolicy` 的 kind 配额/字节预算/会话内去重。
- 跨工作区聚合：union/去重/`ws` 标签/`scope` 守卫（`aggregateAcrossWorkspaces=false` 回落 current）。
- 配置接线：`semanticRecall.*`、`ui.aggregateAcrossWorkspaces`。
- `recall_log` 写入与保留。

夹具遵循「用语真实」，机器夹具保留 `[E2E]` 前缀。

### E2E（真实宿主，`node scripts/e2e.mjs --spec <xxx>`）

- 语义召回「重问/换说法命中」（可 mock 语义返回或构造词面重叠命中）。
- 聚合开关 UI 联动；跨工作区动作只读不提交；`consolidate` 合并路径。
- 夹具幂等自清理（`afterAll`）。

### 真机 W1–W8

凡改动涉及 `client/**`、Mono 设计系统或 API payload（dashboard `scope`、设置卡、窄视图默认、聚合切换），按 `docs/testing.md` §七全量走查。

## 十、风险与取舍

- **保「零外部服务」**：语义召回用宿主 LLM，不加 embedding 依赖/模型体积；扩写与重排均带确定性兜底与预算，成本可控。
- **成本 / 打扰**：默认保守（`enabled` 开 + `dailyBudget` + `minQueryChars` + 缓存；`rerankOn` 或每轮限一次）。先用 `recall_log` 实测命中率再放开阈值。
- **跨工作区只读**：避免「动作改到别的项目」破坏隔离；跨工作区动作需等 ID 锚点 + 三方合并纪律。
- **别堆功能**：本批次严格到跨工作区聚合为止；中远期方向只列框架，不纳入。

## 十一、中远期方向框架（不在 v0.3.0）

- **时间有效性 + 自动失效 + 证据溯源**（P13/P14/P15）：在 SQLite 领域表加 `valid_at/invalid_at` 与来源映射；不引知识图谱。
- **用后裁决 use/verify/ignore + 置信回写 + 自动降级护栏**（P16/P38/P39）：零打扰静默收集。
- **前缀缓存双轨注入**（P43）：静态纪律走 `systemPrompt.section` 锚、动态记忆走 context 快照、内容稳定。
- **跨设备同步纪律**（P27–P29）：条目 ID 为合并锚点 + 三方合并 + 显式推送 + 本地永远完整。
- **记忆治理强化**（P34–P37 未覆盖部分）：提案式记忆、唯一子串定位 + 候选清单容错。

## 十二、实施顺序与提交切分

1. 基线：`pnpm check`/`pnpm test:run`/`pnpm build` 验证 M9 树（本文档视作一次提交的一部分）。
2. 语义召回：`semantic.ts` + `recall.ts`/`index.ts` 接线 + `constants`/`config` + `schema`/`db` 迁移 + `recall_log` + 单测。
3. 跨工作区聚合：`dashboard.ts`/`shared/dashboard.ts`/`scope.ts` + UI 切换 + 单测。
4. 记忆健康度：聚合指标 + `consolidate` 候选与入口。
5. 集成：`pnpm check` → `pnpm test:run` → `pnpm build` → E2E → W1–W8。
6. 文档与发布：`CHANGELOG`/`README` Roadmap/`docs/README.md` 索引 + `npm version 0.3.0` 发布（见 §七）。

---
*关联：`docs/design-m9-recall-quality.md` · `docs/research/09-borrowables.md` · `docs/architecture/overview.md` · `docs/testing.md` · `docs/release.md`。*
