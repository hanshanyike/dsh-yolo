# 目标管理实现架构设计

> 状态：架构设计稿，供研发实现前评审
>
> 本文只描述如何在当前 dsh-yolo 架构内实现 [目标管理产品设计](goal-management.md)。它不把产品设计中的未来能力提前当成当前事实，也不引入第二份计划存储。当前代码仍以 `goals`、`milestones`、`todos` 和 `events` 为事实，本文的新增字段、关系表、DTO 和 action 是后续实现契约。

## 0. 设计结论

本轮采用以下最小且可演进的模型：

```text
目标：一段时间内希望达成的最终结果
  ├── 直接支持事项（一个目标可以有多个）
  ├── 可选里程碑（阶段结果 / 检查点，不是事项容器）
  └── 下一步事项（目标直接关联事项中的一个明确引用）
```

- 事项是具体行动或等待，可以独立存在；目标不拥有事项的生命周期。
- 里程碑是用户标记的特殊阶段事项。第一阶段保留现有 `milestones` 聚合和状态能力，但在产品语义上它是阶段结果，不是普通事项的父节点，也不建立第一阶段子事项树。
- 目标直接关联多个事项；不能只通过一个里程碑间接找到事项。
- 事项完成、里程碑完成、进度变化都只是目标的证据；只有用户明确确认完成标准后，目标才能达成。
- 目标推进的核心是“当前状态 → 一个下一步 → 下一次回顾”，不是自动拆解和代办。
- current state 继续放在 workspace SQLite；事件和 evidence 只追加审计；dashboard/read-model 只投影，不拥有事实。
- HTTP、模型工具、面板动作和已接受的提取更新都进入同一个 application action owner；不能由 client、extract 或 storage 直接拼接写入。

## 1. 现状核对与实现边界

### 1.1 当前可复用的事实

当前代码已经有以下基础：

| 能力 | 当前落点 | 复用方式 |
|---|---|---|
| 事项 current state | `todos`、`src/domain/types.ts`、`src/storage/repository.ts` | 继续作为提醒和具体行动的事实源 |
| 里程碑 current state | `milestones`、`todos.milestone_id` | 继续保留，改变其产品解释为阶段标记，不再把它当事项父容器 |
| 目标 current state | `goals`，当前只有 `milestone_id`、`progress` 和三种状态 | 增加目标管理字段和关系表；旧列进入兼容迁移 |
| 审计 | `events`，带 `subject_type/id/title` 和 `change_json` | 所有目标关系、字段和状态变化追加事件 |
| 统一动作 | `src/application/commands/apply-yolo-action.ts` | 扩展 action，HTTP 和模型工具继续复用；提取改为调用同一 application command core |
| dashboard 投影 | `src/application/read-models/dashboard.ts` | 扩展目标摘要和目标详情投影，不让 client 直接查 SQLite |
| client shell | `YoloPanel`、`KanbanView`、`ForegroundContext`、`ChatPane` | 在现有计划 surface 和单前景模型中增加目标详情/推进 |
| 提取链 | `agent/pre-step` → `turn/end`/idle → LLM → `applyExtractionResult` | 保留 direct-human 边界，只收紧目标候选和关系准入 |

### 1.2 当前问题必须被实现覆盖

现有目标卡在 `KanbanView.tsx` 中只展示标题、进度、里程碑点和“放弃”，`YoloGoalRow` 也只投影这些字段。`goals.milestone_id` 只能表达一个里程碑，不能表达目标直接关联多个事项。现有 `setGoalProgress` 在进度达到 100 时自动把目标设为 `achieved`，这与“目标达成必须由用户确认”冲突，必须在迁移实现中改变。

现有提取结果允许新目标携带一个 `milestone_title`，但不会表达目标—事项多对多支持关系；`apply-extraction.ts` 也会直接调用 storage façade。实现时必须保留提取的 direct-human 观察边界，并把已接受结果交给 application command，而不是新增一条旁路写入。

## 2. 领域关系与不变量

### 2.1 对象定义

#### 事项

事项回答“下一件具体要做什么”，状态仍使用 `pending | in_progress | done | cancelled`。一个事项可以不属于任何目标；在本轮中默认一个事项最多有一个主要目标，避免完成、提醒和归属解释冲突。数据库关系表为未来多目标扩展保留，但 application policy 默认拒绝第二个 `primary` 目标。

