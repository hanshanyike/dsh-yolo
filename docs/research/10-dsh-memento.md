# dsh-memento 分析报告

> 他山之石调研 · 最值得深入研究仓库之一（dsh 生态）
> 一句话：**DSH 生态里把「记忆写入」做成「有界预算 + 不可绕过的审批门 + 双审计链 + 原子并发 + 冻结快照」的高完成度能力接缝。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) |
| 主语言 | JavaScript（ESM `.mjs`，写类型注释但无运行时 TS） |
| 许可证 | Apache-2.0 |
| 当前版本 | v0.4.3（2026-08-21，追 `dsh-session`/`dsh-tools 0.1.0-rc.8`） |
| 维护状态 | 活跃；semver + Keep a Changelog，141 测试 + 协议一致性 22/22，CI 硬化 |
| 定位 | 有界、分层、带审批门、可审计、跨会话的记忆能力接缝（`ctx.memory` 服务 + 本地 SQLite Provider + `memory` 工具 + 冻结快照注入）——「not another memory warehouse」 |
| 技术基线 | engine `node ^22.19\|\|>=24`，用内置 `node:sqlite`（零原生依赖）；peerDeps 走 cordis / dsh-session / dsh-tools / schemastery |

## 定位与主张

主张核心是「**Bounded, layered, approval-gated, auditable cross-session memory**——能力接缝，而非又一个记忆仓库」。它把「记忆写入」当成一个需要**安全治理**的工程课题：

- **双轨（track）**：`user`（用户画像/偏好/雷区/纠正）vs `agent`（环境事实/项目约定/教训/已完成总结）。
- **双层（scope）**：`user-global`（跨工作区）vs `workspace`（按会话 cwd 隔离）。
- **第三隐藏维度 agentKey**：同一 workspace 下再按 `agentPreset` 分隔离层（`''`=共享层）；工具**不暴露**该参数，由写方 session 自动决定——防止模型污染其他 agent 的记忆。
- **预算按 track×scope 四个桶计**：硬字符上限（user 默认 2000/层，agent 默认 4000/层），超限结构化报错**绝不静默截断**。

## 核心架构与运作原理

整体是「三角色 seam」：**Service Definition（`ctx.memory`）/ Provider（本地 SQLite）/ Consumer（memory 工具 + 冻结快照）**。最具工程价值的一点：**协议与实现分离**——写语义抽在 `lib/protocol.mjs` 的 `MemoryProtocolCore`（零 DSH 依赖），`index.mjs` 只是薄子类，只注入两件 DSH 专属物（审批传输、会话事件派发）。

**写路径（add / replace / remove / consolidate / seed）统一流水线**：`预算预检 → 审批 gate → 预算复审 → Provider 事务落盘 → 审计 → 会话事件`，任一步失败无部分写入。

1. **审批门内置在 Service 写方法内部**（不是工具层）：任何路径（memory 工具、其它插件、`/memory` 命令）调 `ctx.memory.add/replace/remove/seed` 都必然过 `ctx.approval.request`。`writePolicy`（ask/auto/off，默认 ask，**模型不可见不可改**）裁决放行；会话级 `approval/never` 由审批服务先裁决，任何 answerer 不可绕过。
2. **审批载荷完整化（approve-what-you-see）**：`add`=新文本全文；`replace`=「旧条目全文 → 新文本」；`remove`=被删条目全文；`consolidate`=每个目标定位原文。**人批准的是具体变更，不是抽象动作**。
3. **被拒写也留痕**：rejected/cancelled/unavailable/off 一律先落 `<action>-denied` 审计行再抛 `WriteDeniedError`。
4. **唯一子串定位 + 零/多命中结构化报错**：`instr(lower,lower)` 大小写不敏感子串；零命中→`ENTRY_NOT_FOUND`、多命中→`AMBIGUOUS_MATCH`（带候选清单），**绝不截断、不接受歧义**。

