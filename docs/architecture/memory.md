# 记忆模块架构

本文说明 `src/memory/` 的当前实现。该模块负责让模型访问已经持久化的管理型记忆，并把偏好、相关记忆和提醒处理规则装配进模型上下文；它不负责从对话中自动抽取记忆、持久化表结构、到期扫描或看板投影。

相关边界如下：

- 自动抽取与合并由 `src/extract/` 负责。
- SQLite 与 FTS5 由 `src/storage/` 负责；领域动作由 `src/application/commands/` 负责，`src/shared/actions.ts` 仅为兼容 re-export。
- 到期扫描、通知投递和常驻线程投递由 `src/reminder/` 负责；通知已读由 `src/ui/` 管理。
- `src/memory/` 只通过 `ctx.yolo` 使用存储服务，不另建一套记忆状态。

## 一、职责与依赖

模块入口是 `src/memory/index.ts`：

```ts
export const name = 'yolo-memory'
export const inject = ['yolo', 'tools', 'systemPrompt', 'llm', 'settings']
```

它完成四件事：

1. 注册五个模型可见工具。
2. 监听真实 `session/event`，推进召回去重并异步预热；最近用户消息与工作区读取自 `ctx.yolo.observations`。
3. 对该消息异步预热语义扩写和候选重排。
4. 注册两段 system prompt section 和一段动态 context。

YOLO 常驻线程和卡片锚定线程属于助手自己的交互表面。它们的消息不会更新工作区跟踪、不会触发召回预热，也不会消耗语义召回预算。

## 二、文件清单

| 文件 | 职责 |
|---|---|
| `index.ts` | 插件入口、召回去重、语义召回异步预热、observation 依赖接线 |
| `tools.ts` | 注册 `memory_*`、`yolo_query`、`yolo_action` 五个模型工具 |
| `recall.ts` | 三段 prompt/context、确定性注入策略、模板转义、会话内去重、缓存重排结果的应用 |
| `semantic.ts` | 宿主 LLM 查询扩写与候选重排、进程内缓存、每日预算、连续空结果自动降级 |

## 三、模型可见工具

工具执行时优先从 `exec.agent.session` 读取工作区；宿主未提供 session 时才回退 `process.cwd()`。所有返回值都包装为 JSON 对象，以满足宿主的工具输出 schema。

| 工具 | 主要参数 | 当前行为 |
|---|---|---|
| `memory_search` | `query`、`topK?`、`kinds?` | 在当前工作区搜索 todo、milestone、goal、preference、event；最终调用存储层的混合 FTS 检索 |
| `memory_write` | `kind`、`title`，以及对应的日期、详情、优先级或规则值 | 直接写入一条管理型记忆；适用于用户明确要求记录或跟踪的承诺、计划、管理规则，不是通用日记入口 |
| `memory_forget` | `kind`、`id` | 审计式软删除：todo 变为 cancelled，milestone 变为 abandoned，goal 变为 abandoned；终态条目会退出相应的活动视图或搜索索引 |
| `yolo_query` | `view`、`status?`、`limit?` | 查询当前工作区的 timeline、todos、goals、milestones 或 preferences |
| `yolo_action` | `action`、`kind`、条目 `id?`/`title?` 及动作参数 | 把提醒回复或计划更新交给 `applyYoloAction`；与看板 HTTP 动作复用领域状态迁移和事件审计 |

`yolo_action` 的 todo 状态动作包括 `complete`、`start`、`cancel`、`postpone`、`remind_again`、`reopen`，也支持把重复 todo 显式 `consolidate` 到保留项；R3 合并必须携带界面预览后产生的 `CONFIRM_CONSOLIDATE` 确认，并通过 `undo_consolidate` 撤销。goal 支持 `set_progress`，milestone 支持 `set_status`。工具声明没有把共享动作分发器的所有看板维护能力都暴露成专用参数，新增动作时应同时核对 `tools.ts` 与 `src/shared/actions.ts`。

`memory_write` 是直接模型工具入口，不经过 `src/extract/` 的 `shouldDropExtracted` 写质量门。它主要依靠工具描述约束用途，存储层仍会执行各领域对象自己的 upsert 规则。

## 四、三段上下文

`registerYoloPrompt()` 注册以下内容：

