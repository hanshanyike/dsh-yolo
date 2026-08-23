# 他山之石 · 总报告

> dsh-yolo / WorkBuddy 竞品与参照调研总览
> 主题：跨会话长期记忆 + 主动提醒 + 看板式管理的个人 AI 助手。
> 数据截至 2026-08，均为开源公共仓库的公开信息（代码、README、文档、GitHub 元数据）。

## 一、调研范围与方法

1. **两个目标仓库源码级深读**：本地克隆 `omdsh-dev/dsh-mnemon` 与 `csyangwen/dsh-memory-evolve`，读取 README/文档 + 关键源码模块 + 测试，做逐项分析（见各项目报告）。
2. **公开候选扫描**：通过 GitHub 站内检索/网页搜索，扫描了 threed 大类的类似项目——**LLM/Agent 记忆层框架**、**个人第二大脑 / 个人记忆应用**、**dsh 生态及其它「记忆+提醒+待办」助手**。筛掉了未核实真实存在、已长期停更、或无法确认维护状态的仓库。
3. **优选取控**：在 10+ 个候选里，按「仍活跃维护 + 做得好 + 与本项目定位相关」收敛为 **12 个逐项报告 + 本总报告**：2 个主动目标仓库 + 3 个外部记忆/Agent 项目 + 2 个个人第二大脑 + 1 个 dsh 生态清单（`08`）+ **4 个 dsh 生态"最值得深入研究"仓库（`10`–`13`，源码级真机实现）**。其余候选并入下文「扫描池」。

## 二、优选清单与定位分类

| # | 项目 | 分类 | 一句话定位 | 维护状态 |
|---|---|---|---|---|
| 01 | [dsh-mnemon](../research/01-dsh-mnemon.md) | dsh 生态 · 记忆控制面 | 三层记忆 + 九个可插拔 Provider + 受监督 Agent 驱动 | 活跃 |
| 02 | [dsh-memory-evolve](../research/02-dsh-memory-evolve.md) | dsh 生态 · 全家桶助手 | 五轨记忆 + 待办 + 自我进化 + 主动调度 + 评审 + 同步 | 活跃 |
| 03 | [mem0](../research/03-mem0.md) | Agent 记忆层 | 通用记忆层，用户/会话/Agent 分层 + 混合召回 | 活跃 |
| 04 | [Letta](../research/04-letta.md) | 状态化 Agent | 记忆/身份/经验 + Cron + skills 的 Agent OS | 非常活跃 |
| 05 | [Zep/Graphiti](../research/05-zep-graphiti.md) | 时间知识图谱 | 带有效时间窗的事实记忆 + 自动失效 | 老仓库停维、框架再推进 |
| 06 | [Basic Memory](../research/06-basic-memory.md) | 本地优先记忆 | Markdown + MCP 的跨会话持久记忆 | 活跃 |
| 07 | [Khoj](../research/07-khoj.md) | 个人第二大脑 | 文档检索 + 联网 + Agent + 自动化 + 通知 | 活跃 |

> **最值得深入研究（dsh 生态 · 源码级真机实现）**——`08` 号清单中按「做得好 + 与 dsh-yolo 定位契合 + 可落地」筛选出的 4 个，逐行分析见 `10`–`13` 号报告：

| # | 项目 | 分类 | 一句话定位 | 维护状态 |
|---|---|---|---|---|
| 10 | [dsh-memento](../research/10-dsh-memento.md) | dsh · 记忆治理 | 有界分层 + 不可绕过审批门 + 双审计链 + 冻结快照的记忆接缝 | 活跃（v0.4.3） |
| 11 | [dsh-memory-gate](../research/11-dsh-memory-gate.md) | dsh · 记忆门控 | 「检索到 ≠ 注入」：CBDC use/verify/ignore + 反馈校准 + 自动降级 | 活跃（v0.11.1） |
| 12 | [dsh-memory-lite](../research/12-dsh-memory-lite.md) | dsh · 轻量记忆 | 文件即真相 + 字节预算贪心注入的极简长期记忆 | 极早期（v0.1.0） |
| 13 | [dsh-auto-memory](../research/13-dsh-auto-memory.md) | dsh · 记忆+提醒 | 三层记忆 + 每轮自巩固 + 跨工具继承，「弱主动」日历提醒 | 活跃（v0.1.29） |

