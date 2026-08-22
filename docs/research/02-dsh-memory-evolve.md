# dsh-memory-evolve 分析报告

> 他山之石调研 · 目标仓库之二
> 一句话：**一个把「跨会话记忆 + 自我进化 + 待办 + 主动调度 + 评审 + 同步」揉进 DSH 的全家桶纯插件。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve) |
| 主语言 | JavaScript（服务器端 `lib/*.js` 直提交）+ React（`src/client/*`） |
| Stars | 约 140+ |
| 许可证 | MIT |
| 当前版本 | v0.1.0（private 包，git tag `v<纯数字>` / `v1.2.3` 双格式发版） |
| 维护状态 | 活跃；2026-08-05 创建、近期持续迭代，多 PR/issue（#11–#21） |
| 定位 | Hermes-style long-term memory, self-evolution, skills, todos, and external CLI agent dispatch for DeepSeek Harness |

## 定位与主张

不是「记忆插件」，而是**一个近乎独立的个人 AI 操作系统级插件**：五轨记忆 + 四轨待办 + 技能管理/自我进化 + COI 会话编排 + 外部 CLI Agent 统一调度 + 会话评审 Advisor + 跨设备记忆同步 + 无限画板 + 书签/分支 + 提示词注入 + web/im 通知。打开会话会多出一排能力 Tab，从一个「每次会话失忆」的对话机器变成「了解你全盘工作的长期伙伴」。

**三条原则**（README）：
1. **AI 只提议，你确认**——所有会真实改变 AI 行为的写入都先进待确认队列；
2. **不重复造轮子**——官方已有的能力不碰，只做官方没做且真实解决痛点的；
3. **内外有别、协作互补**——内部会话负责需要上下文的活，外部代理负责一次性重活。

## 核心架构与运作原理

以 cordis 的 `systemPrompt.context`（快照注入）、`tools.register`（de_*/memory/todo 等）、`ctx.on` 事件总线（`agent/settled`、`session/event`、`tools/pre|post-execute`、`turn-stopping` 等）为唯一公共接缝，把 20+ 子模块统一挂在一个 `apply(ctx, config)`。纯逻辑拆成 cordis-free 的类（`store.js` / `todo.js` / `sync/merge.js` / `advisor/*`），可脱离宿主用 `node --test` 直测。每个子模块一个 `.sync()` 由 `applyRuntimePatch` 调度即时安装/卸载。

**记忆五轨**（用户档案 / 全局事实 / 项目关键记忆 / 项目日志 / 每日日志）

写入-去重-注入-归档一段式原理：

- **写入**：模型每回合收尾被快照里的固定提示要求「先输出回复，再附带 `memory` 工具调用」批量写 daily+project 各 1 条；程序通过 `stampEntry` 自动盖时间戳（`[HH:MM]`/`[日期]`）、`[git 分支]`、项目标签（从 `agent.session.header.cwd` 程序化推导，模型不需要也不会写）。
- **去重**：`add` 在锁内 `reloadForAppend` 对比现有条目；普通轨用 `entries.includes(stamped)`，同步轨先剥离随机 ID 再等值比较（否则永远不命中）；KEY 写入走重要性闸门（只收长期约定/决策/架构/踩坑）并先进待确认队列。
- **注入**：`renderSnapshot` 实时读 memory/user 全量注入；key 按会话 `cwd` 隔离 + 分支过滤，按「渐进式披露」决定全量还是 `[summary:…]` 摘要，需要时 `expand+id` 按需加载全文。**日志轨默认不注入**，只在快照里给一行固定提示让模型主动写——固定文本不产生新快照，保住缓存前缀。
- **归档**：走「`peek` 先取命中原文 → 写入 `*-archive.md` → `remove` 删主轨」的顺序（注释明说：替代先删后加，避免归档失败丢条目）；用整条精确匹配避免子串误删。
- **身份**：`entryIdMode='on'` 仅同步轨加 `[id:8hex]`；`replace` 继承旧 ID；老条目按内容确定性补发（`legacyIdFor`）保证双设备同 ID——ID 只是跨设备合并锚点，展示/注入层全部剥离。

