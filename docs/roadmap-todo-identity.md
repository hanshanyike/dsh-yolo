# 事项身份、去重与会话关联路线

> 文档性质：实施跟踪，不是当前架构事实源。当前已交付能力以
> [`docs/architecture/`](architecture/) 与 [`CHANGELOG.md`](../CHANGELOG.md) 为准。
>
> 背景与取舍见[事项重复、状态流转与多会话关联分析](research/20-todo-identity-dedup-analysis.md)。

## 目标

让一个现实事项拥有稳定身份，并可以关联多个会话、轮次和助手操作；相同输入重放不产生第二次副作用；
事项“完成/取消”等业务状态与记录“已合并/被替代”等身份状态相互独立。

本路线不以“标题相似即自动合并”为目标。判断不充分时宁可保留两个事项或请求确认，也不能静默误合并。

## v0.4.0-rc5：最小结构闭环

本轮批准并实现以下范围；只有代码、迁移、测试和真实宿主证据全部通过后，才能在架构文档和
`CHANGELOG.md` 中标为已交付。

- [ ] **输入幂等**：direct-human 抽取 turn 与助手工具调用具有稳定 operation id；请求哈希检测 id 冲突，
  evidence 指纹再绑定规范事项；相同操作重放不重复创建事项、证据或状态事件。
- [ ] **多会话证据**：新增不可变 `todo_evidence`；一个事项可关联多个 session/turn，分别记录 origin、
  mention、update、correction、completion claim 或 discussion。
- [ ] **旧数据兼容**：现有 `todos.session_id/source_excerpt/source_turn` 保留为兼容投影，并幂等回填首条
  origin evidence；旧库连续打开不得重复回填。
- [ ] **状态分离**：`todos` 增加记录状态与规范事项指向；合并副本标为 merged，不再伪装成业务 cancelled。
- [ ] **规范事项解析**：旧 id 可以解析到 canonical id；merged 副本不能通过普通 reopen 重新进入开放集合。
- [ ] **确定性标题防重**：标题 dedup 只在 open canonical 候选中生效，并使用稳定排序；终态项和 merged
  副本不能抢占候选。
- [ ] **助手操作纳入同一证据链**：助手工具写入记录触发它的会话/轮次和 operation fingerprint；工具重试
  不产生新事项。
- [ ] **审计与投影一致**：dashboard、SQLite、事件、来源列表、提醒和快照都只把 canonical 事项作为可操作项。

本轮明确不开放：基于向量或 LLM 相似度的自动 consolidate、跨工作区自动改 owner、周期 occurrence、
父事项/步骤模型，以及带冲突裁决的自动终态合并。

## 后续阶段

### R1：候选召回与 shadow resolver

- [ ] 从当前输入召回相关开放项、终态项和历史别名，向模型提供稳定 id，而不是固定前 N 条标题摘要。
- [ ] 输出 `LINK / UPDATE / REOPEN / NEW_OCCURRENCE / CREATE / ATTACH_STEP / ASK / NOOP`，先只记裁决日志，
  不改变现有写入结果。
- [ ] 建立人工标注样本，分别统计漏关联和误关联；按表达改写、指代、省略、跨会话和同名异项分层。

### R2：高置信 LINK 与 UPDATE

- [ ] 只对显式 id、相同来源指纹和同 scope 的高置信候选自动关联。
- [ ] 后续提及写 evidence；字段变化按稳定 id 走领域动作，禁止依赖标题静默选中多个候选之一。
- [ ] 多候选、终态语义不明和助手自行拆出的顶层事项进入 `ASK`，不自动修改。

### R3：状态感知合并确认与撤销

- [ ] 在当前“目标状态权威”的显式终态合并基础上，加入一开一终态、两终态冲突的用户确认与结果选择。
- [ ] 合并迁移提醒、未处理通知、别名和来源；历史显示“B 已并入 A”，不显示为用户取消。
- [ ] 增加可审计的撤销合并；撤销后恢复来源关系和业务状态，不篡改旧事件。

### R4：发生实例、步骤与跨工作区

- [ ] 为周期事项引入 occurrence identity，区分改期、重开与下一次发生。
- [ ] 区分顶层事项和执行步骤，助手规划默认形成 proposal/step，而非平级提醒事项。
- [ ] 一个规范事项只有一个 owner scope；跨工作区只生成关联候选，改变 owner 必须由用户确认。

## 产品决定

以下决定沿用已评审建议，后续实现不得绕过：

1. 终态后的同名提及：有明确“再次/下一轮”才新建 occurrence，有“其实/撤销完成”才 reopen，其余 ASK。
2. 跨工作区：一个 canonical owner，其他工作区会话仅作 evidence；迁移 owner 或跨区合并必须确认。
3. 助手创建：只有直接用户消息包含明确记录/跟进授权时才能提交顶层事项；助手推理只能提案或挂步骤。
4. 语义近重复：新的提及可在高置信时 LINK，已经存在的两条记录不自动 consolidate。
5. 合并历史：保留“B 已并入 A”的记录和全部来源，默认隐藏 merged 副本但允许从审计查看。

## 每阶段完成条件

每个阶段都必须同时满足：

- schema 迁移对 fresh/current/legacy 数据库幂等，`PRAGMA integrity_check=ok`；
- 单元测试、API E2E 与受影响的真实宿主对话覆盖正常、重放、并发、失败恢复和误合并反例；
- SQLite、`extraction_log`、events、dashboard、来源和提醒证据一致；
- 当前架构文档只描述实际通过验证的能力，未完成项继续留在本路线；
- 用户可感知变化同步使用文档和 `CHANGELOG.md`。
