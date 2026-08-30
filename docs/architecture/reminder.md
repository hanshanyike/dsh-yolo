# `src/reminder/`：提醒与主动投递 adapter

## 职责与边界

reminder 插件负责 scheduler tick、到期扫描、简报组装和向 YOLO resident thread 的最佳努力投递。它不拥有 turn observation、conversation handles 或 snapshot 投影规则。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、配置、scheduler 生命周期；消费 `ctx.yolo.observations/conversations` |
| `scheduler.ts` | reminder/brief tick、安静时段、跨 workspace 扫描 |
| `brief.ts` | 事实收集、确定性 Markdown fallback 与可选 LLM 润色 |

snapshot cadence use case 位于 `src/application/maintenance/snapshots.ts`；reminder 只传入 daily 或 turn signal。

## 提醒流程

```text
scheduler tick
  → durable catalog 的 ready workspaces
  → 每个 workspace 独立读取到期事项
  → due 纯规则 + quiet window
  → 单 workspace 写 notification/event/reminded stamp
  → ctx.yolo.conversations 中同一 resident session 最佳努力 followup
```

跨 workspace 不是一个事务；单 workspace 失败不应撤销其他 workspace 的记录。投递失败也不能撤销已经提交的通知和审计。

## Runtime owner

- 最近真实 cwd 与 completed turn count 来自唯一 `ctx.yolo.observations`。
- `yolo-w-*`/`yolo-a-*` turn 在 provider 边界排除，不推进 snapshot cadence。
- resident Agent handle 来自 `ctx.yolo.conversations`；reminder 不再创建独立 `YoloSessions`。

## 简报与通知语义

早晚报按 ready workspaces 构建一个聚合事实卡，LLM 失败时使用确定性 fallback。通知 `seen_at` 只表示用户是否查看投递；`handled_at` 表示提醒是否已被回应或事项动作消解，两者和事项状态不互相回填。

## 配置与不变量

默认 reminder interval 30 秒、ahead 0 分钟、quiet off；早晚报默认 09:00/21:00。完整 shape 见 [contracts](contracts.md)，运行归一化见 [runtime](runtime.md)。

1. 只向 YOLO resident thread 投递，绝不注入普通工作 session 或 anchored item discussion。
2. quiet window 内不能提前写 reminded stamp。
3. catalog/workspace partial failure 必须可观察。
4. snapshot 是可删除重建的 maintenance projection，不是 reminder current state。
