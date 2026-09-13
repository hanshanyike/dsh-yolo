# 三对象重构：完整方案（评审稿 v3，已合并独立评审意见）

> 评审意见：`docs/design/plan-layer-redesign-review.md`（独立 agent，未继承作者上下文，含 13 条发现）。
> 证据来源：`docs/design/three-objects-analysis.md`（现状与真实数据）。
> 本文自包含；**v3 相对 v2 的主要变化见 §11**。

---

## 0. 一页速览（v3 修订后）

| | 内容 |
|---|---|
| **问题** | 用户看不出「事项 / 里程碑 / 目标 / 计划」的区别；确实不是纯文案问题 |
| **诊断（收敛后）** | ①「里程碑可独立存在」是**既有决策**，与"结果层缺失"冲突 → **需要变更决策**，不是修 bug ②「计划」是视图名与实体平级 → 是**命名撞车**，但"界面从未解释过三者"是**同样成立的另一个病因**（未证伪） ③ 抽取**没有"结果 / 动作"判据**（已核实：`prompt.ts` 只有一行） ④ 目标几乎没被使用（排除夹具后 3 库合计 1 个 candidate；样本极小） |
| **推荐路径（v3 变更）** | **先做 P0′：零迁移**——重写抽取判据 + 「计划」页改名「事项」 + 把已算好的关系显示出来 + 目标页给一句里程碑定义。**schema 部分（里程碑强制归属）拆成独立提案，只做"加列"，永不自动改判既有行** |
| **模型选型（若走到 schema 步）** | **E′**（只有「目标」一个结果实体，"长期/阶段"是**可见可点的属性**）；不选 D（新增名词，要求用户当场分类） |
| **业界立场（v3 修正）** | 分层与命名**没有统一共识**：中间层可叫 Project（Linear/Asana）也可叫 Milestone（GitHub）；进度语义**业界分歧**（Basecamp 明确人工判断，Linear/GitHub/Asana 由 issue/任务数据算）。YOLO 选择"人工确认"是**产品选择**，不是业界通行做法 |
| **不做** | 不做任务树；不按事项数自动算百分比；不自动改判用户的既有数据；不在创建路径上设分类题 |

---

## 1. 现状证据（事实）

### 1.1 数据模型（`src/storage/schema.sql`）

| 表 / 关系 | 是什么 | 关键字段 |
|---|---|---|
| `todos` | 事项（唯一有到期提醒） | `due_at`、`priority`、`status`、`milestone_id`（L49，`ON DELETE SET NULL`，语义"支撑哪个检查点"） |
| `milestones` | 里程碑 | `status`、`target_date`；**归属存在关联表**，本表无归属列 |
| `goals` | 目标 | `completion_criteria`、`progress`、`progress_source`、`next_todo_id`、`next_review_at`、`target_date`（L98，用户可见） |
| `goal_todos` | 目标 ↔ 事项 | `relation ∈ {support, next}` |
| `goal_milestones` | 目标 ↔ 里程碑（**多对多**） | `position` |
| `todo_merge_log` | 既有"可撤销"范式 | `source_snapshot_json` / `target_before_json` / `target_after_json` / `status('active'\|'undone')` |
| — | **计划** | **不是实体**：`client/panel/navigation.ts` L4 注释写明「Plan segments are the open-todo partition (no goals: they are their own page)」 |

两个"算了但界面不用"的字段：`dashboard.ts` L230–L231 投影 `milestone_status` 与
`milestone_open_todo_count`，`client/**` **0 处使用**。

### 1.2 界面（`client/panel/**`）

- 一级入口 4 个：`PAGES = 首页 / 计划 / 目标 / 历史`（`PageTabs.tsx` L12–L17）。
- 「计划」页装开放事项；「目标」页标题「目标与里程碑」+ hint「N 个长期结果 · 下一步优先」，
  **全页没有一句定义里程碑**（`KanbanView.tsx` L377 附近）。
