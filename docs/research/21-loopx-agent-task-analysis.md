# LoopX 对 YOLO dsh Agent 任务的机制借鉴分析

> 调研日期：2026-08-30
> LoopX 基准：[huangruiteng/loopx@017df081](https://github.com/huangruiteng/loopx/tree/017df081e5cb665bd84ed3c920ee4fb40c3c8cec)
> dsh 基准：本项目锁定的 `@deepseek-ai/dsh-* 0.1.1-rc.2` 公开类型与说明
> 结论适用范围：YOLO 对 **deepseek-harness 宿主内 Agent 任务**的观察、跟进、结果承接和用户验收；不管理外部 Agent，也不在 YOLO 内编排执行。

## 一、结论先行

YOLO 的 Agent 任务来源只有 deepseek-harness（下文简称 dsh）。它不是一个外部 Agent 聚合器，不需要 source adapter、connector、跨来源同步或外部任务身份映射。

LoopX 对 YOLO 最有价值的部分，是它把长期 Agent 工作拆成稳定身份、当前状态、事件证据、用户注意力和结果验收；不应借鉴它的自动唤醒、额度、租约、改派和执行调度。

结合 dsh 当前契约，YOLO 应先区分两种原生对象：

1. **one-shot 后台 Agent 任务**：由 `ctx.jobs` 承载，具备 Job id、`running/stopping/completed/killed/failed` 生命周期，并通过 `subagent/start`、`subagent/end` 与一次子 Agent run 和可选子 Session 关联。
2. **continuable 子 Agent**：拥有持久化 Session，可经历多次 Activation，但 dsh 明确不为它创建 Task 或结果 promise。它是可继续的 Agent 会话，不应伪装成 one-shot Job。

建议 P0 先管理 dsh 的 **Job-backed one-shot Agent 任务**：在 YOLO 中提供独立任务入口和当前状态。当前公开契约尚未给出 `JobView.id` 与 `subagent runId/child SessionId` 的强关联字段；结果摘要、子 Session 跳转和用户验收必须在 dsh 补齐 typed correlation 后进入 P1，不能用 label 或时间近似拼接。P2 再把 continuable 子 Agent 作为另一种任务形态接入，但保留其“持久会话 + 多次运行时段”的真实语义。

核心原则是：**dsh 拥有运行生命周期真相，YOLO 只生成管理投影和本地验收事实。**

## 二、边界修正

本报告不再采用以下假设：

- 不接入 Codex、Claude、GitHub Actions 或其他外部 Agent 平台；
- 不建立 `AgentSourceAdapter`、`source_id`、`external_task_id` 或跨来源 cursor；
- 不讨论外部 API webhook、connector capability 或多来源身份合并；
- 不让 YOLO 启动、改派、续跑或调度 dsh Agent；
- 不把普通 dsh 会话、YOLO anchored chat 或 todo 当成 Agent 任务。

YOLO 的职责是把 dsh 已有 Agent 任务变成用户可管理的状态收件箱：看清哪些任务正在运行、哪些已经结束、结果是什么、是否需要用户处理，以及相关子 Agent 会话在哪里。

### 2.1 对用户来说，两种 Agent 任务有什么区别

用户真正需要理解的只有一个问题：**这件事做完后，我还能不能回到同一个 Agent 继续交代？**

| 用户看到的形态 | one-shot 后台 Agent 任务 | continuable 子 Agent |
|---|---|---|
| 产品文案建议 | 一次性任务 | 可继续任务 / 长期 Agent |
| 用户意图 | “把这一件事做完，把结果交回来” | “你长期负责这件事，我之后还会继续找你” |
| 例子 | “调研 LoopX 并给我一份报告” | “长期跟进 UI 质量，我会持续补充要求” |
| 一次工作结束后 | 任务进入 completed/failed/killed 等终态；要继续通常是新任务 | Agent 变成 inactive/待命，原 Session 和上下文仍在，可继续发送下一条要求 |
| 运行记录 | 一项 Task 通常对应一次 run 和一个结果 | 一个持久任务容器下可有多次 Activation/turn run |
| 用户主要动作 | 看状态、看结果、验收 | 看状态、继续交代、查看历次运行；必要时中断当前轮次 |
| “没有在跑”意味着 | 已结束或正在停止，需要看终态 | 可能只是当前空闲，不能显示成“已完成” |

两者可以放在同一个「Agent 任务」一级页面，但必须有清晰类型标识和不同状态文案。界面不需要把 `one-shot`、`continuable`、`Activation` 这些底层术语强塞给用户；可以分别显示为「一次性任务」和「可继续任务」。

本报告建议先做 one-shot，不是因为它更重要，而是因为它已有明确 Job 生命周期，最容易形成可信的“运行中 → 已结束 → 看结果 → 验收”闭环。continuable 的价值更大，但它需要产品先定义“什么时候算任务完成”，不能把 Agent 暂时 inactive 当成完成。

## 三、dsh 当前可依赖的事实

### 3.1 Job 是宿主内后台任务事实源

`@deepseek-ai/dsh-jobs` 的 `JobRegistry` 提供：

- `start/get/list/read/kill/wait`；
- `onJobDone` 终态观察；
- `onJobsChanged` 可见集合变化观察；
- owner Session 隔离；
- 首次终态优先、取消、等待和资源清理。

浏览器安全的 `JobView` 已包含：

```text
id / kind / label / status / detail / startedAt / finishedAt
```

其中 `status` 为：

```text
running | stopping | completed | killed | failed
```

Host 通过 `session/jobs` frame 推送某个 Session 当前可见的完整 Job 集合。它是用于多标签页、重连和状态变化收敛的全量快照，而不是追加事件。

但 Job registry 是 **进程局部** 的，不保存持久化 Job 历史。宿主重启后任务从 registry 消失，不能据此推断为 `completed`。这决定了 YOLO 必须明确区分“运行时当前可见”和“基于持久化子 Session 恢复出的历史记录”。

### 3.2 one-shot 后台子 Agent 同时具有 Job、run 和可选 Session

`@deepseek-ai/dsh-subagent` 的一次性后台委派使用普通 Job 承载结果。dsh 发布成对生命周期事件：

```text
subagent/start
  runId / provider / id(child SessionId) / local

subagent/end
  runId / provider / id(child SessionId) / local
  stopReason / lastAssistantMessage?
```

已知 `stopReason` 包括：

```text
completed | aborted | error | max-tokens | refusal
```

`SubagentRun.result` 还可提供结构化结果和经过边界约束的 diagnostic。对本地 session-backed run，run 的 `id` 等于 child Session id；远程 provider 可返回 parent 作用域内的 run id，且没有 `localAgent`。

Job 给出后台任务生命周期，`subagent/start/end` 给出 Agent run 的精确配对和终止原因，child Session 提供完整对话与工具历史。但当前公开 `JobView` 不携带 `subagentRunId` 或 `childSessionId`，`SubagentRunInfo` 也不携带 `jobId`。因此这三块事实目前不能由 YOLO 可靠 join：label、startedAt 或同一 owner 只能用于展示，不能成为身份关联依据。

富任务详情需要 dsh 新增一个 browser-safe、typed correlation，例如：

```text
parentSessionId / jobId / subagentRunId / childSessionId / mode
```

该关联应由创建 Job 的 one-shot 后台委派边界一次性产出，而不是由 YOLO 监听两个独立事件后猜测。

### 3.3 continuable 子 Agent 不是 Job-backed Task

dsh 的 continuable 子 Agent：

- 具有持久化 child Session id 和必填 label；
- 可通过 `SubagentsApi.list()` 在不加载 Agent 的情况下枚举；
- `activity` 只有 `running/inactive`，inactive 不等于完成；
- 可冷恢复并接受后续 FIFO prompt；
- 每个驻留 Activation 可产生一对 `subagent/start/end`；
- 没有 Task、没有一次性的结果 promise、也没有 Task cancellation。

客户端安全投影还提供 `subagentTiming`：已结算轮次累计时长，以及当前活跃轮次的 `since/through`。

因此 continuable 子 Agent 若进入 YOLO，应建模为“一个持久 Agent 任务容器 + 多次运行时段/轮次”，不能套用 one-shot Job 的 `completed/killed/failed` 终态。

### 3.4 当前 YOLO 尚未接入这些能力

现状检查：

- [存储 schema](../../src/storage/schema.sql) 没有 dsh Agent task、Job、subagent run、子 Session 映射或验收表；
- [面板导航](../../client/panel/navigation.ts) 只有首页、计划、历史，没有 Agent 任务入口；
- [YOLO 会话服务](../../src/ui/session.ts) 只管理 YOLO 自己的 resident/anchored 对话；
- [看板服务端契约](../architecture/ui.md) 没有 dsh Agent task 列表、详情或验收端点；
- [产品愿景](../VISION.md) 仍明确 Agent 任务属于后续协同阶段，当前不能把普通 Agent 会话冒充为任务。

## 四、LoopX 可借鉴机制及 dsh 化改造

### 4.1 稳定身份，但以 dsh 原生身份为准

LoopX 用稳定 goal/todo 身份把长期工作与单次运行分开。YOLO 应借用这种层级意识，但不创造一套与 dsh 冲突的身份。

推荐映射：

```text
dsh parent Session
├─ one-shot Agent Task
│  ├─ dsh Job id
│  ├─ subagent runId
│  └─ child SessionId（存在时）
└─ continuable Agent Task
   ├─ durable child SessionId
   └─ Activation / turn runs[]
```

本地 `task_id` 只是 YOLO 的稳定主键，必须可追溯到 dsh 身份：

- one-shot P0：绑定 `parentSessionId + hostGeneration + jobId`，表示当前宿主生命周期内的 Job；
- one-shot P1：dsh 提供 typed correlation 后，再把 `subagentRunId` 和 `childSessionId` 绑定到同一 task；
- continuable：绑定 `parentSessionId + childSessionId`；
- Job id 是进程局部 `<kind>-N`，不能脱离 parent Session 和 host lifecycle 独立作为跨重启身份；
- `jobId ↔ runId ↔ childSessionId` 只能通过 dsh 明确关联，不能按 label、时间窗口或 owner 下唯一任务推断；
- 标题、label 或描述永远不能用于合并任务。

**借鉴结论：P0 必做。**

### 4.2 只读管理投影，不复制 dsh 状态机

LoopX 的 [`agent_management_projection_v0`](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/reference/protocols/agent-management-projection-v0.md) 明确 `mode=read_only`、`projection_is_writable=false`。它把运行、等待、阻塞、证据和下一动作投影给操作者，但不让看板成为另一个 dispatcher。

YOLO 应采用同样边界：

- `JobView.status`、`SubagentRunEndInfo.stopReason`、child Session 活动和投影 seq 来自 dsh；
- YOLO 只增加 `seen_at`、注意力判断、与计划事项关联、用户验收和提醒状态；
- dsh 与 YOLO 字段冲突时，以 dsh 当前事实为准，并记录投影时间；
- P0 不提供启动、kill、interrupt、prompt 或 followup；任务详情只读。child Session 跳转在 typed correlation 可用后进入 P1。

**借鉴结论：P0 必做。** 这是“管理而非代办”的实现边界。

### 4.3 当前快照、持久历史和管理事件分层

LoopX 区分当前 status、run history 和追加证据账本。YOLO 也需要分层，但事件来源固定为 dsh：

```text
session/jobs 全量快照 ───────────────┐
dsh typed task correlation ──────────┼─▶ dsh task projector
subagent/start + subagent/end ───────┤        │
child Session descriptor/projection ─┘        │
                                              ├─ 当前任务状态
                                              ├─ run / Session 关联
                                              ├─ 用户注意力投影
                                              └─ 本地管理事件与验收
```

这里有两类数据：

1. **dsh 运行事实**：Job 快照、subagent lifecycle、Session descriptor 和投影 watermark；
2. **YOLO 管理事实**：已读、关联、提醒、验收、用户反馈。

YOLO 可以持久化 dsh 观察摘要以支持历史界面，但不能把该副本声明为 dsh 执行真相。Job 从新快照消失时，应先标为 `not_observable`；只有 typed correlation 已建立时，才可尝试通过 child Session 和 `subagent/end` 恢复。没有强关联或终态证据时保持 unknown，而不是补写 completed。

**借鉴结论：P0 必做。**

### 4.4 拆分运行、结果、注意力、验收和可观察性

一个 `status` 无法同时表达 dsh 运行状态和用户管理状态。推荐五条状态轴：

| 状态轴 | 建议值 | 权威来源 |
|---|---|---|
| `runtime_status` | `running/stopping/inactive/not_observable` | Job、Subagent catalog |
| `result_status` | `pending/completed/killed/failed/aborted/error/max_tokens/refusal/unknown` | Job outcome、`subagent/end` |
| `attention_kind` | `none/review_result/retry_decision/source_unavailable/stale` | YOLO 规则 + dsh 事实 |
| `acceptance_status` | `not_required/pending/accepted/rejected` | YOLO / 用户 |
| `observation_status` | `live/persisted/degraded/unavailable` | dsh registry、Session persistence、projection watermark |

重要组合：

- `result_status=completed + acceptance=pending`：Agent 已完成，用户尚未验收；
- `runtime_status=inactive + result_status=pending`：continuable child 当前空闲，不代表任务完成；
- `runtime_status=not_observable + result_status=unknown`：宿主重启或记录缺失，不能补写失败或成功；
- `result_status=max_tokens/refusal`：输出可能部分可用，但必须提示用户决定后续处理。

**借鉴结论：P0 必做。**

### 4.5 以用户注意力组织列表

LoopX 的 attention queue 把“谁需要行动”从普通运行状态中拆出。YOLO Agent 任务建议分为：

1. **需要你处理**：验收结果、决定是否重试、检查 max-tokens/refusal/error、处理持久化损坏或不可用；
2. **运行中**：`running/stopping`，安静展示；
3. **可继续 Agent**：continuable child 的 `inactive/running` 状态，不与终态任务混淆；
4. **最近结束**：已有 dsh 终态、等待或完成本地验收；
5. **历史**：已经验收、较早失败或已取消。

首页和角标只消费 `attention_kind != none`，不能用运行中 Agent 数量制造提醒。

**借鉴结论：P0 数据、P1 完整界面。**

### 4.6 dsh 结果与用户验收分离

LoopX 用 evidence refs 和 receipt 将状态与证据绑定。typed correlation 建立后，YOLO 可利用以下 dsh 结果：

- Job `detail/finishedAt`；
- subagent `stopReason/lastAssistantMessage`；
- child Session 的对话、工具调用和投影；
- provider 安全 diagnostic。

`SubagentResult.structured` 属于 producer/owner result，不在当前 observer-safe `JobView` 或 `subagent/end` 中，YOLO 不能假设可读。`JobRegistry.read()` 还会消费流游标，并可能改变终态 reported 语义；P0/P1 的观察投影不应调用它。

YOLO 只存储受限结果摘要、必要引用和用户验收：

- `completed` 只表示 dsh run 正常结束；
- `lastAssistantMessage` 是结果摘要来源，不等于用户验收；
- 验收必须绑定具体 task/run revision；新的 Activation 或结果出现后，旧验收不能覆盖新结果；
- 关联 YOLO todo 时只建立关联，dsh Agent task 完成不自动完成 todo。

**借鉴结论：P1。**

### 4.7 watermark、全量快照和幂等折叠

LoopX 的 event ledger 和 revision discipline 值得借鉴。dsh 已经给出更具体的输入：

- `session/jobs` 是 complete set，客户端每次替换当前集合；
- `subagent/start/end` 通过 `runId` 精确配对；
- Session projection 采用 higher-seq-wins；
- subagent descriptor 的 `seq` 用来证明身份来自 child 自己的日志后缀，而不是 fork seed；
- Job terminal read 幂等，settlement 首次结果优先。

YOLO projector 应：

1. 按 parent Session 保存最后一份 jobs snapshot；
2. 用 `runId` 去重 start/end，不按时间近似配对；
3. 对 Session projection 只接受更高 seq；
4. 同一个 terminal outcome 重放时保持幂等；
5. 将 snapshot 中消失和收到 terminal event 区分处理；
6. 将 host lifecycle/generation 纳入 Job identity，防止重启后 `<kind>-N` 重用碰撞。
7. 关联 Job 与 subagent run 时只接受 dsh typed correlation，拒绝 label/时间启发式。

**借鉴结论：P0 必做。**

### 4.8 stale 只是一种观察判断

LoopX 的 stale claim 只生成警告，不自动改派。YOLO 可以借用这一点，但 stale 判断应使用 dsh 事实：

- Job `startedAt` 和当前状态；
- `subagentTiming.active.since/through`；
- child Session 最新 event/projection seq；
- Host 是否在线、registry 是否仍可观察。

超过预期时间只标 `suspected_stale` 并说明依据。continuable child inactive、长时间推理、等待子级和宿主断开不能一律判定为卡住。P0 不自动 interrupt 或 retry。

**借鉴结论：P1。**

### 4.9 Session 是详情事实源，不是新的侧栏平级会话

LoopX 把 handoff 和 run history 放在任务容器下。YOLO 应保持此前确定的信息架构：

- 普通 dsh 会话继续留在宿主会话列表；
- Agent 任务使用独立一级入口；
- one-shot task 详情链接其 parent Session、child Session 和 run；
- continuable child 详情以持久 Session 为容器，Activation/turn 作为运行记录；
- 默认展示当前结论、结果和关键事件，不复制完整 transcript；
- 用户需要细查时通过 dsh Session history 打开原始记录。

**借鉴结论：P0 来源跳转，P1 完整详情。**

### 4.10 数据最小化

LoopX 的证据账本禁止默认暴露 raw logs、完整 trajectory、凭据和私有文档正文。YOLO 应沿用 dsh 已有 browser-safe projection 边界：

- 任务列表使用 `JobView`、Subagent catalog 和受限结果摘要；
- 不把 tool inputs、文件内容、环境值、凭据或原始协议 payload 写入任务表；
- diagnostic 继续遵守 dsh 的安全文本边界；
- 完整历史按需从 child Session 读取，不复制进通知或首页；
- 通知只说明用户需要处理什么，不携带完整 Agent 输出。

**借鉴结论：P0 必做。**

## 五、LoopX 记忆机制可以借鉴什么

### 5.1 LoopX 的“记忆”不是一个统一记忆库

LoopX 把记忆分成几层，而不是把所有历史都塞进向量检索：

| 层次 | 作用 | 当前成熟度 | 对 YOLO 的价值 |
|---|---|---|---|
| registry / active state / todo / run history / evidence | 保存当前目标、下一步、运行结果和证据链 | 核心稳定能力 | 很高：适合作为 dsh Agent 任务的工作记忆 |
| [Reward Memory](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/reward_memory/README.zh-CN.md) | 把显式反馈或经验变成有 scope、authority 和生命周期的候选记忆 | 实验能力、默认关闭；candidate/review 与显式 recall/application seam 已实现 | 中高：适合结果验收后的学习，但不能直接自动写入 |
| [Agent Turn Recall](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/agent_turn_recall/README.md) | 针对一个具体 Agent turn，从已选工作项和近期结果构造有界查询 | 默认关闭，依赖 Reward Memory 配置 | 中：未来继续一个长期 Agent 任务时有用，P0 观察台不需要 |
| [Semantic Preference](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/semantic_preference/README.md) | 在模块明确的 surface 上召回偏好，由调用模块决定如何应用 | 可选、私有配置、provider-neutral | 中：可复用到摘要和结果呈现，不应用于运行权限 |
| [Decision Context](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/decision_context/README.zh-CN.md) | 将 authority source、revision、新鲜度、冲突和 exact read 组装为决策证据包 | 实验、默认关闭 | 高：其“先核验当前事实，再使用历史记忆”原则值得直接借鉴 |
| [Post-outcome utility](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/architecture/rfcs/post-outcome-memory-utility-attribution-v0.zh-CN.md) | 区分一条记忆是 helpful、harmful、neutral 还是 unknown | 仍是受限实验；不会默认影响排序 | 后期价值高，当前不应照搬完整评估器 |

LoopX 的实际 memory storage 和 semantic retrieval 可以交给 OpenViking 等 provider；LoopX 自己重点拥有的是 scope、authority、freshness、lifecycle、candidate review 和 application receipt。YOLO 已有 SQLite、证据、偏好与召回基础，不需要再引入一个平行 memory store。

### 5.2 最值得直接借鉴的六条规则

#### 规则一：当前 dsh 事实永远高于召回记忆

LoopX 将 fresh working context 和当前 source of truth 放在历史经验之前。对 YOLO：

- 当前 Job 状态、`subagent/end`、Session projection 和 dsh revision 是事实；
- 历史任务摘要只能帮助理解，不能覆盖当前状态；
- 记忆说“任务已完成”，而 dsh 仍显示 running 时，必须信 dsh；
- 记忆与当前结果冲突时应标 stale/refuted，而不是静默覆盖。

这是 P0 就应该遵守的原则。

#### 规则二：任务工作上下文不能自动升级成长期偏好

LoopX 将 `working_context` 与可复用 policy/preference 分开。对 YOLO：

- child Session transcript、一次任务 prompt、工具调用和临时限制只是该任务上下文；
- “这个任务使用英文报告”不能自动变成“用户永远喜欢英文”；
- 只有用户明确表达、反复确认或通过 review 的候选，才进入现有 preference/长期记忆；
- 原始 transcript 不应成为 Reward Memory record。

这能避免 Agent 任务越多，YOLO 对用户的理解反而越偏。

#### 规则三：所有可复用记忆都要带作用域和来源

LoopX 的 Reward Memory 记录要求 source、scope、authority、confidence、lifecycle 和 privacy。映射到 YOLO，至少需要：

```text
task_id / run_id / parent_session_id / child_session_id
workspace / surface / source_ref / dsh_revision
valid_at / expires_at / superseded_by / revoked_at
```

例如“UI 任务交付前必须跑 W1–W16”可以是 workspace + `agent_task.delivery_review` surface 的 procedure candidate；它不能自动影响个人生活任务，也不能授权 Agent 执行受保护操作。

#### 规则四：反馈先成为候选，不直接变成长期记忆

LoopX 的流程是：反馈证据 → 紧凑 candidate → accept/edit/reject/no-write → active record → 精确读回。YOLO 可将 Agent 任务验收映射为：

```text
用户验收/拒绝某次 run
        ↓
生成 task-scoped 学习候选
        ↓
判断它只是本次结果，还是可复用经验
        ↓
用户确认或高置信显式规则
        ↓
写入现有偏好/经验表并保留 provenance
```

“这份报告不合格”首先只是 `run_bound_reward`；不能直接推导出一条全局 hard policy。更适合转为候选的是具体反馈，例如“以后此仓库的调研报告必须列出源码证据和未验证项”。

#### 规则五：记忆不能创造权限

LoopX 明确区分“怎样做更好”和“有权做什么”。YOLO 应同样坚持：

- 记住“用户以前允许取消某个任务”不代表这次可以自动 kill；
- 偏好、经验和高 confidence 都不能授权 dsh `interrupt/kill/prompt`；
- 权限仍来自当前用户动作和 dsh 自己的 owner/Session authority；
- 召回结果只影响摘要、排序、建议和验证清单。

#### 规则六：记录记忆是否被使用，但不要把成功自动归功于它

LoopX 的 application receipt 会记录哪条记忆被召回、是否 applied/refuted，以及对应 artifact/outcome；其 post-outcome utility 又明确反对“applied + success = helpful”。

YOLO 后续可记录：

```text
memory_ref / task_id / run_id / application_surface
applied | ignored | refuted
result_ref / user_acceptance
utility = helpful | harmful | neutral | unknown
```

默认 utility 应是 `unknown`。一次任务可能同时使用多条记忆，最终成功不能证明每条都有贡献；负面结果也不应立刻删除记忆，而应进入 review、降权、过期或 supersede。

### 5.3 映射到 dsh Agent 任务的三类记忆

首版不需要五类全做。建议只落三类：

| YOLO 任务记忆 | 内容 | 生命周期 |
|---|---|---|
| `task_working_context` | 当前任务摘要、约束、最近状态、相关 parent/child Session 和结果引用 | 随 dsh revision 更新；旧版本 superseded |
| `run_feedback` | 用户对某次 run 的接受、拒绝和具体反馈 | 只追加，绑定 task/run/result revision |
| `procedure_candidate` | 从明确反馈中提炼的“以后同类任务怎样做”候选 | 先 review；接受后进入现有 preference/experience，支持 revoke/expire |

它们可以复用 `dsh_agent_task_events`、acceptance 和现有偏好/记忆设施，不需要新建一套通用 memory database。

### 5.4 分阶段建议

- **P0**：实现 task working context、source revision、fresh/stale/superseded 和结果 provenance；不做 semantic auto-recall。
- **P1**：把用户验收保存为 run-bound feedback，并允许生成 procedure candidate；不自动激活。
- **P2**：continuable task 再次唤醒时，可按 `task_id + childSessionId + current intent` 做有界 recall，并 fail open。
- **P3**：增加 application receipt；只有收集到足够真实验收后，再评估 bounded utility 是否影响排序。

### 5.5 不建议借鉴的记忆部分

- 不引入 OpenViking 作为 YOLO Agent 任务的前置依赖；
- 不自动采集全部 dsh transcript、tool log 或 Job output；
- 不自动把一次验收转成用户画像或全局策略；
- 不让 recalled memory 影响 dsh 权限或任务归属；
- 不在证据不足时宣称某条记忆“有用”；
- 不为了 Agent 任务再建一套与 YOLO 当前 memory/preference 并行的 store。

## 六、不应从 LoopX 或原报告引入的机制

| 不引入 | 原因 |
|---|---|
| 外部 Agent source adapter / connector | 唯一来源就是 dsh |
| `source_id + external_task_id` 跨来源模型 | 会掩盖 dsh 已有 Job、run、Session 身份 |
| webhook、外部 cursor、跨平台同步 | 不在产品范围 |
| compute quota、auto-wake、heartbeat | 属于执行控制面，不是任务观察 |
| claim、hard lease、自动 transfer/reclaim | dsh 拥有 Agent 与 Job 的运行所有权 |
| supervisor、自动 replan、successor 调度 | 会把 YOLO 扩张成 Agent 编排器 |
| 复制完整 transcript/tool trace | dsh Session 已是详情事实源，也会扩大隐私与存储成本 |
| 用 Job snapshot 消失推断终态 | Job registry 进程局部，宿主重启后该推断不成立 |
| 把 continuable inactive 当 completed | inactive 只是当前没有运行中的 driver |

## 七、推荐最小领域模型

这是 YOLO 对 dsh 事实的管理投影，不是新的 dsh runtime：

| 对象 | 核心字段 |
|---|---|
| `dsh_agent_tasks` | `task_id/form/parent_session_id/job_id/subagent_run_id/child_session_id/correlation_status/label/provider/local/runtime_status/result_status/stop_reason/started_at/finished_at/host_generation/last_observed_at/last_projection_seq/attention_kind/acceptance_status/linked_todo_id` |
| `dsh_agent_task_runs` | `run_id/task_id/subagent_run_id/activation_seq/status/stop_reason/started_at/finished_at/result_summary/result_ref` |
| `dsh_agent_task_events` | `event_id/task_id/run_id/kind/summary/occurred_at/observed_at/dsh_seq/dedup_key` |
| `dsh_agent_task_acceptances` | `acceptance_id/task_id/run_id/result_revision/status/feedback/created_at` |
| `dsh_agent_task_observations` | `observation_id/parent_session_id/host_generation/jobs_fingerprint/projection_seq/status/observed_at/error` |

必要不变量：

1. dsh 生命周期字段只由 dsh 事件、快照和持久化投影更新。
2. `task_id` 必须绑定 parent Session 和 dsh run/child 身份，不能按 label 合并。
3. Job id 不能脱离 host generation 独立复用。
4. `subagent/start/end` 只按同一 `runId` 配对。
5. Job 与 subagent run/Session 只接受 dsh typed correlation，禁止启发式 join。
6. continuable child Session 是稳定容器，Activation 是 run，不创建虚假 Job。
7. Job 从 snapshot 消失且没有终态证据时标 unknown/not_observable。
8. 用户验收绑定具体 run/result revision。
9. dsh Agent task 完成不自动完成关联 YOLO todo。

## 八、推荐 API 与界面

### 8.1 P0 API

```text
GET  /yolo/agent-tasks?bucket=needs_attention|running|recent|history
GET  /yolo/agent-tasks/:task_id
POST /yolo/agent-tasks/:task_id/seen
```

dsh lifecycle observation 应在插件内部消费宿主服务和事件，不开放伪造同步的公共 HTTP 入口。验收和关联 todo 在 typed correlation 稳定后进入 P1。P0 不提供 `start/kill/interrupt/prompt/followup/read/wait`。

### 8.2 信息架构

- Agent 任务是助手看板的独立一级入口，不与普通会话平级混排；
- 第一屏优先显示需要用户处理的 dsh Agent 任务；
- one-shot 与 continuable 使用清晰类型标签和不同状态文案；
- 详情顺序：当前结论 → 需要的动作 → 结果摘要 → 关键事件 → runs → child Session → 验收；
- child Session 使用 dsh 原生 history/导航，不复制一条新的 YOLO transcript；
- 运行中只安静展示，`max-tokens/refusal/error`、结果待验收和持久化损坏才进入注意力队列。

## 九、实施路线

### P0：Job-backed one-shot Agent 任务

1. 接线 `ctx.jobs.onJobsChanged/onJobDone` 与当前集合，按 exact owner 调用 `list(owner)`，限定 `kind=subagent`。
2. 建立 host generation 和 jobs snapshot fingerprint，先实现 Job 级独立任务入口、列表和状态。
3. 在 dsh one-shot 后台委派边界增加 browser-safe typed correlation：`parentSessionId/jobId/subagentRunId/childSessionId/mode`。
4. correlation 可用后再观察 `subagent/start/end`，建立 Job、run 和 child Session 的精确关联。
5. 建立 runId 和 projection seq 幂等规则，实现结果摘要与 Session 跳转。
6. 初期只持久化安全摘要与 YOLO 管理事实；dsh Session 保持详细历史事实源。
7. 明确宿主重启后的降级：有强关联且能从 child Session 恢复的任务显示 persisted；无法恢复的显示 unavailable/unknown。

P0 成功标准：同一 one-shot Job 从注册、运行、结算到 UI 重连只显示一个任务；宿主重启不会把消失的 Job 误报为完成。typed correlation 落地后的扩展标准是 `subagent/end` 重放不重复，且用户能打开强关联的正确 child Session 查看结果。

### P1：结果、注意力和验收

1. 基于 typed correlation 增加 one-shot 结果摘要和 child Session 跳转。
2. 增加结果验收、stale 解释、no-change 静默和注意力角标。
3. 支持关联 YOLO todo，但只提示用户确认是否完成计划事项。

### P2：continuable 子 Agent

1. 通过 Subagent catalog 与持久化 projection 接入 continuable child。
2. 把 child Session 作为稳定任务容器，把 Activation/turn 作为 runs。
3. 明确 inactive、running 和 settled notice 的不同语义。

### P3：受控的 dsh 原生交互

只有产品再次确认需要时，才评估从任务详情调用 dsh 原生能力：

- continuable `prompt`；
- continuable `interrupt`；
- Job `kill`。

这些动作必须直接使用 dsh 权限与收据，不在 YOLO 内复制调度状态；必须由用户显式发起，并在读回 dsh 状态后才显示成功。它们仍是“管理 dsh 任务”，不是让 YOLO 决定执行什么。

## 十、测试与验收重点

| 类别 | 必测场景 |
|---|---|
| 身份 | Job id 重用、同 label 不同 run、parent Session 不同、local/remote run 均不碰撞；无 correlation 时拒绝启发式 join |
| 生命周期 | running→stopping→killed、running→completed/failed，以及首次终态优先 |
| subagent | start/end 按 runId 配对；completed/aborted/error/max-tokens/refusal 正确投影 |
| 快照 | `session/jobs` 全量替换、空集合、重复 frame、多标签页和重连收敛 |
| 重启 | Job 消失不推断终态；有 child Session 时恢复 persisted history；无证据时显示 unknown |
| continuable | inactive 不等于 completed；多次 Activation 归到同一 child task；projection 只接受更高 seq |
| 权限 | 不读取其他 owner Session 的 Job；普通观察者不能 teardown Agent |
| 结果 | 观察投影不调用消费式 Job read；diagnostic/result 摘要不泄露 tool input、文件内容、环境值、凭据或原始协议 |
| 关联 | dsh Agent task 完成不自动完成 YOLO todo；用户确认后才走现有统一动作路径 |
| 真机 | 真实 dsh 宿主与 Edge 中验证启动、状态变化、结果、重连、宿主重启、Session 跳转和验收 |

若修改 `client/**`、API payload 或设计系统，应按 [测试体系](../testing.md) 执行受影响的 W1–W16 真机场景，并新增 dsh Agent 任务的真实宿主场景矩阵。

## 十一、最终建议

调整后的结论是：YOLO 不需要成为 Agent 平台聚合器，它只需要成为 **dsh Agent 任务的人类管理界面**。

优先实施：

1. 精确消费 dsh Job，并推动 dsh 提供 Job/run/child Session typed correlation；
2. 建立 `parent Session → Agent task → run → child Session` 层级；
3. 分离运行、结果、注意力、验收和可观察性状态；
4. 以需要用户处理为第一排序；
5. 将 dsh Session 保持为详细历史事实源；
6. 只在 YOLO 保存安全摘要、关联、提醒和用户验收。

明确不做：外部 Agent connector、多来源同步、compute quota、租约改派、自动 replan 和 YOLO 内部执行编排。

这样既吸收 LoopX 在长期 Agent 工作可观察性上的成熟机制，也完全服从 dsh 已有运行时边界和 YOLO“管理而非代办”的产品定位。

## 参考资料

- [LoopX README](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/README.md)
- [LoopX Architecture](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/architecture.md)
- [LoopX Project Agent Todo Contract](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/project-agent-todo-contract.md)
- [LoopX Agent Management Projection v0](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/reference/protocols/agent-management-projection-v0.md)
- [LoopX Agent-scoped Evidence Ledger v0](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/reference/protocols/agent-scoped-evidence-ledger-v0.md)
- [LoopX Reward Memory Architecture v0](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/reward_memory/README.zh-CN.md)
- [LoopX Agent Turn Recall](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/agent_turn_recall/README.md)
- [LoopX Decision Context](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/decision_context/README.zh-CN.md)
- [LoopX Post-outcome Memory Utility Attribution](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/architecture/rfcs/post-outcome-memory-utility-attribution-v0.zh-CN.md)
- `@deepseek-ai/dsh-jobs@0.1.1-rc.2`：`JobRegistry`、`JobSnapshot`、`JobView` 与 `session/jobs`
- `@deepseek-ai/dsh-subagent@0.1.1-rc.2`：`SubagentRunInfo`、`SubagentRunEndInfo`、持久 descriptor、continuable child 与 timing projection
- `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2`：browser-safe Jobs/Subagents API
- [YOLO 产品愿景](../VISION.md)
- [YOLO UI 架构](../architecture/ui.md)
- [YOLO 存储 schema](../../src/storage/schema.sql)
