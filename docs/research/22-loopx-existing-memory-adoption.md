# LoopX 对 YOLO 现有记忆机制的借鉴分析

> 调研日期：2026-08-30
> LoopX 基准：[huangruiteng/loopx@017df081](https://github.com/huangruiteng/loopx/tree/017df081e5cb665bd84ed3c920ee4fb40c3c8cec)
> 范围：YOLO 当前已经实现的承诺、计划、跟踪规则、事件、来源证据、召回和反馈机制
> 明确排除：OpenViking、第二套 memory store、通用知识库、人物画像和跨产品 Agent 记忆平台

## 一、结论先行

YOLO 不缺记忆底座。当前实现已经具备：

- SQLite + FTS5 运行时事实源；
- todo、goal、milestone、tracking preference、event 与 session summary；
- 自动语义抽取、统一领域动作、追加事件和不可变 todo evidence；
- preference supersession history；
- 确定性召回 + LLM 查询扩写/重排 + 失败降级；
- 注入预算、类别配额、会话内去重和 recall health；
- 来源 Session、turn、operation id、request hash 与 evidence fingerprint。

因此，不应照搬 LoopX 的 provider 层或 OpenViking。真正值得借鉴的是 **记忆治理协议**：

1. 当前事实高于召回记忆；
2. working context、一次反馈和可复用规则分层；
3. 每条规则带明确 surface、authority、freshness 和生命周期；
4. 自动推断先成为 candidate，显式用户规则才可直接写入；
5. 记录“实际召回并注入了什么”，而不只记录搜索和扩写；
6. 任务成功或事项完成不能自动证明一条记忆有用；
7. 记忆只能影响管理建议，不能创造执行权限。

优先级最高的不是新增记忆类型，而是修复四个当前链路缺口：

- 把插件级单值的最近消息、cwd 和注入去重改成按 Session 隔离；
- 让 tracking rule 具备适用 surface、撤销、过期和来源 authority；
- 让 `memory_write` 复用统一写入质量与作用域检查；
- 把 `recall_log` 从“语义预热日志”补成“候选 → 保留 → 实际注入”的完整回执。

## 二、YOLO 当前已有能力

### 2.1 记忆边界已经正确收窄

[抽取契约](../architecture/extract.md) 已明确只保留：

- commitments：todo；
- plans：goal / milestone；
- tracking rules：提醒时间、工作时段、项目跟进规则；
- 与计划管理相关的 decision / milestone event。

当前 [抽取 prompt](../../src/extract/prompt.ts) 已禁止个人口味、沟通风格、编码风格、泛知识和生活画像。该边界与 LoopX Reward Memory 的“不是跨场景个人画像”一致，应该继续保持，不应因为这次调研重新扩大 preference 范围。

### 2.2 当前数据层已有较强溯源

[存储 schema](../../src/storage/schema.sql) 与 [存储架构](../architecture/storage.md) 已具备：

| 机制 | 当前实现 |
|---|---|
| 事项稳定身份 | todo ULID + canonical/merged record identity |
| 来源证据 | `todo_evidence` 保存 session/turn/source/relation/excerpt/fingerprint |
| 变化历史 | `events` 追加记录 subject、前后字段和关系 |
| 偏好历史 | `preference_history` 保存被 supersede 的旧值 |
| 幂等 | extraction operation、client action、tool call 和 evidence fingerprint |
| 审计 | extraction、todo resolver shadow、recall、action denied |

这已经覆盖了 LoopX 强调的 provenance、append-only evidence 和 current-state/history separation。YOLO 不需要重做一套 event store。

### 2.3 当前召回链路已有可靠保底

[记忆架构](../architecture/memory.md) 当前采用：

```text
用户消息
  ├─ 本地 FTS：整句 + token OR + CJK trigram + 二字 LIKE
  ├─ 可选 LLM query expansion
  ├─ 可选 LLM rerank
  ├─ deterministic top-K floor
  └─ kind quota + char budget + session dedup
```

模型失败、预算耗尽、连续空结果或预热未完成时都会退回确定性 FTS。LoopX 的 fail-open recall 原则在 YOLO 中已经存在，无需引入外部 provider 才能获得。

## 三、最值得借鉴的机制

### 3.1 将“偏好”收窄为有 surface 的跟踪规则

LoopX 的 [Reward Memory](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/reward_memory/README.zh-CN.md) 和 [Semantic Preference](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/semantic_preference/README.md) 都要求调用模块声明具体 surface；召回结果不能自动影响所有场景。

YOLO 当前 `preferences` 只有：

```text
key / value / confidence / scope_key / session_id / valid_at / invalid_at
```

所有当前 preference 都会按更新时间取前 12 条，以 `## User preferences` 注入每个真实工作会话。这里有三个问题：

1. tracking rule 被包装成了泛化的 user preference；
2. 规则没有声明它影响 reminder、brief、dashboard、extraction 还是 agent context；
3. 一个只应调整提醒的规则会进入模型所有普通对话。

建议将用户可见概念统一为「跟踪规则」，并增加：

```text
surface: reminder | brief | dashboard | extraction | agent_context
authority_kind: explicit_user | confirmed_candidate | system_default
lifecycle_state: active | revoked | expired | retired
expires_at / superseded_by / source_ref
```

应用原则：

- `reminder-ahead` 只由 reminder 消费，不必进入所有模型 prompt；
- `working-hours` 由 reminder/brief 消费；
- `project:demo-track` 可进入 dashboard/extraction；
- 只有明确需要影响 Agent 回答的规则才进入 `agent_context`。

**优先级：P0。** 这是最有用户价值、也最能防止滑向通用记忆的改动。

### 3.2 补齐 preference 的撤销、过期和 retirement

YOLO 已支持同 key 新值 supersede 旧值，但当前仍有缺口：

- `memory_forget` 不支持 preference；
- current preference 没有独立 revoke/expire/retire 动作；
- `confidence` 在重复相同值时递增，但没有 evidence rationale；
- confidence 不参与权限，却容易被误读成“更可信、更有权”。

借鉴 LoopX 后，应明确：

- `confidence` 只表示证据质量，绝不提高 authority；
- 用户说“以后不用提前一小时提醒”应写 revoke/supersede 事件；
- 临时规则可以设置 `expires_at`；
- retired 规则保留历史但退出 prompt、提醒和召回；
- 所有生命周期变化进入 timeline 或独立 rule event，而不是覆盖删除。

**优先级：P0。**

### 3.3 把写入分成“显式写入、自动抽取、推断候选”三条路径

LoopX 的 candidate → review → active 机制值得借鉴，但不能让所有 YOLO 写入都弹确认。

推荐边界：

| 写入来源 | 行为 |
|---|---|
| 用户明确说“提醒我…”“记下这个计划…” | 直接写入，但经过统一 schema、质量和 tracking-scope 检查 |
| 自动抽取明确承诺/计划 | 继续走现有 `shouldDropExtracted`、known context、幂等动作 |
| 从多次行为、验收或模糊反馈推导规则 | 只生成 candidate；确认后才能成为 tracking rule |

当前 `memory_write` 依赖工具描述约束，不经过 `shouldDropExtracted`。todo 写入已有 tool-call 幂等和 evidence，但 milestone、goal、preference、event 仍直接调用 storage 方法。

建议新增统一的 `validateMemoryWrite()` 或复用扩展后的共享质量层，至少校验：

- 是否属于承诺、计划、跟踪规则或管理事件；
- preference 是否声明 surface；
- event 是否确实影响后续管理；
- 是否有足够来源身份和幂等键；
- 直接工具写与后台抽取同轮时能否正确合并 provenance。

**优先级：P0。**

### 3.4 当前事实必须高于召回内容

LoopX 的 [Decision Context](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/decision_context/README.zh-CN.md) 不把 recall 命中直接当事实，而是检查 source revision、freshness、conflict 和 exact read。

YOLO 当前动态召回只注入：

```text
[todo] 把演示稿发给研发
[goal] 完成发布准备
```

没有状态、截止时间、更新时间、来源或命中解释。由此会产生两类风险：

- 模型看到旧标题，却不知道事项已经完成或改期；
- FTS 数据清理遗漏时，终态目标可能继续被召回。

建议动态 context 使用仍然紧凑、但带事实版本的行：

```text
[todo id=t1 status=pending due=2026-09-01 updated=...]
把演示稿发给研发
```

同时规定：

- 召回只用于提示相关项；真正执行 complete/postpone 等动作前必须按 id exact read；
- terminal/canonical filter 在 storage projection 层统一完成；
- current SQLite row 永远高于 session summary、旧 event 或召回缓存；
- recall cache 必须绑定 row revision，不能在实体变化后继续命中旧投影。

**优先级：P0/P1。**

### 3.5 从“预热日志”升级为“召回应用回执”

LoopX 的 application receipt 会区分：召回了什么、是否应用、作用在哪个 surface、依据哪个当前 artifact。

YOLO 当前 `recall_log` 记录 query、expansions、rerank outcome 和扩写耗时；schema 虽有 `kept_keys/drop_reasons`，但 `applyRecallPolicy()` 后没有写日志。因此它只能回答“模型扩写了什么”，不能回答：

- 最终哪些记忆实际进入 prompt；
- 哪些因为已注入、类别配额或预算被丢弃；
- 注入时对应的实体 revision；
- 一次 prompt 多次装配是否使用同一结果。

建议增加 `recall_application_v0`：

```text
application_id
session_id / turn_seq / surface
query_digest（必要时加有界本地预览，不默认保存完整原文）
candidate_keys / kept_keys / drop_reasons
row_revision_digest / rendered_digest
semantic_status / assembled_at
```

这一回执先用于调试、质量评估和重放，不自动改变排序。

**优先级：P0。**

### 3.6 事项完成和取消不是记忆效用标签

YOLO 的 todo 有 `good_count` 与 `stale_count`，分别在完成、取消时增长。现有路线曾计划用 stale 对召回降权，但 LoopX 的 [Post-outcome Memory Utility](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/architecture/rfcs/post-outcome-memory-utility-attribution-v0.zh-CN.md) 提醒了一个关键问题：

```text
被召回 + 最终成功 ≠ 这条记忆有帮助
```

同理：

- todo 完成只说明事项完成，不说明某次 recall 帮助了用户；
- todo 取消可能是计划变化，不说明该事项是坏记忆；
- 同一轮注入多条记忆，无法把最终结果平均归因给每条。

因此不建议直接用 `good_count/stale_count` 调整召回排序。正确顺序是：

1. 先有 recall application receipt；
2. 再收集明确的提醒/召回反馈；
3. 将效用标为 `helpful/harmful/neutral/unknown`，默认 unknown；
4. 负效用进入 review、降权或 retire proposal，不自动删除；
5. 只有在真实数据足够后才做 bounded utility modifier，语义相关性仍是主排序。

**优先级：P2/P3。**

### 3.7 区分真人对话召回和自动 turn 召回

LoopX 的 [Agent Turn Recall](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/agent_turn_recall/README.md) 不把 chat text 当兜底，而是用 selected work、phase、recent outcome 和 next intent 构造 situation fingerprint。

YOLO 当前监听所有 `session/event user/message`，并将最近文本用于动态 recall。它已经跳过 YOLO 内部线程，但没有按 `source.kind=user|goal|subagent...` 区分真人输入与自动 continuation。

建议拆为：

- **human recall**：直接真人消息作为 query；
- **autonomous turn recall**：Goal 或未来 Agent task 自动轮次不冒充真人 query，而是从 goal/task id、当前阶段、最近结果和 next intent 构造 situation；
- 两者使用不同 application surface 和 dedup identity；
- 自动 recall 失败必须 fail open，不能制造 user gate 或打断工作。

**优先级：P1，Agent 任务落地时升为 P0。**

### 3.8 修复多会话隔离与运行期生命周期

当前记忆插件的：

- `lastUserText`；
- `lastSessionCwd`；
- `RecallDedupTracker`；
- semantic expansion/rerank cache；

都是插件实例级状态。多工作会话并发交错时可能串扰。缓存也没有 TTL 或容量上限。

此外：

- `recall.topK/maxTokens` 已暴露设置但尚未接入；
- `recallLogRetentionDays=30` 和 `pruneRecallLog()` 已存在，但当前没有调用方；
- 预热 `latency_ms` 不包含 rerank；
- preference preamble 与 FTS recall 之间没有统一去重。

建议：

- 所有 recent query、cwd、dedup 和 pending kept keys 按 Session 建立状态；
- cache key 包含 workspace/session/surface/config revision；
- cache 采用 TTL + LRU cap；
- 配置读取与实际 recall 统一；
- 轻量维护任务真正执行 recall log retention；
- preference preamble 和 dynamic recall 共用同一 application plan。

**优先级：P0。**

## 四、建议的数据契约增量

### 4.1 tracking rule

在现有 preference 基础上演进，不新建通用 profile：

```text
id / key / value / scope_key / session_id
surface / authority_kind / confidence / confidence_reason
lifecycle_state / valid_at / expires_at / revoked_at / retired_at
superseded_by / updated_at
```

### 4.2 memory candidate

只承接推断出的可复用规则：

```text
candidate_id / target_kind=tracking_rule
content_summary / proposed_surface
source_refs / reasoning_summary / confidence
status=pending|accepted|edited|rejected|no_write
created_at / decided_at
```

candidate 不进入 reminder、prompt 或 recall，直到被 accepted。

### 4.3 recall application

```text
application_id / session_id / turn_seq / surface
query_digest / situation_fingerprint
candidate_keys / kept_keys / drop_reasons
row_revision_digest / rendered_digest
status / created_at
```

### 4.4 memory utility observation（后期）

```text
observation_id / application_id / memory_key
label=helpful|harmful|neutral|unknown
evidence_ref / evaluator_kind / confidence
created_at
```

它是追加 observation，不直接修改 preference、todo 或 FTS。

## 五、实施优先级

### P0：正确性与可解释性

1. 将最近消息、cwd、dedup、kept keys 改为按 Session 隔离。
2. 接线 `recall.topK/maxTokens`，为 semantic cache 增加 TTL/LRU。
3. 写入最终 kept/drop/revision/rendered digest，形成 recall application receipt。
4. 真正调用 recall log retention，并明确原始 query 的本地保留策略。
5. preference 增加 surface 和 revoke/expire/retire。
6. `memory_write` 复用统一质量与 tracking-scope 检查。
7. 修复 achieved goal 等终态实体退出普通召回的索引一致性。

### P1：候选与场景化召回

1. 将推断出的 tracking rule 先写 candidate，不直接激活。
2. preference preamble 改为 surface-specific application。
3. 动态召回携带 id、状态、due、revision 和最小来源信息。
4. 区分 human recall 与 autonomous turn situation recall。
5. 让当前 attention evidence packet 标记 partial/stale/conflict，而不是把 recall 当事实。

### P2：明确反馈

1. 增加“这条提醒/召回有帮助、无关、已过时”的明确反馈。
2. 将反馈绑定 application id 和实体 revision。
3. 负反馈生成 review/retire proposal，不自动删除。
4. todo complete/cancel 继续只表示领域结果，不作为 recall utility。

### P3：有界效用

只有真实 application + feedback 数据足够后，才评估 bounded utility modifier。必须保留：

- semantic relevance 主排序；
- scope/freshness/lifecycle 硬过滤；
- utility 默认 unknown；
- 负效用可回看、可纠正；
- evaluator 失败不影响主链路。

## 六、不应借鉴的部分

- 不引入 OpenViking 或其他独立 context database；
- 不新增 knowledge/lesson/person profile 通用分类；
- 不自动采集完整聊天、tool log、文件正文或环境信息；
- 不把重复出现等同于更高 authority；
- 不让 memory confidence 授予取消、发送、写入或生产权限；
- 不在每次对话中注入全部 tracking rules；
- 不根据 complete/cancel 自动强化或删除记忆；
- 不让 memory unavailable 变成 user gate；
- 不用 recalled text 替代 SQLite 当前状态和 dsh source readback。

## 七、测试与验收重点

| 类别 | 必测场景 |
|---|---|
| 会话隔离 | 两个工作会话交错时 query、cwd、dedup、cache 不串扰 |
| surface | reminder rule 不进入无关普通对话；agent_context 规则才进入 prompt |
| 生命周期 | supersede、revoke、expire、retire 后退出 prompt/recall，但历史可查 |
| 写入 | tool、automatic extraction、candidate 三条路径使用正确质量和 authority 边界 |
| 召回回执 | candidate、kept、drop、revision 和 rendered digest 可重放且同轮稳定 |
| 当前事实 | todo 改期/完成、goal achieved 后旧 cache 不覆盖当前 row |
| 自动 turn | Goal continuation 不冒充真人 query；situation recall fail open |
| 效用 | complete/cancel 不直接改变 recall score；无证据时保持 unknown |
| 隐私 | application receipt 不保存完整 transcript、tool payload、凭据或本地路径 |
| 配置 | topK/maxTokens、TTL、LRU 和 retention 的设置与实际运行一致 |
| 真机 | 真实 dsh 多会话、Goal 自动轮次、提醒回复和模型召回均验证 |

## 八、最终建议

LoopX 对 YOLO 现有记忆最值得借鉴的，不是“记得更多”，而是：

> **每条被记住、被召回、被应用、被反馈的内容，都能说明它来自哪里、适用于哪里、是否仍有效，以及它有没有真的帮助这次管理。**

最先落地的四项应是：

1. per-session recall isolation；
2. surface-scoped tracking rules + revoke/expire；
3. unified write guard；
4. recall application receipt。

它们直接修复现有链路的正确性和可解释性，不扩大产品边界，也不需要 OpenViking。candidate review、situation recall 和 utility attribution 可以建立在这些可靠事实之上逐步推进。

## 参考资料

- [LoopX Reward Memory Architecture v0](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/reward_memory/README.zh-CN.md)
- [LoopX Agent Turn Recall](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/agent_turn_recall/README.md)
- [LoopX Semantic Preference](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/semantic_preference/README.md)
- [LoopX Decision Context](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/loopx/capabilities/decision_context/README.zh-CN.md)
- [LoopX Post-outcome Memory Utility Attribution](https://github.com/huangruiteng/loopx/blob/017df081e5cb665bd84ed3c920ee4fb40c3c8cec/docs/architecture/rfcs/post-outcome-memory-utility-attribution-v0.zh-CN.md)
- [YOLO 记忆架构](../architecture/memory.md)
- [YOLO 存储架构](../architecture/storage.md)
- [YOLO 抽取架构](../architecture/extract.md)
- [YOLO 借鉴落地结论](18-adoption-verdict.md)