**注入（冻结快照）**：`ctx.systemPrompt.section` 在会话首个 assemble 时**同步读库渲染一次**，`WeakMap` 按 session 冻结，会话内写入只落库不改快照（前缀缓存稳定）。空记忆渲染空串 → 空段不进 prompt、零 token 成本。快照文本同时写入 `request/header`（system 字段）落会话日志 + `audit(snapshot)` 行——两条独立证据链。

**审计三链**：① 审批对 `approval/asked`（reason 全文载荷）+ `approval/decided`（DSH 自动落日志）；② 插件自有 `audit` 表 `(seq, ts, action, track, scope, entry_id, text, outcome, source, session_id)` 每条写/撤销/召回/快照各一行；③ 快照逐字。**事件可重建**：审计行 + entry `version`（每次 replace 自增）可按 entryId 重建演进史。

**并发/原子/幂等**：SQLite WAL + `busy_timeout=5000` + `BEGIN IMMEDIATE` 串行化写、事务内「定位+变更」原子回滚；跨进程共享 `$DSH_HOME`「谁先写谁赢」（显式文档化边界）；`seed` 单事务原子插入；提案 `INSERT OR IGNORE + UNIQUE(session_id,kind)` 幂等。

## 关键亮点（带证据）

1. **审批门下沉到 Service 写方法 + 载荷带全文（approve-what-you-see）**【lib/protocol.mjs `#ask/#resolveMatch`，index.mjs MemoryService→askApproval】——任何写路径不可绕过；replace 展示旧→新、remove 展示被删全文；审批 reason 自携带可重建信息，是审计链数据源。直接对照 Hermes issue #48181（审批绕开）教训。
2. **双预算门 + 复审**【lib/budget.mjs，protocol.mjs `#assertBudget` 两处】——批准前预检（不打扰先拒明显超限）+ 批准后以此刻真实用量复审（审批等待期可能有并发写），无 TOCTOU 漏洞。
3. **`consolidate`（整合）作为一等原子动作**【protocol.mjs + store.mjs consolidateEntries】——一次审批 + 一次事务把 1..20 条定位条目删并成一；这是「预算压缩」的唯一正规出口，**插件刻意不自动压缩**，把记忆瘦身从隐式魔法变成可见可审计的显式操作。
4. **写定位 = 会话可见集（读与写同语义）**【protocol.mjs `#resolveMatch`，snapshot.mjs visibleEntries】——replace/remove/consolidate 只命中共享层 + 写方 agent 键条目；跨 agent/跨工作区条目不可见、也不可能被误改。
5. **协议与实现分离 + 跨 Provider 一致性套件（0.4.0）**【lib/protocol.mjs + test/protocol-conformance + docs/schemas】——第三方 store（mem0/Hermes/CLAUDE.md）可经 `ctx.memoryAdapters` 适配器接入，把记忆仓库变成可生态化的标准 seam。
6. **提案式记忆（auto-capture）**【index.mjs handleSessionEvent + PROPOSALS_SCHEMA_SQL】——监听 `compaction/end`，把压缩摘要截成 `proposals` 提案（幂等 `(session_id,kind)`，pending 满则弃新），**只落提案不写记忆、不调模型**，由用户/命令 approve 才转正式记忆——正是「LLM 语义抽取 → 人工审批门」流水线。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度与差距

**同源可借鉴**：记忆抽取的「提案」机制、审批门 + 预算 + 审计 + 原子写、冻结快照、fail-closed、`/memory export/import` 迁移，与 dsh-yolo「动作统一走 applyYoloAction、审计一致、绝不越权」哲学高度同源。它解决的是「记忆如何被安全、有界、可审计地读写」，是 dsh-yolo 可复用的全套骨架。

