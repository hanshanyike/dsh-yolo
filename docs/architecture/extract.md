# `src/extract/`：语义提取

## 职责与边界

该插件是 dsh turn adapter：在真实工作会话的一轮对话结束后，用一次 LLM 结构化调用识别 commitments、plans 与
tracking rules，并把已接受结果交给 `application/ingestion`。它不依赖主 agent
主动调用写入工具，也不使用逐消息正则快速路径；YOLO resident/anchored 内部会话会被跳过。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、turn 触发、配置读取、节流/配额、LLM 编排与失败隔离；消费 `ctx.yolo.observations` |
| `llm-extract.ts` | LLM 调用、内容折叠、JSON 解析和防御式校验 |
| `prompt.ts` | 抽取提示词与已知记忆摘要 |
| `todo-resolver.ts` | 稳定 ID 候选渲染、shadow 身份裁决与严格结果校验；模型输出本身没有写权限 |

## 数据流

```text
agent/pre-step（只捕获本轮实际进入模型的 direct-human 消息 + 工具执行前的 identity candidates）
  → 唯一 ctx.yolo.observations 按 session + turn 保存捕获
  → agent/turn-stopping 仅排队，不等待辅助模型
  → agent.whenIdle() + durable turn/end completed|max-tokens
  → 跳过 YOLO 内部会话
  → 现代宿主若本 turn 没有 direct-human 捕获则跳过（Goal 自动 round 不抽取）
  → 本轮 direct-human 输入折叠为有界文本（排除 plugin/tool context）
  → minTurnChars、每日运行次数/预算检查
  → buildKnownContext（包含已知状态、进度、到期与标题）
  → 独立 AbortController + llmExtract + 严格 JSON schema 入口 + validateExtraction
  → 从写入前快照读取 todo identity candidates（开放、终态、merged alias、evidence）
  → 独立 resolver 输出 LINK / UPDATE / REOPEN / NEW_OCCURRENCE / CREATE /
    ATTACH_STEP / ASK / NOOP
  → 默认关闭的 R2a 确定性策略评估是否具备唯一、安全的稳定 ID 写入资格
  → shouldDropExtracted 质量过滤
  → 只从 captured direct-human 消息生成有界来源摘录与 turn 元数据
  → 生成 session + turn 稳定 operation id 与规范化请求哈希
  → compatibility cwd 解析为 workspace ScopeRef
  → runIdempotentScopeAction 建立单 workspace UnitOfWork
  → application/ingestion/apply-extraction 按策略写 todos/milestones/goals/preferences/events
  → 再应用 updates[] 的状态变化并追加 todo_evidence
  → extraction_log / session summary 审计与 operation 结果同事务提交
  → todo_resolution_log 记录候选、模型裁决、路由、用量、失败及独立 application policy receipt
```

先新增、后更新保证“同一轮创建并完成”能够命中新条目。`updates[].match_title` 应复用 known
context 的标题；定位时优先精确归一化匹配，再按活跃状态与新近度选择宽松匹配。无法匹配的
LLM 标题会被静默丢弃，不会让整轮失败。

来源摘录不是第二份 transcript：只使用本轮 `agent/pre-step` 捕获且 `source.kind=user` 的直接用户输入，
不包含 system、assistant、tool、Goal continuation、模型提示词或完整会话历史。旧宿主缺少可靠捕获时，
derived-message fallback 仍可作为抽取输入，但不会被当作可引用证据写入。`source_turn` 目前只用于预览
元数据和 tool/extraction 同轮对齐；宿主只支持打开会话时，界面不得声称能够精确定位到该轮。

每个 durable `(session, turn)` 生成版本化 operation id，并与本轮输入的规范化请求哈希绑定。模型调用在
崩溃恢复时仍可能重新发生，但存储副作用由 `runIdempotentScopeAction` 在单 workspace store 内原子保护：相同 operation 与请求重放原
结果，不重复生成事项、状态事件或 `extraction_log`；同一 id 携带不同输入会报告 conflict。每个被该轮
创建、复用或更新的事项再以 `(operation id, resolved canonical todo id)` 生成 evidence fingerprint，因此
一轮可以关联多个事项，同一事项也可以累积多个会话/轮次的 evidence。

