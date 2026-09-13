# 三对象重构方案：独立评审

> 评审对象：`docs/design/plan-layer-redesign.md`（评审稿 v2）+ 其配套证据 `docs/design/three-objects-analysis.md`
>
> 评审方式：逐条核对仓库内代码与文档行号、直接只读查询本机 3 个真实 SQLite 库、用 `web_fetch`
> 实际打开方案引用的 6 条一手文档。**本文只评价证据与推理，不评价作者的投入。**
>
> 证据分级：`[已核实]` = 我亲自读到/查到；`[推理]` = 我的判断，附推理链；`[未核实]` = 我无法确认，已写入立场声明。

---

## 结论

**1. 方案值得执行，但不能按现在这份规格执行。** 诊断②③（「计划」是页面名、抽取没有结果/动作判据）证据扎实、修复方向正确且零迁移风险；
而把 `horizon` + 里程碑强制归属 + 数据改判打包成一次 schema 重构（E′ 全量），其证据基础是 **4 条里程碑、1 个 candidate 目标**，
却要推翻 4 处已发布的产品承诺（含 1 条产品验收标准），性价比与风险不对称。建议拆成「先做的零迁移部分」与「需要独立论证的 schema 部分」。

**2. 选 E′，不选 D。** D 增加一个用户必须在创建时当场分类的名词，与 VISION「管理而非代办 / 主动但克制」（`docs/VISION.md` L74–L75）相冲突，
且方案的自我评估（`plan-layer-redesign.md` L211–L213）是对的：D 的判别测试需要"想一下"，E′ 不需要。但这个结论**不蕴含 E′ 现在的规格可以直接开工**。

**3. 最大的问题不是选型，是迁移与业界论断。** 迁移步骤 3（L192）把 `发布 0.5.0 版本` 从里程碑"变成"目标，却没有交代挂在它下面的
3 条真实事项（`更新文档`/`npm 发包 0.5.0`/`更新标签`）的归宿；而 §2 声称的三条"业界共识"里，第 2、3 条被**该方案自己的表格和一手文档直接否证**。

---

## 用户视角发现

### [严重度: 高] 「有交付日期的 / 持续跟进的」分组标题，与方案自己预测的迁移结果直接矛盾

**发现**：§4.4 规定目标页上段叫「**有交付日期的**」（`stage`），下段叫「持续跟进的」（`ongoing`）（L158）。但分段的依据是 `horizon`，
不是 `target_date` 是否存在；而方案自己说 `stage` 只是"**通常**带 `target_date`"（L127），不是必须。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L127–L130：「`stage`：「有东西要交出去」…**通常带 `target_date`**」；默认值 `ongoing`（L130）。
- `plan-layer-redesign.md` L158：上段标题为「**有交付日期的**」。
- `plan-layer-redesign.md` L192：迁移把 `能力真值实验：30 skill + 120 请求 + 独立验收` 判为 `stage` 目标。
- 我直接查询该里程碑的真实行：`SkillSEO/.dsh/yolo/yolo-3ef670deee2d_default.db` →
  `{"title":"能力真值实验：30 skill + 120 请求 + 独立验收","status":"planned","target_date":null}`，**`target_date` 为 NULL**。

**结论**：按方案自己的迁移规则，这条 `stage` 目标会出现在「**有交付日期的**」分组里，而它没有日期。分组标题在方案自己预测的案例上就是假的。

**建议**：分组依据改为 **`target_date` 的有无**（用户可观察的事实），`horizon` 只作卡片上的一个标签；或把标题改成
「阶段结果 / 持续跟进」。同时明确 `horizon` 与 `target_date` 的耦合规则（谁写谁），否则用户会同时面对一个可见字段和一个隐藏字段描述同一件事。

### [严重度: 高] `horizon` 会在 `target_date` 之外再造一个"我该不该填日期"的困惑

**发现**：用户的原始困惑是「里程碑、目标、计划有什么区别」。方案在删掉一个名词（计划）的同时，引入一个**新的、用户看不见却决定行为**的属性
（`horizon`），并用它决定目标出现在哪一段、是否期待日期。这是把一个已存在的可见字段（`goals.target_date`）的语义拆成两个字段。

**证据**（`[已核实]`）：
- `src/storage/schema.sql` L98：`target_date TEXT` 已存在，注释「ISO8601 date YYYY-MM-DD (nullable)」。
- `docs/usage.md` L79：已经对用户承诺「目标页…可以看到完成标准、当前下一步、**目标日期**、最近进展」——`target_date` 已是用户可见概念。
- `plan-layer-redesign.md` L125–L131：`horizon` 的两个取值分别"通常带/通常无" `target_date`；默认 `ongoing`；切换写审计事件。

**结论**：用户原本只需回答"这个目标什么时候到手"；现在还要（隐式地）回答"这是长期还是阶段"。方案 §4.1 声称
「**永远不需要回答"这是长期还是阶段"**——那是系统填的字段」（L113–L114），但抽取判据把它交给模型猜（L130「系统猜，可能猜错」），
用户一旦发现分错段就要回来改。这就是把分类成本从创建时**平移**到了纠错时，不是消除。

**建议**：若要保留 `horizon`，必须让它在界面上**始终可见且可点**（胶囊而非隐藏字段），并且不让它决定分组；
或者干脆先用 `target_date` 存在与否 + 用户手动的「持续跟进」标记两个 UI 事实表达，不引入新字段名。

### [严重度: 高] 「待整理」把分类问题交还给用户，与 §4.1 的核心原则自相矛盾