| 名称 | 类型 | 顺序 | 内容与刷新方式 |
|---|---|---:|---|
| `yolo-instructions` | section | 110 | 固定能力纪律：YOLO 自动抽取承诺和计划；模型无需为提醒另建文件或运行命令；用户回复提醒时应调用 `yolo_action` |
| `yolo-prefs` | section | 120 | 每次从当前工作区读取最新的当前偏好，按 `updated_at` 倒序，最多 12 条，渲染为 `key: value` |
| `yolo-recall` | context | 220 | 用最近用户消息检索相关记忆，经过候选合并、会话去重、类别配额和字符预算后注入 |

偏好段没有内容时返回空字符串。动态召回段最终只注入：

```text
## Related memory (from YOLO)
[todo] 把演示稿发给研发
[goal] 完成发布准备
```

当前动态注入只包含 `row_type` 和标题，不包含 FTS 命中的正文、截止时间、状态或来源。偏好既可能以完整 `key: value` 出现在常驻偏好段，也可能作为 FTS 命中以标题形式进入动态召回；两条路径没有统一去重。

存储内容中的 `{{` 会被替换为全角 `｛｛`，避免宿主在 prompt 组装时把用户内容误当成模板变量。

## 五、最近用户消息的获取

当前宿主的 `AssembleContext` 不提供 `userMessage`。storage provider 的唯一 `TurnObservationService` 监听宿主事件并维护最近真实工作会话文本/cwd；memory 在 context 装配时只读取：

```text
ctx.yolo.observations
  ├─ latestUserText()
  └─ latestWorkspaceCwd()

memory 自己的 `session/event` listener 只做：
真实 user/message
  ├─ 推进 RecallDedupTracker
  └─ 异步预热语义召回
```

assistant 消息、工具事件、空文本和 YOLO 内部线程都会在 runtime/provider 边界忽略。Observation 按 session 保存 direct-human turn，并有界清理；全局 latest 值只服务当前 prompt fallback，不再由 memory/reminder/UI 各保存一份竞争状态。

## 六、确定性检索

动态召回和 `memory_search` 最终都调用 `ctx.yolo.search()`，其底层是 `src/storage/search.ts` 的 `ftsRecallSearch()`。搜索对象为 FTS5 `yolo_fts` 中的五类行：todo、milestone、goal、preference、event。

确定性检索流程为：

```text
原始用户文本
  ├─ 截取前 64 个字符
  ├─ 整句加引号做 FTS phrase 查询
  ├─ 提取拉丁/数字词和中文三元组，组成 OR 查询
  ├─ 独立二字中文词走 title LIKE 回退
  └─ 按 row_type:row_id 保序去重，截到 topK
```

具体限制：

- 拉丁或数字词长度至少为 3。
- 连续中文按滑动三元组拆分，最多取 8 个检索短语。
- 只有独立的二字中文串进入 `LIKE` 回退，最多取 2 个；`LIKE` 只扫标题，并赋予最差排序值。
- 用户文本先包装成 FTS 引号短语，双引号会被转义，因此 `<`、`>`、`AND`、`OR` 等 FTS 语法字符不会直接进入查询语法。
- 多路径结果按首次出现顺序合并，键为 `(row_type, row_id)`。

该路径完全本地、同步且确定性，是语义模型失败、降级或尚未完成预热时的保底结果。

## 七、语义拓宽与重排

语义召回不使用 embedding 或向量库，而是复用宿主 `ctx.llm`。用户消息到达时，`prewarmSemantic()` 在后台启动，prompt 装配不会等待它完成。

```text
用户消息到达
  └─ shouldExpand 门控
       └─ LLM 生成同义/跨语言查询
            ├─ 原查询 FTS 结果
            ├─ 每个扩写查询的 FTS 结果
            └─ 合并去重
                 └─ 可选 LLM 候选重排
                      └─ 写入进程内缓存

prompt 装配
  ├─ 总能同步取得原查询 FTS 结果
  ├─ 若预热缓存已就绪，再合并扩写结果并应用重排顺序
  └─ 进入统一的确定性注入策略
```

### 7.1 扩写门控

默认满足以下条件才调用 LLM：

- `semantic.enabled = true`；
- `expansionsPerQuery > 0`；
- 去除首尾空白后的查询至少 6 个字符；
- 当天扩写预算未达到 60 次；
- 当前精确查询字符串不在扩写缓存中；
- 当天没有触发自动降级。

扩写最多返回 3 个检索表达，提示模型覆盖同义改写和可能的跨语言表达，同时禁止引入原查询没有的实体。扩写失败或输出无法解析时返回空数组，不阻断确定性检索。

### 7.2 候选重排

默认最多把 8 个候选交给 LLM。模型返回候选键、`keep` 和 `confident|related|weak|irrelevant` 理由，结果会按候选集合签名缓存。

