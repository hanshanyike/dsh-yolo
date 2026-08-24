# `src/reminder/`：提醒、简报与快照调度

## 职责与边界

该插件扫描所有已登记工作区的到期 todo，生成通知卡并最佳努力投递到对应工作区的 YOLO 常驻
线程；同时调度早晚简报和 turn/daily 快照。它绝不把提醒注入普通工作会话。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、真实工作区跟踪、resident thread 投递、turn 快照和调度器生命周期 |
| `scheduler.ts` | reminder/brief tick、安静时段、运行时配置解析和 interval |
| `brief.ts` | 早晚报事实收集、Markdown fallback 与可选 LLM 润色 |

## 提醒流程

```text
scheduler tick
  → listWorkspaceMeta() 遍历全部已知工作区
  → 按 cwd 解析该工作区当前 scope
  → listTodos(cwd) 读取 open + 未提醒候选
  → shared/due 按精确到期时刻和 ahead window 过滤
  → 安静时段：保留未提醒状态，离开窗口后再触发
  → addNotification + reminder_fired event + setTodoReminded
  → 最佳努力 followup 到该工作区 yolo-w-* 常驻线程
```

通知卡与审计写入是保底结果；resident thread 创建或 `followup` 失败不能撤销卡片，也不能使
调度 tick 整体失败。提醒文本只携带用户可读的标题和到期时间；处理指引位于 memory 模块的
`yolo-instructions`，用户在面板对话里可以自然回复完成、推迟或再次提醒，由模型按标题调用统一
`yolo_action`。

到期比较不交给 SQLite 文本排序：date-only todo 在本地当日结束时到期，无时区 datetime 使用本地
精确时刻，带 `Z`/offset 的 datetime 使用其绝对时刻。`last_reminded_at` 防止重复；
`reminder.aheadMin` 当前默认 0，即到点触发，不是旧文档中的 60。

## 简报

调度器按分钟检查本地时间，并用 brief stamp 保证 morning/evening 每个本地日最多各生成一次。
事实来自存储查询；配置了 LLM 时可润色，失败则使用确定性的 Markdown fallback。简报和提醒一样
只进入通知卡与 YOLO 常驻线程。

## 快照

- `storage.snapshotInterval = daily`：调度器每天写一次日期快照并记录 meta stamp。
- `every_10_turns`：每 10 个真实工作会话 turn 写时间戳快照。
- YOLO resident/anchored thread 的 turn 不计入工作会话快照节奏，也不会改变 latest cwd。

## 配置

| 键 | 当前默认值 | 说明 |
|---|---:|---|
| `reminder.enabled` | `true` | 提醒扫描开关 |
| `reminder.checkIntervalSec` | `300` | interval 在插件启动时确定 |
| `reminder.aheadMin` | `0` | 提前量；0 为到点触发 |
| `reminder.quietHoursEnabled` | `false` | 安静时段开关 |
| `reminder.quietStart` / `quietEnd` | `22:00` / `08:00` | 支持跨午夜窗口 |
| `brief.enabled` | `true` | 简报开关 |
| `brief.morningTime` / `eveningTime` | `09:00` / `21:00` | 本地触发时间 |
| `brief.model` | `deepseek-chat` | 可选润色模型 |

除 interval 外，ahead、enabled、quiet 与 brief 配置在 tick 时读取，设置修改无需重启即可影响
下一轮。完整 schema 见 [看板服务端配置](ui.md#配置)。

## 不变量

1. 每个 tick 必须扫描全部已知工作区，不能只扫 latest cwd。
2. 只向 `yolo-w-*` 常驻线程投递，绝不向普通工作会话或 anchored 临时对话投递。
3. 安静时段内不能设置 `last_reminded_at`，否则离开窗口后会丢提醒。
4. 投递失败不影响通知卡、审计事件和去重盖章。
5. 当前 scheduler 只按 registry 中的 cwd 扫描，并未用其中的 scope key 调用 `runInScope`；分支在
   登记后、扫描前发生切换时会按当前分支重新解析，这是现行限制。