#### 里程碑

里程碑回答“哪个阶段结果已经成立”，状态仍使用 `planned | active | done | abandoned`。用户可以创建、改名、开始、完成、放弃和设置目标日期。它不是 `todos` 的父表，也不是必须存在的阶段容器；不要求一个里程碑必须有支持事项。

实现上第一阶段不把所有 `milestones` 物理合并到 `todos`，原因是当前提醒、提取、历史和旧库都已依赖独立 `milestones` 表。application/domain 将 `Milestone` 作为“特殊阶段事项”暴露给产品；它沿用独立状态和审计，但不产生子事项树。未来如果要统一物理实体，必须另做迁移评审，不属于本轮。

#### 目标

目标回答“最终想得到什么结果”，是多个事项和可选里程碑的管理集合，不是大号事项。建议状态为：

```ts
type GoalStatus = 'candidate' | 'active' | 'paused' | 'achieved' | 'abandoned'
```

`candidate` 表示模型识别到了可能的长期结果，但用户尚未授权持续跟进；它不进入主动目标提醒。`paused` 表示仍保留但暂不主动回顾。`achieved` 和 `abandoned` 是不同的终态，不能互相伪装。

### 2.2 关系表和关系语义

```text
goals
  ├─ goal_todos ─────── todos       目标直接支持的事项，多个
  └─ goal_milestones ─ milestones   可选阶段结果，多个

goals.next_todo_id ─── goals 关联事项中的一个当前下一步
todos.milestone_id ─── milestones 兼容保留的可选阶段标记
```

推荐新增表：

```sql
CREATE TABLE goal_todos (
  goal_id       TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  todo_id       TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  relation      TEXT NOT NULL DEFAULT 'support', -- support|next
  is_primary    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (goal_id, todo_id)
);

CREATE TABLE goal_milestones (
  goal_id       TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  milestone_id  TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (goal_id, milestone_id)
);
```

目标 current state 增加 `next_todo_id`，并以 `goal_todos` 为约束：它必须为空，或指向同一目标的开放事项。`relation='next'` 是当前下一步的关系标记；实现可以只维护一个 `next_todo_id`，不要同时把两个字段当成独立事实。推荐做法是：`next_todo_id` 是 current-state owner，`goal_todos.relation` 是投影/兼容标记，在同一事务内同步。

不变量：

1. 目标至少可以直接关联零个或多个事项；不能要求先创建里程碑。
2. 事项完成不自动达成目标；所有事项完成也不自动达成目标。
3. 里程碑完成不自动达成目标；它只是可解释的阶段证据。
4. `next_todo_id` 只能指向同 workspace、同目标、`pending` 或 `in_progress` 的事项；事项完成/取消后清空或由用户选择新的下一步。
5. 删除目标关系不删除事项；删除事项时关系由外键清除，目标变为“待补下一步”并追加审计。
6. 目标、事项、里程碑都可以独立存在；关联是管理关系，不改变被关联对象的主体身份。
7. 第一阶段一个事项最多拥有一个 `primary` 目标；重复关联请求必须幂等，冲突时返回 `409`，不能静默覆盖。
8. 跨工作区关系一律拒绝；聚合 dashboard 只做只读聚合，写入仍路由到行自身的 `scope_cwd`。

### 2.3 目标状态与派生关注信号

持久状态只保留 `candidate / active / paused / achieved / abandoned`。以下内容由 read-model 派生，不能写成第二套状态：

- `no_next_step`：active 目标没有开放的 `next_todo_id`；
- `waiting_review`：`next_review_at` 已到；
- `blocked`：用户明确记录了阻塞原因；
- `stale`：超过阈值没有目标事件或关联事项变化；
- `waiting_external`：用户明确表示等待外部结果。

派生信号只用于卡片文案、排序和低打扰关注，不改变目标状态，也不直接生成提醒。

## 3. SQLite current state、迁移和审计

### 3.1 `goals` 字段演进

保留原字段以兼容旧代码和旧库，并增加：

