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

- [x] **输入幂等**：direct-human 抽取 turn 与助手工具调用具有稳定 operation id；请求哈希检测 id 冲突，
  evidence 指纹再绑定规范事项；相同操作重放不重复创建事项、证据或状态事件。
- [x] **多会话证据**：新增不可变 `todo_evidence`；一个事项可关联多个 session/turn，分别记录 origin、
  mention、update、correction、completion claim 或 discussion。
- [x] **旧数据兼容**：现有 `todos.session_id/source_excerpt/source_turn` 保留为兼容投影，并幂等回填首条
  origin evidence；旧库连续打开不得重复回填。
- [x] **状态分离**：`todos` 增加记录状态与规范事项指向；合并副本标为 merged，不再伪装成业务 cancelled。
- [x] **规范事项解析**：旧 id 可以解析到 canonical id；merged 副本不能通过普通 reopen 重新进入开放集合。
- [x] **确定性标题防重**：标题 dedup 只在 open canonical 候选中生效，并使用稳定排序；终态项和 merged
  副本不能抢占候选。
- [x] **助手操作纳入同一证据链**：助手工具写入记录触发它的会话/轮次和 operation fingerprint；工具重试
  不产生新事项。
- [x] **审计与投影一致**：dashboard、SQLite、事件、来源列表、提醒和快照都只把 canonical 事项作为可操作项。

本轮明确不开放：基于向量或 LLM 相似度的自动 consolidate、跨工作区自动改 owner、周期 occurrence、
父事项/步骤模型，以及带冲突裁决的自动终态合并。

## 后续阶段

### 2026-08-30 路线复核

- **R1 必须先于 R2。** 当前抽取仍依赖固定数量的标题摘要，缺少终态、历史别名与真实改写候选；没有
  shadow 样本就无法知道“高置信”阈值对应的漏关联和误关联风险。先观察、后放权的顺序正确且必要。
- **R2 只负责放权，不重复实现幂等。** 显式 id 和相同 source fingerprint 已由 rc5 的确定性链路处理；
  R2 的新增风险面应收窄为“新的同 scope 提及是否可按 shadow 结果 LINK/UPDATE”，并以分层标注指标为门。
- **R3 仍必要，但不应提前。** 当前显式 consolidate 已能保留目标业务状态并处理终态重复；剩余价值是
  冲突确认、投影迁移和可审计撤销。在 R2 尚未产生安全候选前先做确认界面，用户收益有限。
- **R4 方向正确但范围过宽。** occurrence、step 和跨工作区 owner 分别影响状态机、信息架构与权限路由；
  到达该阶段时应拆成三个独立批准项，不以一个版本同时交付。

### R1：候选召回与 shadow resolver

- [x] 从当前输入召回相关开放项、终态项和历史别名，向模型提供稳定 id，而不是固定前 N 条标题摘要。
- [x] 输出 `LINK / UPDATE / REOPEN / NEW_OCCURRENCE / CREATE / ATTACH_STEP / ASK / NOOP`，先只记裁决日志，
  不改变现有写入结果。
- [x] 建立人工标注样本，分别统计漏关联和误关联；按表达改写、指代、省略、跨会话和同名异项分层。

R1 的长期回归 gold corpus 位于 `tests/fixtures/todo-resolver-labeled-cases.jsonl`，其来源与维护约束见
`tests/fixtures/README-todo-resolver-gold.md`。该语料是人工构造的中文 shadow-style 场景，不冒充真实生产日志，
也不能单独证明线上准确率；真实 shadow log 通过
`scripts/todo-resolver-eval.mjs export` 形成待标注 JSONL，补齐 `expected` 后用 `evaluate` 分别输出
false-link / missed-link 及分层比率。完成 R1 只表示具备观察和评估闭环，不表示 R2 已获得自动写入授权。

### R2：高置信 LINK 与 UPDATE

R2a 的确定性准入策略和审计脚手架已经实现，配置保持默认关闭。长期 gold 源文件继续保持 prediction
为空，真实宿主回放生成独立副本；当前对抗式 42 条语料的 `shadow-v2` 回放已通过 engineering gate，
足以支持向用户提供默认关闭的实验开关。已实现代码只为唯一开放候选的高置信 `LINK` 和明确
`due_at` `UPDATE` 保留稳定 ID 路径；状态、优先级、标题/收件人/详情、终态、occurrence、step、
多候选和跨工作区仍不授权。

R2b 已提供宿主配置回放与 engineering gate：`pnpm eval:todo-resolver` 在临时空工作区启动官方 dsh，
直接复用 `ctx.llm` 的 provider/model/credential，把 prediction 写到 gold 之外的新 JSONL，并生成分层、
置信度和自动准入报告。人工语料本身按对抗方式覆盖接近真实的改写、指代、省略、同名异项、终态和步骤；
近期不再把另一套独立真实对话 holdout 当作实验开关的硬门槛，也不因一次回放通过就自动改写默认值。

- [x] 使用真实宿主模型配置回放长期 gold，生成不含凭据和原始模型文本、路由与时钟可审计的 prediction/report。
- [x] 对 prediction 完整性、单一路由、分层样本、false-link、missed-link、exact、高置信误授权和安全覆盖设门。
- [x] 把 `todoIdentityR2Enabled` 加入助手看板设置，标记为实验性、默认关闭，并准确说明
  只会 LINK 唯一开放事项或按稳定 ID 修改明确截止时间。
- [ ] **低优先级评测债务：**当用户反馈误关联/漏关联，或 resolver 模型、prompt、阈值、授权范围有实质变化时，
  从脱敏真实 shadow 日志扩充并独立标注评测集；不为形式上的“另一套 holdout”阻塞当前实验入口。

- [ ] 保持显式 id / source fingerprint 的确定性幂等链路；只把经指标批准的同 scope 新提及自动关联。
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