若主 Agent 已在本轮同步调用 `memory_write`，tool 行会携带同一 session。后台任务在调用辅助模型前，
现代宿主优先要求 tool 行的 `source_turn` 等于当前抽取 turn；只有旧宿主缺少 turn 时，才退回本轮
accepted 到后台 started 的闭区间。辅助模型返回 new todo、update 或合法 empty 都能补充本轮 direct-human
evidence；tool call 自身仍保留独立的 assistant_action evidence。相同标题或有界包含匹配会复用同一 open
canonical 行，同时后续轮次不会被前一轮摘录误绑定。该对齐仍是确定性标题/包含关系，不代表语义近义
resolver 已经实现。对已经落到相同 due_at 的重复 postpone 是领域 no-op，不重复写最近变化。

`extraction_log.status` 的现行 `hasContent` 判断只统计 todo、milestone、goal 与 `updates[]`；
仅抽到 preference、event 或 session summary 的轮次仍会记为 `empty`。这是当前审计口径，不代表
这些内容没有写入。

`extracted_json` 保存原始模型文本、归一化后的 `parsed`、finish reason、实际 provider/model 路由、
输入规模和 token usage。不能只保存归一化结果，否则错误 schema 与真正空抽取无法区分。

事项身份裁决使用**第二次、独立的辅助模型调用**。候选在 `agent/pre-step` 接受 direct-human 输入后、
主 Agent 执行工具前快照，避免 resolver 看到本轮刚改写的 due/status，或让本轮新建事项成为自己的历史
候选；缺少可靠 pre-step 的兼容宿主才在后台召回并排除同 session/turn 的 assistant-action origin。原有
`llmExtract` 先完成结构化解析，resolver 再对写入前候选分类；随后二者一起交给单 workspace ingestion。
resolver 超时、错误 schema 或模型失败会回退原抽取路径，不能阻止普通记录。候选来自 resolver 专用索引，先把 merged alias 解析为
canonical id，再把稳定 id、业务状态、截止时间和历史别名交给模型。resolver 只能引用候选 id；它输出的
`LINK / UPDATE / REOPEN / NEW_OCCURRENCE / CREATE / ATTACH_STEP / ASK / NOOP` 先作为 observation 进入
`todo_resolution_log`，模型的 confidence 不能自行授权写入。

R2a 的确定性 application policy 版本为 `r2a-v1`，配置 `extraction.todoIdentityR2Enabled` 默认 `false`。
只有显式开启后，单一 resolver 结果、单一开放 canonical 候选、置信度至少 `0.98` 且抽取形状无歧义时，
才允许 `LINK` 追加 mention evidence，或让只含明确 `due_at` 的 `UPDATE` 按稳定 ID 进入既有 postpone 领域动作。
状态、priority/title/detail/recipient、终态、occurrence、step、多候选和多 mention 均不授权；开启前还必须以
当前模型 prediction 的分层 false-link/missed-link 报告获得单独批准。策略计划与实际结果写入
`todo_resolution_log.application_json`，便于区分模型建议和系统动作。

R2c 在 application receipt 中同时保存实际 `evidence_id`，UPDATE 还保存 `due_before/due_after`。用户判定
关联不准确时，统一动作 `identity_reject` 追加 `todo_identity_feedback`，不会改写 resolver/evidence 原始行；
错误 evidence 从有效来源和 identity FTS 排除。只有事项截止时间仍等于该 receipt 写入值时才撤销自动改期，
否则记录 `conflict` 并保留用户后续修改。

日志保存本轮输入的 1000 字符有界摘录和请求 fingerprint，供本机人工标注；不保存完整 transcript。
`scripts/todo-resolver-eval.mjs` 可以导出 JSONL 标注队列，并按 paraphrase、pronoun、ellipsis、
cross_session、same_name_distinct、terminal、step 等层统计 false-link 与 missed-link。人工标签和当前模型
观测达到后续批准阈值前，shadow 结果不具备写入权限。

