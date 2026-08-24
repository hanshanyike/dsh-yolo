# `src/attention/`：确定性助手判断

## 职责与边界

该模块只根据看板已经投影出的可审计事实判断“现在最值得提醒用户什么”。它不读 SQLite、
不调用 LLM，也不接受客户端提交的分数。服务端聚合各工作区候选后最多发布一条主判断。

## 文件与公开能力

唯一文件 `index.ts` 提供：

| 能力 | 作用 |
|---|---|
| `scoreAttentionCandidate` | 从 todo 的到期、优先级、提醒、推迟、陈旧和里程碑事实构造候选 |
| `rankAttentionCandidates` / `rankProjectedAttentionCandidates` | 稳定排序候选 |
| `applyAttentionFeedback` | 应用 seen、suppression 和原因反馈 |
| `selectPrimaryAttention` | 从排序结果中选择唯一判断 |
| `buildDashboardSummary` | 从聚合事实构造摘要 |

规则版本为 `ATTENTION_REASON_VERSION = 'attention-v1'`。同分候选按 due、priority、updated、
稳定 key 打破平局，因此同一事实在刷新后不会随机换序。

## 信任绑定

`evidence_fingerprint` 对工作区、todo 状态、到期、优先级、提醒、推迟、里程碑事实、主理由、
公开证据和规则版本生成稳定哈希。反馈按
`(scope_key, todo_id, reason_version, evidence_fingerprint)` 精确持久化：

- `seen` 使客户端后续以紧凑形式展示同一判断；
- 未过期的 suppression 从候选中移除该判断；
- 证据变化会生成新 fingerprint，旧反馈不会错误套用；
- 客户端回传旧绑定时，统一动作入口拒绝为 `stale_attention`。

到期证据复用 `src/shared/due.ts` 的领域事实：date-only 到本地日末才逾期，datetime 按精确时刻；
因此 row.overdue、判断依据、摘要和客户端筛选不会各自解释同一个 `due_at`。

## 依赖关系

- 输入类型来自 `src/shared/dashboard.ts`。
- 反馈记录由 [存储服务](storage.md) 持久化。
- 全局聚合和唯一候选发布由 [看板服务端](ui.md) 完成。
- seen/suppress/feedback 的校验入口见 [共享动作契约](shared.md)。

## 不变量

1. 判断只能来自服务端可复算事实，不能信任客户端 score 或 reason。
2. 排序必须稳定，规则变化必须升级 `reason_version`。
3. 反馈必须绑定不可变证据版本，不能只按 todo id 回放。
4. 全局唯一判断是在所有工作区候选合并后截取，不是在每个工作区各取一条后直接展示。