**待办四象限 + ID 状态机**（`todo.js`）：四轨 `life/work/project/daily`；首行 tag 语法 `[q1-4]` 重要紧急、`[due:…]`、`[status: pending|doing|done|blocked|cancelled]`、`done` 自动盖戳；`dtodo list` 默认视图**硬过滤**只返回逾期/今日到期/本项目/重要紧急，上限 8 条——「模型只能读到该读的待办」。

**会话评审 Advisor**（`advisor/*`）：独立评审会话，只喂「前台用户可见文本表面」（不含思考/工具参数）；`EmissionGuard` 归一化去重/空泛抑制/每轮一条/真实升级放行；`delivery` 走 `agent.steer`(实时)/`agent.inject`(不打断) 两级，且把建议**伪装成用户指令**（来源身份仅对 GUI 可见、对模型不可见）提高执行力；severity 四级（info 默认仅记录 / nit / concern / blocker）。

**外部 CLI Agent 调度 + 会话编排**（`coi/*`）：多个标准会话拉进「房间」广播、`ws-coord` 的 `tools/pre-execute` 软/硬冲突拦截 + 文件声明锁；kimi/codex/grok/hermes 统一调度（后台进程 + 会话并发锁 + 12h 超时兜底），派活可带图、结果自动沉淀进日志。

**跨设备同步**（`sync/*`）：手写三方合并代替 git merge（`merge.js` 把共同祖先/本机/远端三份按 `[id]` 联合索引 + 12 行规则表决策，git 冲突符号永不落盘）；`dsh-shared/<projectId>` 专属分支、`GIT_TERMINAL_PROMPT=0` 防卡死、push 永远显式触发、三层开关（模块/项目/轨）。

## 关键亮点（带证据）

1. **纯文本存储 + 束头正则统一锚定**：五轨记忆是 `\n§\n` 分隔的 MD 文件，`ENTRY_HEAD_RE`（`store.js:132`）把 `[id]→时间戳→[git]→[branch]→[dsh-only]→[summary]` 的头部 token 序列统一解析，避免「正文里出现 `[summary:…]` 被误剥」。
2. **跨进程锁 + 防漂移 + 原子写 + 提示注入扫描**：`withLock` 目录锁带 pid 存活检测、`isCanonical` 往返校验（drift 时先 `.bak` 备份再拒绝）、tmp+rename 原子写、`scanThreat` 拒「忽略指令」类提示注入——四重防御，工程上极稳。
3. **快照注入保缓存前缀稳定**：`systemPrompt.context`「实时读 + 变更检测物化」，只有文本变化才追加；配固定提示行驱动每回合主动写 + 程序化盖时间戳/标签/分支。
4. **渐进式披露（KEY 轨摘要注入 + 按需 expand）**：直接切中「长期记忆占用上下文」的痛点。
5. **建议确认制（SuggestionQueue）**：所有会改变后续行为的写入先进 `SUGGESTIONS.jsonl` 待确认队列，用户采纳才生效，杜绝 AI 擅自写记忆改变行为。
6. **粘性 due 状态工具**：记忆审查到期写进快照（不自动清零，只有 `memory_review_status complete` 才复位），代替弱跟随模型的自觉——更防漏更可信。
7. **「默认只读该读的 8 条待办」硬过滤**：窄视图设计，符合「提醒/看板需主动、不刷屏」。
8. **多设备同步纪律**：本地永远完整、只同步开启的项目、绝不自动推送、git 冲突不落盘、条目 ID 为合并锚点——一套严谨的同步心智。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度

**极高但方向有分叉**。它在记忆分层、待办状态机、主动到期提醒、多设备同步、建议确认制上与 dsh-yolo 主张高度重合，很多机制（窄视图、粘性 due、待确认队列、四象限待办）可以直接借鉴。但它走的是「让 AI 替你管、替你做、拉一群 AI 干活」的**执行派**路线（COI 调度、外部派单、伪装成用户指令的 Advisor steer），而 dsh-yolo 是「管理而非代办、绝不打扰工作会话」的记忆派路线——在「主动性」的具体姿态上是相反取向。

## 明显的不足 / 局限