**关键差距**：grep 全程无 `remind/due/deadline/schedule/trigger/notification`——**没有 due-date / 提醒调度 / 完成状态迁移**；没有待办状态机（done/postponed/cancelled/reopen/undo/notification-card）；没有每轮对话结束的自动抽取/去重/节流（有幂等但无语义去重）；没有侧栏角标/未处理计数/轮询——「记忆→可推进的待办与提醒」这一步它完全没做，正是 dsh-yolo 的关键领域。

## 明显的不足 / 局限

1. **检索是大小写不敏感子串，无 FTS5**——作者实测 Node22 内置 FTS5 对单字 CJK 不可用（trigram 无法索引单字、unicode61 把 CJK 段当一个 token）才弃用；对 dsh-yolo「以中文记忆为主」这其实是**正确取舍**，但语义召回是硬短板。
2. **`session/event` 会话事件派发被刻意关闭**（memory/* 类型在 rc.8 无 writer 面）——「记忆变化实时同步给 UI/消费者」的事件通道实际不可用，只能轮询/审计表；**事件驱动的响应式看板现阶段做不了**。
3. **依赖 DSH 审批 seam + 外部应答器**——host 无人类 UI answerer 或 ACP 时，`writePolicy=ask` 的写会 `unavailable` 被拒（fail-closed，安全但可用性差）；auto/off 是逃避手段但牺牲审批。
4. **无自动/语义记忆抽取（fire-and-forget）**——记忆靠模型自觉调工具 + 摘要提案（被动），默认新会话不自动写任何东西，可能漏记语境。
5. **跨进程 read-modify-write 竞态**——`busy_timeout` 只保证串行写，不保证跨进程「预算/替换定位」的 read-改-写一致性。
6. **审计/快照量级膨胀**——`audit(snapshot)` 每次会话首 assemble 落一行含全量快照全文，长记忆放大体积；retention 是唯一裁剪手段。

## 对 dsh-yolo 的具体借鉴点（与 applyYoloAction 对照）

1. **把「门」下沉到 Service 写方法内部**——dsh-yolo 的动作统一 `POST /yolo/actions → applyYoloAction` 的技术同构：所有看板状态迁移必经同一中间件，杜绝 UI/模型/命令三套逻辑。
2. **审批载荷完整化 + `<action>-denied` 审计**——「取消也需留痕」纳入动作审计，不只完成时 toast。
3. **预算门双校验 + 原子事务 + 绝不静默截断**——看板卡片/注入 token 设硬预算时复用 `checkBudget` 结构。
4. **冻结快照 + WeakMap 按 Session 冻结 + request/header 逐字落日志**——看板若要把「当前待办注入模型」，应养成「会话首拍一次、会话内不变」的冻结块（前缀缓存稳定）。
5. **唯一子串定位 + 零/多命中结构化报错**——「改哪张卡/删哪条」用唯一子串 + candidate 清单，避免模糊命中误删。
6. **`consolidate` 作为显式原子动作**——dsh-yolo 可做一个等价的「卡片合并/去重」动作，作为看板瘦身的唯一正规出口。
7. **提案式记忆（compaction→proposals→approve）**——正是 dsh-yolo 核心「对话语义抽取写记忆」的干净解析：把 LLM 抽取的不可靠结果挡在审批门外。
8. **fail-closed 与版本迁移梯子**——store schema 升级与动作审计照此保证可安全升级、可重建。

## 一句话结论

一个把「记忆写入」做成**有界预算 + 不可绕过审批门 + 双审计链 + 原子并发 + 冻结快照**的高完成度 DSH 能力接缝，与 dsh-yolo「不越权执行 / 动作统一 / 审计可重建」的原则高度一致，是**本批最值得逐行对照工程实现的项目**；但它刻意不实现 due-date、提醒调度、完成状态迁移等待办看板语义——那正是 dsh-yolo 需要自建并形成差异的空间。

---
*资料来源：仓库 index.mjs、lib/protocol.mjs、lib/gate.mjs、lib/store.mjs、lib/snapshot.mjs、lib/budget.mjs、ARCHITECTURE.md、CHANGELOG.md、package.json（源码级分析）。*