| 字段 | 类型 | owner / 语义 |
|---|---|---|
| `status` | TEXT | 增加 `candidate`、`paused`；旧值原样保留 |
| `completion_criteria` | TEXT | 用户确认的完成标准；可为空，空时 UI 显示“待补充” |
| `target_date` | TEXT | 可选目标日期，日期语义与现有 milestone 日期一致 |
| `next_review_at` | TEXT/INTEGER | 目标下一次回顾时间；建议保存带时区 ISO instant，若产品只给日期则保存本地日结束语义 |
| `next_todo_id` | TEXT | 当前下一步事项；外键可选，业务事务额外校验同 workspace/goal |
| `progress_note` | TEXT | 最近一次用户进度说明的兼容摘要，不替代 event |
| `progress_source` | TEXT | `user_claimed|milestone_evidence|legacy|none`，用于解释百分比来源 |
| `source`、`session_id`、`source_excerpt`、`source_turn` | 兼容 provenance 列 | 首来源投影；完整来源写 `goal_evidence` |

`progress` 暂时保留为兼容字段，但新 UI 不将其作为目标唯一价值；新写入必须携带来源，且 `progress=100` 不再自动修改状态。只有 `achieve` action 才能把状态改为 `achieved`。

### 3.2 provenance 和事件

新增 `goal_evidence` 作为不可变来源链，语义与 `todo_evidence` 一致：

```sql
goal_evidence(
  id, goal_id, source_scope_key, session_id, turn_seq,
  source_kind, relation, excerpt, occurred_at, source_fingerprint UNIQUE
)
```

它是审计 evidence，不是第二份目标事实；目标标题、状态、完成标准和下一步仍只从 `goals`/`goal_todos` current state 读取。

目标相关事件建议新增或规范化为：

| event kind | 触发 |
|---|---|
| `goal_created` | 用户确认创建目标或面板明确创建 |
| `goal_updated` | 修改完成标准、期限、回顾时间、备注或标题 |
| `goal_linked` / `goal_unlinked` | 目标和事项/里程碑关联变化 |
| `goal_next_step_set` / `goal_next_step_cleared` | current next 变化 |
| `goal_reviewed` | 一次回顾产生了进展、阻塞、调整或结束结果 |
| `goal_progress` | 用户明确给出进度；不隐含达成 |
| `goal_status` | candidate/active/paused/achieved/abandoned 变化 |
| `goal_migrated` | 旧字段迁移，只在需要可见审计时使用；默认不进入用户进展白名单 |

每个事件必须带 `subject_type='goal'`、`subject_id`、事件发生时的 `subject_title`、来源和结构化 `change_json`。关系事件的另一侧写入 `related_subject_type/id/title`。同一事务中提交 current state、关系变化、event、evidence 和 idempotency receipt。

### 3.3 旧字段迁移策略

SQLite 迁移继续放在 `src/storage/db.ts` 的 `migrate()`，schema 继续用 `CREATE TABLE IF NOT EXISTS`，不引入独立迁移框架。每一步必须可重入、先检查列/表/索引，再执行。

1. 增加新列：旧 `goals.status` 的 `active|achieved|abandoned` 原样保留；旧 `progress` 原样保留并标记 `progress_source='legacy'`。
2. 创建 `goal_todos`、`goal_milestones`、`goal_evidence` 和索引。关系表的主键保证迁移重复执行不重复关联。
3. 对每个 `goals.milestone_id != NULL` 插入 `goal_milestones(goal_id,milestone_id)`。不删除旧列；旧列在兼容期只读。
4. 对每个旧目标的 milestone，选择 `todos.milestone_id = goals.milestone_id` 的事项插入 `goal_todos`。若一个里程碑被多个目标共用，则每个目标分别获得直接支持关系；不把目标之间互相合并。
5. `next_todo_id` 只在有唯一可解释候选时回填：优先开放且最早 `due_at`，无日期时按 `created_at,id`；若有多个同日候选则保持 NULL，避免迁移替用户做计划。
6. 旧目标没有来源列时不伪造用户摘录；可写 `source='legacy'`，`goal_evidence` 不补造原文。旧 progress 不生成新的 `goal_progress` 用户进展事件。
7. 迁移完成后新 application 不再写 `goals.milestone_id`。读取兼容期可以在关系表为空时 fallback 到该列；每次读取都应以关系表为主，避免双写产生分歧。
8. 迁移异常必须抛错并保留原数据库，不能把关系迁移失败伪装成空目标；migration test 要覆盖重复打开、部分旧数据、悬空外键和锁定错误。

旧 `todos.milestone_id` 不删除。它从“拥有事项的父里程碑”重新命名为“事项的可选阶段标记”，继续支持既有事项编辑和提醒；新目标关联使用 `goal_todos`，不通过 `milestone_id` 间接推断目标。