## 三、横向对比（关键维度）

| 维度 | dsh-mnemon | dsh-memory-evolve | mem0 | Letta | Zep/Graphiti | Basic Memory | Khoj |
|---|---|---|---|---|---|---|---|
| **定位层次** | dsh 记忆控制面 | dsh 全家桶助手 | 通用记忆层 SDK | 状态化 Agent OS | 时间知识图谱 | MCP 记忆服务 | 个人第二大脑产品 |
| **记忆分层** | 运行时/档案/记忆体 3 层 | 用户/全局/项目KEY/项目日志/每日 5 轨 | 用户/会话/Agent 3 级 | Core/Archival/Recall 3 层 | 实体/事实/关系 + 时间 | 笔记文件 + wikilink | 文档索引 + RAG |
| **写入方式** | 受监督 subagent，宿主定校验 | 回合尾提示 + 程序盖章 | Agent 主动写/API | Agent 自管理 memory | 增量抽取 | MCP 工具 | 会话 + 文档摄入 |
| **写入确认制** | 部分（受监督） | **强（待确认队列）** | 无 | 无（Agent 自决） | 自动 | 无 | 无 |
| **召回** | 多 Provider 融合 + recall-quality | 语义 + 分支过滤 + 渐进披露 | 语义+BM25 混合 | 按需 + 检索 | 图遍历+语义+关键词 | 语义 + wikilink | 语义检索为主 |
| **上下文控制** | 字节预算投影 + 按需全文 | 摘要注入 + 按需 expand + 缓存友好 | 由宿主控制 | MemFS + blocks | 检索即注入 | Markdown 注入 | RAG 片段 |
| **任务/待办/提醒** | ❌ 无领域模型 | ✅ 四象限待办 + 到期提醒 | ❌ 无 | ⚠️ 仅 Cron 调度 | ❌ 无 | ❌ 无 | ⚠️ 自动化/通知 |
| **看板/管理 UI** | ✅ Sidebar 管理 | ✅ 多 Tab + 请求确认 | ❌ Ihd | ⚠️ 端+面板 | ❌ 无 | ❌ 无 | ✅ Web/多端 |
| **本地优先** | ⚠️ 依赖 Mnemon CLI | ✅ 纯本地（同步可选） | ⚠️ 需自托管 | ⚠️ Cloud 可 | ⚠️ 云化 | ✅ 强烈 | ⚠️ 可自托管 |
| **低打扰（绝不打断）** | 高 | ❌ 会 steer 打断 | — | 中 | — | — | 中 |
| **工程类型安全** | ✅ TS + 五段校验 | ❌ JS 无类型 | ✅ | ✅ | 由框架 | ✅ | ✅ |
| **真机 E2E** | ⚠️ 单测厚、缺真机 | ❌ mock context | 生态自证 | 成熟 | — | MCP 生态 | 成熟 |

**最值得深入研究四库的横向对比（`10`–`13`）**：

