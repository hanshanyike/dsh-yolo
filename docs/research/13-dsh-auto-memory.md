# dsh-auto-memory 分析报告

> 他山之石调研 · 最值得深入研究仓库之一（dsh 生态）
> 一句话：**目前与 dsh-yolo 定位最贴近的参照物——三层记忆注入 + 每轮自巩固 + 跨工具记忆继承，点缀以「注入式弱主动」的日历提醒；但无待办看板状态机与审计，恰是 dsh-yolo 的核心差异空间。**

## 元信息

| 项 | 值 |
|---|---|
| 仓库 | [Aik358/dsh-auto-memory](https://github.com/Aik358/dsh-auto-memory)（npm `@a9i5k4/dsh-auto-memory`） |
| 主语言 | JavaScript（ESM `lib/*.js`，类型由 dsh 宿主承载） |
| 许可证 | BSD-3-Clause |
| 当前版本 | v0.1.29（features 密度高，迭代快） |
| 维护状态 | 活跃 |
| 定位 | DSH Web GUI 的缓存友好三层记忆引擎 + 人性化交互插件：自动注入 / 每轮自巩固 / 跨工具记忆继承，点缀主动日历提醒、暖心问候、自写每日日志 |

## 定位与主张（README 主张 vs 真实实现）

| 主张 | 真实实现 |
|---|---|
| 三层自动记忆 | ✅ 真实：用户级 / 项目笔记 / 每日日志三层 + 反思（实为四类文件），集中式根 `~/.dsh/memory/workspaces/{ws}/` |
| proactive calendar reminders | ⚠️ **名不副实**——无到点实时触发，是「开新会话时被动注入未完成事项」的弱主动 |
| 温和问候 | ✅ 但**只活在 GUI 概览页**；另有「欢迎回来」注入对话首轮 |
| 逐轮自巩固 | ✅ `agent/turn-stopping` 钩子 + subagent，带冷却/每日上限 |
| 继承他工具记忆 | ✅ 扫描 workbuddy/CodeBuddy/Claude Code/Codex 画像与会话 |

**关键判断**：README 把日历提醒讲得很主动（「赶在时间到达前提醒你」），但源码里唯一触达机制是系统提示词注入未完成事项 + GUI，没有「到点推送」。这是名与实之间最大的裂缝。

## 核心架构与运作原理

**三层记忆（实为四类存储）**：用户级 `~/.dsh/memory/MEMORY.md`（跨项目，daily 4000 字）、项目笔记 `{ws}/MEMORY.md`（daily 3000 字）、每日日志 append-only、反思。明文 Markdown + 进程内缓存（`this.state`），检索为**关键词行匹配**（非语义、无 embedding）。

**proactive calendar reminders —— 真实机制**：数据面 `~/.dsh/memory/CALENDAR.md`（用户级、跨工作区），纯 Markdown 逐行 `- [x] HH:MM | 象限 | 标题 | 备注`；四个工具 calendar_add/list/done/remove 增删改这个文件。**投递面三处全是被动/注入，无一条实时推送**：① 会话首轮系统提示词把「未完成且日期≥今天」的条目 `.slice(0,10)` 注入 `<memory_system>[日历与日程(未完成)]` 块，由 AI 在回复里提及；② GUI 概览页月视图 + 当天时间轴；③ `reminder` 字段**直接沦为备注**（只拼进 note 字符串，无任何调度/到点触发逻辑）。周期轮询 `setInterval(15s)` 的 `tickTime()` 只做暂离检测/兜底恢复/按 points 到点生成时段总结，**日历无 due-time 检查**——它不会打断工作会话（契合 dsh-yolo「绝不打扰」），但也**做不到 deadline 到了主动推给用户**。

**温和问候时机**：AI 问候卡仅渲染在 GUI 概览页（按时段每天每时段一次、缓存不重复烧 API），不注入对话流；「欢迎回来」在 `_lastActiveAt` 距今 > 3600s 时注入对话首轮要求 AI 回复开头欢迎，GUI 返回时自动弹毛玻璃「记忆窗口」（可配关闭）。

**逐轮自巩固频控（对 dsh-yolo 最有借鉴价值）**：`agent/turn-stopping` → `setTimeout(600ms)` → `engine.consolidateTurn`。闸门：顶层会话才处理（subagent 轮跳过）；content 门槛 `autoConsolidateMinChars`(240) 判寒暄；turn 去重；冷却 `autoConsolidateCooldownMinutes`(30，非工作时段 22:00-08:00 自动 ×2)；每日上限 `autoConsolidateDailyMax`(8)。subagent 超时(40s)入重试队列，5 分钟 retryTimer 兜底；15s heartbeatTimer 写心跳文件证明轮询存活。产出 `[TOPIC]/[LOG]/[NOTE]/[USER]` 分路写日志/项目/用户级，带今日预算 + 压缩兜底。

**继承他工具记忆**：`external.discover` 扫描 `~/.workbuddy/MEMORY.md`、`~/.claude/CLAUDE.md`、项目级 CLAUDE.md/AGENTS.md/CODEBUDDY.md 等；`memory_external import` 用**纯路径指针**（不整段写入，防脏内容混入），注入端只给绝对路径让模型自己读。

## 关键亮点（带证据）

1. **前缀缓存友好双轨注入**：静态纪律走 `systemPrompt.section`（字节级稳定作前缀缓存锚），动态记忆走 `systemPrompt.context` user-role 快照（内容不变不重复注入），避免系统提示词一变化就击穿整条历史【lib/index.js pre-step L710-786 + smoke-test】。
2. **「写闸门」记忆卫生**：`sanitizeForWrite`（乱码/复读退化/重复行拒绝、append 8000/整篇 20 万上限、尾部 60 行复读去重）+ 脏 token 扫描器 `dirtyScanForFiles`（34 项乱码特征、raw JSON/base64 拒写，只给位置不给正文）【lib/index.js L2222】。
3. **每轮自巩固完整工程闭环**：turn-stopping → subagent 提炼 → 预算 → 压缩/归档兜底 → 失败重试队列 → 15s 心跳探活，比多数记忆插件「靠模型自觉调 memory_log」可靠【lib/index.js L1610-1764】。
4. **日界/集中式/迁移**：`dayBoundaryMinutes`(450=7:30) 把凌晨活儿归前一天、跨天重置预算；老式分散 `.dsh-memory/` 自动迁移到集中式根【L599-606】。
5. **仅 loopback 的 API + 敏感段注入剥离**：所有 `/api/dsh-auto-memory/*` 强制 `isLoopbackRequest`（403 拒外部）；`stripSensitiveSections`(凭据/token/密钥) 不注入 prompt，文件保留【L2929 / L751】。

## 与「个人 AI 助手（记忆+提醒+看板）」的契合度与差距

**契合（最接近 dsh-yolo 定位）**：覆盖了 dsh-yolo 核心的「长期记忆 + 主动提醒 + 跨会话 + 低打扰通知面」，会话与面板都在 DSH 侧栏常驻。

**差距（dsh-yolo 的两大空档）**：**无看板状态机/审计**——日历每条只是 `done` 布尔，无推迟/取消/撤销/进度分支、无审计事件留痕、无撤销窗口（这正是 dsh-yolo `applyYoloAction` 统一状态迁移 + 审计的差异化点）；**「主动」名不符实**——无到点实时推送，靠开会话时注入 + GUI，若用户一直不开会话就永远收不到。

## 明显的不足 / 局限

1. **提醒非实时**：无 scheduler/due-time 触发；`reminder` 字段无调度语义；不开会话就收不到提醒【L1449-1473 / L2882-2890】。
2. **`API.greet` 路由有实际 bug**：handler 引用未定义 `body` → 必抛 ReferenceError 被吞成 500【L3304-3306】。
3. **「逐轮自巩固」依赖 LLM subagent** → 每次调用有 API 成本；虽限 8 次/天但静默烧预算；subagent 不可用时功能静默失效（降级为空结果）。
4. **记忆检索为关键词行匹配非语义**；跨工作区/大文件 `slice(-2000)`/`truncateTail` 截断，深层回忆精度有限。
5. **无看板状态机、无审计、无删除确认/撤销**；日历为明文单文件，多实例/并发写无锁，无跨设备同步。
6. **注入只覆盖会话首轮/首步**，turn 中途 deadline 变化依赖每 15s refresh 兜底，时序有盲区【L2691-2704】。

## 对 dsh-yolo 的具体借鉴点

1. **主动日历提醒的数据面 + 投递面分层**：学它「未完成事项注入 next-session 首轮」的低打扰冷启动感知；但**要补齐它缺失的 due-time scheduler**——用 15s 心跳轮询作触发源，命中到点事项时走 dsh-yolo 自己的低打扰通知卡（侧栏角标 + 看板卡），而非仅注入式。
2. **自巩固频控整套参数化闸门可平移**：minChars 寒暄门槛 / turn 去重 / 冷却（非工作时段翻倍）/ 每日上限 / 失败重试队列 / 15s 心跳探活 / 日界跨天重置——正是 dsh-yolo「每轮 LLM 语义抽取 + 去重节流」可直接复用的成熟模板【L1622-1650】。
3. **记忆继承用纯路径指针 + 脏内容写闸门**：`memory_external` 的 pure-link import 与 `sanitizeForWrite` 卫生层极成熟，dsh-yolo 若做「继承他工具记忆」应照搬「指针不整段、写入前过闸门」两条原则。
4. **前缀缓存双轨（section 静态纪律 + context 动态快照）** 是让「逐轮自巩固 + 动态记忆注入」不击穿 DeepSeek 前缀缓存的正确姿势，dsh-yolo 注入层应沿用。

## 一句话结论

dsh-auto-memory 是目前与 dsh-yolo 定位最贴近的参照物，**三层记忆注入与每轮自巩固的工程化程度高、启发价值大**；但它的「主动提醒」实为**注入式弱主动而非到点实时推送**，且完全没有待办看板状态机与审计——恰是 dsh-yolo 需要补齐并借此做差异化的两个空档。

---
*资料来源：仓库 lib/index.js（提醒注入 L769-776、tickTime L1449、自巩固 L1610、问候 L1518、外部继承 L2181）、lib/client.js、README.zh-CN.md / README.md、package.json、cordis.patch.yml（源码级分析）。*