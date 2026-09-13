# 计划层重构方案：业界调研 + 数据模型与 IA 重设计

> 前置：`docs/design/three-objects-analysis.md`（现状诊断）。
> 本文回答「要不要大改、改成什么、动哪些代码」。
>
> **调研口径**：只采用我实际读过正文的一手文档（Linear Docs、GitHub Docs、Basecamp Help、
> Todoist 帮助与 GTD 指南）；读不到的页面（Asana 帮助中心、gettingthingsdone.com 正文有反爬）
> 只用其公开标题/摘要，并已在文中标注。

---

## 0. 结论与需要拍板的三件事

**调研结论一句话**：主流产品里**没有一个把「里程碑」当顶层独立实体**；它们都有一层
**「包含行动、有明确结果和日期的中间单元」**——Linear 叫 Project，Asana 叫 Project，
GitHub 叫 Milestone，Basecamp 叫 To-Do List，Todoist 叫 Project。YOLO **缺的正是这一层**，
而用户已经拿「里程碑」去顶替它（真实数据：`发布 0.5.0 版本` 下面挂着 3 条事项）。

**因此重构的方向不是"把文案写清楚"，而是补上这一层，并把四个名词各归其位。**

需要你拍板（详见 §3.3 对比与 §10）：

0. **先定这一条**：是真要新增「计划」这一层（方案 D），还是**不新增名词**、
   把"长期／阶段"做成**目标的属性**（方案 E′）。评审提的「计划和目标是什么关系」
   正是 D 的主要风险；E′ 让这个问题根本不存在。**我的建议：E′**（用户只需记三个词，且不用做分类）。
1. 若选 D：中间层叫 `计划` 还是 `项目`（你已选「计划」；选 E′ 则此项作废）。
2. **一级入口怎么排**：5 个（首页/事项/计划/目标/历史）还是 4 个（把事项时间视图放回计划页）。
   两个方案共用，E′ 下"计划"页替换为"目标"页的两段式。
3. **现有数据怎么迁移**：自动启发式分诊 + 人工确认（推荐）／只做保守映射不动语义。

---

## 1. 业界怎么做（一手文档）

| 产品 | 层级（自上而下） | 里程碑在哪一层 | 进度怎么来 |
|---|---|---|---|
| **Linear** | Initiative → **Project** → Milestone → Issue | **Project 内部**：「represent different stages in a project's lifecycle」，创建入口在 project overview / details pane，issue 用 `Shift M` 挂到 milestone | Project 有自己的 progress graph（由 issue 汇总）；Initiative 汇总多个 project |
| **GitHub** | Repository → **Milestone** → Issue/PR | **就是中间层**：「track progress on **groups of** issues or pull requests」，有 due date 与完成百分比（open/closed 计数） | 从挂进来的 issue 计数 |
| **Asana** | Goals → **Project** → Task（Milestone 是项目内的进度标记） | Project 内：官方发布说明标题即「用里程碑**可视化项目进度**并共享」 | 项目内里程碑；Goals 由 KR/关联工作汇总〔未读到帮助中心正文，仅用公开标题与摘要〕 |
| **Basecamp** | Project → **To-Do List**（可勾选上 Hill Chart） | 没有里程碑概念；用 **Hill Chart** 表达「阶段」 | **人工判断**：把「一组工作（list）」拖到上坡/下坡，位置变化写入项目历史 |
| **Todoist** | Project → Section → Task | 无 | 无（只管行动） |
| **GTD** | 六个高度：宗旨/原则 → 愿景 → **目标** → 关注领域 → **项目** → 下一步行动 | 无里程碑；**「项目」＝需要多个行动才能达成的结果** | 靠每周回顾，不靠百分比〔gettingthingsdone.com 正文有反爬，此处为该方法论的通用表述〕 |
| **OKR 类工具**（ClickUp 等） | Objective → Key Result → 关联工作 | 无 | 由 KR 或关联任务自动汇总 |

三条可以直接拿来用的业界共识：

1. **必须有一个"装行动"的中间单元**，而且它自带「结果 + 日期」——Linear 的定义原话是
   *"units of work that have a clear outcome or planned completion date … comprised of issues"*。
2. **里程碑属于那个单元，不是顶层实体**（Linear 最明确：里程碑是 project 内部的阶段）。
   GitHub 是唯一让里程碑当顶层的，但那是因为它上面还有 Repository 作为容器。