## 4. Application command 与统一 action 路径

### 4.1 command owner

在 `src/application/commands/` 增加目标领域 command helper，建议拆为：

- `goal-commands.ts`：目标创建、字段更新、关系、下一步、回顾和状态机；
- `apply-yolo-action.ts`：只负责验证 request、路由到 command helper、返回统一 outcome；
- `src/storage/repository.ts`：只实现原子 SQL/repository primitive，不决定产品动作和状态语义。

现有 `Yolo` façade 的 `addGoal`、`applyGoalProgress`、`applyGoalAbandon` 等入口暂时保留，但迁移后只作为 compatibility wrapper，内部必须转给 application owner；新 client、HTTP、tool、extract 不得新增对这些裸 façade mutation 的依赖。

### 4.2 Action contract

扩展 `YoloActionRequest`，保留现有字段并增加可选字段：

```ts
type GoalAction =
  | 'create' | 'update' | 'link' | 'unlink'
  | 'set_next' | 'clear_next'
  | 'review' | 'set_progress'
  | 'activate' | 'pause' | 'resume' | 'achieve' | 'abandon'
```

建议载荷：

```ts
{
  action: 'link', kind: 'goal', id: goalId,
  todo_id: todoId, relation: 'support',
  scope_cwd, client_action_id
}
```

```ts
{
  action: 'review', kind: 'goal', id: goalId,
  note, next_todo_id, next_review_at,
  progress, completion_criteria, status,
  scope_cwd, client_action_id
}
```

由于当前 `YoloActionRequest` 没有 `todo_id`、`next_review_at`、`completion_criteria`、`relation`，它们需要作为版本兼容的可选字段加入 `src/contracts/actions.ts`。不要把整个 goal detail JSON 放进 `note` 再由服务端解析。

所有 action 的处理顺序固定为：

```text
HTTP / yolo_action / accepted extraction / client
  → parse + validate request
  → applyYoloActionInScope
  → applyYoloAction（client_action_id 幂等）
  → goal command helper
  → 一个 workspace UnitOfWork
  → current state + relation + event/evidence + receipt
  → outcome DTO
```

`review` 是一个事务性组合 action：它可以同时记录 note、进度说明、下一步、回顾日期和用户选择的状态，但所有字段仍需逐项校验。这样一次推进不会出现“进度已写入、下一步写入失败”的半状态。

### 4.3 状态机和验证

允许的目标状态变化：

```text
candidate → active | abandoned
active    → paused | achieved | abandoned
paused    → active | achieved | abandoned
achieved  → active       （仅明确 reopen/修订目标时，是否开放由后续产品确认）
abandoned → active       （仅明确恢复，第一阶段可先不开放）
```

第一阶段 UI 直接提供 `推进目标`、`添加下一步`、`设置回顾`、`暂停`、`达成`、`放弃`；`activate` 主要供 candidate 确认使用。`abandon` 必须是次级操作并在 UI 二次确认，不能叫“删除目标”。

action 错误使用稳定 code：`goal_not_found`、`todo_not_found`、`goal_relation_exists`、`goal_relation_conflict`、`next_todo_not_open`、`next_todo_not_linked`、`invalid_goal_status`、`completion_confirmation_required`、`candidate_confirmation_required`、`cross_workspace_relation`。拒绝也继续追加 `action_denied` 审计。

## 5. LLM 抽取与 Goal continuation 边界

### 5.1 不可破坏的 direct-human boundary

继续以 `src/runtime/turn-observation.ts` 的捕获结果为准：

- `agent/pre-step` 只捕获 `message.source.kind === 'user'` 的直接用户消息；
- `source.kind === 'goal'` 的 Goal continuation 即使 `role === 'user'` 也不是 direct-human；
- durable event-log 路径在本轮没有 direct-human capture 时跳过抽取；
- 兼容 fallback 也必须同时要求 `role === 'user'` 和 `source.kind === 'user'`；
- Goal 专属推进会话中的真实用户输入仍会被捕获并允许产生一次提取；自动继续步骤不能产生新目标、事项或关系。

这条边界优先于“目标推进要有对话”。推进 session 的模型输出只能形成建议或回答，不能绕过用户确认写入 current state。

### 5.2 目标创建准入

扩展 extraction contract 时，`ExtractedGoal` 可增加：

