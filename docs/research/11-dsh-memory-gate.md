# dsh-memory-gate 分析报告

> 他山之石调研 · 最值得深入研究仓库之一（dsh 生态）
> 一句话：**「检索到 ≠ 注入」——一套纯本地、零额外模型调用、以可解释裁决与反馈闭环控制记忆是否进上下文的低打扰记忆闸门（CBDC 门控）。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [GIT121995/dsh-memory-gate](https://github.com/GIT121995/dsh-memory-gate) |
| 主语言 | TypeScript（ESM，Node >=22.5，零运行时依赖，仅 schemastery） |
| 许可证 | MIT |
| 当前版本 | v0.11.1（2026-08-18，修 5 个 review bug） |
| 维护状态 | 活跃个人项目；每版明确 "release" |
| 定位 | 只负责「记忆被存下来之后怎么用」：每次模型调用前 CBDC 裁决（use/verify/ignore）决定哪条记忆能进上下文，用后反馈校准置信度，全程可审计 |
| 技术基线 | 本地 Node `node:sqlite` + FTS5，无 embedding、无第二次模型调用、无外部 API |

## 定位与主张：CBDC &「检索到 ≠ 注入」

CBDC = **Claim → Belief → Decision → Consumption** 四阶段，不是简单存取：

1. **Claim**：用户明确陈述形成的带作用域/来源/生命周期的主张（state 有 active/superseded/tombstoned）。
2. **Belief**：用 Beta 分布 `alpha/(alpha+beta)` 表示可用置信度，另累计 `harmful_count`。
3. **Decision**：结合相关度、新鲜度、置信度、风险裁决 `use/verify/ignore`。
4. **Consumption**：人工标记 helped/harmful/stale/conflict 反向回写 Belief。

主张核心是**决断权在「使用」而非「存储」**——解决「记忆记住了，然后呢？」。Harness Session 日志仍是会话事实源，插件 DB 只是「可重建的长期记忆投影 + 独立审计侧车」。

## 核心架构与运作原理

**数据流四线**：写入线（`user/message → turn/end` 保守提取器 → secret gate → Claim）、召回线（`agent/pre-step` 第一步 FTS+词项召回 → CBDC 决策 → 模式过滤 → 注入）、反馈线（`/memory feedback` → Consumption+Evidence → 置信更新）、审计线（retrieval_runs / authority_decisions / injections / consumption 四表）。

**use / verify / ignore 决策优先级**（`src/authority.ts` 纯函数，独立可测）：
非 active → ignore；已过期 → verify；`harmful_count ≥ 2` → ignore（隔离）；词法相关 < 0.12 → ignore；弱相关（<0.5）→ verify；新鲜度 < 0.2 → verify；belief < 0.7 或 risk > 0.45 → verify；其余 → use。Risk 基线按 kind 分级（preference 0.12 < fact 0.2 < procedure 0.28 < constraint 0.34 < warning 0.4），叠加 `(1-belief)*0.3` 与 harmful 历史。排序权重 `词法×0.62 + belief×0.23 + freshness×0.15 + scope boost + capsule boost`。

**shadow / assist / enforce 三模式**（默认 assist）：shadow=计算审计但零注入；assist=注入 use 且 verify 标 `[VERIFY #n]` 线索；enforce=只注入 use。

**置信度管理**：新显式 Claim `alpha=6,beta=1`（belief≈0.857 可直用）；启发式 `alpha=4,beta=2`（0.667 默认不足）。反馈增量：helped `+α1`；harmful `+β5` 且计数+1；stale `+β2`；conflict `+β4`。

**使用中克制**：默认 ≤3 条 / 1200 字符；`verify` 只配短预算（160 字符），`use` 才拿全宽（「敢用才配多花」）；滚动窗口 20 回合内已注入 ≥ 20000 字符则收紧（跳过 verify 只注入 use）。**全程无第二次模型调用**。

**使用后学习**：`/memory ok` 把最近注入的查询**词项**（不存原文）学进 `learned_terms_json` 重索引 FTS——换说法也能命中；harmful/stale 降置信并隔离。

**近重复 supersede 合并（v0.9）**：写入时与同作用域现有活跃 claim 词项重叠 ≥ 60% → 旧标 superseded；手动 `consolidate` 全库扫描合并。

**self-diagnose 自动降级**：最近 50 条消费记录若负反馈（harmful/stale/conflict）占比 ≥ 0.4 且样本 ≥ 5 → `degraded`、自动切 `shadow`（零注入）、`/memory status` 红标、手动恢复后重评。

**autoMine 回挖**：手动 `/memory mine N` 扫历史 `session.jsonl.zstd` 用更宽 cue 补提取；autoMineWorkspace 会话第一轮自动扫同 workspace 历史 session（按 cwd 哈希匹配，不串味），每会话一次。

**作用域与安全**：`session:<id>` / `workspace:<sha256-24>`（**只存哈希不存路径**）/ `global`（只允许显式建）；secret gate 落库前正则拒绝 API key/GitHub/AWS/Bearer/密码/私钥 6 类；**全程 fail-open**（任何 DB/检索异常返回原消息数组，Agent 照常）。

## 关键亮点（带证据）

1. **「检索到 ≠ 注入」+ 可解释 use/verify/ignore**，每次决策落 reasonCodes，`/memory explain` 逐条审计【src/authority.ts + src/commands.ts】。
2. **零额外推理成本门控**：召回全本地 FTS5，无 embedding、无第二次模型调用、无外部 API，实测 p95 完整召回 11.151ms【README/docs/benchmark.md + src/repository.ts】。
3. **闭环学习：反馈回灌触发词 + supersede 相似去重**——「越用越准」是数据驱动而非假设【src/repository.ts】。
4. **克制优先 + 预算分级 + 自我降级**：默认 3 条/1200 字符、verify 短预算、滚动 20 回合预算阀、负反馈率 0.4 自动降 shadow——完整低打扰/防污染护栏链【src/service.ts】。
5. **capsule 特权通道 + workspace 只存哈希 + 全程 fail-open + 敏感模式跨繁体/全角归一**——高敏感隐私设计样板【src/repository.ts / src/scope.ts / src/text.ts】。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度与差距

**强契合**：CBDC「该不该进上下文/纯净上下文」与 dsh-yolo「纯净上下文、低打扰」哲学同源——都是主张「管理而非生成/不执行」；反馈校准回写置信（use 后 harmful/stale → 降 belief+隔离）与 dsh-yolo「由用户在看板做完成/推迟/取消驱动状态迁移 + 审计」都是以用户动作作地面真值反哺系统；低打扰护栏与 dsh-yolo「绝不打扰工作会话」一致。

**重大差距（dsh-yolo 核心它没有）**：**完全没有提醒/调度/看板/状态机**——无时间触发、无 due/完成/推迟/取消状态模型、无 `applyYoloAction` 式统一入口、无看板 UI、无 30s 轮询、无完成 toast 撤销。它是**被动-调用期门控**：每个 agent/pre-step 查一次，**没有到点主动醒来的能力**。且明确 v1.1 无 LLM 语义抽取、无向量、无自动 outcome 归因、无 UI。

## 明显的不足 / 局限

1. **词法级触发词召回，非语义**：覆盖率比值 + 词项重叠，无语义向量；换个说法（非同义词组覆盖）就漏【src/repository.ts + 自认 README】。
2. **自动提取只认明显 cue、宁缺毋滥**：固定正则短语（记住/以后/请始终/我偏好/不要再…），`extractDurableClaims` 一次只出 1 条，提问句跳过；非 cue 但实为长期偏好的陈述漏【src/extractor.ts】。
3. **无语义去重/分类的碎片化风险**：supersede 靠 60% 词法重叠；语义等价但用词迥异不合并；consolidate O(n²) 无索引加速【src/repository.ts】。
4. **feedback 依赖用户主动 + 自动 outcome 归因粗糙**：需手动 `/memory ok`；无服务端自动归因；长时间不反馈置信度漂移【docs/architecture.md 自认】。
5. **无提醒/时间调度、无历史回填、无 UI**：不能主动到点提醒；安装前会话不回填；无浏览器管理看板【README/docs】。
6. **识别器语言与停用字硬编码、保守**：繁→简表、停用字、同义词组是有限硬编码；单字关键信息难召回【src/text.ts `run.length===1 → []`】。
7. **部分内存态非持久**：Budget/自查的 injectionHistory/minedSessions 为实例字段，进程重启清零；`/memory mode` 运行时切换重启失效【src/service.ts】。

## 对 dsh-yolo 的具体借鉴点

1. **门控判定（最重要）**：把「这条记忆/提醒要不要注进上下文」从「命中就注入」升级为可解释裁决 use/verify/ignore，阈值改成配置项，产出 reasonCodes 供审计。
2. **反馈校准回写置信（闭环）**：把用户看板动作当同行地真值，参照 `recordConsumption` 的 Beta 增量映射回写该条记忆/提醒置信——正是 yolo「动作统一走一条路径 + 审计事件一致」的天然延伸。
3. **supersede 相似去重**：写入前查同作用域重叠 ≥ 阈值的活跃条，旧标 superseded，防止长期记忆/提醒「相近表达堆成多条」。
4. **降级模式（低打扰护栏）**：负反馈率阈值 + 最小样本 → 自动降级零注入，叠加预算阀与 verify 短预算分级，是「绝不打扰工作会话」的现成范式。
5. **capsule 特权通道承载「始终生效」的高稳规则**：全局 preference/constraint 无条件注入，可用来保留用户硬约束（如「工作时别插提醒」）。
6. **audit 侧车 + workspace 只存哈希 + `/memory explain` 全程可查**：高敏感隐私设计与可审计性的直接样板。

## 一句话结论

一套**「纯本地、零额外模型调用、以可解释裁决与反馈闭环控制记忆是否进上下文」的低打扰记忆闸门**，其 use/verify/ignore 门控、反馈回写置信、supersede 去重与自动降级护栏，恰好为 dsh-yolo 的「纯净上下文、低打扰、不越权执行」提供了可直接借鉴的注入决策范式；但它只解决「记忆使用」，**完全没有提醒调度、看板状态机与主动触发**——这正是 dsh-yolo 的核心差异与价值所在，两者互补而非替代。

---
*资料来源：仓库 src/authority.ts、src/service.ts、src/repository.ts、src/text.ts、src/extractor.ts、src/mine.ts、src/harness.ts、src/commands.ts、docs/architecture.md、README.md、package.json（源码级分析）。*