| 维度 | dsh-memento | dsh-memory-gate | dsh-memory-lite | dsh-auto-memory |
|---|---|---|---|---|
| **定位层次** | 记忆写入治理（审批+审计+预算） | 记忆使用时门控（CBDC 裁决） | 极简记忆存储/注入 | 记忆+提醒+自巩固（主动面） |
| **写入监督** | **最强**：不可绕过审批门 + `-denied` 审计 | 保守 cue 提取 + secret gate | 半自动（工具引导勿重复） | 每轮自巩固 subagent + 写闸门 |
| **注入控制** | 冻结快照 + 硬字符预算 | use/verify/ignore + 预算阀 + 特权胶囊 | 字节预算贪心打包 + digest 去重 | 前缀缓存双轨（section+context） |
| **任务/待办/提醒** | ❌ 无领域模型 | ❌ 无（被动调用期门控） | ❌ 无 | ⚠️ 日历条目 done 布尔 +「弱主动」注入 |
| **看板/管理 UI** | ✅ Web 面板 + /memory 命令 | ⚠️ /memory 命令（无 GUI） | ❌ 无 | ✅ GUI 概览页 + 记忆窗口 |
| **中间件/关于 yolo 对齐点** | 审批门下沉 = applyYoloAction 同构；P34/P35/P36 | 门控 + 反馈=纯净上下文；P38–P40 | 字节预算/原子写/会话注入；P41/P42 | 自巩固频控/前缀缓存；P44/P43/P46 |

## 四、七大洞察（他山之石的核心结论）

### 1. 「记忆」与「任务/提醒/看板」是两层，鲜有人把两者做在一起
mem0、Zep/Graphiti、Basic Memory 都是**纯记忆层**，明确不做任务/提醒/看板；Letta 只有通用 Cron；Khoj 把提醒做成自动化的一环。**在这批项目里，只有 dsh-memory-evolve 真正把「长期记忆 + 待办状态机 + 到期提醒」揉在一起**——这也是 dsh-yolo 的核心差异：从对话中整理计划并在到期时提醒，但不越权执行。这既说明已有相近方向，也说明**这一差异化位置仍少有项目覆盖**。

### 2. 受监督写 + 确定性边界剥离，是记忆工程的质量分水岭
两个 dsh 生态项目（尤其 dsh-mnemon）反复证明一条成熟做法：**让 LLM 只产语义候选/判断，让宿主定容量、字节、冲突、幂等、归档顺序**。dsh-memory-evolve 用「先 handle 后写 + 待确认队列 + 粘性 due」把模型自由裁量锁进流程。对照之下，纯靠"每回合提示模型自觉写"的做法（Basic Memory、mem0 的用户依赖）漏写/写脏风险更高。

### 3. 上下文控制是记忆助手的隐形工程，做得好坏决定体验
dsh-memory-evolve 的「缓存友好的快照注入 + 低频轨只按需读 + 摘要注入按需 expand + 粘性 due」、dsh-mnemon 的「字节预算法则性打包 + 归档前移出」，以及 Letta 的 MemFS，都在解决同一件事：**长期记忆既要"在上下文里"，又不能撑爆 token 前缀缓存**。这不是炫技，是「记忆助手」能否长期陪伴的关键。

### 4. 时间感知是"提醒"的正确地基，但别直接上图谱
Zep/Graphiti 的 `valid_at/invalid_at + 自动失效 + 证据溯源` 对「截止日期、偏好变化、事实过期」是更科学的模型。但工程上它偏重（图存储 + 混合检索）。**对 dsh-yolo 的启示：在领域表层面借鉴"时间有效性 + 证据可溯源 + 矛盾自动失效"，比引入整套知识图谱更务实。**

### 5. 主动性的姿态要由产品定位说了算，不是技术能力
dsh-memory-evolve 的 Advisor 会「伪装成用户指令 + 实时打断主会话」去施加影响；dsh-yolo 承诺「提醒绝不打扰工作会话」。**同样的主动提醒技术，会因产品边界不同而产生完全不同的体验**。这批项目提醒了 dsh-yolo：主动性应通过有节制、可处理的通知面呈现（对应 Khoj 的 smart notifications、dsh-memory-evolve 的通知卡、看板的 4 秒撤销），并且不能越权执行。

### 6. 多设备同步有一套成熟纪律，dsh-yolo 可整套沿用
dsh-memory-evolve 的 `sync/`（条目 ID 为合并锚点 + 手写三方合并 + git 冲突不落盘 + push 显式触发 + 本地永远完整）、dsh-mnemon 的作用域语义，且 Basic Memory/Khoj 也都在做跨设备。**结论：若 dsh-yolo 要做跨设备，这套"ID 锚点 + 三分合并 + 显式推送 + 本地完整"是经过验证的模板**。

