# deepseek-harness 插件生态相关仓库补充

> 他山之石调研 · dsh 生态专项
> 主题：长期记忆 / 提醒调度 / 通知 / 待办 / 看板管理 / 跨设备同步 / 上下文工程。
> 数据截至 2026-08-22，来源为本地克隆仓库（深读 README / package.json / 文档）与本地下载的生态列表（`catalog.md`、`awesome.md`、`plugins-top.html`）。

## 说明：核实方法与证据边界

- **本地克隆并深读 README**（结论可信，标注「本地核实」）：`dsh-mneme`、`dsh-memento`、`dsh-memory-lite`、`dsh-memory-gate`、`dsh-hme`（hme-plugin）、`dsh-memory-vault`。另 `dsh-mnemon`、`dsh-memory-evolve` 已在 `01` / `02` 号报告单独成文。
- **仅见于生态列表、无法本地核实维护状态/细节**的，一律标注「**未本地核实**」，不为其编造 star 数或机制细节。
- 用户提示提及的官方 `@deepseek-ai/dsh-schedule`：**在本地 catalog / awesome / plugins-top 中均未检索到该名字**。故本文不把「官方 dsh-schedule 提醒插件」作为已确认存在来引用——只能在「待人工核实」处提及，倾向其应为 dsh 官方能力但当前未能从本地列表证明。

---

## 一、长期记忆类（重点）

