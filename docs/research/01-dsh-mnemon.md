# dsh-mnemon 分析报告

> 他山之石调研 · 目标仓库之一
> 一句话：**DSH 生态里「三份记忆 + 九个可插拔 Provider + Agent 驱动」的受监督记忆控制面。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [omdsh-dev/dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) |
| 主语言 | TypeScript（node16 ESM，相对导入带 `.ts`） |
| Stars | 约 40+ |
| 许可证 | MIT |
| 当前版本 | v0.2.15（2026-08 仍在发版） |
| 维护状态 | 活跃；`pushed_at ~2026-08`，v0.2.13/14/15 连续小步发布，CI 三矩阵 |
| 定位 | DeepSeek Harness 的三层记忆控制面；默认以官方 Mnemon（Go+SQLite）为存储，可换任意第三方长期记忆后端 |

## 定位与主张

dsh-mnemon 的核心主张不是「把所有知识塞进同一个库」，而是**把「哪种知识放哪一层、由谁来判定」想清楚**。它把记忆明确切成三层，每层存储介质、注入方式、管理者都不同：

| 层级 | 适合保存 | 如何进入 Agent 上下文 | 由谁管理 |
|---|---|---|---|
| **运行时** | 偏好、协作规则、项目约定、环境事实 | `USER.md` / `MEMORY.md` 每轮紧凑投影 | Host 确定性管理 |
| **档案** | 设计、调查、流程、复盘、交接材料 | 先检索中，再按需读全文 | Host 确定性管理 |
| **记忆体** | 跨会话事实、决策、实体与关系 | 从已激活记忆体召回有界证据 | Mnemon Native 或三方 Provider |

判断规则被压缩成一句好记的话：**每轮都要的放运行时，需要完整阅读的放档案，需要跨任务按需召回的放记忆体。** 当前指令、仓库文件与实时工具结果始终高于历史记忆。

## 核心架构与运作原理

以一个 cordis TypeScript 插件实现，通过 12 个 `mnemon_*` 工具 + `/mnemon` 命令 + 一套 RPC/设置暴露能力。核心执行**几乎全部委托给「独立 task Agent / 隔离 subagent」**，宿主只做确定性校验、路由、容量与并发控制。根模型永远不当「最终写手」。

**写入（受监督蒸馏）**
- 写操作统一委托独立 subagent（`subagent.ts` 里的 `WRITE_PERSONA` / `SUPERVISED_WRITE_PERSONA`），要求「先选最窄空间 → 查重 → 只写 Provider 支持的变更 → 等收据」；不稳定 / 重复 / 临时噪音返回 `skipped` receipt。
- 运行时记忆：LLM 只产出语义压缩候选，宿主用 importance 排序 + **UTF-8 字节预算法则性打包**（`critical<normal<low` 逐条判定 byteCount 是否超预算）；容量满时走「先归档到记忆体、后压缩、校验 revision、无并发覆盖再重试」（`runtimeLocked`）。LLM 从不自己数 token。
- 档案归档是**归档-前-移出**事务：先委托 subagent 写一个能在冷档区重新发现该文档的「冷引用」（含路径 + 内容 SHA-256），成功后才物理改名归档，失败重试一次（`archiveDocumentLocked`）。

**召回**
- 检索时并发调用各 Provider 最快的原生召回路径；`service.ts search()` 对异构 Provider 用位置启发式 `federatedScore = 1/(60+providerRank)` 做跨 provider 融合排序，同 Provider 用原生 score。
- 召回结果经可插拔的 `recall-quality` 策略（`strict-v1` / `balanced-v1` / `exhaustive-v1`）逐一 `evaluate`（keep/drop + tier + reason）再 `select` 到 requestedLimit；引擎做运行时校验，非法策略自动回退 strict。只返回 high/medium tier。

**注入（上下文）**
- 运行时记忆通过 `systemPrompt.context` 每轮常驻投影；`instructions` 级 `guidedReminder` 在每轮 pre-step 注入一句「何时该用记忆」的指令型提示，把裁决留给模型但给出边界。
- 防注入：把记忆内容里的字面量 `{{` 用变量替换再回填，防止模板花括号被当作用户指令。

**AI 判定边界的确定性剥离**（最重要的设计）
- Provider 选路：硬规则先过滤（allowed 域 / 数据边界 / 能力要求），**只有单一候选**才确定性选中；多候选才交给 LLM，且 LLM 只能从宿主导出的候选里挑、必须带 reason+confidence。
- 语义判断（蒸馏/压缩/去重/合并）让 LLM 出候选；**容量、字节预算、冲突检测（revision+文件锁）、幂等去重由宿主确定性完成**——大大降低 LLM 出错成本，也利于单测。

**并发 / 一致性基建**：内存数据面统一「进程内 Promise 队列 + 文件锁（`.lock`，stale 30s）+ 原子写（tmp+rename）」三板斧；每写带 `runId`+provider+action 计数形成审计轨迹，受监督写还带幂等键（256 条 LRU）防重放。

## 关键亮点（带证据）