## 配置与运行约束

- `extraction.enableLLM`：总开关。
- `extraction.model`：辅助抽取模型。
- `extraction.minIntervalSec`：同 session 后台调用的最小间隔，默认 30 秒。快速连续轮次进入串行队列并延后执行，
  不再直接跳过已完成轮次。
- `extraction.minTurnChars`：短闲聊闸门，默认 4。
- `extraction.maxRunsPerDay`：每日运行次数上限，默认 300。
- `extraction.todoIdentityR2Enabled`：R2a 实验开关，默认关闭；助手看板设置可显式保存该值。
- `extraction.todoIdentityR3Enabled`：R3 重复事项合并建议开关，默认关闭；只控制看板候选投影，合并仍需
  用户预览、选择保留项并提交 `CONFIRM_CONSOLIDATE`。
- 模型流量使用宿主允许的 `purpose: 'session-title'`；该联合类型没有自定义 purpose。
- 每个通过现有抽取闸门的 turn 在主抽取解析后运行一次 resolver；它沿用同一 provider/model
  路由，但独立记录 token 和耗时。每日上限仍按主抽取 turn 计数，不把第二次调用误算成第二个 turn。
- provider/model 优先继承当前 agent 的完整路由，其次使用宿主 `agentDefaultModel`。历史 `extraction.model`
  只有在 DeepSeek provider 上覆盖模型，避免把 `deepseek-chat` 错配给其他 provider。
- 模型以 `error`/`aborted` 结束或没有返回文本时记为抽取错误，不再伪装成 `empty`。
- 错误 JSON 或不含抽取 schema 字段的 JSON 记为 `error`；只有合法的空 schema 才记为 `empty`。
- `due_at` 接受兼容的 `YYYY-MM-DD`，有明确时间或相对分钟时必须保存带时区的 ISO-8601 datetime；
  相对时间以宿主接受本轮首条直接用户输入时捕获的本地时钟为准，不能因等待 agent 空闲或抽取节流跨过
  午夜而改变“今天/明天”的日期。缺少 `agent/pre-step` 的兼容宿主才回退到后台任务启动时间。
- aborted/blocked/error/interrupted 的 turn/end 不抽取；插件卸载会中止正在运行的后台抽取。
- Goal continuation 是 `role=user`、`source.kind=goal` 的自动消息，每个 round 都是独立 turn；它不代表
  新的用户承诺，不能触发抽取。现代宿主有 durable event log 时，没有本轮 direct-human 捕获就直接跳过；
  只有无 event log 的兼容宿主可回退到 derived messages，且仍必须满足 `source.kind=user`。
- Goal 执行期间新到达的真人 steering 仍由 `agent/pre-step` 捕获，只抽取该真人消息，不混入 Goal 文本。
- 没有 durable turn 或稳定工具 call id 的兼容宿主只能依赖开放 canonical 标题去重和领域 no-op；不能承诺
  exactly-once，也不能用时间窗或 payload hash 冒充宿主操作身份。
- handler 必须隔离异常并写日志，不能把抽取失败抛回 agent 循环。

## 记忆范围

只保留需要管理的承诺、计划、目标/里程碑、日程事件和跟踪规则。人格、泛知识、随口偏好与
无后续管理价值的生活细节不属于本模块的长期记忆范围。

## 架构归属

- direct-human turn、最近 cwd 和 turn cadence 的唯一 owner 是 [`runtime/turn-observation.ts`](runtime.md)，extract 不保存第二份 session 状态。
- accepted extraction 的写入组合与 known context 位于 [`application/ingestion`](application.md)。
- 领域类型与 extraction DTO 分别来自 [`domain`](domain.md) 与 [`contracts`](contracts.md)。
- `ctx.yolo` 当前提供 scope bridge、single-store UoW 与 repository compatibility；catalog 不加入 extraction transaction。

## 相关文档

- [记忆与召回](memory.md)
- [存储服务](storage.md)
- [应用用例](application.md)
- [运行时观察](runtime.md)
- [事项身份、去重与会话关联路线](../roadmap-todo-identity.md)