**发现**：§4.1 的整个卖点是"分类责任从用户移到系统建议 + 一键改判"（L18、L112–L114、L267）。但 §4.4/§4.5/§4.7 的迁移期流程恰恰要求用户
对每一条 `unresolved` 做**恰好是那个被否定的二元判断**：「挂到某个目标 or 改判为事项」（L162）。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L113–L114：「**永远不需要回答"这是长期还是阶段"**」。
- `plan-layer-redesign.md` L162：「一次点击即可挂到某个目标或**改判为事项**」。
- `plan-layer-redesign.md` L174：「不确定时**不猜**：写入 `unresolved[]`…由 UI 的「待整理」呈现，用户一次点击落位」。
- `plan-layer-redesign.md` L267（风险 3）：「不要让用户先学分类」——「待整理」列表本身就是"先学分类"的一种形式。

**结论**：这不是硬伤，但一个刚抱怨"分不清三者"的用户，打开看板第一屏看到的是"N 条待你确认的分类"，体感上确实像系统在丢锅。
尤其当这些条目是**系统自己在迁移中改判出来的**（L192–L193）时，用户并没有参与产生这个问题。

**建议**：（a）「待整理」不得出现在首页或默认落地页，只作为目标页顶部一条可折叠提示，且**首屏不阻塞**；
（b）为空归属里程碑提供"先放着不管"的默认出口（保持 `goal_id = NULL` 且正常显示），而不是要求先分类；
（c）文案改成"这几条我还不确定归到哪个目标，你可以告诉我，也可以先不管"，把判断权描述成可选项。

### [严重度: 高] 迁移会改动用户已有数据，且方案把它列为"行级改判"，但真实数据里这是**实体类型变更**

**发现**：§4.7 声称「迁移只做**加法**（`ALTER TABLE … ADD COLUMN`）与**行级改判**」（L195）。但步骤 3 要做的是把一条**里程碑行变成目标行**
（L192），并把另一条里程碑**改判为事项**。这不是"改判"（同一实体换归类），而是跨表搬迁；方案没有定义搬迁后 `todos.milestone_id` 的命运。

**证据**（`[已核实]`，我自己的只读查询）：
- `src/storage/schema.sql` L49：`milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL`。
- `plan-layer-redesign.md` L61–L62（配套分析文档 §5 的原始 dump，我已复核）：`发布 0.5.0 版本` 下面挂着 3 条 pending 事项。
- 我在 `dsh-yolo/.dsh/yolo/yolo-65c0ede8ba5b_default.db` 上重跑：里程碑 `发布 0.5.0 版本` → `todos: [更新文档(pending), npm 发包 0.5.0(pending), 更新标签(pending)]`，`goal_links: []`。
- `plan-layer-redesign.md` L192：「`发布 0.5.0 版本` → **成为** `stage` 目标「0.5.0 发布」」；L146「**保留**：`todos.milestone_id`（语义不变）」。

**结论**：两种读法都成问题——
- 读法 A（里程碑行就地升格为目标）：里程碑行消失/改写 → 那 3 条事项的 `milestone_id` 变成悬空或被 `ON DELETE SET NULL` 清空，
  **用户会静默丢掉"这 3 条是在给发布干活"这层信息**，而方案承诺"语义不变"。
- 读法 B（新建目标并把里程碑挂上去）：那么同一件事同时存在为「目标 `0.5.0 发布`」和「里程碑 `发布 0.5.0 版本`」，
  表述重复，且 §4.2 要求里程碑必须属于目标，于是形成 `目标 → 里程碑 → 3 条事项` 三层——正是 `docs/design/goal-management.md` L29/L102
  「里程碑不是事项的父容器」所拒绝的形态。

**建议**：把迁移步骤 3 拆细并写成可执行规格：明确"升格"是删行还是建行；若建行，明确 `todos.milestone_id` 是否重指到新目标的
`next_todo` 或保留原里程碑且**必须**给该里程碑一个 `goal_id`；为这条路径写一个真实库的 dry-run 断言（"迁移后原 3 条事项仍能追溯到发布目标"）。

### [严重度: 中] 「待整理」状态没有落库位置；`unresolved[]` 与 §4.3 的"不新增表"冲突

**发现**：§4.5 引入 `unresolved[]`（L174），§4.3 声明"**不新增表**、不新增 kind"（L148）。但 `unresolved[]` 作为**独立于 `milestones[]` 的数组**
在现有 schema 里没有归宿。

**证据**（`[已核实]`）：
- `src/contracts/extraction.ts` L38–L46：`ExtractionResult` 是闭合的 7 个字段，没有 `unresolved`。
- `src/storage/schema.sql` L260–L273：`extraction_log` 是审计表，`UNIQUE(session_id, turn_seq, strategy)`，
  用途是"raw LLM JSON return (audit)"，不是工作队列。
- `plan-layer-redesign.md` L148：「**不新增表、不新增 kind**」；L174：「写入 `unresolved[]`…由 UI 的「待整理」呈现」。
- `plan-layer-redesign.md` L173：「`milestones[]` 增加 `goal_title`（**必填字段，允许 null** 表示待整理）」——"必填"与"允许 null"自相矛盾。

**建议**：删掉独立的 `unresolved[]`，把"待整理"统一表达为 `milestones.goal_id IS NULL` + `goals.horizon` 待确认标记（这些都有列可存），
并把 L173 的表述改成"`goal_title` 为可选字段，缺失即进入待整理"。

### [严重度: 中] 迁移撤销只有审计事件，不足以回退跨表搬迁

**发现**：L194 说"每次改判写事件（`milestone_reclassified`），支持撤销"。但仓库里已有的撤销模式（`todo_merge_log`）明确需要
**前后快照**才可回退；`events` 表只存标题快照与 `change_json`，不含被改判行的全部字段。

**证据**（`[已核实]`）：
- `src/storage/schema.sql` L324–L340：`todo_merge_log` 存 `source_snapshot_json`、`target_before_json`、`target_after_json`、
  `status IN ('active','undone')`、`undone_at`——这是本仓库既有的"可撤销"实现范式。