3. **进度不要用任务计数糊弄人**。Basecamp 说得最直白：*"42% of the tasks are complete. What does that
   tell you? Very little."* —— 它把进度做成**人对一组工作的人工判断**，并保存历史快照。
   这与 YOLO 现有设计（拒绝「按事项完成数自动计算目标进度」）**完全一致**，可以直接沿用。

（AI 日程类工具如 Motion/Reclaim 以任务与日历排程为主，公开材料里看不到成熟的目标/里程碑层——
这条是类别观察，非本文论据。）

---

## 2. 诊断：缺一层 + 三个结构性缺陷

| | 业界 | YOLO 现状 |
|---|---|---|
| 装行动的中间层 | Project / Milestone / To-Do List | **没有** |
| 里程碑位置 | 中间层内部 | **顶层实体**，可属于多个目标或不属于任何目标 |
| 归属约束 | 行动必须属于某个单元（Linear：issue 只能属于一个 project） | 事项可挂遗留字段 `milestone_id`，也可完全不挂 |
| 「计划」 | Todoist 的 Project 就是它 | **是页面名**（开放事项的时间划分），不是实体 |
| 目标使用率 | 目标/KR 是主入口 | 真实数据：活跃工作区 **0 个目标**，全局仅 1 个 candidate |

三个缺陷（都能在真实数据里看到后果）：

- **缺陷 1｜中间层缺失 → 里程碑被迫当容器。** `发布 0.5.0 版本` 下面挂着
  `更新文档 / npm 发包 0.5.0 / 更新标签`，而它不属于任何目标。用户需要的是「0.5.0 发布」这个**单元**，
  不是「一个叫里程碑的检查点」。
- **缺陷 2｜里程碑是顶层却无归属约束 → 孤儿要靠 UI 兜底。** 昨天那个修复（`8a64b21`
  把无归属里程碑放进「其他里程碑」轴）本质是**给模型缺陷打补丁**：如果里程碑天然属于某个单元，
  就不存在"孤儿"这种状态。
- **缺陷 3｜抽取三分类缺失 → 入库形态就错。** 提示词只有一句
  `milestones: NEW named project phases or checkpoints with target dates`，
  既没有区分「结果 / 动作 / 单元」，也没说清挂载方向，于是「**进行** PRD 设计」（动作）被存成里程碑。

---

## 3. 目标模型（推荐方案 D）

### 3.1 四个对象，各回答一个问题

| 对象 | 回答 | 必须具备 | 状态 | 提醒 |
|---|---|---|---|---|
| **事项** Action | 我要做的这一件事 | — | pending / in_progress / done / cancelled | 到期提醒（唯一） |
| **里程碑** Checkpoint | 这个阶段结果成立了吗 | 属于某个计划 | planned / active / done / abandoned | 阶段检查（低频） |
| **计划** Unit（**新增**） | 我在推进的这件事，什么算完成 | **完成标准**（结果信号）+ 目标日期（可选） | planned / active / paused / done / abandoned | 回顾（按计划日期/停滞） |
| **目标** Outcome | 我长期要达成什么 | 完成标准 | candidate / active / paused / achieved / abandoned | 回顾（低频） |

包含关系（**唯一方向**）：`目标 ⊇ 计划 ⊇ {里程碑, 事项}`；`目标` 可直接含事项（如一次性承诺），
`计划` 可含里程碑（可选）；**里程碑不再独立于计划存在**。

### 3.2 用它重解你现有的真实数据

| 现有数据（今天） | 重构后 | 依据 |
|---|---|---|
| 里程碑 `发布 0.5.0 版本`（下面挂 3 条事项、无目标） | **计划**：完成标准＝「0.5.0 已发布到 npm 且标签推送」；3 条事项挂到它下面 | Basecamp/Linear：单元＋行动 |
| 事项 `更新文档 / npm 发包 0.5.0 / 更新标签` | 计划下的**事项**（归属明确） | 同上 |
| 里程碑 `内部评审完成`、`灰度验证通过` | 该计划下的**里程碑**（检查点） | Linear：project milestones |
| 里程碑 `进行 PRD 设计`（动作口吻、有日期） | **事项**（若在推进）或计划 `PRD 设计` + 里程碑「设计定稿」 | 设计文档 L61 的判据 |
| 里程碑 `能力真值实验：30 skill + 120 请求 + 独立验收` | **计划**（它有完成信号：独立验收） | Linear project 定义 |
| 目标 `Capability-evidence-anchored skill-selection defense`（candidate、无标准、无日期） | **目标**，并挂上「能力真值实验」这个计划 | Initiative 含多个 project |

