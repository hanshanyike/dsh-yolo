# M8 设计文档 · Phase 1 Organizer（组织）

> 状态：✅ 已交付（2026-08-22，提交 0da3136 → 2d2f49a）
> 对应愿景：[VISION.md](VISION.md)「能力弧线」第二级 **组织** —— *把记住的事整理成一份有状态的计划（谁在做、到哪了、卡在哪）*，以及「产品形态」中的 **提醒即对话，可就地操作**。
> 上游调研：宿主平台已验证 `ctx.webServer` 支持 POST（handler 收到完整 `(req, res)`，自行判断 method）、`ctx.agents.create()` 可编程创建会话（本期不用，留给 Phase 2）。

## 一、背景：Keeper 留下的四个缺口

Phase 0（Keeper）交付了"记得"：LLM 语义提取 + SQLite/FTS 存储 + 到期提醒 + 全局看板。对照 Organizer 的目标，当前实现有四个明确缺口：

| # | 缺口 | 现状证据 |
|---|---|---|
| G1 | **任务状态不流转** | 用户在后来说"X 做完了"，`mergeExtraction` → `upsertTodo` 只更新 due/priority/detail/milestone 四个字段，**status 永不变化**；已完成的任务仍会被提醒 |
| G2 | **目标进度不动** | `goals.progress` 恒为 0——`setGoalProgress` 全库唯一调用方是 `memory_forget`（重置为 0）；提取 prompt 根本不产出进度 |
| G3 | **提醒不可回复** | 提醒只是一条裸文本 `⏰ 提醒: …`；用户回复"推迟到明天"后，agent 没有任何工具能把这条待办改期（存储层连 postpone 操作都没有） |
| G4 | **看板只读 + 计划散落** | 看板是纯只读 JSON 投影；`mergeExtraction` 丢弃 LLM 产出的 `milestone_title`，milestone↔todo/goal 的计划层级实际从未建立；也没有"卡在哪"（逾期/滞留）信号 |

另有一项 Phase 1 目标已由 Keeper 交付：**偏好生效**（preferences 注入 systemPrompt 常驻区 + 置信度递增），本期不做新工作，仅在文档中确认归属。

## 二、方案总览

四条主线，全部落在既有插件接缝上，零新增插件、零新增配置项、零 schema 迁移（`events.kind` 无 CHECK 约束，可直接扩展）：

```
                ┌──────────── 提取层（extract）────────────┐
                │ prompt 新增 updates[] 输出（状态变化）     │
                │ known digest 升级：带 status/progress/due │
                │ merge：milestone_title 关联 + 状态应用     │
                └──────────────┬───────────────────────────┘
                               ▼
┌── 存储层（storage）──────────────────────────────────────────┐
│ 领域动作门面 applyTodoAction / setGoalProgressEx 等：          │
│ 状态迁移 + due_at 改期 + 重提醒戳 + 【事件审计】               │
│ findTodoByTitle / findGoalByTitle / findMilestoneByTitle 模糊匹配 │
└──────┬───────────────────────┬───────────────────────────────┘
       ▼                       ▼
┌── 交互层 A（memory+reminder）┐  ┌── 交互层 B（ui+client）──────┐
│ yolo_action 工具（模型可见）  │  │ POST /yolo/actions（HTTP）   │
│ 提醒文本带 id+操作指引        │  │ 看板就地操作按钮 + 计划视图    │
│ → 提醒即对话，可回复          │  │ → 看板从只读变为可操作        │
└─────────────────────────────┘  └──────────────────────────────┘
```

三个入口（提取层自动流转、会话内自然语言回复、看板点击）汇聚到**同一套存储层领域动作**，每个动作写一条时间线事件——这就是"到哪了"的可审计答案。

## 三、详细设计

### 3.1 存储层：领域动作与事件审计

**新事件种类**（扩展 `EventKind`，schema 无需迁移）：

```ts
export type EventKind =
  | 'note' | 'decision' | 'milestone_reached' | 'reminder_fired'   // 既有
  | 'todo_completed' | 'todo_cancelled' | 'todo_postponed'          // 新
  | 'todo_remind_again' | 'goal_progress' | 'milestone_status'      // 新
```

**新领域动作**（`src/storage/repository.ts` + `Yolo` 服务门面，全部同步写事件）：