- `src/storage/schema.sql` L189–L201：`events` 只有 `subject_type/subject_id/subject_title/change_json`，
  并注明 `subject_id` "deliberately not an FK so deleted history survives"。
- `src/storage/db.ts` L269–L292：既有迁移在不确定时**主动放弃**写入（"Same-date ties remain unset so migration never plans for users"），
  与本方案"启发式分诊 + 人工确认"（L293）的激进程度形成对比。

**建议**：迁移的"可撤销"要落成一张与 `todo_merge_log` 同构的 ledger（含改判前行快照），或把迁移限定为**只加列 + 只写 NULL**，
不改变任何既有行的实体类型。后者风险最低、最符合本仓库既有迁移的克制风格。

### [严重度: 低] 真实数据库里已经有 6 条未清理的 `[E2E]` 目标，方案完全未提

**发现**：§1.3 的"目标 = 0"是**按标题过滤后的结果**；未过滤时该库的目标表并非空的，而是 6 条 `abandoned` 的 E2E 夹具。

**证据**（`[已核实]`）：`dsh-yolo/.dsh/yolo/yolo-65c0ede8ba5b_default.db` 的 `goals` 表返回 6 行，标题均为
`[E2E] 在九月完成产品发布 <时间戳>`，`status=abandoned`；`goal_todos` 与 `goal_milestones` 均为空。

**结论**：这不构成对方案证据的否证（`three-objects-analysis.md` §9 L209–L213 已声明排除 `[E2E]` 标题，口径透明，
我复核后确认三库计数与文档一致）。但它意味着「目标使用率≈0」这个结论是在一张**被测试噪音污染**的表上得出的。

**建议**：在 §9 度量脚本里同时输出"原始行数 / 排除夹具后行数"，避免后续复盘时再次混淆；顺手把夹具清理脚本补全到 `goals`。

---

## 业界视角发现

### [严重度: 高] 「进度不靠任务计数」（§2 共识 3）被方案自己的表格和一手文档否证

**发现**：§2 从 Basecamp 一家产品的立场，推出了全行业结论。而同一张表的 Linear 行写着"project 由 issue 汇总"、GitHub 行写着"由挂入的 issue 计数"（L74–L75）。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L87–L88：「**进度不靠任务计数。** Basecamp：*"42% of the tasks are complete. What does that tell you? Very little."*」
- 同方案 L74：Linear「project 由 issue 汇总」；L75：GitHub「**由挂入的 issue 计数**」。
- Linear 官方 Project graph 页：进度/预测由 issue 数据算出——"Project graph statistics update hourly with the latest **issue activity**"、
  "Project velocity is calculated based on weekly historical data: how many **completed issue points** per week"、
  "Remaining issue points are calculated by summing the points of **incomplete issues**"，FAQ 甚至专门有 "Why did my progress go down?"。
  来源：<https://linear.app/docs/project-graph>
- GitHub 官方 About milestones 页：里程碑页展示"The milestone's **completion percentage**"与"The number of **open and closed issues** and pull requests associated with the milestone"。
  来源：<https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones>
- Asana 官方论坛（功能已上线帖的引用）：「the only two methods of configuration for tracking goal progress is **by tasks completed** and
  **milestones completed**, within specific projects」。来源：<https://forum.asana.com/t/automate-goal-progress-by-tasks-from-specific-project-sections/1017347/4>

**结论**：业界分歧是真实存在的——**是 Basecamp 单方面取消了百分比**（该文原话："the status is human generated, not computer generated"，
<https://5.basecamp-help.com/article/1066-tracking-work-on-the-hill-chart>），不是"主流都不用计数"。把一家之言写成"业界共识"，
会让读者以为 YOLO 的做法有普遍背书。

**建议**：改成「Basecamp 明确反对按任务数计进度，Linear/GitHub/Asana 则相反；YOLO 选择 Basecamp 路线，理由是
`goals` 的完成标准由用户确认（`docs/design/goal-management.md` L297）」——这仍然站得住，而且更诚实。

### [严重度: 高] 「里程碑不是顶层实体」（§2 共识 2）有直接反例：GitHub 自己就是

**发现**：§2 共识 2 说「里程碑属于那个层，不是顶层实体；**唯一**让里程碑当顶层的 GitHub 上面还有 Repository 兜着」（L86）。
但 Repository 是代码命名空间，不是"带结果与日期的单元"；GitHub 里承载日期与完成度的**就是里程碑本身**。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L75 自己承认：GitHub 的「里程碑 **就是中间层**」。
- GitHub 官方文档：里程碑可以"track progress on groups of issues"、有 due date、description、completion percentage（同上一节 URL）。
  GitHub 在该命名空间内**没有** Project 层（GitHub Projects 是与里程碑并列的另一种视图，不是其父容器）。
- 对照 Linear：里程碑明确在 Project 之内——"Project milestones represent different stages in a **project's** lifecycle"，
  来源：<https://linear.app/docs/project-milestones>。

**结论**：行业事实是"**层是必要的，名字不统一**"：Linear 把中间层叫 Project、里程碑在它下面；GitHub 直接把中间层叫 Milestone。
这两者都支持"必须有一个装住行动、带日期与结果的层"，但**都不支持"这个层不能叫里程碑"**。方案用共识 2 支撑"YOLO 的里程碑设计错了"，
这一步推理不成立。

**建议**：把共识 2 重写成："中间层必须存在，行业对它的命名不统一（Project / Milestone 都有）。YOLO 的问题不在于名字，
而在于这个层与结果层**混用同一个实体**。"——这样才与 §5 里"E′ 与 D 的分岔点"（L90–L91）真正对齐。