```ts
completion_hint?: string | null
management_intent?: 'explicit' | 'inferred' | 'unclear'
goal_title?: string | null // 事项明确声明所属目标时使用
```

application ingestion 的准入规则：

1. 结果信号、持续/多步信号和管理意图明确时，可创建 `active`；完成标准不完整则标记待补充，不阻塞创建。
2. 只有愿望、主题或讨论，没有持续跟进授权时，只创建 `candidate`，不主动提醒、不自动关联事项。
3. 单次动作、带日期提醒和重复提醒规则继续进入 todo/规则，不创建目标。
4. 新目标不得仅因同一轮出现多个事项就自动关联；只有用户明确说“这些事项都是为了这个目标”，或在面板确认后，才创建 `goal_todos`。
5. 已知目标的完成、暂停、进度和阻塞是 `updates[]`，不能在 `goals[]` 重复创建。
6. 模型提出的下一步、目标归属、完成标准和达成结论都是建议，除非 direct-human 文本已有明确授权，必须进入待确认，不直接写入。

### 5.3 已知目标更新

`updates[]` 继续用稳定标题匹配只是现有兼容输入；新增目标动作应尽量在 known context 中提供稳定 id，但模型输出的 id 仍只能作为候选，最终由 application 在同 workspace 校验。`goal` progress update：

- 只接受用户明确陈述的进度和说明；
- 写 `progress_source='user_claimed'`、`progress_note` 和 `goal_progress` event；
- 即使进度是 100，也不自动改为 `achieved`；只有用户明确表达“已达到完成标准/请达成目标”或在 UI 点击“达成”才执行 `achieve`；
- 模型没有候选或匹配不唯一时丢弃 update 并记录 extraction audit，不修改任意目标。

### 5.4 提取写入路径

`applyExtractionResult` 仍由 `src/application/ingestion` 拥有 accepted result 的组合，但不再新增 `yolo.addGoal`/`yolo.applyGoalProgress` 旁路作为业务语义 owner。它应构造带 `source: extraction`、`session_id`、`operation_id` 的 application command，在同一个 workspace transaction 内调用 goal command；todo identity R2a 的独立授权策略仍只管理事项 identity，不能扩展成自动目标关联授权。

## 6. Read-model、DTO 和 HTTP

### 6.1 Dashboard 摘要

`YoloGoalRow` 从只读进度行升级为服务端事实摘要：

```ts
interface YoloGoalRow {
  id: string
  title: string
  description?: string | null
  status: 'candidate' | 'active' | 'paused' | 'achieved' | 'abandoned'
  completion_criteria?: string | null
  target_date?: string | null
  progress?: number | null
  progress_source?: string | null
  next_review_at?: string | null
  next_todo_id?: string | null
  next_todo?: YoloTodoRow | null
  open_todo_count: number
  linked_todo_count: number
  current_milestone?: YoloMilestoneRow | null
  milestone_count: number
  attention?: 'no_next_step' | 'waiting_review' | 'blocked' | 'stale' | null
  source?: YoloItemSource
  sources?: YoloItemSource[]
  updated_at: number
  ws?: WorkspaceTag
}
```

列表只展示摘要；`next_todo` 必须来自服务端关系和事项 current state，client 不按 due date 猜下一步。`progress` 可为空或带 source；历史旧目标的 0% 不应再被 UI 文案解释为“尚未完成 0%”。

### 6.2 Goal detail read model

新增 `application/read-models/goal-detail.ts`，提供单 workspace 的 `buildGoalDetail(yolo, cwd, goalId)`。建议增加薄 HTTP adapter `GET /yolo/goals/:id?scope_cwd=...`，跨 workspace 不在详情 endpoint 扇出；若 dashboard 已包含完整详情，仍由同一 projector 复用内部 builder，不能在 client 复制查询逻辑。

```ts
interface YoloGoalDetail {
  goal: YoloGoalRow
  support_todos: YoloTodoRow[]
  milestones: YoloMilestoneRow[]
  recent_progress: YoloHistoryEvent[]
  history: YoloHistoryEvent[]
  partial?: boolean
}
```

排序固定：开放事项优先、`next_todo_id` 首位、再按 due/updated/id；历史按 occurred_at 降序。关系不存在、事项已终态、来源缺失等情况要用明确的空值/降级，不由 client 猜测。

### 6.3 版本、作用域和失败隔离