| 动作 | 行为 | 事件 |
|---|---|---|
| `completeTodo` | status→done, completed_at=now, FTS 软删 | `todo_completed` |
| `cancelTodo` | status→cancelled, FTS 软删 | `todo_cancelled` |
| `postponeTodo(id, due_at)` | due_at 覆写 + **清空 last_reminded_at**（允许再提醒） | `todo_postponed` |
| `remindAgainTodo(id)` | 仅清空 last_reminded_at（下个调度 tick 重新触发） | `todo_remind_again` |
| `setTodoDue` | （提取路径）改期且不写提醒戳 | 复用 `todo_postponed` |
| `setGoalProgressEx(id, progress, note?)` | 进度 0-100 钳制 + ≥100 自动 achieved | `goal_progress` |
| `setMilestoneStatusEx(id, status)` | 状态迁移 + FTS 软删 | `milestone_status` |

服务层统一入口（三个调用方共用，保证审计一致）：

```ts
yolo.applyTodoAction(cwd, id, action: 'complete' | 'cancel' | 'postpone' | 'remind_again', args?: { due_at?: string }): Todo | null
yolo.applyGoalProgress(cwd, id | title, progress: number, note?: string): Goal | null
yolo.applyMilestoneStatus(cwd, id, status: MilestoneStatus): Milestone | null
```

**标题模糊匹配**（供提取层与 yolo_action 工具在无 id 时定位条目）：`findTodoByTitle` / `findGoalByTitle` / `findMilestoneByTitle` —— 归一化标题精确匹配优先，其次双向包含（要求被匹配方 ≥ 4 字符防误伤），仅在非终态（todo: pending/in_progress）中查找。

### 3.2 提取层：状态变化提取（G1 + G2）

**prompt 输出 schema 新增 `updates` 数组**：

```json
{
  "updates": [
    { "kind": "todo",      "match_title": "写季度报告初稿", "status": "done",  "due_at": null, "note": null },
    { "kind": "goal",      "match_title": "学会 Rust",      "progress": 40 },
    { "kind": "milestone", "match_title": "v0.3 发布",      "status": "done" }
  ]
}
```

prompt 规则要点：
- `todos[]` 只放**新**条目；对已知条目的状态/进度/改期变化一律走 `updates[]`；
- `match_title` 必须照抄 Known memories 中的标题（去重摘要会带出状态）；
- 触发信号：完成/开始/放弃某任务、目标进度陈述（"写了一半"→50）、日期推迟、里程碑达成。

**known digest 升级**（`buildKnownContext` 输入带状态）：

```
Todos: [pending] 写季度报告初稿 (due 2026-08-22) | [in_progress] 修复登录 bug
Goals: [35%] 学会 Rust | [0%] 完成论文初稿
Milestones: [active] v0.3 发布 (target 2026-09-01)
```

**merge 顺序**：先 upsert 新条目（同时用 `milestone_title` 解析并回填 `milestone_id`，修复 G4 的关联断裂），**后**应用 updates（同轮"新建即完成"的次序问题由此解决）。updates 应用时按标题模糊匹配定位，匹配不到静默丢弃（记 debug 日志，不报错——LLM 幻觉标题是常态而非异常）。

**校验**：`validateExtraction` 对 updates 做种类/字段强转与白名单校验，非法条目剔除而非整体失败。

### 3.3 交互层 A：可回复的提醒（G3）

**新模型工具 `yolo_action`**（`src/memory/tools.ts`，与既有 4 工具并列）：

```
参数：action (complete|cancel|postpone|remind_again|set_progress)
      kind (todo|goal|milestone), id?, title?, due_at?, progress?, note?
语义：id 缺失时按 title 模糊匹配；返回 { ok, item } 或 { ok:false, error }
```

**提醒文本升级**（`reminderText`，注入与 pending 队列共用）：

```
⏰ YOLO 提醒：写季度报告初稿（到期 2026-08-22）
（待办 id: 9f3c…）
用户可能会就此回复「已完成 / 推迟到明天 / 再提醒我一次」。此时请调用 yolo_action：
- 已完成 → action=complete, kind=todo, id=<上面的 id>
- 推迟到X → action=postpone, kind=todo, id=…, due_at=解析出的绝对日期
- 再提醒 → action=remind_again, kind=todo, id=…
操作成功后向用户简短确认，不要展开多余解释。
```

这是"提醒即对话"的落地：提醒消息自带路由指引，agent 拿着工具就能就地兑现用户的自然语言回复。注入路径不变（`agent.inject` + `followup`）。