### [严重度: 中] 「必须有一个装行动的中间层」（§2 共识 1）把"桶"和"结果单元"混为一谈

**发现**：共识 1 的原话是"必须有一个**装行动、带结果与日期**的层"。但被引用为支持的产品里，只有 Linear 的 Project 同时具备
"结果 + 日期 + 装行动"三件事；Basecamp 与 Todoist 的中间层是纯桶（无结果语义、无日期语义）。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L77：Basecamp 中间层是「To-Do List」，来源文档明确写"Each of our development projects in Basecamp is made of a
  set of To-Do Lists"、"We create a To-Do List for each piece of work that we can make progress on independently"
  （<https://5.basecamp-help.com/article/1066-tracking-work-on-the-hill-chart>）——**没有一个"结果"的定义，也没有日期字段**。
- `plan-layer-redesign.md` L78：Todoist 是 Project → Section → Task，Section 是纯分桶。

**结论**：如果"桶"就够（Basecamp/Todoist），那么 YOLO **已经**有那个桶了——`PlanSurface` 的全部/今天/接下来/未排期
（`src/storage/schema.sql` L37 注释、方案 L37、`client/panel/navigation.ts` L5）。于是"缺一层"的论断不成立：
缺的是"结果层"，而不是"中间层"。方案其实自己也走到这一步（L90–L91 的"推论边界"写得很清楚），但 §2 的措辞比它的结论走得更远。

**建议**：把共识 1 的措辞收紧为"装行动需要一个容器（桶即可，YOLO 已有）；把行动**归因到结果**需要一个结果层"，
并据此把 §3 的缺陷①从"里程碑是顶层实体"改写为"**没有结果层，里程碑被迫兼职**"——后者才是被真实数据支持的诊断。

### [严重度: 中] §6 对 Basecamp 的转述有误，因而错过了最现成的模式

**发现**：§6 的 F 方案写「**取消里程碑**（学 Todoist/Basecamp，只留目标+事项）」（L231）。但 Basecamp 的差异化能力恰恰不是"没有里程碑"，
而是 Hill Chart：把"一组工作"用**人工判断**放到上坡/下坡，并把每次更新快照进项目历史。

**证据**（`[已核实]`，同 URL）：
- "Note how that the status is **human generated, not computer generated**."
- "because the status is **attached to lists**, not individual to-do items, we gain a higher-order perspective on all the work at once."
- "Every time someone updates the positions on the hill, **a new snapshot is saved to the project's history**."

**结论**：这正是 YOLO 现有 `milestones.status` + `events` + `pending_reminders`（`schema.sql` L31、L186–L202）已经具备的形状：
一个**人工判断的阶段状态**，而不是任务计数。方案一边引用 Basecamp 反对百分比，一边把它最有借鉴价值的机制归类成"最简方案"并弃用。
对里程碑的替代设计因此少了一个有力的候选。

**建议**：把"里程碑阶段进展 = 人工判断 + 状态快照"作为方案的显式设计依据（YOLO 已有 `applyMilestoneStatus` 与审计事件），
并据此论证为什么需要保留里程碑这个名词——这比"`灰度验证通过` 这类用例的表达"（L232）更有说服力。

### [严重度: 低] 方案漏掉了对自己有利的一条业界证据

**发现**：Linear 把"项目当前处于哪个阶段"作为 **Project 自身的属性**（`Milestone | Defaults to Upcoming`），而不是一个独立实体。
这恰是 E′ 把"长期/阶段"降级为属性的行业先例，方案没有用。

**证据**（`[已核实]`）：<https://linear.app/docs/project-overview> 的 Project properties 表列出
`Status`、`Lead`、`Team`、**`Milestone`（Defaults to Upcoming）**、`Start date`、`Target date`。
（注意此处的 `Milestone` 是项目级单值属性，与 §2 表里"Project 内部的 milestone 列表"不是同一个东西——Linear 两者都有。）

**建议**：把这个先例补进 §2，让 E′ 的核心动作（跨度作为属性）在业界一侧也站得住，而不是只靠"少一个名词"。

---

## 反向检查

### [严重度: 高] 诊断①是**推翻一条既有产品决策**，不是修复一个缺陷；方案的证据章节把它写成了 bug

**发现**：方案把"里程碑无归属约束"列为结构性缺陷①（L99、L104），并用"真实数据 4/4 无归属"作证据。但"里程碑可以不属于任何目标"
是设计文档**显式决定**的，还进了**产品验收标准**。

**证据**（`[已核实]`）：
- `docs/design/goal-management.md` L98：「| 一个里程碑事项必须属于目标 | **不推荐** | 外部阶段、独立项目检查点和一次性验收可以独立记录 |」
- 同文 L112：「#### 里程碑可以独立存在 …以后用户说"这是发布计划的一部分"，再关联到目标，不需要重新创建。」
- 同文 L375：「里程碑可以在目标详情中显示，**也可以在没有目标时进入独立的阶段检查区域**」。
- 同文 L540（产品验收标准 3）：「**里程碑既能关联目标，也能在没有目标时独立存在**」。
- `docs/usage.md` L76、L79、L87 已对用户发布同一承诺（L79 明确写了「其他里程碑」时间轴）。

**结论**：①是**有意的设计选择**，不是疏漏。方案 §3 用 `8a64b21`「只能靠 UI 兜底」当失败证据（L99），
但那正是 L375 设计要求落点的实现。把决策变更写成"缺陷修复"，会让评审者低估这次改动的性质——
这是**推翻一条已经写进验收标准的承诺**（`goal-management.md` L540），必须走"变更决策"的论证路径，而不是"修 bug"。