dashboard contract 递增到下一版本时，新增字段全部保持向后兼容的 optional；`ui_contract_version` 由服务端发出。所有目标/事项/里程碑行继续带 `scope_cwd` 或 `ws.cwd`，action 以行自身 scope 路由。单 workspace 详情失败只返回该 workspace error；聚合 dashboard 保留其他工作区并标记 partial。

## 7. Client 组件和交互

### 7.1 组件拆分

在现有 `client/panel` 内建议增加：

| 组件/控制器 | 职责 |
|---|---|
| `GoalSurface.tsx` | 目标列表、candidate/active/paused/终态分组和空态 |
| `GoalCard.tsx` | 结果、状态、下一步、回顾日期、唯一主操作 |
| `GoalDetailPanel.tsx` | 目标详情、支持事项、里程碑、完成标准、来源和历史 |
| `GoalReviewDialog.tsx` | 记录进展、阻塞、下一步、回顾和状态的事务性提交 |
| `goal-controller.ts` | detail fetch、action busy/error、refresh、服务端 outcome 应用 |
| `goal-model.ts` | 只放展示纯函数，不生成任何 current state |

这些组件由 `YoloPanel`/`ForegroundContext` 组合；goal detail 是新的单一前景类型，不能和事项 detail、source preview、assistant chat 同时存在。目标推进使用现有 `ChatPane` 的 item/goal episode 能力，目标上下文只包含目标 DTO、开放事项、阶段、最近进展和来源，不读取 resident thread，也不把目标回顾注入普通工作会话。

### 7.2 目标卡

目标列表优先显示：

1. 目标结果；
2. 进行中/待确认/暂停/已达成/已放弃；
3. 当前下一步事项；
4. 下次回顾；
5. 一个主操作：有下一步时“推进目标”，没有下一步时“添加下一步”。

“放弃目标”放在详情更多菜单并要求确认；不显示“进度只读”作为主说明，也不展示所有目标的平均百分比。里程碑以阶段标签/小节显示，不绘制必须经过的任务树。

### 7.3 目标详情和推进

详情顺序：

```text
目标结果与状态
→ 完成标准 / 目标日期
→ 当前下一步
→ 当前里程碑
→ 相关事项（支持事项）
→ 阻塞与等待原因
→ 最近进展及来源
→ 下次回顾
→ 历史变化
```

“推进目标”打开目标专属讨论，首个引导问题是“这个目标现在进展到哪里了？下一步是什么？”。自然语言回复先生成可确认建议；用户确认后，单个 `review` action 事务性提交。纯模型自动继续不产生 extraction；真实用户在该会话中的修改仍按 direct-human 规则处理。

### 7.4 空状态和文案

统一使用用户可理解的产品用语：

- 没有目标：`还没有进行中的目标。明确想在一段时间内达成的结果，并告诉我“帮我持续跟进”，这里会帮你记下。`
- 待确认：`这是一个可能的目标。需要我持续帮你跟进吗？`
- 没有下一步：`这个目标还没有下一步。添加一件要做的事，设置下次回顾，或先暂停目标。`
- 暂停：`目标已暂停，不会主动回顾。需要继续时可以恢复。`
- 没有完成标准：`还没有写清什么算完成，可以之后补充。`
- 没有里程碑：`这个目标暂时没有阶段标记，不影响直接推进事项。`
- 放弃确认：`放弃目标？这只会停止继续跟进，不会删除已记录的事项。`

避免使用“有效投影”“可审计撤销”等内部术语；“放弃”只表示停止追踪，不与事项的“取消”混用。

## 8. 本轮实现与后续能力

### 8.1 本轮应实现

这是可以直接进入研发的最小闭环：

1. 目标可以直接关联多个事项，并在详情中看到支持事项；
2. 里程碑保持独立阶段事项语义，不实现第一阶段子事项容器；
3. 目标拥有完成标准、目标日期、下一步、下次回顾和 `paused/achieved/abandoned` 状态；
4. 目标创建、关联/解除关联、设置下一步、更新进展、回顾、暂停、恢复、达成、放弃全部通过统一 action 和审计；
5. 旧 `goals.milestone_id`、旧 progress 和旧 `todos.milestone_id` 可幂等迁移并兼容读取；
6. dashboard 摘要和目标详情 read-model 由 application 生成，跨 workspace 继续 partial-safe；
7. LLM 目标抽取改为 active/candidate 两道门槛，目标关系和模型建议不绕过用户确认；
8. 计划页目标卡和详情能直接回答“要达成什么、现在到哪、下一步是什么、什么时候再看”。