### 3.3 备选方案 E′：不新增名词——「目标」自带跨度 + 可选嵌套（**推荐度与 D 并列，待定**）

> 这条是被评审问出来的：「计划和目标是什么关系，这怎么好理解呢？」
> 疑问成立：**D 方案引入的正是我们要消灭的那类边界**——两个都表示"结果"的名词，
> 用户每建一条就要判断一次该放哪个。这正是"两排相似控件"的模型版本。

E′ 的做法是**不加名词**：

- 只有一个"结果"名词：**目标**。跨度不是**分类**而是**属性**——
  它可能没有终点（长期方向），也可能有一个交付时刻（一次发布）。
- **里程碑**仍然是目标内部的检查点（与 D 相同）。
- 目标之间可以**可选地嵌套一层**（"这次发布是为那个长期目标服务的"），
  用关系表达，而不是要求用户把对象建成两种。

于是用户只需要理解三个词，且**永远不需要回答"这是长期还是阶段"**：

| | 方案 D（计划 / 目标两层结果） | 方案 E′（只有目标，跨度是属性） |
|---|---|---|
| 用户要记的名词 | 事项、里程碑、**计划**、目标（4） | 事项、里程碑、目标（3） |
| 每次新建要做分类吗 | **要**：这是交付单元还是长期结果？ | **不要**：都是目标，填不填目标日期而已 |
| 表达"一个长期目标下的多个交付" | 天然（目标含多个计划） | 靠可选嵌套（多一步），或先并列 |
| 与业界对照 | 与 Linear/Asana 的字面结构一致 | 与 OKR 类"目标可服务上级目标"的思路一致；Linear 的 Initiative/Project 二分在个人场景里被合并 |
| 主要风险 | 目标/计划边界要靠解释（**本次质疑点**） | 长期与阶段混在同一列表时，需要靠排序/分组区分，而不是靠名词 |

**判别测试**（决定新条目该进哪一格，用来判断方案是否"可瞬间判断"）：

- 方案 D 的测试：「完成那一刻你会说什么？」→「我把它交付出去了」= 计划；
  「我现在是那样了 / 这条线不用我盯了」= 目标。→ **需要想一下**（这正是问题）。
- 方案 E′ 的测试：「有没有一个交付物要交出去？」→ 有就填目标日期，没有就不填。
  → **不需要想**（同一个对象，只是字段不同）。

**我的判断**：E′ 在"用户能否直接理解"这一目标上明显更优，代价是表达力弱一档
（长期目标与阶段交付在数据上不再天然分离）。若你更看重表达力（未来要做"一个长期方向下
若干个发布"的汇总），选 D；若更看重"打开就能用、不用学分类"，选 E′。
**两者共用同一套里程碑/事项改动**，差别只在"是否新增 `plans` 表"与"目标页是否要分两段"。

### 3.4 为什么不选另外两个方案

- **方案 A：目标兼容器（把目标当 project 用）。** 不用改模型，但每次发布都要建一个"目标"，
  目标是长期结果，会被迫退化成短周期任务容器 → 目标页变成项目列表，语义再次塌陷。
  （注意：**E′ 与 A 不是一回事**——A 是"目标被迫同时当两种东西"，E′ 是"取消两种东西的区分，
  只保留一个名词、跨度由字段表达"。）
- **方案 C：直接把里程碑定义成容器（顺应用户现状）。** 改动最小，也自洽，但它把「检查点」
  和「交付单元」两种时间尺度压进一个名词，且与全行业用法相反（除 GitHub 外无人这么做）；
  更重要的是**放弃了对"阶段结果"的表达**——而「灰度验证通过」这类里程碑恰恰是 YOLO
  差异化价值（阶段判断）所在。

---

## 4. 数据模型改动（DDL 草案）

```sql
-- 新增：计划（交付单元）。与 goals 同级，都是"结果"，但计划有明确终点。
CREATE TABLE IF NOT EXISTS plans (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL,            -- planned|active|paused|done|abandoned
  completion_criteria TEXT,               -- 什么算完成（沿用 goal 的字段语义）
  target_date   TEXT,
  progress_note TEXT,
  progress_source TEXT NOT NULL DEFAULT 'none',
  next_review_at TEXT,
  scope_key     TEXT NOT NULL,
  source        TEXT, session_id TEXT, source_excerpt TEXT, source_turn INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 计划 ↔ 事项（一个事项最多属于一个计划；NULL 表示不受计划约束的日常杂事）
ALTER TABLE todos ADD COLUMN plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_todos_plan ON todos(plan_id);

-- 计划 ↔ 里程碑（里程碑归属唯一）
ALTER TABLE milestones ADD COLUMN plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_milestones_plan ON milestones(plan_id);

-- 目标 ↔ 计划
CREATE TABLE IF NOT EXISTS goal_plans (
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (goal_id, plan_id)
);
```