**建议**：§3 表把①改标题为「里程碑的独立存在承诺与'结果层缺失'冲突（**变更既有决策**）」，并在 §8 风险里加一条：
"撤销 L540 验收标准"，附撤销理由与对既有用户（尤其已经在用独立里程碑的人）的影响。

### [严重度: 高] 方案没有回答"更小的改动行不行"，而配套分析文档自己已经给出过这个答案

**发现**：`three-objects-analysis.md` §7 提出 T0（纯文案）/T1（小改动）/T2（需设计或抽取改动）的分档建议（L162–L184），
其中 T0/T1 **零 schema 变更**就能显著改善可理解性；方案 §6"不采纳的方案"只讨论了 A/C/F（L225–L232），**没有讨论 T0/T1**，
直接从诊断跳到了 schema 重构。

**证据**（`[已核实]`）：
- `three-objects-analysis.md` L162–L174：T0 四条（计划页副标题划边界、目标页里程碑区加定义、空态三行对照、修文档漂移）、
  T1 三条（显示已算好的 `milestone_open_todo_count`、里程碑胶囊可点跳到事项、计划页改名待定）。
- `plan-layer-redesign.md` L39–L40 自己指出：`milestone_status` 与 `milestone_open_todo_count` **已算好但客户端 0 处使用**；
  我在 `src/application/read-models/dashboard.ts` L230–L231 复核确认这两个字段确实被投影。
- `plan-layer-redesign.md` L225–L232：§6 只列 A/C/F。

**结论**：存在一个**零迁移、零承诺破坏**的中间方案，能同时解决②③并把①的可见性补上，而方案没有与它做对比。
这不代表 E′ 一定不该做，但"改动性质：结构性中等改动"（L20）这个判断缺少与更小方案的基准比较。

**建议**：在 §6 增设一节「方案 G｜分阶段落地（推荐先做）」：T0+T1 全部 + 抽取判据重写 + 仅"读侧"单一归属展示
（不改 `milestones` 表，只把 `goal_ids` 多于 1 的情况标注出来）。以 P0' 交付，用 2–4 周真实数据决定是否需要 schema 重构。

### [严重度: 高] 方案解决了"计划 vs 目标"，但把"里程碑 vs 目标"的辨析留在了原地

**发现**：E′ 删掉「计划」这个界面名词（L157），用户原来的四词问题变成三词问题。但用户问的是三个词的区别，
其中「里程碑 vs 目标」在 E′ 下仍然需要用户自己从**版面位置**（里程碑画在目标卡里面）反推，而不是从**定义**上理解。

**证据**（`[已核实]`）：
- `plan-layer-redesign.md` L18：E′「**不新增名词**：只有一个结果实体「目标」」——但里程碑**仍然是独立对象、独立状态机**
  （L122：`planned/active/done/abandoned`）、独立入口（事项编辑器的下拉、筛选、事项行尾后缀，见 §1.2 L47）。
- `plan-layer-redesign.md` L279：验收信号①仍是「用户不看文档，也能在几秒内说清**三者**」——作者自己保留了这条验收线，说明尚未解决。

**结论**：E′ 的实质收益是"删掉一个误导性的名词 + 给里程碑一个强制宿主"，而不是"让三者可区分"。
若把里程碑**同时**降为目标的属性（例如"目标下的阶段标记"）或干脆取消（方案已否掉的 F），三者才真的变成两者。
当前 E′ 是"三个名词、其中两个强绑定"，用户仍要理解"里程碑是目标内部的检查点"这句定义——方案没有给出这句定义会出现在界面的哪个位置。

**建议**：把 §9 验收信号①拆成两个可分别验证的问题：Q1「事项和目标有什么区别？」Q2「里程碑和目标有什么区别？」。
Q2 必须在**产品界面内有答案**（例如目标卡里程碑区的一句固定说明，正是 `three-objects-analysis.md` T0-2 的建议），
否则这次重构只是把困惑从 Q1 挪到了 Q2。

### [严重度: 中] 诊断③方向正确，但证据基础是 4 条里程碑和一次主观归类

**发现**：`src/extract/prompt.ts` L51 确实只有一行判据，缺"结果 vs 动作"规则——这条我复核后**完全成立**（`[已核实]`）。
但"4 条里 2 条是行动口吻"（L66）是把 4 个样本做了人工归类，且方案 §9 已把这个数当成基线（L280「动作口吻 2/4」）。

**证据**（`[已核实]`）：
- `src/extract/prompt.ts` L51：`- milestones: NEW named project phases or checkpoints with target dates.`——确实只有这一句。
- `plan-layer-redesign.md` L66：「4 条里 2 条是行动口吻（`进行 PRD 设计`、`能力真值实验：…`）」。
- 我的复核：`进行 PRD 设计` 确实是动作口吻；但 `能力真值实验：30 skill + 120 请求 + 独立验收` 是一个实验**安排**，
  也可能被合理读作"要交付的一份实验结论"。归类边界不清晰。

**建议**：补充抽样的判定规则（谁判、按什么标准、能否复现），或把这条基线标注为"人工判断，样本 n=4，未做双人标注"。
不要让它进入 §9 的通过/失败判据。

### [严重度: 中] 诊断②的"命名撞车"是一种解释，但代码事实提供了另一种同样合理的解释

**发现**：§3 把「计划 vs 目标」归因于"页面名与实体平级"（L100）。但代码里「计划」**从来就是一个视图**，
`navigation.ts` 的注释明确写着这一点，所以"撞车"可能不在命名，而在**产品内缺少对三者的任何一句解释**。

**证据**（`[已核实]`）：
- `client/panel/navigation.ts` L4–L5：「Plan segments are the open-todo partition (no goals: they are their own page).」
  `PlanSection = 'all' | 'today' | 'upcoming' | 'undated'`。