1. **功能面过宽导致单体复杂度**：20+ 子模块全塞进一个 `apply()`，`lib/index.js` 就 2000+ 行、配置项上百个、注释里遍布「用户拍板」式个人决策，是「十年前做全功能 IDE 插件」式的巨石，可维护性成本极高。
2. **服务器端 JS 无类型**：`lib/*.js` 全是 JSDoc + 手写文档，没有 `tsc --noEmit` 把关（`pnpm test` 只跑 `node --test`）；大量自由文本正则无编译期校验，类型安全≈零。
3. **`lib/client.js`（1.18MB）编译产物直接提交在版本库**：构建产物入库 + 手动 `build.mjs`（依赖 `DSH_SOURCE`），diff 噪音大、安全性依赖产物正确性。
4. **缺真机 E2E**：55 个 `node --test` 单测覆盖密（sync、advisor、coi 各一堆），但 `plugin.test.js` 用 mock context 而非真 dsh 进程，快照全链路、tool↔host 双向未被覆盖——没有 dsh-yolo 那种真实宿主 + Playwright W1–W8。
5. **高度耦合 DSH/cordis 具体 API**：依赖 `agent.steer/inject`、`agent/settled`、`surfaceOp`、`agent/inbox/spliced` 等底层事件/投影方法，是随 DSH 版本「踩坑式磨合」出来的，DSH 任一 API 升级都可能导致多模块连锁失效。
6. **大量纪律靠「提示词 + 模型自觉」**：收尾写日志、待办检查等本质是快照里一句指令让模型做，作者打了粘性 due 补丁但仍依赖模型配合；模型工具调用顺序/格式一旦偏离就漏写或写脏。
7. **「绝不打扰工作会话」与 Advisor 的 steer 相冲突**：Advisor 会对 nit/concern/blocker 走 `agent.steer` **实时打断**主会话，且**故意伪装成用户指令**——与 dsh-yolo「提醒绝不打扰工作会话」红线完全相反的设计取向，直接借鉴需谨慎。
8. **同步/评审模块过度自研、边界多**：三方合并、确定性补发、PROVENANCE、迁移/孤儿目录、CRLF 等大量边界，GUI 手动操作为主、无自动同步/推送/删除墓碑；内存合并仅启用项目生效，全局轨二期——心智负担高，未必适合轻助手默认开启。

## 对 dsh-yolo 的借鉴点（他山之石）

1. **记忆分层 + 渐进式披露控制上下文**：「全量注入 + 高频轨只按需读 + 低频轨摘要化按需 expand」直接搬到看板——保证长期记忆既在上下文里、又不撑爆 token 前缀缓存。
2. **变更检测的快照注入**：用「实时读 + 文本变化才追加」而不是每轮 append 新消息；配稳定固定收尾提示驱动知识抽取 + 程序化盖时间戳/项目标签/分支。
3. **建议确认制 + 粘性 due 状态工具**：所有会改变后续行为的写入先进待确认队列；用「到期写进快照 + 状态工具 complete 才复位」的粘性 flag 代替 LLM 自觉——比纯语义抽取更防漏更可信。dsh-yolo 的「语义抽取 + 提炼待确认」可借此做得更稳。
4. **待办状态机 + 「默认只读该读的 N 条」硬过滤**：dsh-yolo 的提醒/看板可借鉴其「主动展示该读的、不铺开全部」的窄视图。
5. **独立评审/提醒的防打扰治理**：用 guard（去重/升级/每轮一条）+ severity 分级 + 两级投递做频率控制——但**纠正其伪装成用户指令的做法**，保持 dsh-yolo「通知卡 + 绝不打断工作会话」的红线。
6. **多设备同步纪律**：条目 ID 为合并锚点 + 手写三方合并 + push 显式触发——若 dsh-yolo 未来要跨设备，这是一套可直接沿用的模板。

## 一句话结论

一个「记忆 + 待办 + 自我进化 + 主动调度」的极致全家桶，**在记忆分层、待办状态机、粘性 due、建议确认、同步纪律上有大量可直接吸收的机制**；但它是一人深度迭代出的执行派巨石（无类型、产物入库、强耦合 DSH 内部 API、缺真机 E2E），且其「伪装用户指令 + 实时打断」的主动性设计与 dsh-yolo「管理而非代办、绝不打扰工作会话」的定位相反——**取其机制、舍其姿态与工程形态**。

---
*资料来源：README.md、README-详细说明.md、docs/记忆同步.md、docs/COI-调度.md、lib/*.js 源码级分析、tests/*.test.js。*