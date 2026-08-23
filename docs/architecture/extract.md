# `src/extract/`：语义提取

## 职责与边界

该插件在真实工作会话的一轮对话结束后，用一次 LLM 结构化调用识别 commitments、plans 与
tracking rules，并把新条目和既有条目的状态变化交给存储/统一动作链。它不使用逐消息正则
快速路径，也会跳过 YOLO resident/anchored 内部会话。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、turn 触发、配置读取、节流/配额、合并、质量闸门与失败隔离 |
| `llm-extract.ts` | LLM 调用、内容折叠、JSON 解析和防御式校验 |
| `prompt.ts` | 抽取提示词与已知记忆摘要 |

## 数据流

```text
agent/turn-stopping
  → 跳过 YOLO 内部会话
  → deriveMessages() 折叠为有界文本（超长保留尾部）
  → minTurnChars、session 间隔、每日运行次数/预算检查
  → buildKnownContext（包含已知状态、进度、到期与标题）
  → llmExtract + parseExtractionJson + validateExtraction
  → shouldDropExtracted 质量过滤
  → 先写 todos/milestones/goals/preferences/events
  → 再应用 updates[] 的状态变化
  → extraction_log / session summary 审计
```

先新增、后更新保证“同一轮创建并完成”能够命中新条目。`updates[].match_title` 应复用 known
context 的标题；定位时优先精确归一化匹配，再按活跃状态与新近度选择宽松匹配。无法匹配的
LLM 标题会被静默丢弃，不会让整轮失败。

`extraction_log.status` 的现行 `hasContent` 判断只统计 todo、milestone、goal 与 `updates[]`；
仅抽到 preference、event 或 session summary 的轮次仍会记为 `empty`。这是当前审计口径，不代表
这些内容没有写入。

## 配置与运行约束

- `extraction.enableLLM`：总开关。
- `extraction.model`：辅助抽取模型。
- `extraction.minIntervalSec`：同 session 节流，默认 30 秒。
- `extraction.minTurnChars`：短闲聊闸门，默认 4。
- `extraction.maxRunsPerDay`：每日运行次数上限，默认 300。
- 模型流量使用宿主允许的 `purpose: 'session-title'`；该联合类型没有自定义 purpose。
- handler 必须隔离异常并写日志，不能把抽取失败抛回 agent 循环。

## 记忆范围

只保留需要管理的承诺、计划、目标/里程碑、日程事件和跟踪规则。人格、泛知识、随口偏好与
无后续管理价值的生活细节不属于本模块的长期记忆范围。

## 相关文档

- [记忆与召回](memory.md)
- [存储服务](storage.md)
- [共享质量闸门与动作入口](shared.md)