- 里程碑的可见线索：目标卡胶囊、目标页底部「其他里程碑」轴、事项行尾后缀、筛选下拉、事项编辑器下拉。

### 1.3 真实数据（3 个有内容的存储，排除 `[E2E]` 夹具）

| 存储 | 目标 | 里程碑 | 开放事项 |
|---|---|---|---|
| `dsh-yolo/.dsh/yolo/yolo-65c0ede8ba5b_default.db` | 0（另有 **6 条 `[E2E]` abandoned 残留**） | 2 | 5 |
| `SkillSEO/.dsh/yolo/yolo-3ef670deee2d_default.db` | 1（candidate） | 1 | 0 |
| `dsh-yolo/.dsh/yolo/yolo-decf873e665c_main.db` | 0 | 1 | 5 |

```
MS 发布 0.5.0 版本   [planned] goal_links=[] | todos: 更新文档 | npm 发包 0.5.0 | 更新标签
MS 进行 PRD 设计     [planned] target=2026-08-30 | goal_links=[] | todos: —
MS 内部评审完成      [planned] …（仅出现在示意，真实库为 SkillSEO/其它 scope）
MS 能力真值实验：30 skill + 120 请求 + 独立验收 [planned] target_date=null | goal_links=[]
GOAL [candidate] Capability-evidence-anchored skill-selection defense | criteria=— target=— milestones=[] todos=[]
```

**样本量必须写明**：全库仅 **4 条里程碑 / 1 个目标**。"2/4 是行动口吻"是**人工归类**（无标注规则、无双人标注），
不作为验收判据使用；"目标使用率≈0"同样受样本与测试噪音限制。

---

## 2. 业界事实（v3 重写：分歧，不是共识）

> v2 把 Basecamp 的立场写成了"业界共识"，被评审用方案自己的表格与一手文档否证。以下为修正版。