**保留不改的**：`todos.milestone_id`（语义仍是"支撑/对应哪个检查点"，不是容器）、
`goal_milestones`（旧目标仍可直接挂里程碑，迁移期兼容）、`goals` 全部字段。
**新增但暂不使用的**：`plans.progress_source`（为将来的"里程碑证据驱动计划进度"留位，规则同 goal）。

迁移（v1 → v2，`src/storage/db.ts` 的现有 ALTER TABLE 循环旁）：

1. 现有里程碑按启发式分诊：标题含动作动词（进行/开始/实现/准备）→ 转成事项；
   含结果词（完成/通过/就绪/发布）→ 转成计划；无法判断 → 保留为孤儿里程碑并**在 UI 里提示整理**。
2. 每个转成的计划，把它原有的支撑事项（`todos.milestone_id`）改挂到 `plan_id`。
3. 用户现有 4 条里程碑全部走这条路径，不需要手工 SQL；迁移结果写一条审计事件。

---

## 5. 代码改动清单

| 层 | 文件 | 改动 | 规模 |
|---|---|---|---|
| storage | `schema.sql`、`db.ts`、`repository.ts`、`index.ts` | `plans` 表 + 关系 + v2 迁移 + repo/façade 方法 | L |
| domain | `domain/types.ts` | `Plan` 类型、`PlanStatus`、关系类型 | S |
| application | `commands/apply-yolo-action.ts` | `kind: 'plan'` 的 create/rename/update/link/unlink/set_status/review；goal↔plan 关联动作 | L |
| application | `ingestion/apply-extraction.ts` | 建计划、把事项/里程碑挂到计划 | M |
| application | `read-models/dashboard.ts` | `plans[]` 投影（含 `todo_count`/`open_todo_count`/`milestone_count`/`current_milestone`）、goal 增加 `plan_ids` | M |
| contracts | `shared/dashboard.ts`、`contracts/dashboard.ts` | `YoloPlanRow`、`goal_ids`/`plan_id` 字段 | S |
| extract | `extract/prompt.ts`、`contracts/extraction.ts` | 输出增加 `plans[]`；三分类判据（结果/动作/单元）+ 反例；`milestones` 增加 `plan_title` | M |
| memory | `memory/tools.ts` | `yolo_action` 支持 `kind: 'plan'`；`memory_write` 支持 `plan`；`yolo_query` 增加 `plans` 视图 | S |
| client | `panel/navigation.ts`、`PageTabs.tsx`、`kanban/surfaces.ts` | 新页面与新 surface（见 §6） | M |
| client | `panel/PlanView.tsx`（新）、`KanbanView.tsx`、`milestone-ownership.ts` | 计划卡（结果/日期/阶段/事项进度）；里程碑只出现在计划内；删掉「其他里程碑」轴 | L |
| client | `design/tokens.ts` | 计划卡与阶段的视觉（复用现有 Mono 变量，不新增色） | S |
| tests | 单测 12+、`tests/e2e/api|ui` 6+ | 含「抽取三分类」判例、迁移前后一致性、计划卡交互 | L |
| docs | `design/goal-management.md`（改结论）、`architecture/modules.md`、`usage.md`、`testing*.md`、`CHANGELOG.md` | 见 §9 | M |

---

## 6. IA：一级入口两个方案

**方案 ①（推荐）5 个入口：首页 / 事项 / 计划 / 目标 / 历史**

- 「事项」＝现在的计划页（全部/今天/接下来/未排期）**改名**，语义变成"所有要做的事"；
- 「计划」＝新的单元列表（计划卡片：结果、目标日期、阶段进度、内含事项数），是新的主入口；
- 「目标」＝只放长期结果，卡片里分组展示它下面的计划；
- 理由：三者是三种不同的东西，各自一个页面才不会重演"两排相似控件"。

**方案 ②（保守）4 个入口：首页 / 计划 / 目标 / 历史**，计划页内分两段：
「进行中的计划」卡片 + 下面的时间视图。理由：少一个 Tab；代价是一个页面又承担两种对象。