### 8.2 必须留到后续

- 按事项完成数量自动计算目标进度或自动达成；
- 自动生成完整任务树、复杂依赖、OKR/KR 和资源排期；
- 一个事项同时作为多个目标的 active primary 支持项；
- 里程碑下的子事项容器和多层目标树；
- 无用户授权的目标回顾高频提醒；
- 目标模型自动创建/执行外部 Agent 任务；
- 把独立 `milestones` 物理合并为 `todos` 的大迁移；
- 使用第二个 Markdown/向量/外部数据库作为目标事实源。

## 9. 测试与验收矩阵

### 9.1 单元和存储测试

新增或扩展以下测试，测试应靠近事实 owner：

| 测试 | 必须证明 |
|---|---|
| `goal-relations.test.ts` | 一个目标关联多个事项；关系幂等；解除关系不删事项；next 必须属于该目标且开放 |
| `goal-actions.test.ts` / `storage-actions.test.ts` | action 状态机、事务回滚、receipt、`action_denied` 和事件 change_json |
| `goal-migration.test.ts` / `storage-scope-migration.test.ts` | 旧 `milestone_id` 回填关系、重复迁移无重复、旧 progress/来源不伪造、异常保留原库 |
| `goal-read-model.test.ts` / `dashboard-aggregate.test.ts` | next、计数、里程碑、attention 派生、scope tag、partial 失败隔离 |
| `goal-extraction.test.ts` | active/candidate gate、明确目标关联、模糊愿望不提醒、existing update 不重复创建 |
| `extract-index.test.ts` | 纯 Goal continuation 不抽取；Goal 中真实 direct-human 只抽取一次；兼容 fallback 同样过滤 `source.kind=goal` |
| `goal-history.test.ts` | 状态、关系、回顾和来源事件可追溯，历史标题使用事件时快照 |
| `goal-controller.test.ts` | client 只消费 DTO/outcome，重复 action 不重复提交，detail 错误可恢复 |

已有“进度 100 自动 achieved”的测试必须改成：100% 只更新用户进度，明确 `achieve` 才改变状态；这是本轮有意的产品行为变更。

### 9.2 API E2E

新增 `tests/e2e/api/goal-management.spec.ts`，使用真实宿主、真实 SQLite 和 `[E2E]` 真实用户措辞，至少覆盖：

1. 创建目标，关联至少两条事项，设置一个下一步，GET dashboard/detail 返回关系；
2. 完成下一步后目标仍 active，服务端显示待补下一步，不自动 achieved；
3. `review` 一次提交进展、note、下一步和回顾，事件和 current state 同步；
4. pause/resume/achieve/abandon 的状态语义和重复请求幂等；
5. milestone 可以独立存在，也能关联目标，目标不通过 milestone 才能找到事项；
6. 模糊候选目标不会进入主动提醒；Goal continuation 不增加 extraction/entity；
7. 聚合 dashboard 的目标行带自身 `scope_cwd`，错误 scope 被拒绝，单 workspace 失败保留 partial；
8. 旧数据库迁移后仍能读取旧目标、旧里程碑和旧事项，重复打开不重复关系。

### 9.3 UI / W1–W16 验收

目标页改动触发真实 Edge 和 W1–W16；以下是目标专项断言：

| 场景 | 目标功能验收 |
|---|---|
| W1 | 目标 surface 和 detail 恢复安全；失效 goal id 回到计划目标列表 |
| W2 | 计划仍只有“今天/接下来/目标/全部”；目标列表、candidate 和空态清楚 |
| W3 | 目标中的支持事项完成/推迟/取消仍走事项 action，目标不被误达成 |
| W4 | 从目标添加下一步时回车只创建一次，中文输入法不重复提交 |
| W5 | 目标详情、事项详情、来源和推进 chat 互斥；Esc/返回焦点正确 |
| W6 | 目标状态不只靠颜色；深浅主题、reduced-motion、状态文字可读 |
| W7 | 窄屏目标卡、详情和主操作不遮挡，无横向滚动 |
| W8 | 目标关系、最近进展、来源和改名后的历史稳定可追溯 |
| W9 | 从目标来源/讨论往返普通会话后恢复原目标 surface，不关闭失败前景 |
| W10 | 目标推进 episode 不读取 resident/普通工作会话；目标 A/B 不串上下文 |
| W11 | 首页不因目标数量制造重复首要关注；目标下一步和事项关注按 `(scope,id)` 去重 |
| W12 | 每次目标 action 展示服务端 outcome；回顾失败不伪装成功，状态不靠 optimistic guess |
| W13 | 跨 workspace 目标可读可操作，错误 workspace 不误写同 id 目标 |
| W14 | 目标回顾不抢占前景；若启用后续回顾通知，必须低打扰且不复制事项提醒 |
| W15 | 暂停、达成、放弃在卡片、详情和历史中语义不同；放弃不是删除 |
| W16 | 目标、事项、里程碑关系、来源摘录、事件和 SQLite current state 一致，client 不推断关系 |

