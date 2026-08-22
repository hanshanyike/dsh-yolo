# Basic Memory 分析报告

> 他山之石调研 · 外部优选之「本地优先的 Markdown/MCP 记忆」
> 一句话：**用 Markdown 文件 + MCP server 给 Claude/Cursor 等做跨会话持久记忆，哲学上和 dsh-yolo「文件即权威、本地优先」最接近。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) |
| 主语言 | Python（MCP server） |
| Stars | 约 3.4k、forks 约 225 |
| 许可证 | AGPL-3.0 |
| 维护状态 | 活跃；latest release v0.22.1（~2026-06），README 近期更新 |
| 定位 | 把记忆存成 Markdown，让 AI 工具有真正跨会话的持久记忆编码 |

## 定位与主张

Basic Memory 的核心主张是**「记忆应该是可读、可携带、可版本控制的普通文本」**：你的记忆不是锁在某家向量数据库/云平台里，而是**本地的 `.md` 文件**，任何编辑器都能打开、任何 git 都能跟踪、换工具不丢。它通过 MCP server 给 Claude Desktop / Claude Code / Cursor 等客户端提供记忆读写能力。

## 核心记忆机制 / 架构

- **MCP server**：暴露 `write_note`、`read_note`、`edit_note`、`move_note`、`delete_note`、`read_content` 等工具。
- **存储即 Markdown**：对话、项目知识、笔记存成本地 Markdown 文件；支持语义搜索、wikilink graph（双向链接）、内容间的关联。
- **同步**：本地优先；云端版用 Postgres / S3，跨设备同步与协作（也基于 git/rclone/云 类机制）。
- **集成面**：Claude Desktop、Claude Code、Cursor 等一切 MCP 客户端可直接接入。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度

**中高、但只在「记忆基础面」**。它非常适合「跨会话记忆 + 给助手注入上下文」，例如记住用户偏好、项目约定、对话摘要。但没有提醒、待办状态机、看板 UI，任务管理需外接 Todoist/Notion/日历或自建 dashboard——它止步于「会记住」，还谈不上「主动管理」。

## 明显的不足 / 局限

1. **强依赖 MCP 客户端生态**：如果不走 Claude/Cursor 等 MCP 客户端，集成成本上升；它不是独立可运行的「助手」，而是被 AI 工具调用的记忆服务。
2. **Markdown 在大型知识、复杂图谱查询、权限/审计上的局限**：超过一定规模后，文本文件比结构化数据库难维护、难做细粒度权限与审计。
3. **AGPL-3.0** 对商业闭源集成不友好。
4. **同步机制基于 rclone/cloud/git 类方式**，生产环境需自行验证冲突与一致性；无内建的强提醒、待办状态机、看板 UI。

## 对 dsh-yolo 的借鉴点

1. **「记忆可读可写、离开工具也不丢」**：启示 dsh-yolo 可以把看板/记忆状态落成可审计的结构化文本/记录，人可离线查看、git 可追踪——与它「审计事件 + 可回滚」一致。
2. **wikilink graph / 双向链接**：展示一种轻量"知识关联"，比纯标签更利于跨条目召回（dsh-yolo 的实体/关系升级可借鉴）。
3. **借力 MCP 生态做注入**：Basic Memory 证明「给任意客户端一份稳定记忆注入面」是可行的；dsh-yolo 若未来要多端，可参考其「一个记忆服务喂多个表面」的形态。
4. **本地优先的意识形态参照**：作为「管理而非代办、数据在用户手上」定位的背书。

## 一句话结论

**哲学最接近的参照**（本地优先 + 文件即权威 + 可版本控制），适合作为 dsh-yolo「记忆可看可审计可落地」的实现作风参考；但它没有提醒与任务管理，且受 MCP 生态与 Markdown 规模限制——恰好衬托出 dsh-yolo「在结构化记忆之上做看板管理 + 主动提醒」的价值。

---
*资料来源：[Basic Memory README](https://github.com/basicmachines-co/basic-memory)、第三方索引页信息。*