> **交付修正**：实测发现 `inject()` 只驻留上下文不唤醒 driver、裸 `followup()` 会抛异常，
> 最终实现改为**单个 `agent.followup(msg)`**（见 architecture.md 已验证平台行为）。

### 3.4 交互层 B：看板就地操作与计划视图（G4）

**HTTP**：`POST /yolo/actions`（`src/ui/actions.ts`，prefix 路由 `/yolo/actions`）：
- body：`{ action, kind, id?, title?, due_at?, progress?, note? }`（≤ 64KB，JSON 解析失败/未知动作 → 400 + JSON error）
- 响应：`{ ok: true, item }` / `{ ok: false, error }`

**看板数据升级**（`YoloDashboardData`，加法式扩展）：
- `YoloTodoRow` 增 `milestone_title`、`updated_at`、`overdue`（due_at < 今天且未完成）、`stale`（pending 超 7 天未更新）
- `YoloGoalRow` 增 `milestone_title`
- events 行原样透传新 kind，时间线自然成为"状态流转日志"

**客户端**（`YoloSidebarDashboard.tsx`）：
- 每条未完成待办：`✓ 完成` `⏰+1d` `✕ 取消` 三个操作按钮 → POST → 成功后立即刷新（失败内联提示）
- 待办行：状态徽章、逾期红色高亮、滞留灰色提示、里程碑标签
- 目标行：进度条；"进行中的目标"区按里程碑分组
- 操作互斥：请求期间按钮禁用，防止重复提交

## 四、明确不做的（Scope 边界）

- **不创建 YOLO 独立 agent 会话**（`ctx.agents.create` 已验证可行，但专属会话是后续"提醒型对话"的核心命题，本期注入路径已满足"可回复"）
- **不做语义/向量检索**（路线图"下一步"）
- **不做跨工作区聚合**（路线图"下一步"）
- **不加新配置项**（可回复提醒是本体能力，非开关功能）
- **不做 goal 进度的看板手动编辑**（进度来源=对话提取 + 工具/API，避免玩具化交互）

## 五、测试计划

**单元（新增/扩展）**：
| 文件 | 覆盖 |
|---|---|
| `storage-actions.test.ts` | 领域动作的状态迁移、FTS 软删、事件写入、标题模糊匹配边界 |
| `extract-updates.test.ts` | prompt 含状态摘要；validateExtraction 对 updates 的强转；mergeExtraction 应用 updates + milestone 关联 |
| `tools-action.test.ts` | yolo_action 注册与全部分支（含 title 匹配、not-found） |
| `ui-actions.test.ts` | POST 路由：正常/坏 JSON/未知动作/not-found |
| `shared-dashboard.test.ts` | overdue/stale/milestone_title 投影 |

**端到端**（`scripts/dev.mjs` 起真实宿主，含真实 LLM 提取）：
1. 会话 R1：交代带截止日的任务 + 一个目标 → 验证入库；
2. 会话 R2：陈述"已完成/进行中/推迟" → 验证状态迁移 + 事件时间线；
3. 看板：curl `POST /yolo/actions` 完成/推迟任务 → GET 验证数据与操作结果一致；
4. 提醒链路：造到期任务、缩短调度间隔 → 验证带 id 的提醒注入 → 以"推迟到明天"回复 → 验证 due_at 变化与事件；
5. 回归：既有用例全绿（交付时 20 文件 / 175 用例）、`tsc --noEmit` 干净。

## 六、实施顺序与提交切分

| 步 | 提交 | 内容 |
|---|---|---|
| 0 | `docs: M8 design` | 本文档 |
| 1 | `feat(storage): domain actions` | §3.1 + `storage-actions.test.ts` |
| 2 | `feat(extract): state-change updates` | §3.2 + `extract-updates.test.ts` |
| 3 | `feat(memory+reminder): reply-able reminders` | §3.3 + `tools-action.test.ts`、reminder 文本测试 |
| 4 | `feat(ui+client): in-place dashboard actions` | §3.4 + `ui-actions.test.ts`、投影测试 |
| 5 | E2E 验证 | §五（发现问题随修随提交） |
| 6 | `docs: M8 shipped` | README/VISION/architecture/modules/usage/CHANGELOG；版本 `0.3.0-alpha.1`（依 release.md「M8 → 0.3.0」；稳定版 0.2.0 的正式发布仍按发布流程单独执行，不在本次自动化范围） |