两方案都必须满足：**里程碑不再有独立的顶层展示**（它只出现在计划内），
`其他里程碑` 轴删除（模型上不再有孤儿）。

---

## 7. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | 数据模型 + 迁移 + 领域/命令/repo + 投影（后端可用，UI 未动） | 单测：v1→v2 迁移幂等、旧数据无损、`plans` CRUD 与关联；api e2e 新增 PLAN-01 |
| **P1** | 客户端：新入口 + 计划卡 + 里程碑归位 + 删除「其他里程碑」轴 | ui e2e：计划卡闭环、里程碑只在计划内、无孤儿轴；W2/W7/W12 通过 |
| **P2** | 抽取三分类 + `memory_write/yolo_action` 支持计划 + 真实对话判例 | RM 判例：动作口吻→事项、结果口吻→计划/里程碑；抽样准确率基线 |
| **P3** | 数据整理引导（把历史孤儿里程碑分诊给用户确认）+ 文档同步 + 复盘 | 真实库迁移后：孤儿里程碑 0、计划挂接率 > 0 |

每阶段独立可发布、独立回滚（P0/P1 只加不改；P2 的抽取是增量字段；P3 有审计与撤销）。

---

## 8. 风险与必须避免的反例

1. **不要做成任务树。** 计划 ⊇ 事项是一层，不设子计划/子事项；层级固定不许无限嵌套。
2. **不要自动百分比。** 沿用现有立场（设计文档反例三）与 Basecamp 的判断：进度是人的判断，
   事项完成数只作为卡片上的一行事实（"3/5 件已完成"），不合成百分比。
3. **不要四个名词都要求用户建。** 用户只需建事项（对话里说）与计划（"我在推 0.5.0 发布"）；
   里程碑与目标由 YOLO 建议、用户确认。
4. **抽取误判的兜底**：新增的「待整理」状态（计划/里程碑分类不确定时），在计划页顶部一条提示，
   一次点击即可改判，改判要写审计。
5. **迁移不可逆点**：`ALTER TABLE ... ADD COLUMN` 是加法，安全；但**把里程碑改判为计划/事项
   是有损操作**，必须留审计事件并支持撤销（复用现有 undo 机制）。

---

## 9. 与现有设计文档的冲突（必须同步修改）

- `docs/design/goal-management.md` §1.4「一个里程碑事项必须属于目标：**不推荐**」→ 改为
  「里程碑必须属于计划；计划可选属于目标」。
- 同文 §1.5「里程碑可以独立存在」→ 改为「计划可以独立存在（不挂目标）」。
- 同文 §5.2「计划 → 目标会展示…」→ 随新 IA 更新（该处已过期）。
- `docs/architecture/modules.md` / `usage.md` / `testing*.md` / `CHANGELOG.md` 同步。

---

## 10. 决策清单

| # | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| 0 | **要不要「计划」这个名词** | D：新增计划层 / **E′：不新增，跨度做成目标的属性** | **E′**：用户只记三个词，且不必回答"这是长期还是阶段"；D 的名词边界正是本次质疑点 |
| 1 | 中间层叫什么（仅 D） | `计划` / `项目` | **计划**（已选；选 E′ 则作废） |
| 2 | 一级入口 | 5 个 / 4 个 | **5 个**：三类对象各一页，避免再次出现"两排相似控件" |
| 3 | 数据迁移 | 启发式分诊 + 人工确认 / 只做保守映射 | **分诊 + 确认**：否则真实的 4 条里程碑会永远停在错误形态 |
| 4 | 是否现在就动手 | 从 P0 开始 / 先只更新文档 | 评审已要求「先想想」：**先定 #0，再排期** |

> 我读过的一手文档：Linear（[Projects](https://linear.app/docs/projects)、[Project milestones](https://linear.app/docs/project-milestones)、[Initiatives](https://linear.app/docs/initiatives)）、
> GitHub（[About milestones](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones)）、
> Basecamp（[Tracking work on the Hill Chart](https://5.basecamp-help.com/article/1066-tracking-work-on-the-hill-chart)）、
> Todoist（[GTD 指南](https://www.todoist.com/productivity-methods/getting-things-done)、[版块](https://www.todoist.com/zh-CN/help/todoist/features/introduction-to-sections-rOrK0aEn)）。
> Asana 帮助中心与 gettingthingsdone.com 正文有反爬未能读取，相关行已标注。