| 产品 | 分层 | 中间层是什么 | 进度语义 |
|---|---|---|---|
| [Linear](https://linear.app/docs/projects) | Initiative → **Project** → [Milestone](https://linear.app/docs/project-milestones) → Issue | Project：*"a clear outcome or planned completion date … comprised of issues"* | **由 issue 数据算**：[project graph](https://linear.app/docs/project-graph) 按每周完成的 issue points 算速度并预测完成日，FAQ 甚至解释 *"Why did my progress go down?"* |
| [GitHub](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones) | Repository → **Milestone** → Issue/PR | **里程碑本身就是中间层**（`track progress on groups of issues`） | **完成百分比**（open/closed 计数） |
| [Asana](https://asana.com/resources/project-milestones) | Goals → **Project** → Task | Project（里程碑是项目内的进度标记） | 目标进度可按"任务完成数 / 里程碑完成数"配置（[官方论坛对已上线能力的引用](https://forum.asana.com/t/automate-goal-progress-by-tasks-from-specific-project-sections/1017347/4)）〔帮助中心正文未读到〕 |
| [Basecamp](https://5.basecamp-help.com/article/1066-tracking-work-on-the-hill-chart) | Project → **To-Do List**（可上 Hill Chart） | To-Do List（**纯桶**：无结果定义、无日期字段） | **人工判断**：*"the status is human generated, not computer generated"*，挂在 list 上，每次更新存快照 |
| [Todoist](https://www.todoist.com/zh-CN/help/todoist/features/introduction-to-sections-rOrK0aEn) | Project → Section → Task | Section（纯分桶） | 无 |
| GTD | 六高度（愿景→目标→关注领域→**项目**→下一步行动） | 项目＝需多个行动才能达成的结果 | 周回顾 |

**修正后的四条事实**（每条都能被上表支持）：

1. **把行动装起来是必需的，但"桶"就够**：Basecamp 的 To-Do List、Todoist 的 Section 都是纯桶。
   **YOLO 已经有桶**（`PlanSurface` 的全部/今天/接下来/未排期 + 目标/里程碑/事项的归属表）。
2. **"结果层"是产品选择，不是行业必备**：Linear 有 Project（结果+日期）；GitHub **没有**独立结果层，
   让里程碑兼任；Todoist 没有。**所以"里程碑当顶层"本身不是错误设计**——v2 用这条推"YOLO 设计错了"，推理不成立。
3. **进度语义业界分歧**：Basecamp 明确反对按任务数算；Linear / GitHub / Asana 恰恰**用它**。
   YOLO 现有立场（`goal-management.md` L491 反例三、L297 用户确认达成）属于 Basecamp 一派，
   是**自觉的产品选择**，**不是有普遍背书的业界共识**。
4. **命名不统一**：中间层叫 Project（Linear/Asana）或叫 Milestone（GitHub）都有先例。
   真正值得对齐的是"**层必须存在**"，而不是"这个层叫什么"。

> 补充一条**支持 E′ 的业界先例**（v2 漏用）：[Linear Project overview](https://linear.app/docs/project-overview)
> 把 `Milestone` 列为 **Project 自身的单值属性**（默认 `Upcoming`），同时项目内又有里程碑列表——
> 说明"**跨度/阶段既可以是一个属性，也可以是一个列表**"，E′ 把跨度降为属性并非自创。

---

## 3. 诊断（v3：区分"决策变更"与"缺陷"）

| # | 定性 | 结论 | 证据 |
|---|---|---|---|
| **①** | **决策变更**（不是 bug） | 「里程碑可以不属于任何目标」是**显式设计决定**，还进了产品验收标准；本次要动它，必须走"变更决策"的论证路径，并明确撤销哪条承诺 | `goal-management.md` L98「一个里程碑事项必须属于目标 → **不推荐**」、L112「里程碑可以独立存在」、L375「也可以在没有目标时进入独立的阶段检查区域」、**L540 验收标准 3**；`usage.md` L79/L87 |
| **②** | **两个竞争假设（未判定）** | H1：命名撞车（页面名与实体平级）；H2：界面从未解释过三者。代码只支持"「计划」从来是视图"（`navigation.ts` L4），**不能判定撞车是病因**；目标页无里程碑定义这句是 H2 的证据 | `navigation.ts` L4；`PageTabs.tsx` L14；`KanbanView.tsx` 目标页文案 |
| **③** | **缺陷（已核实，可零风险修复）** | 抽取判据只有一行、没有"结果 / 动作"规则，导致入库形态就错 | `src/extract/prompt.ts` L51：`- milestones: NEW named project phases or checkpoints with target dates.` |
| **④** | **样本不足以支撑结论** | 目标使用率极低（排除夹具后 1 个 candidate），提示**结果层没有被用起来**，但 n 太小、且目标表里混有 6 条 `[E2E]` 残留 | §1.3 的 dump；评审已复核计数一致 |

**v3 的推论**：③ 是唯一"现在就该修且零风险"的缺陷；① 是决策问题，② 未判定，
④ 是观察。**因此正确的动作顺序是先修 ③、用最小成本验证 ②，而不是先动 schema。**

---

## 4. 方案 E′（v3 收窄后的规格）

### 4.1 核心原则（保留）

> 只有一个结果名词；跨度是**可见可点的属性**；分类由系统建议、用户改。

### 4.2 对象与关系

| 对象 | 定义 | 归属 | 状态 |
|---|---|---|---|
| **事项** | 一件要做的行动，唯一有到期提醒 | 可选 → 目标（`goal_todos`）；可选 → 里程碑（`todos.milestone_id`） | pending / in_progress / done / cancelled |
| **里程碑** | 目标内部的**阶段检查点** | **迁移后**争取单一归属（`milestones.goal_id`）；**无归属仍是合法的长期状态**（见 4.4） | planned / active / done / abandoned |
| **目标** | 唯一的结果实体 | 无嵌套（**v3 删除 `parent_goal_id`**，见 4.6） | candidate / active / paused / achieved / abandoned |

`horizon ∈ {stage, ongoing}`：**系统填、用户可点改、不决定分组**（分组按 `target_date`，见 4.4）。

### 4.3 数据模型（v3：只加列，不改既有行）

```sql
-- 目标：跨度作为属性（行业先例：Linear 的 Project Milestone 属性）
ALTER TABLE goals ADD COLUMN horizon TEXT NOT NULL DEFAULT 'ongoing';   -- ongoing|stage

-- 里程碑：单值归属（可空；ON DELETE SET NULL，与 todos.milestone_id 一致）
ALTER TABLE milestones ADD COLUMN goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_milestones_goal ON milestones(goal_id);
```

**v3 删除的设计与原因**（均来自评审）：

| 删除项 | 原因 |
|---|---|
| `goals.parent_goal_id` | 3 个库里 **0 条目标需要嵌套**；它引入环检测、跨 workspace 校验、子目标分组归属三个新问题，全是为弥补 D 的表达力缺口而加的范围外复杂度 |
| `unresolved[]` | `ExtractionResult` 是**闭合接口**（`contracts/extraction.ts` L38–L46），且没有落库位置；"待整理"用 `milestones.goal_id IS NULL` 表达即可（有列可存） |
| `ON DELETE CASCADE` | 与 `goal-management.md` L112/L540「里程碑可独立存在」冲突；改 `SET NULL`，让"无归属"是合法长期状态 |
| 「删除『其他里程碑』共享轴」 | 若"无归属"合法，删轴就是**把一个合法状态从界面抹掉**；v3 保留轴，改为**标注**（未归属 / 原属已放弃目标 / 原属多个目标） |
| 迁移"改判既有行" | 会跨表搬迁实体（里程碑→事项 / 里程碑→目标），真实数据里 `发布 0.5.0 版本` 下挂着 3 条 pending 事项，"升格为目标"与"`todos.milestone_id` 语义不变"无法同时成立；且仓库既有"可撤销"范式需要前后快照（`todo_merge_log`），`events` 不够 |

**迁移（v3）**：

1. 回填 `goals.horizon`：有 `target_date` 或标题含交付词 → `stage`，否则 `ongoing`。
2. 回填 `milestones.goal_id`：取 `goal_milestones` 中 `position` 最小者；**多归属时**（`milestone-ownership.ts` 与
   `tests/milestone-ownership.test.ts` 都明确支持多归属）写审计事件并在界面标注「原属 N 个目标」，
   **不静默丢弃**；无归属 → 保持 `NULL`。
3. **不做**任何实体类型改判。历史遗留的错误形态（如 `进行 PRD 设计`）改由**用户从界面改判**，
   走与 `apply-yolo-action` 同一条可撤销路径。

### 4.4 IA（v3 修订）

| 入口 | 变化 | 内容 |
|---|---|---|
| 首页 | 不变 | 判断 / 提醒 / 今日 |
| ~~计划~~ → **事项** | 改名 | 全部 / 今天 / 接下来 / 未排期（纯行动视图） |
| **目标** | 两段 + 定义 | 分组**按 `target_date` 有无**：上段「有目标日期的」、下段「持续跟进的」；`horizon` 只作卡片上的标签。里程碑区**固定一句定义**：「里程碑是阶段的结果（如「内部评审完成」），不是要做的动作」 |
| **其他里程碑**（保留） | 标注而非删除 | 每条标注：未归属 / 原属已放弃目标 / 多个目标共享；提供"先不管"的默认出口 |
| 历史 | 不变 | — |

### 4.5 抽取重写（③ 的正面修复，零迁移）

1. 判据扩成三分类，附正反例：**动作 → 事项**（进行/准备/写/发 X）；**阶段结果 → 里程碑**（X 完成/通过/就绪/定稿）；
   **结果 → 目标**（有交付物 → `horizon=stage`；持续方向 → `ongoing`）。
2. `goals[]` 增 `horizon`；`milestones[]` 增**可选** `goal_title`（缺失即进入"待整理"，**不是必填**）。
3. 不确定就不猜：把该条留给"待整理"（存在 `milestones.goal_id IS NULL`），不新增数组、不新增表。
4. RM 判例矩阵增加"结果 vs 动作"条目，抽样人工复核并记录判定规则（谁判、按什么标准）。

### 4.6 E′ 的代价（v3 更新）

1. 长期与阶段混在同一列表 → 用 `target_date` 分组 + 卡片标签缓解，不再是"隐藏字段决定分组"。
2. `horizon` 由系统猜 → 界面上始终可见可点，猜错成本 = 一次点击。
3. 表达"一个长期方向下多次交付"要靠关系补齐（v3 先不做嵌套，等真实需求）。

---

## 5. 方案 D（备选，未变）

新增「计划」实体（`plans` + `todos.plan_id` + `milestones.plan_id` + `goal_plans`），5 个一级入口。
优点是与 Linear/Asana 字面一致、长期目标含多次交付天然表达；代价是**用户每建一条结果都要判断
"交付单元还是长期结果"**，判别测试需要"想一下"。

**v3 结论：若将来要动模型，选 E′。** 但**当前两者都不该先动**——先做 §6 的方案 G。

---

## 6. 方案 G｜分阶段落地（**v3 推荐**）

### G1（P0′，零迁移、零承诺破坏）

1. **抽取判据重写**（③）+ RM 判例（`extract/prompt.ts`、`contracts/extraction.ts`、`testing-e2e.md`）。
2. **「计划」页改名「事项」**（`PageTabs.tsx` 一处 + 文案）。零风险，可无条件先做；
   但要按 §3-② 说明：**改名不构成对 H1/H2 的判定**，它只是去掉一个误导性名词。
3. **把已算好的关系显示出来**：目标卡的里程碑显示 `milestone_open_todo_count`（"N 件事在推进这个阶段"），
   里程碑胶囊可点 → 按该里程碑筛选。
4. **目标页给里程碑一句固定定义**（回答用户原始问题的核心）。

验收：`docs/usage.md` L76/L79/L87 与 `goal-management.md` §5.2 的漂移同步；W2 相关 e2e 通过。

### G2（P1′，只在 G1 无法回答时启动）

按 §4 的 E′ 收窄规格做：`goals.horizon` + `milestones.goal_id`（**只加列、只回填、不改判**）+
目标页两段 + 「其他里程碑」标注。**可逆**（加列可回退，回填不影响既有语义）。

### G3（需独立论证，默认不做）

任何**改判既有行实体类型**的迁移（如把 `进行 PRD 设计` 从里程碑改成事项）：只在
（a）用户逐条确认、（b）有 `todo_merge_log` 同构的前后快照 ledger 两个条件都满足时做。

**为什么 G1 优先，而不是 v2 的"P0 = 模型 + 迁移"**：
v2 把风险最高、证据最薄的一步排在最前——用 4 条里程碑 / 1 个目标当依据，去推翻一条写进验收标准的承诺，
并改动真实数据。G1 直击唯一已核实的缺陷（③）与用户原始问题（②的解释），且完全可逆。

> 对"等 2–4 周真实数据"这一点我做了修正（评审建议的门槛）：**单人产品的数据增长慢，用时间当门槛可能永远等不到**。
> 更可操作的门槛是**事件**：出现第 2 次"一个里程碑归属多个目标"，或第 3 条无归属里程碑时，再启动 G2。
> 而 G2 本身只加列、可逆，风险与 G1 同档，因此不必等太久。

---

## 7. 影响面与排期（v3 修正覆盖）

### G1 影响面

| 层 | 文件 | 规模 |
|---|---|---|
| extract | `extract/prompt.ts`、`contracts/extraction.ts` | M |
| client | `PageTabs.tsx`、`KanbanView.tsx`、`tokens.ts` | M |
| docs | `usage.md`（L76/L79/L87 **重写**，不是同步）、`goal-management.md`（§5.2）、`testing-e2e.md`（RM 判例）、`CHANGELOG.md` | M |
| tests | RM 判例 + `home-plan-history` / `accessibility-feedback` 的页签名断言 | S |

### G2 影响面（若启动）

| 层 | 文件 | 规模 | v3 修正点 |
|---|---|---|---|
| storage | `schema.sql`、`db.ts`、`repository.ts`、`index.ts` | M | 只加两列 + 回填；`ON DELETE SET NULL` |
| application | `apply-yolo-action.ts` | M/L | **修正 v2 事实错误**：里程碑 `link/unlink` **已实现**（L577–L599），需要的是"设置归属目标"的动作 +
  处理 `goal_milestones` 停写后既有 link/unlink 的语义（拒绝 / 转发 / 读兼容）|
| application | `apply-extraction.ts` | M | **v2 漏项**：L188–L201 也直接调 `yolo.linkGoalMilestone` 写 `goal_milestones`，必须一并改 |
| application | `read-models/dashboard.ts` | M | 分组按 `target_date`；`unowned` 要区分"从未归属"与"原属已放弃目标"（`milestone-ownership.ts` L46–L47 注释） |
| contracts | `shared/dashboard.ts`、`contracts/dashboard.ts` | S | `goal_ids` → `goal_id`（**注意多归属能力被取消，需审计**） |
| client | `KanbanView.tsx`、`milestone-ownership.ts`、`tokens.ts` | L | 保留共享轴并标注 |
| scripts | `scripts/e2e.mjs` L172 | S | **v2 漏项**：`[E2E]` 清扫按 `goal_milestones`，改表后必须同步 |
| tests | `tests/e2e/ui/milestone-ownership.spec.ts` L48/L56、`tests/milestone-ownership.test.ts` L78 | M | **这些是"反转既有断言"**，不是"更新"（有专属多归属用例） |
| docs | **`docs/VISION.md` L47/L48** | M | **v2 漏项**：VISION 用"计划"定义该入口，改名前必须同步 |

---

## 8. 风险清单（v3 补入评审发现）

1. 不做任务树；目标嵌套 v1 不做（无真实需求）。
2. 不自动百分比；完成数只作为事实行。
3. 分类由系统建议 + 一键改判；创建路径不设分类题。
4. **多归属能力被取消**：`goal_ids: string[]` → `goal_id` 会静默丢弃第二个归属，而该能力有实现与专属测试；
   必须写审计 + 界面提示"原属 N 个目标"。（评审发现）
5. **同 workspace 校验**：`db.ts` L258/L265 的既有回填都 `JOIN … scope_key`，新列写入路径必须同样校验；
   身份有两套（`milestone-ownership.ts` 用 cwd，`dashboard.ts` 用 `ws.slug|id`），新增查找要选对。（评审发现）
6. `ON DELETE SET NULL` 而非 CASCADE；未来若加"删除目标"路径，需保证 `pending_reminders.milestone_id`、
   `events.subject_id` 的指向不变。
7. **测试是反转而非更新**：`milestone-ownership.spec.ts` / `milestone-ownership.test.ts` / `scripts/e2e.mjs` /
   `docs/testing-e2e.md` L71 都在断言即将改变的行为，必须逐条列出并重写。（评审发现）
8. **两种"待整理"含义不同**：从未归属 vs 原属已放弃目标，界面要分开表述。（评审发现）
9. 度量脚本要同时输出**原始行数 / 排除夹具后行数**（本机 `goals` 表仍有 6 条 `[E2E]` 残留）。

---

## 9. 验收与度量（v3）

| 信号 | 做法 | 基线 |
|---|---|---|
| **Q1**「事项和目标有什么区别？」 | 3 位不看文档的用户各说一句（原 v2 的合并问题拆开） | 未测 |
| **Q2**「里程碑和目标有什么区别？」 | 同上；且要求**产品界面内有答案**（目标页里程碑区的固定定义） | 未测；当前界面无任何定义 |
| 数据健康度 | 脚本输出：孤儿里程碑 / 多归属里程碑 / 目标挂接率 / 动作口吻占比（**含原始与过滤后两种计数**） | 孤儿 100%（4/4）；多归属 0；挂接 0；动作口吻 2/4（人工归类，n=4，不作通过判据） |
| 抽取分类 | RM 判例 + 真实对话抽样，记录标注规则 | 未覆盖 |

---

## 10. 待决策（v3 收敛为两个）

| # | 问题 | 选项 | 建议 |
|---|---|---|---|
| A | **先做哪一步** | **G1（零迁移）** / 直接上 G2（加列） / 一次做到 v2 的完整 E′ | **G1**：直击已核实的缺陷与用户原始问题，完全可逆；G2 在**事件门槛**出现后启动 |
| B | 若走到模型改动 | **E′**（属性表达跨度）/ D（新增计划层） | **E′**：只要一个结果名词，不要求用户当场分类 |

（v2 的"中间层叫什么"随 B 一起保留：若选 D 则叫「计划」；选 E′ 则该问题作废。）

---

## 11. 评审处置记录（v3）

独立评审共 13 条发现（含 1 条阻断）。**全部接受**，其中 3 条我另行复核后确认：

| 评审发现 | 处置 | 复核 |
|---|---|---|
| [阻断] §4.3「不新增表」与 `unresolved[]`/「可撤销」三者不能同时成立 | 删除 `unresolved[]`，改用 `milestones.goal_id IS NULL`；迁移降为只加列 | 复核 `contracts/extraction.ts` L38–L46 确为闭合接口 ✅ |
| [高] §2 共识 3「进度不靠任务计数」是 Basecamp 一家之言 | §2 重写为"业界分歧 + YOLO 的选择" | 复核 [Linear project graph](https://linear.app/docs/project-graph) 确由 issue 速度算进度 ✅ |
| [高] §2 共识 2「里程碑不是顶层实体」有反例（GitHub） | §2 改为"层必须存在，命名不统一"；① 改定性为**决策变更** | 复核本方案 §2 表 GitHub 行自述"里程碑就是中间层" ✅ |
| [高] 迁移步骤 3 不可执行且会破坏真实数据 | 整段删除；不做实体改判 | 复核真实库 `发布 0.5.0 版本` 下确挂 3 条 pending 事项 ✅ |
| [高] E′ 只解决 Q1，Q2 仍在 | §9 拆成 Q1/Q2；§4.4 加固定定义 | — |
| [高] 未与更小方案对比 | 新增 §6 方案 G，并把 G1 提为推荐 | — |
| [中] 分组标题与 `horizon` 矛盾（真实反例无日期） | 分组改为按 `target_date` | 复核 SkillSEO 该里程碑 `target_date=null` ✅ |
| [中] 「待整理」把分类交还用户，与 §4.1 矛盾 | 边界收敛：`horizon` 系统填；待整理只针对**归属**且可"先不管" | — |
| [中] `parent_goal_id` 范围外复杂度 | v3 删除，作为独立后续提案 | — |
| [中] 影响面漏 `apply-extraction` / `scripts/e2e.mjs` / `VISION.md`；`link/unlink` 已存在 | §7 逐条补入并修正事实错误 | 复核 `apply-yolo-action.ts` L577–L599 确有里程碑 link/unlink ✅ |
| [中] 测试是反转既有断言 | §7/§8 列出清单 | — |
| [低] 「其他里程碑」还包含"原属已放弃目标" | §4.4/§8 区分两种待整理 | — |
| [低] `[E2E]` 目标残留污染"使用率≈0" | §1.3/§9 写明原始与过滤后计数 | — |

**唯一与评审不同的判断**：评审建议"等 2–4 周真实数据再加列"，我认为单人产品数据增长慢，
时间门槛不可操作，且**只加列本身可逆**，因此改为**事件门槛**（见 §6 末），并把 G2 与 G1 的风险等级视为同档。
