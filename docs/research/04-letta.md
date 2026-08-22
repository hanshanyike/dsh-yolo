# Letta（letta-code，原 MemGPT）分析报告

> 他山之石调研 · 外部优选之「状态化 Agent + 自我管理的长期记忆」
> 一句话：**从 MemGPT 演进出的状态化 Agent 平台，有记忆、身份、跨越时间经验，还带 Cron 调度——最接近「Jarvis 式 Agent 原型」。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | 历史入口 [letta-ai/letta](https://github.com/letta-ai/letta)（约 24.3k stars）；当前源码 [letta-ai/letta-code](https://github.com/letta-ai/letta-code) |
| 主语言 | TypeScript / Python / JS 混合（letta-code 是现行主仓库） |
| 许可证 | Apache-2.0 |
| 维护状态 | 非常活跃；letta-code 约 3,177 commits，recent commit ~2026-08，issues 约 103、PR 约 131 |
| 定位 | Agents have memory, identity, and a sense of experience over time；学习并改写自己的 memory/skills/prompts/harness |

## 定位与主张

Letta 是 MemGPT 的精神续作，核心信念是**「一个状态化的 Agent」**：Agent 不只是每次对话的响应器，而是拥有长期记忆、身份、overtime 经验的持续存在。它支持多入口（CLI、桌面、Web、Slack、Telegram、Discord 等），有 Crons & Schedules，可让 Agent「主动」在周期内干活——这是它在「助手形态」上领先于纯记忆层项目的关键。

## 核心记忆机制 / 架构

联想式记忆模型（经典 MemGPT/Letta）：

- **Core Memory（常驻上下文）**：接近工作记忆，始终在上下文中，Agent 可改写。
- **Archival Memory（长期外部记忆）**：类似磁盘，存入/读取长期知识。
- **Recall / message history**：历史消息与记忆的检索。

工程化能力（letta-code README 明示）：**memory blocks**（结构化记忆块）、**skills、hooks**（钩子扩展）、**Crons & Schedules**（周期调度）、**MemFS**（所有上下文含 memory blocks 用 git 追踪）、`/doctor`（审计记忆质量）、`/memory`（查看记忆）、`/remember`（教 Agent 新信息）、`/search`（搜索消息与记忆）。Letta Cloud 可跨机器保存 Agent memory、identity、conversations。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度

**很契合、最接近「原型」**：长期记忆 + 身份 + 经验 + Cron 调度 + skills + 多方入口，几乎是「Jarvis 式 Agent」的功能清单。但：

- 它是**通用状态化 Agent OS**，不是个人任务管理产品——任务/待办/看板的领域模型要自建。
- Crons 能做「到点调度」，但「提醒的领域语义」（完成/撤销/推迟/筛选/审计事件）仍要应用层设计。
- Reframe：当下它更像「能记住我的那台 Agent 机器」，而不是「帮我管理工作与生活的那块看板」。

## 明显的不足 / 局限

1. **对轻量产品过重**：要理解 memory blocks、MemFS、hooks、Crons、remote environments 等概念，学习成本高。
2. **任务管理/看板/提醒的领域语义缺失**：需要自行建模「任务对象、状态迁移、提醒表、审计事件」。
3. **架构迁移期**：主仓库从 V1 迁到 letta-code，旧仓库变 landing page；若要接入需面对新老两套生态的不确定。
4. **本地优先 / 私有数据控制需单独评估**：若用 Letta Cloud，数据走向云；自托管与本地 SQLite 的适配需自行验证。
5. **多入口、多 Agent 编排带来的复杂度**：对「一个安静、低打扰、只在一个 IDE 侧栏里出现」的助手而言可能略重。

## 对 dsh-yolo 的借鉴点

1. **Core / Archival / Recall 三层记忆的心理模型**：与 dsh-yolo「每轮常驻 + 按需召回」一脉相承，可作为语义映射参考。
2. **Cron 调度与「主动到点干活」**：启示 dsh-yolo 的提醒调度器可以借鉴「定周期检查 + 状态化」思路（呼应其 `checkIntervalSec`）。
3. **`/doctor` 记忆质量审计 + `/memory` 可视化**：启发 dsh-yolo 做「记忆/看板健康度」入口，让用户能看见系统记住了什么、质量如何。
4. **MemFS 用 git 追踪全部上下文**：与 dsh-yolo「审计 + 可回滚」的取向一致，值得参考其把状态变更纳入版本追踪的做法。

## 一句话结论

**「个人 Agent 形态」最完整的参考样本**，其状态化记忆 + 主动调度 + 记忆质量审计的理念，为 dsh-yolo 指出了一条「助手不只是检索、而是有持续存在」的演进方向；但它仍是通用 Agent OS，真正的「任务/提醒/看板管理」差异化与「低打扰」体验仍需 dsh-yolo 自己在应用层定义。

---
*资料来源：[letta-ai/letta](https://github.com/letta-ai/letta)、[letta-ai/letta-code](https://github.com/letta-ai/letta-code)、[Letta 文档](https://docs.letta.com/)。*