完成 UI 后必须使用隔离 `DSH_HOME`、独立端口和官方 dsh host；仅源码单测或 mock browser 不能替代真实 Edge 证据。不能验证的场景必须写明 `SKIP` 原因，不能默认算通过。

## 10. 分阶段提交计划和风险

每个阶段是一个可独立验证、可单独提交的范围；实现时按仓库约定合入本地 `develop`，但本设计阶段不执行提交或推送。

| 阶段 | 代码范围 / 交付 | 主要风险 | 进入下一阶段的门禁 |
|---|---|---|---|
| C0 契约冻结 | domain/contracts、状态机、action shape、migration fixture、测试骨架 | 如果关系和状态未锁定，后续 UI/SQL 会反复返工 | 设计评审通过；关系不变量和旧字段规则有测试 |
| C1 存储与迁移 | schema、`db.migrate`、repository primitives、goal relations/evidence | SQLite 旧库、外键、重复迁移和 Windows 锁 | `pnpm check`、目标存储/迁移单测、`PRAGMA integrity_check` |
| C2 Application command | goal commands、统一 action、receipt、events、compat wrapper | 绕过 application、事务半成功、旧 action 语义回归 | action/transaction 单测、全 `pnpm test:run` |
| C3 Read-model/API | dashboard DTO、goal detail projector、HTTP endpoint、scope/partial | client 依赖存储、跨 workspace 错路由、payload 版本破坏 | `pnpm check`、单测、API E2E、`pnpm build` |
| C4 Extraction | candidate gate、明确关系确认、Goal continuation 回归 | 自动目标污染、source.kind 泄漏、R2a 边界被扩大 | extraction 单测、真实 host extraction/entity/evidence 检查 |
| C5 Client | GoalSurface/Card/Detail/Review、foreground/chat、Mono 文案 | 目标变成项目管理工具、前景串线、乐观 UI 伪造状态 | client 单测、`pnpm build`、受影响 API/UI E2E |
| C6 真机收束 | 隔离 host、Edge W1–W16、失败/恢复和 SQLite 证据 | 旧 host bundle、端口/DSH_HOME 污染、测试 fixture 残留 | W1–W16 按触发范围 PASS/SKIP 记录、无残留、远端 CI |

每阶段提交应只包含该阶段路径，并在提交前保留工作区中协作者的未完成改动。任何阶段都不得创建第二份目标事实、修改 `main`、创建 tag、发布包或推送功能分支；发布相关动作仍需用户单独授权。

## 11. 架构接纳标准

研发可以接纳本方案，前提是实现最终满足：

1. `goals` 是目标 current state，`goal_todos`/`goal_milestones` 是关系事实，`events`/evidence 是追加审计，read-model 不是事实；
2. 所有写入从 application command 进入同一 workspace transaction，HTTP/tool/extract/client 不直接写 repository；
3. 目标直接拥有多个支持事项；里程碑是特殊阶段事项而非第一阶段容器；
4. 目标达成需要用户确认，进度 100 不再自动达成；
5. 旧字段可恢复、可重入迁移，旧数据没有被无证据地改写；
6. LLM 抽取继续只处理 direct-human 输入，Goal continuation 自动消息不会被当成用户授权；
7. UI 让用户首先看到结果、当前下一步和回顾，而不是孤立百分比和“放弃”；
8. 单测、API E2E、真实 Edge/W1–W16 和 SQLite 证据共同证明完成。

不满足任一条时，不应以“代码能编译”作为目标功能完成的判断。