必须注意：当前 `applyRerank()` 不是强过滤器。它先放入模型判定保留的候选，再补入原始确定性结果的保底项，最后把候选池中尚未出现的其余行继续追加。因此 `irrelevant` 候选仍可能进入后续注入策略；现阶段重排主要改变顺序，不能表述为模型已经删除无关项。

### 7.3 缓存、预算与自动降级

扩写缓存以去空白后的完整查询为键；重排缓存以查询和排序后的候选键集合为键。两者都是插件进程内 `Map`：重启后清空，目前没有 TTL 和容量上限。

每日预算也是进程内计数，按本地日期切换清零。一次扩写尝试消耗一次预算，重排没有单独预算计数。

默认连续 5 次扩写得到空结果后，当天停止语义拓宽，只使用确定性 FTS。日期切换会重置连续空结果和降级状态；也可以通过实例方法手动复位。一次非空扩写会立即清零连续空结果计数。

## 八、注入策略

所有确定性和语义拓宽后的候选最终都进入 `applyRecallPolicy()`，语义模型不能绕开该策略。

策略按候选顺序执行：

1. 若 `row_type:row_id` 已在当前会话注入过，丢弃并标记 `already-injected`。
2. 每种 `row_type` 最多保留 2 条，超过者标记 `kind-quota`。
3. 将每条候选按 `[row_type] title` 计算长度；累计超过预算者标记 `over-budget`，但继续尝试后续较短候选。
4. 返回保留项和丢弃原因。

预算当前为 `DEFAULTS.recallMaxTokens * 4`，默认相当于 2048 个 JavaScript 字符。它是 token 到字符数的粗略换算，使用 `line.length` 计算，不是 UTF-8 字节预算，也不是模型 tokenizer 的精确 token 数。

## 九、会话内注入去重

`RecallDedupTracker` 用于同时满足“同一记忆不要每轮重复注入”和“同一轮多次模型装配保持内容稳定”：

1. 第一条用户消息到达，开始本轮；当前 `injected` 集合不变。
2. prompt 装配把本轮保留键交给 `onRecallKept()`，暂存在 `keptKeys`，但不立即加入 `injected`。
3. 同一轮发生多次装配时，看到的 `injected` 集合相同，生成文本保持稳定。
4. 下一条用户消息到达时，上一轮 `keptKeys` 才并入 `injected`；之后相同行不会在该会话再次注入。

切换 session 时会先清空已经累计的 `injected`，但随后仍会提交上一轮尚未提交的 `keptKeys`。所以新 session 通常重新获得此前记忆，只有紧邻切换前一轮刚渲染的键会继续被抑制。当前 tracker 只有一份全局状态，不是每个 session 一份独立状态。

## 十、配置接线现状

### 10.1 已实时接线的语义配置

`src/memory/index.ts` 每次用户消息预热前从 `yolo` settings 命名空间读取 `semantic`：

| 配置 | 默认值 | 作用 |
|---|---:|---|
| `enabled` | `true` | 语义拓宽总开关 |
| `model` | `deepseek-chat` | 扩写和重排模型 |
| `expansionsPerQuery` | `3` | 每次最多扩写数 |
| `rerankOn` | `true` | 是否调用并应用候选重排 |
| `maxRerankCandidates` | `8` | 最多交给模型的候选数 |
| `dailyBudget` | `60` | 每个进程、每个本地日的扩写次数上限 |
| `minQueryChars` | `6` | 查询最短字符数 |
| `degradeAfterEmpty` | `5` | 连续空扩写触发当天降级的阈值；0 表示禁用该保护 |

### 10.2 已暴露但当前未接线的召回配置

设置 schema 还暴露了：

- `recall.topK`，默认 5；
- `recall.maxTokens`，默认 512。

当前 `registerYoloPrompt()` 和语义预热仍直接读取 `DEFAULTS.recallTopK`、`DEFAULTS.recallMaxTokens` 和 `DEFAULTS.recallKindQuota`，没有读取 settings 中的 `recall`。因此用户修改 `topK` 或 `maxTokens` 暂时不会改变实际动态召回行为。文档与 UI 不应宣称这两项已经动态生效。

`recallPrefsMax` 和 `recallKindQuota` 目前只有内部默认常量，没有对应设置项。

## 十一、审计与可观测性现状

语义预热会调用 `ctx.yolo.logRecall()`，记录：

- 原始 query；
- LLM expansions；
- rerank outcome；
- 扩写阶段耗时；
- 来源 session；
- `ok|empty|error` 状态和错误信息。