### 7. 工程成熟度两极分化：dsh-yolo 应守住"类型安全 + 真机 E2E"这条线
dsh-mnemon（TS + 五段校验 + 三矩阵 CI）与 dsh-memory-evolve（JS 无类型 + 产物入库 + mock context 测试）形成鲜明对照。dsh-yolo 的 AGENTS.md 已内置 `pnpm check` + 单测 + W1–W8 真机验证 + 用语真实回归，方向与 dsh-mnemon 一致，这正是值得坚持的护城河之一。

## 五、对 dsh-yolo 的具体借鉴建议（分层落地）

**短期（配合现有 v0.3.x 看板，机制层的"少而准"借鉴）**
1. 受监督写 + 确定性边界：看板动作统一走 `POST /yolo/actions → applyYoloAction`（已有），进一步把"该不该记 → 提炼 → 写入"委托独立 Agent，宿主定容量/幂等/审计（借鉴 dsh-mnemon `delegate` + 幂等键）。
2. 粘性 due / 待确认队列：语义抽取结果先进待确认、以"到期写进快照 + 状态工具 complete 才复位"的实现代替弱跟随模型的自觉（借鉴 dsh-memory-evolve）。
3. 窄视图待办：提醒/看板默认只主动展示"该读的 N 条（逾期/今日到期/重要紧急）"，不铺开全部（借鉴 dsh-todo.js 的硬过滤）。
4. 归档先落可恢复轨迹：推迟/取消/归档动作先写可重新发现的轨迹再改状态；完成 toast 4 秒撤销进一步加固为"先写可恢复引用再迁移"（借鉴 dsh-mnemon archive-before-eviction + 自身 reopen）。

**中期（M9 语义召回 + 提醒质量）**
5. 语义 + 关键词混合召回取代 FTS5 trigram（借鉴 mem0 多信号检索 / dsh-mnemon recall-quality policy，并补强其对"语义同但措辞异"的覆盖）。
6. 时间有效性 + 证据溯源 + 矛盾自动失效的领域建模（借鉴 Graphiti，但只在 SQLite 表层面落地，不引图谱）。
7. 记忆健康度/可见性入口：让用户能"看见系统记住了什么、质量如何"（对应 Letta `/doctor`、dsh-mnemon 状态页）。

**长期（若做跨设备 / 多端）**
8. 条目 ID 为合并锚点 + 手写三分合并 + push 显式触发的同步纪律（整套沿用 dsh-memory-evolve `sync/`）。
9. 多端表面统一喂"一份记忆/看板状态"，保持低打扰（参照 Khoj 多端 + Basic Memory"一个记忆服务喂多个表面"）。

## 六、风险与取舍提醒

- **别被功能广度裹挟**：dsh-memory-evolve 的教训是"20+ 子模块巨石 + 无类型 + 产物入库 + 强耦合 DSH 内部 API"。dsh-yolo 应守住 `src/client` 解耦、类型安全、W1–W8。
- **对"主动提醒"姿态要明确**：全盘借鉴 dsh-memory-evolve 的"伪装用户指令 + steer 实时打断"会破坏"绝不打扰工作会话"的红线——取其频率控制（guard/severity/两级投递），舍其身份伪装。
- **语义能力是记忆质量的软肋**：dsh-mnemon/memory-evolve 都重度依赖 LLM 语义判定。dsh-yolo 要在"LLM 出候选、宿主定正确性"上持续投入，避免语义漏召回/写脏。
- **本地优先是差异化**：Zep 云化、Khoj AGPL、mem0 需自托管服务，衬托出 dsh-yolo"SQLite-first、纯本地、不打扰"的取舍本身就是卖点，不宜轻易妥协。

## 七、扫描池（进入初筛但未列逐项报告的候选）