| 仓库 | 定位摘述 | 核实 |
|---|---|---|
| [modusensus/dsh-mneme](https://github.com/modusensus/dsh-mneme) | 跨会话记忆引擎：SQLite 存储 + 可人工编辑的 Markdown，Memory Genome 自发进化 | **本地核实** |
| [PerryLink/dsh-memento](https://github.com/PerryLink/dsh-memento) | 有界、分层、带审批门、可审计的跨会话记忆：typed `ctx.memory` seam + SQLite | **本地核实** |
| [yangyongzhen/dsh-memory](https://github.com/yangyongzhen/dsh-memory)（npm 包 `dsh-memory`，目录名 dsh-memory-lite） | 轻量长期记忆：四类记忆（preference/fact/summary/knowledge）+ 两种作用域 + JSON 文件存储 + 会话开始注入 | **本地核实** |
| [GIT121995/dsh-memory-gate](https://github.com/GIT121995/dsh-memory-gate) | 记忆闸门：CBDC（Claim→Belief→Decision→Consumption）门控，「检索到 ≠ 注入」 | **本地核实** |
| [weopenfire-git/hme-plugin](https://github.com/weopenfire-git/hme-plugin)（dsh-hme） | 跨会话长期记忆：有界核心 USER.md/MEMORY.md 文件 + archive 扩容 + recall 检索，类推 CPU 多级缓存 | **本地核实** |
| [flymysql/dsh-memory](https://github.com/flymysql/dsh-memory)（dsh-memory-vault） | 跨会话记忆库：3 模型工具（remember/recall/forget）+ 每轮注入 + 浏览器管理页 | **本地核实** |
| [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | 七层 SQLite（soul/user/project/fact/lesson/topic/rules）+ BM25 + 按窗口做梦式巩固 | 未本地核实 |
| [zhujunpeng12/dsh-memory-system](https://github.com/zhujunpeng12/dsh-memory-system) | 本地优先记忆基础设施：热启动 + 中文 BM25 冷召回 + lease-lock 事务写 + 只读治理 | 未本地核实 |
| [jiayan-xu/dsh-memoria](https://github.com/jiayan-xu/dsh-memoria) | Memoria 记忆后端：observe/remember/search/recall 四工具进向量+图记忆层 + 命名空间隔离 | 未本地核实 |
| [ZSeven-W/dsh-noema](https://github.com/ZSeven-W/dsh-noema) | Noema 长期记忆：可持久、可检视，带召回工具与设置页 | 未本地核实 |
| [Classicoke/cleverer-dsh](https://github.com/Classicoke/cleverer-dsh) | 执行纪律套件：拦截同参重试、强制反思、约束待办执行、记忆查重、经验→技能沉淀（11 插件 + 6 技能，426 测试） | 未本地核实 |
| [Qinling-Melon-Farmers/dsh-memoir](https://github.com/Qinling-Melon-Farmers/dsh-memoir) | 项目持久化记忆：会话归纳 + 经验教训 → `PROJECT_MEMORY.md` + 全局索引，附 **Web GUI 记忆面板** | 未本地核实 |
| 其它（[dsh-engramory](https://github.com/tinqiao-oss/engramory/tree/master/adapters/dsh)（即 tinqiao-oss/engramory 的 dsh adapter，同一实体）/ [plur-ai/dsh-plugin](https://github.com/plur-ai/dsh-plugin) / [dsh-memory-porter](https://github.com/Shiye-10Pages/dsh-memory-porter) / [wangyihao0001-oss/dsh-task-memory](https://github.com/wangyihao0001-oss/dsh-task-memory) / [dsh-simple-memory](https://github.com/a903067276-rgb/dsh-simple-memory) / [dsh-simple-wiki-memory](https://github.com/rainow/dsh-simple-wiki-memory)） | 均在记忆领域各占一角：dsh-engramory 文件式策展记忆（`MEMORY.md` 索引 + 每条事实一 md 文件 + guard 硬上限）；plur-ai/dsh-plugin 为 BM25+BGE + 纯 YAML（engram 渲染进系统提示词）；dsh-memory-porter 跨厂商迁移；dsh-task-memory 任务隔离记忆；dsh-simple-memory / dsh-simple-wiki-memory 侧车 Markdown、会话注入（「语义 + 图」已归 dsh-memoria，见上） | 未本地核实 |

### 逐仓描述（本地核实者，取自本地 README）

**dsh-mneme** —— 一句话：跨会话记忆引擎，记忆「不再是存储，而是会生长」。亮点：离线优先（默认零 API、Markdown 人类可读可编辑）；自动整理/去重/归档；`删除对话 ≠ 删除记忆`（可配置）；v0.3–v0.6 依次落地 entities/attrs/relations 三表、Sleep Mode 空闲四阶段深度维护、BM25+图谱+热记忆召回融合、会话生命周期。不足：需 Node 24+（`node:sqlite`），embedding 默认仍是云端 openai（离线要手动切 `local`）。关联：与 dsh-yolo 同为「SQLite-first、本地优先」，其「删对话不删记忆」与 dsh-yolo 的记忆抽取理念同源；但其关心的是检索/进化，「提醒/看板/完成状态迁移」缺位。

**dsh-memento** —— 一句话：有界、分层、带**审批门**、可审计的跨会话记忆 seam（`ctx.memory`）。亮点：写路径（add/replace/remove/seed）强制走服务内 approval waterfall，模型无法绕过；`replace/remove` 携带被改条目的全文进审批载荷，被拒仍落 `*-denied` 审计；快照冻结一次注入 system prompt 且会话中途不变；硬字符预算（user 2000 / agent 4000，超预算结构化报错不截断）。不足：`ask` 策略需有 UI 应答器，无应答器则写入 fail-closed；无 FTS5（子串搜索用 `instr`）。关联：与 dsh-yolo「AI 不直接落库、走统一动作路径、审计一致」的取向最契合，**是本批最值得对照工程实现的项目之一**。

**dsh-memory-lite / yangyongzhen/dsh-memory** —— 一句话：轻量长期记忆，JSON 文件即真相 + 会话开始自动注入。亮点：四类记忆 + 全局/项目两作用域；`agent/pre-step` 仅第一步注入且带 digest 去重，resume 安全；UTF-8 字节预算贪心打包（超预算跳过单条而非丢整个 section）；原子写（tmp+rename）。不足：极简、无向量/语义检索（`memory_search` 为包含匹配）；无 release 工程化。关联：其「文件即真相 + 字节预算注入 + 原子持久化」是 dsh-yolo 做记忆存储与上下文注入的直接可抄模板。

**dsh-memory-gate** —— 一句话：记忆闸门，「检索到 ≠ 注入」，每次模型调用前 CBDC 门控。亮点：注入前裁决（use/verify/ignore 可解释）、使用中克制（默认 ≤3 条 / 1200 字符、不加第二次模型调用）；使用后学习（`/memory ok` 词项学习、harmful/stale 降置信并隔离）；近重复 supersede 合并；shadow/assist/enforce 三模式、self-diagnose 自动降级。不足：词法级触发词召回，不等价语义；自动提取只认明显 cue。关联：**为 dsh-yolo「该不该进上下文」提供了一张现成的门控+反馈校准设计图，与「纯净上下文、低打扰」天然合拍**。

**dsh-hme（hme-plugin）** —— 一句话：给 dsh 装上「跨会话大脑」，不会失忆也不会被杂事烦扰。亮点：有界核心（`USER.md`/`MEMORY.md` 纯文本文件，溢出/过期 → 压缩成摘要 → 沉降下一层索引头 → 本层删除原内容）+ archive 扩容 + 价值分层 TTL（V1 永不过期 / V2 365d / V3 90d）；启动状态仪表盘 + `/hme-status`。不足：核心只存纯文本精华，检索为关键词而非语义；`[v:N]` 价值标记依赖模型自觉打标。关联：其「小而快的常驻 + 大而全的按需取」多级缓存式记忆分层，与 dsh-yolo 看板 + 记忆的层次感思路一致。

**dsh-memory-vault（flymysql）** —— 一句话：跨会话记忆库，3 工具 + 每轮注入 + 浏览器「记忆库」管理页。亮点：模型工具命名直白（`memory_remember/recall/forget`）；注入可配（injectLimit 默认 8）；Web 端 Settings 有可视化浏览/增删页。不足：相对简单，召回为 tag/content 打分，无门控与审批。关联：其「每轮注入 + 自带管理页」提醒 dsh-yolo 记忆需要「用户可见可查」的入口。

---

## 二、提醒 / 调度 / 通知类

| 仓库 | 定位摘述（来自列表） | 核实 |
|---|---|---|
| `@deepseek-ai/dsh-schedule`（官方提醒） | **本地列表未检索到，无法核实**，此处仅按用户提示占位，倾向为应存在但未证实 | 未核实 |
| [Aik358/dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory) | 三层自动记忆 + **proactive calendar reminders** + 温和问候 + 逐轮自巩固 + 继承他工具记忆 | 未本地核实 |
| [Aisland-SJL/dsh-reminder](https://github.com/Aisland-SJL/dsh-reminder) | 跨窗口完成 / 审批**弹出提醒**，把用户拉回 DSH（「Codex/WorkBuddy 风格」） | 未本地核实 |
| [omdsh-dev/dsh-notification](https://github.com/omdsh-dev/dsh-notification) | DSH 桌面通知 | 未本地核实 |
| [610la/dsh-notification-center](https://github.com/610la/dsh-notification-center) | 对话/任务完成、报错、等待批准触发浏览器通知 + 音效 | 未本地核实 |
| [THEWOLFWALKER/dsh-notifier](https://github.com/THEWOLFWALKER/dsh-notifier) | 统一通知推送：一条 `notify()` API + 8 渠道（telegram/dingtalk/feishu/wxpusher/pushplus/serverchan/bark/webhook）+ 会话事件/Agent 工具双触发 | 未本地核实 |
| [dingyi222666/dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification) | 会话完成等四状态通知 + 浏览器提示/提示词 | 未本地核实 |
| [Ceelog/dsh-plugin-scheduled-tasks](https://github.com/Ceelog/dsh-plugins/tree/main/src/plugins/dsh-plugin-scheduled-tasks) | 定时任务插件 | 未本地核实 |
| [titanwings/dsh-automation](https://github.com/titanwings/dsh-automation) | 让编码任务按计划在**全新 Agent Session** 中运行，可建/管定时任务 | 未本地核实 |
| [fuhefei/dsh-sentinel](https://github.com/fuhefei/dsh-sentinel) | 条件驱动唤醒：文件/命令/http/process/webhook 监听唤醒 Agent + 侧栏 + 全局看板 | 未本地核实 |
| [dsh-web-ui-notify](https://github.com/dsh-external/dsh-web-ui-notify) | 为 DSH 增加 WebUI 通知提醒 | 未本地核实 |

**要点**：这部分生态的「提醒/通知」绝大多数是「**通知触发通道**」（桌面/浏览器/飞书/微信/统一 8 渠道转发），即把「某事发生了」推给用户，而非「到期该做什么」的主动调度。少数做「主动」（Aik358 的 proactive calendar reminders、titanwings 定时任务、dsh-sentinel 条件唤醒）。**对 dsh-yolo 的启示**：提醒的「数据面」（到期算谁是 due、状态机什么时候该亮）生态里基本没人认真做，大多停留在通道层——这正是 dsh-yolo「提醒调度 + 看板卡」的差异化空间；通道层（统一 `notify()` 多渠道）可作为后续可选外发能力的参考。

---

## 三、待办 / 任务 / 看板管理类

| 仓库 | 定位摘述（来自列表） | 核实 |
|---|---|---|
| [Classicoke/cleverer-dsh](https://github.com/Classicoke/cleverer-dsh) | 执行纪律套件：**todo enforcement**（约束待办执行）+ 记忆查重 + 经验→技能（426 测试） | 未本地核实 |
| [dongsheng123132/task-passport](https://github.com/dongsheng123132/task-passport) | **开放任务交接协议**：用机器可读检查点 + 乐观锁在 dsh / WorkBuddy / Claude Code / Codex 间交接，**verified state 而非 chat logs** | 未本地核实 |
| [a903067276-rgb/dsh-todo-guard](https://github.com/a903067276-rgb/dsh-todo-guard) | 重启后仍可恢复的 Todo 面板（通过 projection 预…） | 未本地核实 |
| [shengsheng90/DSH-taskboard](https://github.com/shengsheng90/DSH-taskboard) | 原生本地任务看板插件（catalog 中另有 [cloader/dsh-taskboard](https://github.com/cloader/dsh-taskboard)、[chuspeeism/dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard)） | 未本地核实 |
| [isomoes/ikanban](https://github.com/isomoes/ikanban) | 面向键盘操作、基于 DSH 的看板 | 未本地核实 |
| [Qinling-Melon-Farmers/dsh-memoir](https://github.com/Qinling-Melon-Farmers/dsh-memoir) | 记忆侧附带 Web GUI 记忆面板（项目/全局 tab、检索、手动记录/删除） | 未本地核实 |
| [dsh-task-status](https://github.com/dsh-external/dsh-task-status)（官方 bundle）/ [vlln/dsh-task-status](https://github.com/vlln/dsh-task-status) | 后台任务状态条：对话输入区上方任务进度 + 实时输出 tail | 未本地核实 |
| [february2015/dsh-taskswarm](https://github.com/february2015/dsh-taskswarm) | TaskPlane 的 DSH 移植：按依赖分波的任务处理 | 未本地核实 |

**要点**：dsh 生态的「待办/看板」多停留在「展示会话内任务进度 / 简单原生化看板」，与 dsh-yolo「跨会话、到期调度、看板状态机、审计」不是一个量级。**最值钱的两条信号**：`cleverer-dsh` 把「待办执行纪律」做成可约束的插件套件（todo enforcement），`task-passport` 把任务状态做成**跨工具（含 WorkBuddy）机器可读、以 verified state 交接**的协议——后者与 dsh-yolo 同一生态圈，是潜在可协同/学习的状态表示。

---

## 四、跨设备同步 / 会话搜索 / 上下文工程类

| 仓库 | 定位摘述（来自列表） | 核实 |
|---|---|---|
| [PerryLink/dsh-session-sync](https://github.com/PerryLink/dsh-session-sync) | 跨设备会话同步：专用 git 镜像 + 仅追加的双方保留 | 未本地核实 |
| [dsh-external/dsh-session-search](https://github.com/dsh-external/dsh-session-search) | 跨 dsh/Codex/Claude Code/pi/OpenCode 会话搜索（无索引） | 未本地核实 |
| [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | 上下文洞察/管理：Context 面板 + 浏览器 + 命令，透视组成、演进、压缩、剪枝（精选站 ~771★） | 未本地核实（star 来自 plugins-top 精选数据） |
| [Zhenyu98/dsh-context-doctor](https://github.com/Zhenyu98/dsh-context-doctor) | 上下文注入审计：指令链/技能目录/工具 schema 的 token 成本量化 + 重复/冲突检测 + 裁剪建议（Web 圆环 + context_audit） | 未本地核实 |
| [Tyan66666/billion-context-dsh](https://github.com/Tyan66666/billion-context-dsh) | 模型驱动上下文压缩（ACP） | 未本地核实 |
| [GooodWei/context-vista](https://github.com/GooodWei/context-vista) | 右侧悬浮栏上下文可视化 + `/context` 命令 | 未本地核实 |
| [qing3a/dsh-repo-context](https://github.com/qing3a/dsh-repo-context) | 把 git 状态与仓库规范动态注入 system prompt | 未本地核实 |
| [JohnXu22786/context-pruner](https://github.com/JohnXu22786/context-pruner) | 修剪过期/重复/失效上下文 | 未本地核实 |
| [xiaoyuyu6420/dsh-backup](https://github.com/xiaoyuyu6420/dsh-backup) | 一键备份 DSH 数据：定时、sha256 校验 + 轮转 | 未本地核实 |
| [shaobeichen/dsh-pocket](https://github.com/shaobeichen/dsh-pocket) | 手机扫码同屏访问/同步电脑上跑的 dsh web | 未本地核实 |

**要点**：这部分是 dsh-yolo 最容易「现成可抄」的工程区。`dsh-session-search` 提供跨工具会话搜索（无索引，轻量匹配即可回补 dsh-yolo 的「记忆溯源/证据」）；`dsh-context` / `dsh-context-doctor` 把「上下文里到底装了什么、多少 token、有无重复冲突」做成可视化仪表盘——正是 dsh-yolo 做「渐进披露/字节预算注入」时要加的外部可观测性；`dsh-session-sync` 的 git 镜像 + 仅追加，与 `02` 号报告里 `dsh-memory-evolve` 的同步纪律互为印证。

---

## 五、一句话总结：dsh 生态的启示

- **记忆层卷地最狠，但几乎全在「存与取」，缺「到期该做一件事」的领域模型** —— 众仓库擅长存储/召回/进化，却罕有像 dsh-yolo 那样把「长期记忆 + 提醒调度 + 看板状态机 + 审计」揉成一体；这是在 dsh 自家生态里也未被占满的位。
- **「受监督写 + 确定性边界 + 审批/审计」已是 dsh 记忆插件共识**：dsh-memento（approval gate）、dsh-mnemon（subagent 委托）、dsh-memory-gate（CBDC）、dsh-memory-lite（预算注入）反复印证同一条成熟路径，与 dsh-yolo 的 `applyYoloAction` 取向高度同构。
- **上下文控制是显性工程**：字节预算、冻结快照、会话生命周期（删对话不删记忆）在多仓库成熟，且配套有可视化审计（dsh-context 系），值得整体吸收。
- **提醒/通知生态停留在「通道层」，待办/看板停留在「展示层」**：留给 dsh-yolo 的差异化是「面向到期、低打扰、看板状态机」那一整层。

---

## 六、最值得 dsh-yolo 深入研究的 3–5 个

> **更新（源码级深读已完成）**：`dsh-memento`、`dsh-memory-gate`、`dsh-memory-lite` 已在 `08` 原为「本地核实」，现于 `10`–`13` 号报告做了**逐行源码级深读**（含测试、审计表、版本史）：`yangyongzhen/dsh-memory` → `12-dsh-memory-lite.md`；`GIT121995/dsh-memory-gate` → `11-dsh-memory-gate.md`；`PerryLink/dsh-memento` → `10-dsh-memento.md`。`Aik358/dsh-auto-memory` 也已本地克隆并深读（修正为**本地核实**，见 `13-dsh-auto-memory.md`；结论：其「proactive calendar reminders」实为**注入式弱主动**、无到点 scheduler，`reminder` 字段仅作备注）。四库的可借鉴条目已并入 `09-borrowables.md` 第八节（P34–P46）。

按「做得好 + 与 dsh-yolo 定位契合 + 可落地」排序：

1. **dsh-memento（本地核实，首推）** —— 其 approval 门 + 审计 + 硬预算 + 冻结快照，是与 dsh-yolo「AI 不直接落库、动作统一、审计一致」完全同源的对标实现，工程细节（编解码、审计表、污染处理）最值得逐行对照。（→ `10-dsh-memento.md`）
2. **dsh-memory-gate（本地核实）** —— 「检索到 ≠ 注入」的门控 + 反馈校准 + supersede 去重，天然契合 dsh-yolo「纯净上下文、低打扰、管理而非代办」；其 autoMine 回挖与自我诊断可作为看板/记忆质量机制的设计蓝本。（→ `11-dsh-memory-gate.md`）
3. **dsh-memory-lite / yangyongzhen/dsh-memory（本地核实）** —— 极简却完整的「字节预算注入 + 会话开始注入 + 原子持久化 + 文件即真相」，是 dsh-yolo 实现记忆注入层的最适范本（无向量依赖，MVP 立即可抄）。（→ `12-dsh-memory-lite.md`）
4. **Aik358/dsh-auto-memory（现已本地核实）** —— 唯一把「三层自动记忆 + proactive calendar reminders + 每轮自巩固 + 跨工具继承」同时做在提醒方向的仓库，与 dsh-yolo「记忆 + 主动提醒」定位最近；但提醒是注入式弱主动、缺 due scheduler。（→ `13-dsh-auto-memory.md`）
5. **dsh-session-search + bowenliang123/dsh-context（未本地核实）** —— 一个解决「记忆/会话可回溯检索（证据溯源）」，一个解决「上下文构成可视化（渐进披露的观测面）」，是 dsh-yolo 中期做语义召回 + 上下文工程时的现成参照。

> 待人工核实：官方 `@deepseek-ai/dsh-schedule` 是否存在/形态（本地列表未见）；`dsh-meow-memory`、`dsh-memoir`、`task-passport`、`dsh-todo-guard` 的具体机制（未本地核实）。

---
*配套报告：`00-total`（总览）· `01-dsh-mnemon` · `02-dsh-memory-evolve` · `03-mem0` · `04-letta` · `05-zep-graphiti` · `06-basic-memory` · `07-khoj` · `09-borrowables`（可借鉴清单）· `10-dsh-memento` · `11-dsh-memory-gate` · `12-dsh-memory-lite` · `13-dsh-auto-memory`。*