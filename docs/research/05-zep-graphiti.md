# Zep / Graphiti 分析报告

> 他山之石调研 · 外部优选之「时间感知的知识图谱记忆」
> 一句话：**用「带有效时间窗的实体/事实/关系」做 Agent 记忆——对「截止日期、偏好变化、事实过期」天然擅长，是最值得研究的一条记忆架构路线。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [getzep/zep](https://github.com/getzep/zep)（约 3.3k stars，**已 archived**）；开源底层框架 [getzep/graphiti](https://github.com/getzep/graphiti)（现行） |
| 主语言 | Go（zep）；Graphiti 为时序知识图谱框架 |
| 许可证 | zep Apache-2.0；Graphiti 开放 |
| 维护状态 | **关键**：zep 老仓库已归档、Community Edition 已 deprecated 停维，Zep 开源重心整体转向 Graphiti + Zep Cloud/BYOC；Graphiti 仍在推进（含 MCP 服务器）。**老仓库≠仍维护**，不要把它当可直接复用的开源基座 |
| 定位 | 面向动态环境中 AI Agent 的时序感知知识图谱构建与查询框架 |

## 核心记忆机制 / 架构

Zep 的核心是**时间知识图谱（temporal knowledge graph）**，Graphiti 是其开源框架。关键概念：

- **Entities**：人、产品、政策、概念等节点。
- **Facts / Relationships**：带自然语言描述的实体间事实/关系。
- **Episodes**：原始摄入数据（对话、文档、事件），作为事实溯源。
- **Ontology**：开发者自定义的实体/关系类型约束。

最特别的是**双时间建模**：每条事实/边带 `created_at`（系统何时学到）、`valid_at`（事实何时为真）、`invalid_at`（事实何时不再为真）。因此它支持**自动事实失效**：当新证据与旧事实矛盾，Graphiti 自动把旧事实标记失效并保留时间历史，而不是靠 LLM 每轮重新判定。

检索是混合式：语义向量 + 关键词 + 图谱遍历 + ranked answer。与 GraphRAG 对照（README 对比表）：Graphiti 是**持续增量更新**（非批处理）、时间上下文图谱 + 显式双时间追踪 + 自动事实失效 + 时序历史保留。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度

**形式上契合度高、通用性受限**：非常适合「用户每周三健身」「某项目 deadline 是 9 月」「上周说切换技术栈、这周又改回」这类**长期事实 + 时间关系**。对「记忆何时有效 / 何时过期」的建模，比普通向量库/文本文件记忆更严谨。

但「时间感知」不等于「提醒」：它能回答「这个事实现在还成立吗」，但不会帮你「到点提醒该完成某件事」。任务状态机、看板、提醒触发器仍是应用层的事。

## 明显的不足 / 局限

1. **老 Zep 仓库已停维**，Community Edition deprecated；自托管只剩 enterprise BYOC，本地免费路径断了。当前开源只有 Graphiti 框架，不是完整平台——不适合作为可以直接上手的开源基座。
2. **工程复杂度高**：图谱、时间事实、混合检索，对仅仅是「一个轻量个人长期记忆」的诉求而言是重模型。
3. 对「任务状态、看板视图、提醒触发、撤销/重开」等应用动作没有内建概念，仍需自行设计任务对象与状态迁移。
4. 需要 Neo4j / 图存储等基础设施，本地优先、SQLite-first 形态下集成成本高。

## 对 dsh-yolo 的借鉴点

1. **时间事实建模是提醒的正确地基**：dsh-yolo 的提醒/看板要管理「某个 deadline 何时成立、何时因变更失效」，Graphiti 的 `valid_at / invalid_at` + 自动失效，是比「存一个字符串截止时间」更可演进的模型，值得在领域表设计上借鉴（不一定上图谱）。
2. **事实溯源（episodes 作为证据）**：Append 的记录/证据与结论分离——呼应 dsh-yolo「语义抽取要有依据、可审计」的方向。
3. **矛盾处理自动化**：当用户改口时自动让旧事实失效，比每轮让 LLM 硬判更稳——与 dsh-yolo 要升级的「语义抽取去重/冲突」直接相关。

## 一句话结论

**最值得研究的记忆架构灵感**：其「带有效时间窗的事实 + 自动失效 + 证据溯源」恰好是任务/提醒类应用的语义地基；但因老仓库停维、产品云化、工程偏重，**取架构思想、不取工程形态**，更不宜作为直接依赖的开源主基座。

---
*资料来源：[getzep/zep](https://github.com/getzep/zep)、[getzep/graphiti](https://github.com/getzep/graphiti)、[Zep 开源战略公告](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/)、[Zep FAQ](https://help.getzep.com/v3/faq)。*