- `client/panel/PageTabs.tsx` L14：`{ key: 'plan', label: '计划', ... }`——只是一个 tab 标签。
- `client/panel/KanbanView.tsx` L377：目标页有标题「目标与里程碑」和副标题 hint「N 个长期结果 · 下一步优先」，
  但**没有任何一处**定义里程碑。这与 §1.2「没有任何位置解释它是什么」（L48）一致。

**结论**：两种解释都能解释用户的提问；方案没有做区分，就直接选了对自己更有利的那一种。如果真正的病因是"界面没解释"，
那么改名（E′）是治不了这个病的——用户仍然不知道里程碑是什么，只是不再把它和"计划"比。

**建议**：把②拆成两个可独立验证的假设，用一次 3 人 5 秒复述测试（§9 信号①）先判定病因，再决定是否改名。
改名本身零风险，可以无条件先做；但不要把它当成②的完整修复。

### [严重度: 中] 未被写进风险章节的风险（清单）

以下是我在代码里发现、而 §8（L263–L271）未覆盖的：

1. **`goal_milestones` 的"多对多"能力被静默取消，且迁移会丢归属**（`[已核实]`）
   - 证据：`client/panel/milestone-ownership.ts` L60–L61 明确实现"a shared milestone lists several goals; it shows under each of them"；
     `tests/milestone-ownership.test.ts` L78 有专门用例 `shared = milestone('ms-shared', '灰度验证通过', WS_A, { goal_ids: ['g-1', 'g-2'] })`。
   - 方案 L181 把 `goal_ids: string[]` 换成 `goal_id: string | null`，L191 迁移规则是"取 `position` 最小者"——
     **被丢弃的第二个归属没有任何用户可见记录**。这是删除一项已实现的、有测试的能力。
   - 建议：迁移时对"多归属"行写审计事件并在「待整理」中显式提示"这条里程碑原本属于 N 个目标"。

2. **`goal_id` 与 `parent_goal_id` 缺少"同 workspace"约束，而修复代码恰恰依赖它**（`[已核实]`）
   - 证据：`src/storage/db.ts` L258、L265 的既有回填都显式 `JOIN … AND m.scope_key = g.scope_key`，
     说明仓库惯例是**必须**校验归属同库；方案的 DDL（L138、L142）只有裸 `REFERENCES`，无 scope 约束。
   - 佐证：`client/panel/milestone-ownership.ts` L13–L14 注释「Milestone ids are only unique inside their own store」，
     且同一文件 L21 用 **cwd** 作身份，而 `dashboard.ts` L431 用 **ws.slug|id** 作身份——两套身份方案并存，
     新增 `goal_id` / `parent_goal_id` 查找时必须选对。
   - 建议：写入路径校验同 scope；`parent_title` 解析显式带 workspace。

3. **`parent_goal_id` 没有环检测，而"只允许一层"只是文档承诺**（`[已核实]`）
   - 证据：方案 L123「可选 → 上级目标（**只允许一层**）」、L265「目标嵌套也只允许一层」——两处都只是文字；
     DDL（L138）是裸自引用，无 `CHECK`、无触发器，且本仓库迁移没有"业务不变量校验"的既有设施。
   - 更实际的问题：一层嵌套与 §4.4 的两段式分组**没有定义交互**——一个 `stage` 子目标挂在 `ongoing` 父目标下时，
     它出现在上段还是父目标卡内？方案未写。
   - 建议：要么删掉 `parent_goal_id`（延后到有真实需求时），要么在写入路径做环检测 + 明确子目标的分组归属。

4. **`ON DELETE CASCADE` 让里程碑的生命期依附于目标**（`[已核实]`）
   - 证据：方案 L142 `goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE`；对照 `schema.sql` L49 `todos.milestone_id … ON DELETE SET NULL`。
   - 目前没有"删除目标"的动作（`apply-yolo-action.ts` L496–L504 只有 `abandon` 软状态），所以危害有限；
     但一旦未来加删除路径，里程碑行会被连带删除，`pending_reminders.milestone_id`（`schema.sql` L360）与
     `events.subject_id` 会指向已消失的对象。
   - 建议：改成 `SET NULL`（与 `todos.milestone_id` 一致），把"无归属"交由「待整理」承接。

5. **`apply-yolo-action` 的影响面被低估；方案对现状的判断有一处事实错误**（`[已核实]`）
   - 方案 L148–L150 称：goal kind「已覆盖 create/rename/update/link/unlink/…，**只需加两个字段与里程碑的 link/unlink**」。
     但 `link/unlink` 对里程碑**已经实现**：`src/application/commands/apply-yolo-action.ts` L577–L599
     处理 `action === 'link' && r.milestone_id` 与 `unlink`，并写 `goal_linked`/`goal_unlinked` 审计事件。
   - 真正需要的是**方向反转后新增"设置里程碑的归属目标"动作**，并处理既有的 `link/unlink`（goal→milestone）在
     `goal_milestones` 停写之后的语义（是拒绝、是转发、还是保留为读兼容）。
   - 另：`apply-extraction.ts` L188–L201 也直接调用 `yolo.linkGoalMilestone` 写 `goal_milestones`；
     方案 §7 把它归为"M（三分类落库）"，未列出这条必须一起改的写路径。
   - 建议：把 `apply-yolo-action.ts` 与 `apply-extraction.ts` 的**所有 `goal_milestones` 写点**在 §7 中逐一列出，
     并把规模从 `M` 调整为 `M/L`。