| 项目 | 一句话 | 为何未列逐项报告 |
|---|---|---|
| [cognee](https://github.com/topoteretes/cognee)（~30k★） | 面向 Agent 的知识图谱 + 向量记忆平台 | 与 Zep/Graphiti 同属"图谱记忆"，工程偏重 |
| [supermemory](https://github.com/supermemoryai/supermemory)（~26k★） | 面向 Agent 的记忆/上下文工程平台 | 更偏底层记忆 API，与 mem0 重叠 |
| [Dzarlax-AI/personal_memory](https://github.com/Dzarlax-AI/personal_memory) | 轻量语义记忆 + Todoist + dashboard 的 MCP 层 | 新且小、生态弱，但"记忆+待办"组合值得关注 |
| [yangyongzhen/dsh-memory](https://github.com/yangyongzhen/dsh-memory) | 轻量 dsh 记忆，JSON 存储 + 会话注入 | **已升优质选清单 `12`**（源码级深读见 `12-dsh-memory-lite.md`），此处保留链接便于追溯 |
| [dan-calin/miko](https://github.com/dan-calin/miko) | 本地语义记忆 + Obsidian 导出的 Windows Agent | 偏 knowledge/second brain，无提醒看板 |
| [nitintayal/ai-rag-agent](https://github.com/nitintayal/ai-rag-agent) | 任务 + 提醒 + journal + 记忆的 Web 助手 | 偏全栈 Web 应用，与 dsh 插件形态不同 |
| [moyunliuyin/claude-memory-reminder](https://github.com/moyunliuyin/claude-memory-reminder) | Claude 记忆 + 定时提醒 + 自然语言待办 | 项目小、历史短，记忆时效 + 提醒日程机制可参考 |

> 注：搜索中还出现 `dsh-mneme`、`awesome-deepseek-harness` 等 dsh 生态线索，个别仓库未能在本次公开检索中稳定核实 URL/维护状态，未纳入正式清单（`dsh-mneme` 描述称有 SQLite + autoDream consolidation，建议后续人工核实）。

## 八、结论

**他山有石，且不止一块**。这趟调研给出三点可以立刻带回去的判断：

1. **差异化位真实存在**：公开的成熟项目多数是「纯记忆层」或「纯 Agent OS」之一，很少有人把"长期记忆 + 提醒 + 看板管理"做成一个安静、低打扰、本地优先的助手——这是 dsh-yolo 的机会。
2. **机制层有大量成熟做法可借**：受监督写 + 确定性边界、缓存友好的快照注入 + 渐进披露、粘性 due/待确认制、窄视图待办、时间有效性 + 证据溯源、多设备同步纪律。
3. **两条红线要守**：守住“类型安全 + W1–W8 真机验证”的工程要求；守住“整理和提醒，不越权执行；绝不打扰工作会话”的产品边界——不要为了借鉴而放弃它们。

> **关于「最值得深入研究」四库的一并结论**：`10`–`13` 号的源码级深读进一步印证——**审批门下沉、CBDC 门控、字节预算注入、每轮自巩固频控** 这四件事在 dsh 生态里已经各有一份可抄的真机实现（详见 `09-borrowables.md` 第八节 P34–P46）；但四库**没有一家做了 due-date 提醒调度 + 待办看板状态机 + 审计三位一体**（dsh-auto-memory 的提醒也仅有 done 布尔、缺 scheduler）。这份「空档」与洞察 1 完全一致，是 dsh-yolo 差异化与下一步（M9）最该盯的方向。

---
*配套逐项报告：`01-dsh-mnemon` · `02-dsh-memory-evolve` · `03-mem0` · `04-letta` · `05-zep-graphiti` · `06-basic-memory` · `07-khoj` · `08-dsh-ecosystem` · `09-borrowables`（可借鉴清单）· `10-dsh-memento` · `11-dsh-memory-gate` · `12-dsh-memory-lite` · `13-dsh-auto-memory`（均在 `docs/research/`）。*
