# 问题定位：时间线事件缺少会话归属，且不可点击

> 状态：已定位，待修复 · 定位时间：2026-08-22 · 由真实使用反馈驱动

## 一、现象

用户在看板「时间线」板块查看事件时：

1. 看不到某条事件（完成/推迟/进度等）**来自哪个会话**；
2. 事件行**不可点击**，无法展开查看详情。

此前沟通中曾说「时间线事件带会话归属，可点开看是哪个会话触发的」——**该说法不成立**。
当时只有存储层落实了会话归属，展示层从未实现。本文档把断点逐一钉死，并给出修复方案。

## 二、证据链（自下而上逐层核对）

### 存储层 —— ✅ 已落实

- `events` 表有 `session_id` 列（`src/storage/schema.sql`）；
- `addEvent()` 写入 `session_id`（`src/storage/repository.ts:307-326`）；
- `listEvents()` 用 `SELECT *` 返回，**结果里其实带着 `session_id`**；
- 实测（2026-08-22，`D:\Code\WorkBuddy\dsh-yolo\.dsh\yolo\yolo-decf873e665c_main.db`）：

  | 事件 | session_id |
  |---|---|
  | `todo_completed` 完成：整理 E2E 测试记录 | `session-563bea0c-3129-4f2d-…`（chat `yolo_action` 路径触发） |
  | `todo_postponed` / 其余 `todo_completed` | `null`（看板按钮触发，无会话上下文） |
  | `note` 下周三出差做汇报 | `null`（提取路径触发，不传会话） |

### 投影层 —— ❌ 断点 1：字段被丢弃

`src/ui/dashboard.ts:59-64`（GET /yolo/dashboard 的组装处）：

```ts
events: yolo.listEvents(cwd, 30).map((e) => ({
  id: e.id,
  kind: e.kind,
  summary: e.summary,
  occurred_at: e.occurred_at,   // ← session_id、detail 都没有透传
})),
```

### 共享契约层 —— ❌ 断点 2：类型没有这个字段

`src/shared/dashboard.ts` 的 `YoloEventRow` 只有 `{ id, kind, summary, occurred_at }`，
`session_id`、`detail` 均不在契约内——即使投影想传，类型也不允许。

### 客户端 —— ❌ 断点 3：无渲染、无交互

`client/sidebar/YoloSidebarDashboard.tsx` 时间线行只渲染「类型徽标 + summary + 时间」，
没有会话信息，也没有任何点击处理。

### 归属数据本身 —— ⚠️ 断点 0：大部分事件本来就是 null

`session_id` 目前只有一条路径会写入：chat 中 `yolo_action` 工具调用（从 ToolRunContext 取
`agent.session`）。其余两条高频路径都不写：

- **提取路径**（LLM 从对话中发现状态变化 → `applyTodoAction`）：不传 `session_id`；
- **看板路径**（POST /yolo/actions）：无会话上下文，天然为 null（合理）。

即：打通展示层之后，大部分事件的归属仍是空的——**归属的采集面也要补**。

## 三、根因归纳

会话归属在上一轮交付中只完成了「存储 + 审计」半程，没有走完「投影 → 契约 → 渲染 → 交互」
的下半程；同时提取路径的归属采集缺失。属于典型的**能力落地在数据层止步**，沟通口径又
超前于实现，放大了落差。

## 四、修复方案

按依赖顺序，四步走（P0 = 本周内）：

| # | 层 | 改动 | 优先级 |
|---|---|---|---|
| 1 | 契约 | `YoloEventRow` 增加 `session_id?: string \| null` 与 `detail?: string \| null`（detail 顺带打通，见下） | P0 |
| 2 | 投影 | `src/ui/dashboard.ts` 事件映射透传 `session_id`、`detail` | P0 |
| 3 | 客户端 | 时间线行尾渲染归属徽标（有 `session_id` 时显示「会话」小标签 + 短 id）；**点击行展开详情浮层**：完整 summary、detail、kind、时间、会话 id（可复制） | P0 |
| 4 | 采集 | 提取路径（`mergeExtraction` 应用 updates 时）透传当前会话 id——LLM 发现的状态变化也应有归属 | P1 |

补充说明：

- **会话 id 人类可读化**是加分项：宿主若提供会话元数据 API（title/首条消息），客户端可
  显示「会话：出差安排…」；没有就显示短 id。第一步先不做，避免依赖宿主未验证的接口。
- `detail` 字段（事件的补充说明）与 `session_id` 同样卡在投影层，修复成本为零，一并打通。

## 五、验收标准

1. 在 chat 会话里对某待办执行 `yolo_action(complete)`；
2. 打开看板 → 时间线该「完成」事件带会话徽标；
3. 点击该行 → 浮层显示：事件类型、完整 summary、时间、会话 id；
4. 经由看板按钮完成的事件 → 无徽标（归属为空是诚实的）；
5. 单测覆盖：投影包含 `session_id`/`detail` 字段；提取路径事件带会话 id。