6. **测试与夹具的改动不是"更新"，是"反转既有断言"**（`[已核实]`）
   - `tests/e2e/ui/milestone-ownership.spec.ts` L48 直接播种 `goal_milestones`，L56 清理该表；
     `scripts/e2e.mjs` L172 同样按 `goal_milestones` 做 `[E2E]` 清扫；
     `docs/testing-e2e.md` L71 明确把"无归属的开放里程碑留在「其他里程碑」轴上仍可见可编辑"写成规格。
   - 方案 L257 只写「ui e2e 全绿」，未说明这些用例是在断言一个**即将被删除的产品行为**。
   - 建议：§7 的 tests 行改为"删除/重写 N 个断言既有承诺的用例"，并列出清单；同时更新 `scripts/e2e.mjs` 的清理路径。

7. **`docs/VISION.md` 未列入文档影响面**（`[已核实]`）
   - `docs/VISION.md` L47 定义了「**计划** 把开放事项划分为今天、接下来、未排期」——这正是被改名的那个入口；
     L62 也在「组织」阶段用"计划"指代整理结果。
   - 方案 §7 的 docs 行（L250）只列了 `goal-management.md`、`architecture/*`、`usage.md`、`testing*.md`、`CHANGELOG.md`，**漏了 `VISION.md`**。
   - 而 `AGENTS.md` 明确把 `docs/VISION.md` 定为"长期产品边界"事实源，`docs/usage.md` 是用户可见文案源——两者都在改名前必须同步。
   - 建议：补入 `docs/VISION.md`（L47、L48），并在 §7 把 `usage.md` 的规模从"M（口径同步）"提升为"重写"：
     L76/L79/L87 三处描述的里程碑独立性与「其他里程碑」轴将被删除，这不是同步而是**改承诺**。

---

## 对 E′ 的逐条质疑

**E′ 站得住的部分（我认为无需改）**

- 「两个结果实体不如一个结果实体」——被 `goal-management.md` L16「事项完成数量不会自动宣布目标达成」与 L491 反例三支持，
  且 Linear 用 Project 属性表达阶段（<https://linear.app/docs/project-overview>）提供了行业先例。**接受**。
- 「不要求用户先分类」——与 `docs/VISION.md` L74「用户拥有决定权」一致。**接受**（但见下方第 2 条）。
- 「进度不自动按事项数算」——与 `docs/design/goal-management.md` L491–L495 一致，且是既有产品立场，重构不改变它。**接受**。
- 「不新增 kind」——`apply-yolo-action.ts` 的 `action`/`kind` 在 `src/contracts/actions.ts` L5–L6 是宽松 `string` 类型，
  扩展成本确实低。**基本接受**（但 L148 的"不新增表"与 §4.5 的 `unresolved[]` 冲突，见用户视角）。

**我認為站不住或规格不完整的地方**

1. **[高] §2 共识 2、3 不成立**（见业界视角两条 高 级发现）。这不是措辞问题：§2 是方案论证业界合理性的唯一支点，
   两条被否证后，E′ 的正当性只剩下"少一个名词" + 内部一致性，而不是"符合业界"。
   → 要求：重写 §2，把"业界共识"降级为"业界分歧 + YOLO 的选择与理由"。

2. **[高] §4.1「永远不需要回答"这是长期还是阶段"」与 §4.5/§4.7 的 `unresolved` 分诊流程矛盾**（见用户视角）。
   规则如果真的是"系统填、用户改"，就不应该有"待整理"这种要求用户先判定的队列。
   → 要求：明确二者的边界——`horizon` 由系统填（用户可改），"待整理"只针对**归属**（挂到哪个目标），不针对**类型**。

3. **[阻断] §4.3 「不新增表」与 §4.5 `unresolved[]`、§4.7 "可撤销"三者不能同时成立。**
   - `unresolved[]` 无落库位置（`src/contracts/extraction.ts` L38–L46 是闭合接口，`extraction_log` 是审计日志）。
   - "撤销"需要前后快照，本仓库既有范式是 `todo_merge_log`（`schema.sql` L324–L340），`events` 不够。
   → 要求：三选一——(a) 新增一张 ledger 表；(b) 用 `milestones.goal_id IS NULL` 表达待整理并**放弃**跨表改判；
   (c) 迁移降级为"只加列、不改既有行"。我推荐 (c)+(b)。

4. **[高] §4.7 迁移步骤 3 不可执行，且会破坏真实数据。**
   真实库里 `发布 0.5.0 版本` 下挂着 3 条 pending 事项（我已复核），而方案说该里程碑"成为"目标，
   同时又说 `todos.milestone_id` "语义不变"（L146）。这两句无法同时为真。
   → 要求：写出可执行的迁移规格 + dry-run 断言；若做不到，把步骤 3 从本次范围移除。

5. **[高] `ON DELETE CASCADE`（L142）与 `goal-management.md` L112/L540「里程碑可以独立存在」直接冲突。**
   即使迁移期允许 NULL，模型上里程碑的生命期也已从属于目标。
   → 要求：改为 `ON DELETE SET NULL`，并明确"无归属里程碑"在产品中仍然是合法且可显示的长期状态，
   而不是仅存在于迁移期的过渡态（否则 §4.4「删除「其他里程碑」共享轴」L161 就是把一个合法状态从界面上抹掉）。

6. **[中] `parent_goal_id` 是范围外的复杂度，且与 §4.4 分组规则未定义交互。**
   方案把它列为"可选一层嵌套"（L123）并在 §4.8 承认"表达长期方向下多次交付要靠可选嵌套（多一步）"（L201），
   即这个字段是为弥补 E′ 相对 D 的表达力缺口而加的。但它引入了环检测、跨 workspace 校验、子目标分组归属三个新问题，
   而**没有一条真实数据需要它**（3 个库里 0 条目标需要嵌套）。
   → 要求：从 E′ v1 删除 `parent_goal_id`，作为独立后续提案；否则必须补环检测与分组规则。

7. **[中] §4.4 的两段式分组标题与分组依据不一致**（见用户视角第一条，含真实数据反例）。
   → 要求：按 `target_date` 分组，或改标题。

