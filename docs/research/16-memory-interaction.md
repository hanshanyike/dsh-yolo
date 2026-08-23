# dsh 生态「记忆机制」与「交互机制」专项（结合 dsh-yolo 已实现）

> 按你的方向收窄：**只讲记忆机制与交互机制**。上一轮（`14`/`15`）的投递分级、待办象限、
> 崩溃恢复，按你判断放次要，本报告不再展开。
> 源码克隆：`D:\Code\WorkBuddy\dsh-research\`；逐行读了 `dsh-memento`(index/store/gate/snapshot/match/budget)、
> `dsh-memory-gate`(authority/commands/mine)、`dsh-memory-lite`(index/store/render)、
> `dsh-auto-memory`(index/external)、`dsh-mneme`(quality-filter/hot-memory/store/inject)、
> `dsh-hme`(archive/facts/recall/status)、`dsh-memory-evolve`(store/todo/advisor)、`dsh-mnemon`(memory-providers)。
> 基线（dsh-yolo 已实现）：`src/memory/*`、`src/extract/*`、`src/storage/*`、`src/ui/*`。

---

## 0. 一句话

记忆机制：生态里大家几乎都在做「存→写→召回→引用→遗忘」，**dsh-yolo 已经把「存与取」做掉了七成**
（SQLite+FTS5 混合召回、LLM 语义扩写重排、preference 时间有效性、注入预算与去重）。
真正缺的是 **知识/事实/教训的类型分层、证据溯源、用后反馈学习、写入质量门、自然淡出**。

交互机制：生态里大家几乎都在做「模型工具 + 用户管理面 + 人机确认」，**dsh-yolo 已经把「看」做掉了七成**
（看板/台账/记忆健康折叠/快速记一条）。真正缺的是
**单一 `memory` 动词 + 召回带历史证据、`/memory` 反馈/诊断/解释/回挖/模式、
记忆管理面板（预算 + 审计 + 待审提案）、能遗忘偏好/事实**。

---

## A. 记忆机制：横向对比

### A.1 数据模型与类型分层（"记忆长什么样"）

| 仓库 | 类型/轨道 | 作用域 | 关键字段 | 存储 |
|---|---|---|---|---|
| **dsh-yolo** | todo/milestone/goal/preference/event | 单 `scope_key`(sha1(cwd)+branch) | pref: `confidence`+`valid_at/invalid_at`+`session_id` | SQLite+FTS5 |
| dsh-memory-lite | preference/fact/summary/knowledge | global/project | `tags`+`importance`(1..5) | 原子 JSON 文件 |
| dsh-memory-gate | kind: preference/constraint/fact/procedure/warning | session/workspace/global | **`belief(alpha/beta)`+`harmfulCount`+`terms`+`learnedTerms`+`evidence`+`state`+tombstone** | SQLite+FTS |
| dsh-memento | track: user/agent | user-global/workspace | `tags`+`source`+`sessionId`+硬预算+审计+提案 | SQLite(node:sqlite) |
| dsh-memory-evolve | 5 轨：USER.md(偏好)/MEMORY.md(约定)/daily 日志/project 日志/project KEY.md(注入) | 项目+分支 | `§` 分隔纯文本+`[branch:]`+时间戳 | Markdown 文件 |
| dsh-mneme | entities/attrs/relations 图谱 + 记忆体 | 项目/全局 | 图谱边+`valid_at`+质量分 | SQLite(graph)+BM25+热记忆 |
| dsh-hme | 事实/规则/归档 | 有界核心→archive | `[v:N]`+`[ttl:]` 价值/过期 | Markdown 多级缓存 |

**差距**：dsh-yolo 的 `preference` 是**扁平 key-value**，没有 `fact`（环境事实）、`knowledge`/`lesson`
（可复用经验/教训）、`summary`/`procedure`（流程约定）。抽取 prompt（`src/extract/prompt.ts`）只产出
todos/goals/milestones/preferences/events——`knowledge`、`fact`、`procedure`、`lesson` **没有落点**。

### A.2 写路径：谁决定"值得记"

| 仓库 | "值得记"的判定 | 是否确认 | 途径 |
|---|---|---|---|
| **dsh-yolo** | 每回合尾 LLM 语义抽取（whole-turn→JSON） | **无**（direct write） | `agent/turn-stopping`→`llmExtract`→`mergeExtraction` |
| dsh-memento | 同上，但**提案先行**：compaction→proposals→user approve | **有**（approval gate ask/auto/off） | 不可绕过 Service seam + `-denied` 审计 |
| dsh-memory-gate | 显式 `/memory remember` + 保守 cue 抽取（宁缺毋滥）+ `mine` 回挖旧日志 | 无（heuristic 低压） | 命令 + extractor + mine |
| dsh-mneme | 每回合插入 + **Sleep Mode 深度维护**（聚类/打标/决策抽取）+ 写入前质量分 | 无 | dream/sleep + quality-filter |
| dsh-auto-memory | 每轮自巩固 subagent（寒暄门槛/冷却/日上限）→每日日志→升格项目/用户 | 无 | turn-stopping + 写闸门 |

**差距**：dsh-yolo 的 LLM 抽取是**直接落库、无确认、无质量门**（`mergeExtraction` 只做 title/key +
事件摘要去重）。它既没有"提案待审"，也没有"写入质量打分"。

### A.3 召回与注入

| 仓库 | 召回 | 注入 | 是否有"历史会话"召回 |
|---|---|---|---|
| **dsh-yolo** | FTS(短语+trigram+LIKE) + LLM 扩写/重排 + recall policy(配额/预算/去重) + 确定性下限 | prefs 常驻 section + 动态 recall context | **否**（只搜存下来的行） |
| dsh-memento | `memory_recall` = **记忆 + 近期会话历史**（session-query 抽片段） | 会话启动冻结快照（中途不变） | **是**（两段式） |
| dsh-memory-lite | 子串 match（不含语义） | 会话首步一次注入 + digest 去重/resume 免疫 | 否 |
| dsh-memory-gate | 词法触发 + CBDC 裁决 use/verify/ignore | 注入前裁决 + capsule 特权通道 | 否 |
| dsh-mneme | BM25+图谱+热记忆融合 + 质量加权 + 自适应 | 热记忆块在长期召回前 | 否 |
| dsh-hme | 关键词（核心常驻+archive 按需） | 有界核心 + 价值/TTL | 否 |

**差距**：dsh-yolo 的召回**完全没有读"更早的会话原文"**——它只搜 SQLite 里已抽取的行。memento 的
`memory_recall`（记忆 + 近期会话历史片段）这一交互是 dsh-yolo 缺失的：当记忆有歧义、或答案在更早对话
而非"记忆"里时，模型没有证据可看。

### A.4 遗忘 / 衰减 / 隔离 / 质量

| 仓库 | 遗忘语义 | 衰减/淡出 | 质量门 | 隔离 |
|---|---|---|---|---|
| **dsh-yolo** | cancel/abandon（todo/goal/milestone 软删 FTS） | **pref 仅"被替代"**（valid_at/invalid_at），facts/事件无 TTL | **无**（直接入库） | 无 |
| dsh-memento | remove + 审计 | 硬预算触发 consolidate（**不截断**） | 提案待审把关 | 无 |
| dsh-memory-gate | forget→tombstone | stale 降权 + harmful 隔离 + supersede 合并 | 提取宁缺毋滥 | harmful quarantine |
| dsh-mneme | 归档不删（`<30` 仍可搜） | 质量降权注入 | **0–100 打分（meta/自指/过短/复读/重复）** | 低质不打注入 |
| dsh-hme | 溢出→压缩沉降 archive | **价值分层 V1 永久/V2 365d/V3 90d + `[ttl:]`** | 无 | 层级隔离 |
| dsh-auto-memory | 外部记忆可导入可移除 | 每日日志 30 天归档 | 写闸门（乱码/复读/脏 token） | secret/脏 token 拦截 |

**差距**：dsh-yolo **没有"用后学习"**（belief/harmful/stale）、**没有写入质量门**、**没有自然淡出**
（仅偏好被替换）、**没有 harmful 隔离**。这是记忆机制上最厚的空档。

---

## B. 交互机制：横向对比

### B.1 模型工具面（Agent 怎么看/写记忆）

| 仓库 | 工具集 | 特点 |
|---|---|---|
| **dsh-yolo** | `memory_search`/`memory_write`/`memory_forget`/`yolo_action`/`yolo_query` | 按"计划"拆开；kind=row-type；**forget 只支持 todo/milestone/goal** |
| dsh-memento | **单一 `memory` 工具**：action=add/replace/remove/consolidate/query + track/scope/match/matches/tags/limit；`memory_recall`(记忆+历史) | 动词化、唯一子串定位、显式 consolidate、工具描述内嵌 SAVE/SKIP 指引 |
| dsh-memory-lite | `memory_write/read/search/delete`(type+scope+tags+importance) | 四类两域、重要性、写前先搜防重 |
| dsh-memory-gate | `/memory` 命令：status/list/remember/search/explain/forget/ok/feedback/mine/consolidate/mode | 人机闭环：反馈、解释、回挖、模式、自诊断 |
| dsh-auto-memory | `memory_log/note/user/recall/maintain/status/reflect/consolidate/external` | 许多强动词；reflect(每日反思)、consolidate(AI 读日志提炼)、external(其它 AI 工具记忆) |
| dsh-mneme | 工具 + API | 召回质量/实体/图谱 |
| dsh-hme | `recall-tool`/`archive-tool`/`status-tool`/rules/facts + `/hme-status` | 记忆多级缓存 + 状态仪表盘 |

**差距**：
1. dsh-yolo 没有**统一记忆动词**（add/replace/remove/consolidate/query）→ 模型要分裂成 search+write+forget+action。
2. dsh-yolo 的 `memory_forget` **不能遗忘 preference/event**（kind 只允许 todo/milestone/goal）——偏好错了删不掉。
3. dsh-yolo 的 `yolo_query` 是**看板视图**，不是"召回记忆+近期历史"的 `memory_recall`。

### B.2 用户管理面（人怎么"看见/编辑/信任"记忆）

| 仓库 | 用户面 |
|---|---|
| **dsh-yolo** | 看板(kanban)+时间线台账+记忆健康折叠(recall 计数+consolidate)+快速记一条+设置。**没有记忆条目浏览器/预算条/审计尾** |
| dsh-memento | Web 面板 `/api/memento/{entries,audit,proposals}`：浏览/搜索记忆 + **预算用量条** + **审计尾** + **待审提案**（写走审批 UI，面板只读） |
| dsh-memory-gate | `/memory` CLI（**无 GUI**）但反馈/状态/解释/回挖/模式都在 |
| dsh-auto-memory | GUI 侧栏「记忆」面板 + 设置页 + 外部来源配置 + 反思视图 + "接续"页签（可把已导入段落从记忆 prompt 移除） |
| dsh-mnemon | WebUI 记忆体概览（创建/编辑/启停/删除）+ Provider 配置 + 三层浏览；**secret 掩码展示** |
| dsh-memory-evolve | 记忆 Tab（分支/项目/轨道）+ advisor 可见表面 + 待确认队列 |

**差距**：dsh-yolo 的"记忆健康折叠"是**可观测性**（召回/抽取质量+去重入口），不是**记忆管理**
（没有"我记住了什么"的逐条浏览器、没有预算用量、没有审计尾、没有待审提案）。

### B.3 人机确认与信任

| 仓库 | 确认 | 反馈 | 解释/溯源 | 自诊断 |
|---|---|---|---|---|
| **dsh-yolo** | 完成/取消走 `applyYoloAction`+审计+4s 撤销 | **无** | pref 带 session_id（弱） | recall/抽取质量计数 |
| dsh-memento | **approval 门**（ask/auto/off）+ `-denied` 审计 + 提案待审 | 无 | 审计表可重建 | 预算报表 |
| dsh-memory-gate | 无（heuristic） | **`/memory feedback <n> <helped/harmful/stale/conflict>` + `/memory ok`** | **`/memory explain`（belief/terms/evidence）** | **`/memory status` 自动降级 shadow + `mode` 恢复** |

**差距**：dsh-yolo 没有**用后反馈**（M3）、没有**逐条解释**、没有**自诊断降级入口**（semantic
degrade 是内部自动、无 `/memory status` 用户可见面）。

---

## C. dsh-yolo 现状盘点（哪些已实现 / 哪些是空的）

**记忆机制：已实现** —— SQLite+FTS5 混合召回、LLM 语义扩写/重排/确定性下限、recall policy（配额/预算/去重）、
preference time-validity + history、注入预算与 session 去重、semantic 自动降级。
**记忆机制：空的** —— ① 知识/事实/教训/约定类型分层（只有 preference 扁平）；② 证据/术语/belief 溯源；
③ 用后反馈学习；④ 写入质量闸门+归档不删；⑤ 自然淡出（TTL/价值分层）；⑥ 召回读历史会话原文。

**交互机制：已实现** —— 看板/时间线台账/记忆健康折叠/快速记一条/行内筛选改期/设置/常驻线程。
**交互机制：空的** —— ① 统一 `memory` 动词 + 唯一子串 + 显式 consolidate；② `memory_recall`(记忆+历史)；
③ `/memory` 人机反馈(feedback/ok)/诊断/解释/回挖/模式；④ 记忆管理面板（预算/审计/待审提案）；
⑤ 遗忘 preference/event；⑥ 记忆条目浏览器。

---

## D. 真正值得借的差额清单（M1–M10，按记忆机制/交互机制归类）

> 每条 = 借什么（出处）→ dsh-yolo 现状（文件）→ 怎么改 → 验收。

### 记忆机制

**M1 记忆类型分层：`knowledge/lesson` + `fact` + `summary/procedure`**（dsh-memory-lite 4 类；
dsh-memory-gate kinds preference/constraint/fact/procedure/warning；dsh-mneme experience/lessons）
- 现状：`src/extract/prompt.ts` 只产 todos/goals/milestones/preferences/events；`knowledge` 无落点。
- 改：抽取 prompt 加 `facts`/`lessons`/`procedures` 数组；`schema.sql` 加对应表或并入 preferences 用
  `kind` 区分；`recall`/注入按 kind 分组。
- 验收：单测——"我们项目用 pnpm"（convention）落到 knowledge 而非 todo；"这函数要小心 X"(lesson) 落到事实。

**M2 证据 + 术语 + belief 溯源**（dsh-memory-gate `evidence`/`terms`/`learnedTerms`；dsh-mneme 冷引用 sha256）
- 现状：pref 只有 `session_id`；无证据表、无匹配术语、无 belief 分。
- 改：记忆/偏好加 `evidence`(来源 session+时间+摘要)、`terms`(触发词)；`/explain` 可回显。写 `recall_log`
  时记录谁触发了这条（`grep` 用）。
- 验收：每条注入可答"来自哪次会话、因为什么词命中"。

**M3 用后反馈闭环**（dsh-memory-gate belief(alpha/beta)+harmful 隔离+stale 降权；
dsh-mneme 质量降权）
- 现状：`confidence` 只在 pref 重复时 +0.1（`repository.ts:286`），从不因"用过/没用过"变化。
- 改：加 `belief(alpha,beta)`+`harmful`+`sealed`；`applyTodoAction` 的完成/取消、`remind_again` 回写
  `good`/`stale`；`harmful` 超阈值不注入；排序乘 `beliefScore`。
- 验收：某条记忆被"完成"数次后注入权重升；被"取消/标有害"数次后不再注入。

**M4 写入质量闸门 + 归档不删**（dsh-mneme `evaluateMemoryQuality`；dsh-memento 预算触 consolidate 不截断）
- 现状：`mergeExtraction` 直接落库。
- 改：落库前跑纯函数评分（元记忆/自指/过短/复读/近重复）；`<30` 标 `low_quality` 记 `archived` 不注入（仍可搜）；
  `30–60` 存分供排序降权。
- 验收：单测——"记住你刚提到要记住系统提示词"被标 low；正常句子正常入库。

**M5 自然淡出 / 价值分层 TTL**（dsh-hme `[v:N]`/`[ttl:]`；memento 预算隔离）
- 现状：只有 pref `valid_at/invalid_at`（被替代），facts/事件/约定无 TTL。
- 改：加 `expires_at`/`value`；到期降权并写 `archived` 标记（不删）；健康页可"清理已过期"。
- 验收：一条到期的约定不再进注入；库内保留。

**M6 召回两段式：记忆 + 近期会话历史证据**（dsh-memento `memory_recall`）
- 现状：`src/memory/recall.ts` 只搜存下来的行，不读 dsh 历史会话。
- 改：给 recall 加"近期会话命中片段"段（经 `sessionQuery.filterSessions/filterEvents` 或本地读取），
  模型可看原文；`recall_log` 记录命中。
- 验收：搜"端口 8080"时既返回记忆行、也返回早前对话里提到该端口的原文片段。

### 交互机制

**M7 单一 `memory` 动词 + 唯一子串 + 显式 consolidate**（dsh-memento）
- 现状：`src/memory/tools.ts` 拆成 search/write/forget + yolo_action；无统一 add/replace/remove/consolidate。
- 改：加一个 `memory` 工具 action=query/upsert/remove/consolidate，`match` 用唯一子串（复用
  `looseMatch`/`applyTodoConsolidate`），工具描述内嵌 SAVE/SKIP 指引；`memory_write/forget` 保留为短别名。
- 验收：单测——`memory action=remove match="端口 8080"` 在歧义时返回候选清单；`consolidate` 原子合并+审计。

**M8 `/memory` 人机闭环：feedback/explain/status/mine/mode**（dsh-memory-gate）
- 现状：无 `/memory` 命令；反馈/诊断/解释/回挖/模式全缺。
- 改：`/memory` 命令 + `/memory status`(自诊断)、`/memory feedback <n> <helped|harmful|stale|conflict>`、
  `/memory explain <id>`、`/memory mine`(回挖旧会话 cue，option)、`/memory mode`(shadow/assist)。
- 验收：真机——用户 `/memory ok` 让注入记忆正向回写；`/memory status` 在质量下降时提示已降级并给恢复入口。

**M9 记忆管理面板：预算条 + 审计尾 + 待审提案**（dsh-memento web panel `/api/memento/*`）
- 现状：记忆健康折叠只有 recall 计数 + consolidate 入口；无逐条浏览器/预算/审计。
- 改：加只读 `/api/yolo/memory` 路由：条目浏览/搜索 + 按 kind 预算用量 + 审计尾 +（若做 M10）待审提案。
- 验收：W1–W8——看板"记忆"页可逐条看到"记住了什么、占多少预算、有过哪些审计动作"。

**M10 写路径受监督：提案先行 + 分级确认**（dsh-memento approval gate + `-denied` 审计）
- 现状：LLM 抽取直接落库（auto，无确认）。
- 改：**日常写入 auto**（保持低打扰）；**破坏性/消耗性写（批量 cancel/forget/consolidate）走确认**；
  拒绝落 `action_denied`（已有）。
- 验收：单测——破坏性写被拒时留 `-denied`；日常单条写入不弹确认（不打扰）。

---

## E. 优先级与红线

- **先做记忆机制 M1 + M2 + M3（类型分层 + 证据溯源 + 用后反馈）**——这是"记忆质量"的地基，
  且 M3 正是 `14`/`15` 反复提到的"越用越准"。
- **再做交互 M6 + M7 + M8（历史会话召回 + 单一 memory 动词 + /memory 人机闭环）**——这是"用户/模型
  怎么跟记忆打交道"的接缝，M8 把反馈/诊断/解释真正交到人手里。
- **顺带 M4 + M5（质量门 + 淡出）**；**中期 M9 + M10（面板 + 提案确认）**。
- **红线**：审批/确认与"绝不打扰"要分级（只在破坏性/消耗性写 ask，日常 auto）；"伪装用户指令 +
  实时打断"仍禁止；类型安全 + W1–W8 + 用语真实门禁不丢。
- **别被 dsh-memory-evolve 的"5 轨 Markdown 文件"带跑**——它是 JS 无类型 + 文件真相 + 外部可编辑，
  与 dsh-yolo 的 SQLite-first 不同；借其"分层/存储纪律/漂移守卫"，不借其"工程形态"。
  dsh-mnemon 的 Provider 抽象 + 诚实能力（host 只暴露适配器能兑现的，不伪造图谱/删除）值得参考，
  但属中期大改。

---

## F. 结论

1. **记忆机制**：dsh-yolo 已把"存与取"做扎实，缺的是"记什么类型、可不可信、会不会过期、越用越不准的
   怎么收"——M1/M2/M3/M4/M5 逐条补齐。其中 **M3（用后反馈）** 是记忆质量提升的命门，也是当前完全没做的。
2. **交互机制**：dsh-yolo 已把"看板/台账"做扎实，缺的是"模型统一记忆视图 + 召回带历史证据 +
   人机反馈/诊断/解释/管理面板"——M6/M7/M8/M9 逐条补齐。其中 **M8（/memory 人机闭环）** 把"用户看得见、
   能纠正、能诊断"真正落到人手里。
3. **借鉴与红线的平衡**：借"类型/证据/反馈/淡出/提案"，不借"伪装用户指令/实时打断/全量 ask"；
   `pnpm check` + `test:run` + W1–W8 门禁不缺位。

---
*配套：`00-total.md` · `09-borrowables.md`（P1–P46）· `14-borrow-pass.md`（B1–B8）·
`15-dsh-memory-evolve-borrow.md`（D1–D4+红线）。*