`recall_log` schema 还预留了 `kept_keys` 和 `drop_reasons`，但当前动态 context 在执行 `applyRecallPolicy()` 后没有写 `logRecall()`。因此实际注入了哪些键、各候选为何被丢弃，尚未进入数据库审计。现有日志是“语义预热观测”，不是完整的“召回到注入全链路审计”。

另一个细节是预热日志的 `latency_ms` 在扩写结束后即计算；即使随后还执行重排，该值也不包含重排耗时。

## 十二、与提醒和动作的关系

记忆模块不负责到期扫描或投递提醒，但它承接提醒回复：

- `yolo-instructions` 告诉模型识别以 `⏰ YOLO 提醒` 开头的消息。
- 用户回复“已完成”“推迟到某日”“再提醒”时，模型使用 `yolo_action`。
- `yolo_action` 进入与看板 HTTP 动作相同的 `application/commands/applyYoloAction` 路径，再由单 workspace UnitOfWork 完成状态迁移、提醒盖章复位或通知卡处理，并写时间线事件。

当前提醒正文只包含用户可读的标题和到期时间，不携带 todo id 或模型操作指令；模型按标题引用 todo，处理规则只存在于 system section。若后续修改提醒载荷，必须同步核对 `src/reminder/scheduler.ts`、`recall.ts` 的指令和 `tools.ts` 的工具描述。

## 十三、失败降级

- FTS 搜索或 prompt 组装读取存储失败：记录 warn，动态召回返回空字符串，不拖垮主对话。
- LLM 扩写或重排失败：返回空结果，继续使用原查询的确定性 FTS。
- 语义预热尚未完成：当前轮直接使用确定性结果；后续同一查询可命中缓存。
- 连续空扩写达到阈值：当天降级为确定性 FTS，次日恢复。
- 没有最近用户消息或没有保留候选：不生成动态 context。

## 十四、已知限制

1. 最近消息和工作区已经统一由 `TurnObservationService` 管理；但 `RecallDedupTracker` 仍是 memory 插件实例级状态，多 session 并发时的注入去重尚未完全按 session 隔离。
2. 扩写与重排缓存没有 TTL 或容量上限，长时间运行时会持续增长。
3. 重排只改变优先顺序，没有真正过滤 `irrelevant` 候选。
4. `recall.topK` 与 `recall.maxTokens` 设置尚未接入实际召回。
5. `recall_log` 没有记录最终 `kept_keys` 和 `drop_reasons`。
6. 动态注入只有标题，没有正文、状态、截止时间、来源或命中解释。
7. 预算是字符数近似，不是 UTF-8 字节数或精确 token 数。
8. 语义预热是异步的，首个 prompt 装配可能早于缓存就绪，这是以不阻塞主链路换取的明确取舍。
9. 当前作用域由最近真实工作 session 的 cwd 决定；记忆模块不会跨所有已知工作区做一次聚合召回。
10. 达到 100% 的 goal 会变为 achieved，但存储层目前没有在该转换中移除对应 FTS 行，因此仍可能被搜索或动态召回。

## 十五、相关测试

| 测试文件 | 主要覆盖 |
|---|---|
| `tests/memory-index.test.ts` | 插件注册、observation 消费、YOLO 内部线程跳过、特殊 FTS 字符、二字中文回退、改写召回、session 切换去重 |
| `tests/turn-observation.test.ts` | 并发 session、direct-human capture、late steering、YOLO session 排除与有界清理 |
| `tests/memory-tools.test.ts` | 五个模型工具的执行、作用域解析、写入/查询/软删除、提醒回复动作 |
| `tests/memory-recall.test.ts` | 三段 prompt/context、偏好上限、模板转义、动态召回渲染、注入键回报和类别配额 |
| `tests/recall-policy.test.ts` | `applyRecallPolicy` 的三类丢弃原因、超预算跳过、`RecallDedupTracker` 状态机、混合 FTS 查询 |
| `tests/semantic.test.ts` | 查询扩写、候选结果解析、缓存键、预算门控、确定性保底、连续空结果降级与跨日恢复 |
| `tests/memory-health.test.ts` | recall/extraction 错误与命中率等看板健康指标的聚合 |

修改本模块时，至少运行：

```bash
pnpm check
pnpm test:run
```

若工具协议、prompt 内容或 API payload 有用户可感知变化，还应按仓库测试约定补对应单测，并执行受影响的真实宿主 E2E 与 W1–W8 验证。