8. **[中] §7 影响面对 `apply-yolo-action.ts`、`apply-extraction.ts`、`scripts/e2e.mjs`、`docs/VISION.md` 的覆盖不全**
   （见反向检查风险清单 5/6/7）。
   → 要求：逐点补入，并把 client 与 application 两行从 `L`/`M` 重新估算。

9. **[低] §4.6 删除"孤儿里程碑"渲染路径，但 `milestone-ownership.ts` 的 `unowned` 还承担"已放弃目标名下的里程碑"**
   （该文件 L46–L47 的注释明确：`a milestone of an abandoned goal lands in unowned rather than disappearing`）。
   方案 L182 只把 `unowned` 重新定义为"待整理计数"，未说明这些**有主但主已放弃**的里程碑在 E′ 下落到哪里。
   → 要求：明确区分"从未归属"与"原属已放弃目标"两种待整理，二者对用户的含义不同。

---

## 如果只能做三件事

**第一件（零迁移、直击缺陷③，收益最高）**
修 `src/extract/prompt.ts` L51：把一行的 `milestones` 判据扩成"结果 vs 动作"三分类，附正反例
（`进行 PRD 设计`→事项/里程碑改判依据、`内部评审完成`→里程碑），同步 `src/contracts/extraction.ts` 与 RM 判例矩阵。
**不碰任何表、不改任何 UI、不破坏任何承诺。** 缺陷③是唯一"入库形态就错、后面界面怎么写都救不回来"的问题，先修它。

**第二件（零迁移、直接回答用户的原始问题）**
(a) `client/panel/PageTabs.tsx` L14 把「计划」改成「事项」；(b) 目标页把已算好的
`milestone_open_todo_count`（`dashboard.ts` L231）显示出来，让"里程碑不是容器但确实有支撑"变得可见；
(c) 目标页里程碑区加一句固定定义（`three-objects-analysis.md` T0-2），并修 `goal-management.md` §5.2 与 `usage.md` 的文档漂移。
这三条合起来正是用户问的那件事的答案，且**不需要任何 schema 变更**。

**第三件（把 schema 改动拆成独立决策，先证明必要性）**
不做完整 E′ 迁移。只做**读侧**的"归属可见 + 待整理计数"（`goal_ids` 长度 > 1 时显式标注为"多个目标共享"，
0 时标注"未归属"），跑 2–4 周，用 §9 的度量脚本（补齐 VISION/usage 口径）观察：
真实数据是否出现"必须强制单一归属"的压力。**只有数据显示确实有人被多归属/孤儿困扰时**，才启动 `milestones.goal_id` 重构，
并且按"只加列、不改既有行、不新建目标"的最小路径执行。

> 换言之：**先做 P0′（判据 + 文案 + 可见性），把 P0 的 schema 迁移推迟到有数据支撑时。**
> 方案当前把风险最高、证据最薄的一步（改判用户数据、取消已发布承诺）排在了最前面（§7 的 P0 = 模型 + 迁移）。

---

## 评审者立场声明

以下判断我**没有充分证据**，不作为结论强度使用，如实列出：

1. **我无法区分"真实用户数据"与"未清理的测试数据"。** `SkillSEO` 库里那个 candidate 目标
   （`Capability-evidence-anchored skill-selection defense`）看起来既可能是真实抽取结果，也可能是某次实验的产物；
   我只能按 `[E2E]` 前缀约定排除，没有其他依据。因此"缺陷④ 目标使用率≈0"**我既不能确认也不能否证**——
   我只能确认"排除 `[E2E]` 后为 1 条"，与方案一致。
2. **"4 条里程碑里 2 条是行动口吻"是人工归类。** 我复核了 `进行 PRD 设计`（同意是动作口吻），
   但 `能力真值实验：30 skill + 120 请求 + 独立验收` 我认为边界模糊，可以读成"要交付的实验结论"。样本 n=4，无标注规则。
3. **"用户会不会觉得系统在丢锅""醒来发现数据变了能不能接受"是产品判断，我没有用户研究数据。**
   我只能给出机制层面的推理（见用户视角第三条），不能给出结论性判定。
4. **Asana 帮助中心正文我未能读取。** `https://help.asana.com/s/article/progress-status-and-connecting-work-to-goals`
   返回空正文（与方案 §2 脚注的说明一致）。我关于 Asana 的唯一硬证据来自其官方论坛对已上线功能的引用
   （<https://forum.asana.com/t/automate-goal-progress-by-tasks-from-specific-project-sections/1017347/4>），
   它足以证明"Asana 有按任务完成数计目标进度的能力"，但不足以描述 Asana 的完整分层模型。
5. **我没有核实 Linear Initiatives 的强制度。** §2 表中"Initiative → Project"的层数我采信了方案与 Linear 文档导航结构；
   我**没有**读到"Project 是否必须属于某个 Initiative"的明文。因此我在"业界在中层是否强制归属"这一点上，
   只用了 GitHub（里程碑无父层，已核实）作为反例，没有把 Linear 计入。
6. **我没有运行测试、没有跑迁移演练、没有打开浏览器核对界面。** 所有 UI 结论来自读源码与文档；
   "用户看不到解释"这一条我核对的是 `KanbanView.tsx` 的标题与 hint（L377）与筛选/编辑器路径，
   没有穷举全部 UI 文案，理论上可能存在我遗漏的说明性文案。
7. **"更小的改动就能达到同样效果"是可行性论证，不是效果等价证明。** 我论证的是 T0/T1 零风险且方向正确，
   以及它与 E′ 未被对比；我**不能**证明 T0/T1 的效果等于 E′。
8. **本次评审只读不写。** 除本文件外未修改任何代码、数据或文档；三个 SQLite 库均以 `readOnly: true` 打开。
