# `src/extract/`：语义提取

## 职责与边界

该插件在真实工作会话的一轮对话结束后，用一次 LLM 结构化调用识别 commitments、plans 与
tracking rules，并把新条目和既有条目的状态变化交给存储/统一动作链。它不依赖主 agent
主动调用写入工具，也不使用逐消息正则快速路径；YOLO resident/anchored 内部会话会被跳过。

## 文件

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、turn 触发、配置读取、节流/配额、合并、质量闸门与失败隔离 |
| `llm-extract.ts` | LLM 调用、内容折叠、JSON 解析和防御式校验 |
| `prompt.ts` | 抽取提示词与已知记忆摘要 |

## 数据流

```text
agent/pre-step（只捕获本轮实际进入模型的 direct-human 消息）
  → agent/turn-stopping 仅排队，不等待辅助模型
  → agent.whenIdle() + durable turn/end completed|max-tokens
  → 跳过 YOLO 内部会话
  → 现代宿主若本 turn 没有 direct-human 捕获则跳过（Goal 自动 round 不抽取）
  → 本轮 direct-human 输入折叠为有界文本（排除 plugin/tool context）
  → minTurnChars、每日运行次数/预算检查
  → buildKnownContext（包含已知状态、进度、到期与标题）
  → 独立 AbortController + llmExtract + 严格 JSON schema 入口 + validateExtraction
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

`extracted_json` 保存原始模型文本、归一化后的 `parsed`、finish reason、实际 provider/model 路由、
输入规模和 token usage。不能只保存归一化结果，否则错误 schema 与真正空抽取无法区分。

## 配置与运行约束

- `extraction.enableLLM`：总开关。
- `extraction.model`：辅助抽取模型。
- `extraction.minIntervalSec`：同 session 后台调用的最小间隔，默认 30 秒。快速连续轮次进入串行队列并延后执行，
  不再直接跳过已完成轮次。
- `extraction.minTurnChars`：短闲聊闸门，默认 4。
- `extraction.maxRunsPerDay`：每日运行次数上限，默认 300。
- 模型流量使用宿主允许的 `purpose: 'session-title'`；该联合类型没有自定义 purpose。
- provider/model 优先继承当前 agent 的完整路由，其次使用宿主 `agentDefaultModel`。历史 `extraction.model`
  只有在 DeepSeek provider 上覆盖模型，避免把 `deepseek-chat` 错配给其他 provider。
- 模型以 `error`/`aborted` 结束或没有返回文本时记为抽取错误，不再伪装成 `empty`。
- 错误 JSON 或不含抽取 schema 字段的 JSON 记为 `error`；只有合法的空 schema 才记为 `empty`。
- `due_at` 接受兼容的 `YYYY-MM-DD`，有明确时间或相对分钟时必须保存带时区的 ISO-8601 datetime；
  相对时间以宿主接受本轮首条直接用户输入时捕获的本地时钟为准，不能因等待 agent 空闲或抽取节流跨过
  午夜而改变“今天/明天”的日期。缺少 `agent/pre-step` 的兼容宿主才回退到后台任务启动时间。
- aborted/blocked/error/interrupted 的 turn/end 不抽取；插件卸载会中止正在运行的后台抽取。
- Goal continuation 是 `role=user`、`source.kind=goal` 的自动消息，每个 round 都是独立 turn；它不代表
  新的用户承诺，不能触发抽取。现代宿主有 durable event log 时，没有本轮 direct-human 捕获就直接跳过；
  只有无 event log 的兼容宿主可回退到 derived messages，且仍必须满足 `source.kind=user`。
- Goal 执行期间新到达的真人 steering 仍由 `agent/pre-step` 捕获，只抽取该真人消息，不混入 Goal 文本。
- handler 必须隔离异常并写日志，不能把抽取失败抛回 agent 循环。

## 记忆范围

只保留需要管理的承诺、计划、目标/里程碑、日程事件和跟踪规则。人格、泛知识、随口偏好与
无后续管理价值的生活细节不属于本模块的长期记忆范围。

## 相关文档

- [记忆与召回](memory.md)
- [存储服务](storage.md)
- [共享质量闸门与动作入口](shared.md)