1. **三层职责完全解耦**：运行时/档案/记忆体三层存储与注入方式完全不同，判断规则单句可记（README + `service.ts` MemoryBody）。
2. **真·受监督写入 + 独立 worker**：根模型不直接落库，判断-选路-查重-提炼-写入整条委托独立 Agent，消耗分级 `maxTokens`，不占主会话历史（`subagent.ts` 9 个 delegation persona）。
3. **确定性边界剥离**：LLM 出候选，宿主定容量/字节/冲突/幂等（`runtime-memory.ts compactTarget`）。
4. **归档-前-移出**的安全迁移事务（`documents.ts capacityPlan/archive`）。
5. **九 Provider 声明式能力矩阵 + 秘密管理**：`providers/catalog.ts` 用声明式字段（scope/secret/url/…、capability 位图）描述；外部 Provider 默认关闭、不会向模型编造不支持的语义。
6. **发布/构建质量闭环**：`pnpm verify` = typecheck + 380 单测 + 确定性双构建（65 文件一致）+ headless 激活（35 tools）+ publint strict/attw；CI 三矩阵、Windows job 下载官方 mnemon 二进制校验 sha256 冒烟。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度与差距

**契合**：跨会话召回、分层上下文、受监督写、审计与幂等这些机制，与 dsh-yolo「提醒/看板走同一动作路径、审计一致、绝不越权」的诉求高度同源。

**关键差距**：dsh-mnemon 是记忆系统，领域对象只有 `insight(记忆条目)` + graph `edge`，**没有 due-date / recurrence / 提醒调度 / 完成状态迁移**。它所谓的「提醒」只是每轮注入一句 guided cue 和空闲 30s 的延迟写回抽查（`lifecycle.ts scheduleIdleReview`），**不具备到点提醒能力**。任务/看板是它刻意不管的领域。

## 明显的不足 / 局限

1. **强依赖外部 Mnemon CLI**：几乎所有操作都经 `runner.ts` 解析执行 `mnemon ...` CLI（SQLite）；无此二进制核心功能基本不可用；Windows 需用户手动装 exe，`runner` 里给的 PATH/GOPATH/LOCALAPPDATA/ProgramFiles 一套猜测式搜索正说明「找不到二进制」是常态。
2. **仓储/提炼高度依赖 LLM 语义能力**：写入蒸馏、实体关系、压缩、元信息维护、选路全由 subagent 判定，模型弱或超时 → 拒写/skip。
3. **召回层检索较粗**：文档搜索是 title/desc/content 词面子串打分，对「语义相同但措辞不同」（如「季度总结」vs「Q3 report」）召回弱；跨 Provider 融合是朴素位置启发式，非英语/小众关键词无基准验证——这正是 dsh-yolo 要升级 M9 语义召回要解决的问题。
4. **跨 Provider 数据模型无法统一迁移**：`mergeBodies` 硬性要求 native→native；外部 Provider 的 write/delete 语义各异（exact vs async-extracting、hard/soft/unsupported），行为一致性靠 persona 措辞而非数据模型保证。
5. **九后端维护负担 + 缺真机端到端**：9 个适配器各绑第三方 API，契约易漂移；CI 只对官方 Mnemon 做冒烟，远程 Provider 仅靠探针脚本，无宿主真机全链路。
6. **无 HEAD CHANGELOG**：版本历史散落在逐版 release 文档，机器可读变更日志缺失。

## 对 dsh-yolo 的借鉴点（他山之石）

1. **真·受监督写 + 独立 worker**：把「该不该记/记哪层 → 提炼 → 写入」委托独立 Agent。WorkBuddy 的看板动作（完成/推迟/取消/撤回）若也走统一的 `delegate` 风格、隔离于主会话历史，能天然防模型越权改状态——与 `GET /yolo/actions → applyYoloAction` 同源。
2. **确定性边界剥离**：LLM 出语义候选，宿主做容量/字节/冲突/幂等——把「智能」放在对的地方，把「正确性」交给代码，直接可单测。
3. **归档-前-移出**：推迟/取消/归档类动作先落「可恢复/可重新发现的轨迹」再迁移状态——对应 WorkBuddy 完成 toast 4 秒撤销的服务端 `reopen` 领域动作，可再加固为「先写可恢复引用再改状态」。
4. **每操作带审计与幂等**：`applyYoloAction` 借鉴其「同一操作统一进数据平面 + 事件日志 + 幂等键防重放」。
5. **三层分档 + 每轮常驻层 vs 按需召回层**：把「角标/看板快照」放每轮注入层、把「长期档案」放按需召回层，两者不同写入与刷新策略——正是 WorkBuddy「看板 + 长期记忆」的理想映射。

## 一句话结论

工程成熟度接近生产级（强类型 + 五段校验链 + 确定性构建 + 三矩阵 CI）的三层记忆参考范本，**其「受监督写 + 确定性边界 + 归档前移出 + 审计幂等」值得直接吸收**；但它是纯记忆系统、没有任务/提醒/看板领域模型，且依赖外部 CLI 与 LLM 语义能力，召回还停留在词面匹配——恰好是 dsh-yolo 可以差异化补强的点。

---
*资料来源：仓库 README.zh-CN.md、docs/zh-CN/*、src/* 源码级分析、.github/workflows/ci.yml。*