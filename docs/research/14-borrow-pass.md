# 他山之石 · 第二轮复盘：「借过来」差额报告

> dsh-yolo 对照 deepseek-harness 生态各库的「现状 vs 差距」代码级复盘。
> 和前两轮调研的区别：这一轮**以 `dsh-yolo` 当前代码为基线**，逐条回答
> **「别人做的好，我们借了没有？还差哪一块？怎么补？」**，不再停留在"可以借鉴"的抽象原则。
> 配套：`08-dsh-ecosystem.md`（生态清单）· `09-borrowables.md`（P1–P46）·
> `10`–`13` 号（各库源码级深读）。源码克隆位于 `D:\Code\WorkBuddy\dsh-research\`。

---

## 0. 先回答你的直觉：「感觉没借鉴」——对，但原因不是"调研白做了"

三句话概括：

1. **P1–P46 里确实有被落到代码的**（见 §1），落的全是"看不见的管道"——
   语义召回、注入去重、前缀缓存、动作审计、记忆健康入口。它们让你的产品"平时更稳、更省、更可查"，
   但**没有任何一处是用户一眼能看到的"变好了"**。所以体感为零。
2. **真正"借了就能立刻感知到好"的两件事被明确搁置了**——① 用后反馈（越用越准、
   坏记忆自动隔离）② 召回质量**可测量**（拿证据证明"换了说法也找得到"）。
   前者在 roadmap R15 里标注"置信回写无反馈通道，按红线不堆功能"；后者只有 `recall_log`
   观测，没有评分基准。**缺的正是"因此变好了"的证据。**
3. **上一轮的报告写法是"可以借鉴"，不是"已借了什么 / 还差什么"**——所以读起来像分析，
   不像工程清单。这一轮改成差额清单（§3 的 B1–B8），每条都可以直接当工单。

结论：调研没白做，但"借"要兑现成**可感知的收益 + 可测量的证据**，否则永远像没做。

---

## 1. 已经借了（对照表）—— 别以为没借

以下映射成立，说明上一轮不是空转。缺口是**"可见的证据"**，不是"没落实"。

| dsh-yolo 已实现的需求 | 对应可借鉴编号 | 出处库 | 当前落点 |
|---|---|---|---|
| R13 真·语义召回（扩写+重排+兜底+预算） | P6/P7 | mem0、dsh-mnemon | `src/memory/semantic.ts`、`src/memory/recall.ts` |
| R14 时间有效性+失效+溯源（preference valid_at/invalid_at/history） | P13/P14 | Zep/Graphiti | `src/storage/schema.sql`（表层面）、`src/storage/repository.ts` |
| R15 keep/drop+reason+自动降级（连续空跑→只做确定性） | P12/P38/P39 | dsh-memory-gate | `src/memory/recall.ts`（applyRerank/applyRecallPolicy）、`src/memory/semantic.ts`（degrade） |
| R8 记忆健康折叠页+一键 consolidate | P35/P26 | dsh-memento、Letta `/doctor` | `src/shared/actions.ts`（consolidate）、`src/storage/repository.ts` |
| R9 今日聚焦默认 N 条可配 | P20/P24 | dsh-memory-evolve（硬过滤） | `client/panel/*`、配置 schema |
| R16 前缀缓存双轨注入 | P43 | dsh-auto-memory | `src/memory/recall.ts`（section 锚 + context 快照 + 会话去重） |
| 动作统一入口 + `<action>-denied` 审计 + 原子合并 | P34/P35 | dsh-memento | `src/shared/actions.ts`（`deny()`） |
| 跨工作区只读聚合（scope=all） | P29 / 08 生态教训 | 08 | `src/ui/dashboard.ts` |

一句话：**"借"发生在了机制层，但没发生在"看得见"的信号层。** 下面补的就是信号层。

---

## 2. 逐库再读：别人做得好、我们仍缺哪一块（代码级基线）

> 基线代码以 `src/**` 当前实现为准。每条 = 仓库做法（文件）→ dsh-yolo 现状（文件）→ 差额。

### 2.1 dsh-memory-gate —— 缺「用后反馈 + 坏记忆隔离」

- **做法**：`lib/authority.js` 的 `decideAuthority` 用 `belief(alpha/beta)`、`harmfulCount`
  、`validUntil`、词法相关度、新鲜度做裁决，输出 `use/verify/ignore` + 可解释 `reasonCodes`；
  `harmfulCount ≥ quarantineThreshold` 直接 `ignore`（有害隔离）。
- **dsh-yolo 现状**：`src/memory/recall.ts` 的 `applyRerank` 只做 `keep/drop+reason`；
  `src/memory/semantic.ts` 只对"LLM 空跑"（`noteOutcome`）降级。**confidence 只在偏好重复时
  `+0.1`**（`src/storage/repository.ts:286`），**从不因"用户用过/没用过"变化**。
- **差额**：**没有反馈回路**。记忆要么"被注入"，要么"被降级"，但永远不会"因为用过而更可信，
  因为没用过/有害而隔离"。这是"越用越准"的分水岭，也是 dsh-yolo 记忆质量最大的单点缺口。

### 2.2 dsh-mneme —— 缺「写入质量闸门 + 召回质量分量」

- **做法**：`lib/quality-filter.js` 的 `evaluateMemoryQuality` 对每条记忆打 0–100 分，
  命中 元记忆(-45)/自指(-15)/过短(-80)/复读(-50)/近重复(-80)；`<30` 归档、`30–60` 降权注入。
  `lib/hot-memory.js` 把最近几轮对话做成**独立短期热缓冲**，与长期库严格分离。
- **dsh-yolo 现状**：`src/extract/index.ts` 的 `mergeExtraction` 把 LLM 返回的
  todos/goals/prefs/events **直接落库**（仅 title/key + 事件摘要去重），无质量闸门；
  `src/memory/recall.ts` 排序只看语义重排 + FTS 相关度 + 预算，**无质量分参与**。
- **差额**：**写入无质量闸门**（"记住你刚才在系统提示里提到记忆系统"这类自指/元记忆会直接进库）；
  **召回排序无质量分量**（低质条目与高质条目同权）。

### 2.3 dsh-memento —— 缺「存储预算 / 老化」+「改删歧义报错」

- **做法**：`lib/budget.mjs` 按 `track×scope` 设硬字符预算，**超限报错、绝不截断/自动压缩**；
  `lib/match.mjs` 用**唯一子串定位**，零命中→not-found、多命中→ambiguous（带候选清单）；
  `lib/snapshot.mjs` 会话启动冻结一次、中途不变（前缀缓存稳定）。
- **dsh-yolo 现状**：`src/memory/recall.ts` 的 `applyRecallPolicy` 超预算"跳过单条"（注入侧 OK）；
  但**store 层无每轨/每作用域预算**，todos/events/prefs 无上限增长；改删定位用
  `src/storage/repository.ts` 的 `looseMatch`（双向包含），**多命中时不会报 `ambiguous`**，
  `applyTodoAction`/`applyTodoUpdate` 直接取第一个匹配。
- **差额**：**存储无预算/无老化**（只增不衰）；**改删有歧义时不报错**（可能误改第一匹）。
  注：快照冻结这一条 dsh-yolo 已用 `RecallDedupTracker` 部分对齐。

### 2.4 dsh-auto-memory —— 缺「工作时段门控 / 分级投递」+「跨工具只读继承」

- **做法**：`lib/index.js` 每轮自巩固带频控（`autoConsolidateMinChars`、冷却、`DailyMax`、
  失败重试队列、heartbeat、日界重置、**非工作时段冷却翻倍**）；外部记忆继承用**路径指针非整段 +
  `sanitizeForWrite` 卫生闸门**；`CALENDAR.md` 数据面 + 首轮注入弱主动。
- **dsh-yolo 现状**：`src/extract/index.ts` 有日上限 + 最小字符 + 每会话间隔（= 频控的一半）；
  **无失败重试队列**；**无跨工具记忆继承**；`src/storage/schema.sql:20` 有 `working_hours` 字段、
  `src/storage/types.ts:42` 有类型，但 `src/reminder/scheduler.ts` 的 `runReminderTick` **完全不读它**；
  提醒**单一强度**，无 due 前预告 vs 到点分级。
- **差额**：**提醒缺 working_hours 门控与分级投递**；**缺跨工具只读记忆继承（指针+卫生闸门）**；
  **缺自巩固失败重试**。

### 2.5 dsh-hme —— 缺「价值分层 TTL / 自然淡出」

- **做法**：`src/memory/archive.ts` 价值分层（V1 永不过期 / V2 365d / V3 90d）+ 溢出沉降 +
  `[ttl:]`/`[v:]` 标记 + `parseTtlMs` 计算过期。
- **dsh-yolo 现状**：preferences 有 `valid_at/invalid_at`（只处理**被替代**），
  **facts/notes/事件没有 TTL/价值分层**，不会"自然过期沉降"。
- **差额**：**记忆只有"替换"，没有"淡出"**。旧事实不会因时间过去而降权/归档。

### 2.6 dsh-memory-lite —— 大部分已对齐/更优，只借「原子写」到快照

- **做法**：文件即真相 + tmp+rename 原子写 + mtime 跨进程协调 + 解析失败保留最后好快照；
  会话开始注入 + digest 去重 + resume 免疫。
- **dsh-yolo 现状**：SQLite 本身 ACID，原子天生优于文件（这块不用借）；会话注入已有
  `RecallDedupTracker`（部分对齐 digest/resume）；但**快照写是 `writeFileSync`**
  （`src/storage/snapshot.ts`），非原子，崩溃可能留半截 Markdown。
- **差额**：**快照/导出写非原子**。这条值得借（低成本、防半截文件）。

### 2.7 dsh-memory-evolve（提醒面对照）

- **做法**：guard/severity/**两级投递**、**工作时段感知**、due 写快照粘性、不打扰。
- **dsh-yolo 现状**：单级投递 + `aheadMin`；**无 severity、无工作时段感知**。
- **差额**：**提醒分级 + working_hours 门控**（低打扰的红线工程化）。

---

## 3. 真正值得"现在就借"的差额清单（B1–B8，按"借了就变好"排序）

> 每条 = **借什么（出处）→ dsh-yolo 现状（文件）→ 怎么改（落点 + diff 思路）→ 验收（可测）**。
> 这是工单，不是分析。

### B1（最高优先）用后反馈回路 —— "越用越准 + 坏记忆隔离"
- **借**：dsh-memory-gate `authority.js`（belief alpha/beta + harmfulCount 隔离）、#02 反馈校准。
- **现在**：`src/memory/recall.ts` 只降级不学习；prefs `confidence` 只在重复时 +0.1（repository.ts:286）。
- **改**：
  - 给 `recall_log`/`actions` 加"用后"信号：看板"完成/取消"、会话内"yolo_action complete/cancel"
    把该条 todo/project 记忆回写一个 `good`；提醒"再提醒/被忽略"回写 `stale`。
  - 抽象一个 `belief`（alpha/beta）+ 一个 `harmful/sealed` 标记；`decide` 时：
    `harmful ≥ 阈值` → 不注入（隔离）；`good 多` → 提升注入优先级/权重；`stale 多` → 降权。
  - 落地：`src/storage/repository.ts` 加 `bumpBelief(rowType,rowId,good|stale)` 封装，`src/shared/actions.ts`
    在 applyTodoAction 处调用；`src/memory/recall.ts` 排序时乘 `beliefScore`。
- **验收**：单测——某条记忆被"完成"数次后，注入权重上升；被"取消/标有害"数次后不再注入。
  真机——用"再提醒"折腾某条记忆，看板可看到它从"常出现"变"少出现"。

### B2 召回质量基准 —— "证明借对了"（让借鉴可量化）
- **借**：dsh-memory-gate 的 30 个 synthetic 场景 + `backtest/`；dsh-mneme `scripts/benchmark-recall.js`。
- **现在**：只有 `recall_log`（观测），无评分基准；R13 的"换说法也找得到"无法证明。
- **改**：建 `tests/recall/*.fixture.ts`（贴合真实句子，如"提醒我把演示稿发给研发"对应
  "要把演示稿发给研发"），每 run 统计 **命中率@5 / MRR**，写入 `recall_log` 之外的 `recall_bench` 表；
  设置变更（开启/关闭语义扩写、调 `recallTopK`）能在基准上看到 delta。
- **验收**：`pnpm test:run` 跑基准；在某次改动前后对比命中率，看到正向 delta。**这是"我借了、
  且变好了"的直接证据。**

### B3 写入质量闸门 —— 防自指/元记忆/复读入库
- **借**：dsh-mneme `quality-filter.js`（meta/self-ref/short/repetitive/duplicate 打分）。
- **现在**：`src/extract/index.ts` `mergeExtraction` 直接落库。
- **改**：在 `mergeExtraction` 落库前对每条 title/content 跑一个纯函数 `evaluateQuality`；
  `< archive` 记 `quality=low` 不注入（仍可搜）；`30–60` 存 `quality_score` 供排序降权。
  可先只做"元记忆 + 复读 + 过短"三条规则（`escapePromptTemplates` 已有 meta 转义）。
- **验收**：单测——"记住你刚提到要记住系统提示词"这种自指句被标 low；正常句子正常入库。

### B4 事实/笔记价值分层 TTL —— 只淡出，不误删
- **借**：dsh-hme `archive.ts`（V1 不过期 / V2 365d / V3 90d + `[ttl:]`）。
- **现在**：prefs 有 `valid_at/invalid_at`（仅替换）；facts/events/notes 无 TTL。
- **改**：`schema.sql` 给 `preferences`/`events`/`todos`（非活跃）加可选 `expires_at`；读取/召回时
  `expires_at < now` → 降权/归档（写 `archived` 标记，不删）；健康页可 "清理已过期"。
  与 B1/B3 一致：**宁可淡出，不静默删**。
- **验收**：单测——一条 `expires_at` 到期的记忆不再出现在 recall 注入；库内仍在（可查）。

### B5 提醒分级 + working_hours 门控 —— 低打扰可配置
- **借**：dsh-memory-evolve guard/severity/两级投递 + 工作时段感知；dsh-auto-memory 非工作时段冷却翻倍。
- **现在**：`src/reminder/scheduler.ts` `runReminderTick` 单级、不读 `working_hours`；`DEFAULTS.reminderAheadMin=0`。
- **改**：`schedule` 读 `user_profile.working_hours`；due 前 `aheadMin` 内→"温和预告"（角标弱强调），
  到点→"到期提醒"（高亮 + 卡片）；非工作时段到期顺延到下一工作时段（可配置）。
  `runReminderTick` 增加 `severity` 级别，投递分级、正文分级。
- **验收**：单测——工作时段外到期不触发"强提醒"；`aheadMin=60` 的 todo 在 due 前 1h 出预告、
  due 时出强提醒。真机走 W1–W8 提醒可见性项。

### B6 改删歧义报错 —— 防误改第一匹
- **借**：dsh-memento `match.mjs`（唯一子串 + ambiguous 带候选清单）。
- **现在**：`src/storage/repository.ts` `looseMatch` 取第一个命中。
- **改**：把"标题定位"抽成 `locate(ref)`，返回 `ok/not-found/ambiguous`；
  `applyTodoAction`/`applyTodoUpdate`/`applyMilestoneStatus` 接 `ambiguous` 时走 `deny()`
  （`src/shared/actions.ts`）给"请用更具体的唯一子串/选择卡片"，并落 `action_denied` 审计（已有）。
- **验收**：单测——两条名字含"演示稿"的 todo，`title="演示稿"` 报 ambiguous；`title="演示稿 v2"` 精确命中。

### B7 跨工具只读记忆继承 —— 指针 + 卫生闸门（中期）
- **借**：dsh-auto-memory `external/`（WorkBuddy/Claude Code/Codex 会话）+ 路径指针 + `sanitizeForWrite`。
- **现在**：dsh-yolo 只存自己的 SQLite。
- **改**：加一个**只读**的 `memory_external`（不写外部）；导入只给"路径/摘要指针"不整段注入，
  注入前过 sanitize/secret 闸门；走"跨工作区只读"同款红线（不操作）。
- **验收**：读侧单测——外部源以指针形式出现在 recall，全文不落 dsh-yolo 库。

### B8 快照原子写 —— 防半截 Markdown（低成本顺手做）
- **借**：dsh-memory-lite tmp+rename 原子写 + 解析失败保留最后好快照。
- **现在**：`src/storage/snapshot.ts` `writeFileSync`。
- **改**：写入用 `tmp + rename`；解析失败保留上一份好快照。
- **验收**：单测——写入中断不产生半截文件。

---

## 4. 怎么让"借鉴"不再被当成"没做"

1. **凡借必交"可测量/可见"**：B2 召回基准让"借了变好"有数据；B1/B5 让好落在用户可感知处。
2. **落点留注释**：以后每个 borrow 在代码注释里写 `// borrowed from P## · dsh-<repo>@lib/<file>`
   ，别只写"语义召回"这种抽象词。
3. **借了就跑全套门禁**：`pnpm check` + `pnpm test:run`；改 `client/**`/设计系统/API payload 再跑
   对应 E2E 与真机 W1–W8（见 `docs/testing.md` 触发范围）。
4. **红线不破**：取"频率控制 / 门控 / 衰减 / 指针继承"，舍"伪装用户指令 / 实时打断工作会话 /
   整段塞外部记忆"——这与 §2.4 的 dsh-auto-memory、§2.7 的 dsh-memory-evolve 对照正是取舍点。

---

## 5. 结论

- 上一轮调研**没有白做**：P1–P46 已有落地（§1 映射成立），但全部落在"看不见的机制层"。
- **"没感知到借鉴"是真实问题**，根因是缺**反馈回路**（B1）+ **测量基准**（B2）+
  **用户可见收益**（B5）。这三样补上，借鉴就不再是"自说自话"。
- 本轮差额清单（B1–B8）**都贴着现有代码**，且都是"借了立刻变好"的工程项。
  **建议优先级：B1、B2、B3 先行（质量三角），B5、B6 紧随（低打扰+防误操作），B4、B7、B8 跟进。**
- 两条红线照旧：只借机制，不越"管理而非代办 / 绝不打扰工作会话"；工程门禁（类型安全 +
  W1–W8 + 用语真实）不缺位。

---
*配套：`08-dsh-ecosystem.md` · `09-borrowables.md`（P1–P46）· `10-dsh-memento.md` ·
`11-dsh-memory-gate.md` · `12-dsh-memory-lite.md` · `13-dsh-auto-memory.md`。*
