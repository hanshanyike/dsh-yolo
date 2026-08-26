# 为什么“一件事”会变成多个事项，以及怎么改（讨论稿）

> 本文只讨论承诺与计划的自动整理，不讨论通用个人记忆。
>
> 这是供讨论的设计稿，不代表已经实现，也不是实施授权。

## 先说结论

现在有两个问题，必须按先后顺序处理：

> **第一，Goal 模式的每个自动 round 都被当成新 turn，再调用一次抽取模型；第二，抽取结果只有扁平 todo，没有“一个用户承诺是父事项，拆解结果只是步骤”的结构。**

我的建议可以缩成三条：

1. 只有本轮确实收到 direct-human 消息时，才允许启动承诺抽取；Goal 自动 round 必须跳过。
2. 只有用户明确承诺的事情，才能成为看板上的顶层事项。
3. assistant 拆出的执行步骤默认挂在该事项下面；拿不准是一件还是多件时，先让用户确认。

普通用户 turn 仍然可以在对话结束、agent 空闲后异步抽取一次。Goal 内部推进不属于新的用户承诺，不应运行这条抽取链。

## 1. 用一个例子说明当前问题

假设用户说：

> “这周把新版发布准备好。”

主 assistant 可能回复：

> “可以拆成：修复遗留问题、补测试、整理发布说明。”

用户真正承诺的是一件事：**把新版发布准备好**。

合理的看板应该是：

```text
把新版发布准备好              ← 1 个顶层事项，可以完成、推迟、提醒
  ├─ 修复遗留问题              ← 计划步骤
  ├─ 补测试                    ← 计划步骤
  └─ 整理发布说明              ← 计划步骤
```

不合理的结果是：

```text
修复遗留问题                  ← 3 个并列事项
补测试
整理发布说明
```

后者会让看板数量膨胀，还可能产生三个提醒。更严重的是，用户没有亲自承诺“每一步都要被分别跟踪”。

## 2. 当前实现实际上怎么工作

普通对话下，当前 `dsh-yolo` 的主链路是：

```text
用户输入被宿主接受
  → agent/pre-step 只保存 source.kind=user 的直接用户消息
  → 主 assistant 完成本轮回复
  → durable turn/end + agent 空闲
  → 独立抽取模型只读取刚才保存的用户消息
  → 输出 todos / goals / milestones / updates
  → 结果立即写入 SQLite 和看板
```

但 Goal 模式多了一条会破坏上述边界的路径。

### 2.1 Goal 的每个自动 round 都是新 turn

Goal 的 continuation consumer 会向同一 session 追加一种特殊的 user-role 消息：

```text
role = user
source.kind = goal
source.round = 1 / 2 / 3 / ...
```

每个 round 都会独立完成一个 turn，因此都会触发一次 `agent/turn-stopping`。当前抽取器使用 `${sessionId}:${turn}` 去重，只能阻止同一个 turn 重复调度，不能把多个 Goal round 合并成一次。

结果是：一个 Goal 自动推进 5 轮，就可能运行 5 次语义抽取。

### 2.2 direct-human 过滤被 fallback 绕过

`agent/pre-step` 捕获阶段本来只接受：

```text
source.kind === 'user'
```

因此 `source.kind='goal'` 的自动消息不会进入 `capturedMessages`。问题发生在后面的兼容 fallback：当本 turn 没捕获到 direct-human 消息时，它会从 session history 找最新的：

```text
message.role === 'user'
```

这里没有再次检查 `source.kind`。Goal continuation 正好是 user-role，于是又被取回来送进抽取模型。

完整错误链是：

```text
Goal round N
  → 新 turn
  → 没有 direct-human capturedMessages
  → fallback 找到 role=user、source.kind=goal 的自动消息
  → 调用一次抽取模型
  → Goal 下一 round 再重复一次
```

所以你指出的现象是准确的：**Goal 模式下当前确实会每一步抽取一次。**

### 2.3 正常主路径仍不会把 assistant 回复直接交给抽取模型

当前代码只捕获 direct-human 消息，常规 assistant 回复、工具结果和 plugin context 都不属于抽取证据。

普通模式下，看到多个事项时不能直接断言“主 assistant 的三步回复被复制进了数据库”。但 Goal 模式下，assistant 驱动产生的 goal continuation 会通过上述 fallback 进入抽取器，因此模型的自动推进内容确实可能被错误转成事项。

当前存在两类来源：

- 普通用户 turn：用户自己的表达被抽取模型拆成多个 todo；
- Goal turn：自动生成的 goal-role continuation 被 fallback 当成用户输入。

要判断某一次真实样本，需要看对应 `extraction_log` 的模型原始输出和 `parsed.todos`。我只读检查了当前工作区可用的最近审计，没有找到截图中“整理 E2E 测试记录”对应的那一行，因此本文不把具体样本的来源写成已经证实。

### 2.4 第二层问题才是“父事项与步骤”

当前抽取 schema 只有扁平的 `todos[]`：

```text
todos: [A, B, C]
```

它没有表达下面这种关系的能力：

```text
commitment: A
steps: [B, C]
```

存储层去重也主要依赖规范化标题。“准备新版发布”和“补发布测试”标题不同，因此不会被认为是同一个承诺下的内容。

## 3. 两个参考仓库到底提供了什么

它们都不是可以直接搬过来的答案，只各自提供一个有用部件。

### 3.1 dsh-memory-evolve：值得借“先建议、后确认”

[`dsh-memory-evolve`](https://github.com/csyangwen/dsh-memory-evolve/tree/1e6e7eb15ce515b0f2bd2142bdee9a36c46c8b91) 的主模型会基于完整会话做 review，用户内容和 assistant 内容没有执行层的硬隔离。它虽然在规则中要求“用户口述的 todo 可直写、模型自己想到的 todo 走建议”，但真正执行 `dtodo add` 时不会检查来源消息。

所以它**没有解决“一件事被 assistant 拆成多个顶层事项”**。

它最值得借的是 suggestion queue：模型建议的重要记忆或 todo 可以先进入待确认区，用户编辑、采纳或拒绝后再正式生效。相关证据见其 [review 规则](https://github.com/csyangwen/dsh-memory-evolve/blob/1e6e7eb15ce515b0f2bd2142bdee9a36c46c8b91/docs/rules.md#L79-L122) 和 [`dtodo add` 实现](https://github.com/csyangwen/dsh-memory-evolve/blob/1e6e7eb15ce515b0f2bd2142bdee9a36c46c8b91/lib/todo.js#L625-L643)。

### 3.2 dsh-mnemon：值得借“用户事实与 assistant 产物分开处理”

[`dsh-mnemon`](https://github.com/omdsh-dev/dsh-mnemon/tree/91af2d86ee71982f4f5bfbccb8ad7acf308496f5) 只用直接用户活动决定是否启动后台 review，然后在 review persona 中要求：

- 用户明确、长期有效的断言可以进入 hot memory；
- assistant 的推理、总结不能当作用户事实；
- assistant 产出的完整设计或调查可以进入 Project Document；
- 用户若要保存某条 assistant 回复，可以点 Save to memory，确认后再交给 worker。

这比 `dsh-memory-evolve` 的来源纪律更清楚，但它仍然读取完整 checkpoint，主要靠 persona 区分；Runtime 条目本身也没有用户原话 span。更重要的是，它管理稳定知识和文档，不管理 todo 的截止、完成、推迟和提醒。

相关证据见 [后台 review 工作流](https://github.com/omdsh-dev/dsh-mnemon/blob/91af2d86ee71982f4f5bfbccb8ad7acf308496f5/docs/en/workflows.md#L249-L306)、[review persona](https://github.com/omdsh-dev/dsh-mnemon/blob/91af2d86ee71982f4f5bfbccb8ad7acf308496f5/src/subagent.ts#L660-L666) 和 [Save to memory](https://github.com/omdsh-dev/dsh-mnemon/blob/91af2d86ee71982f4f5bfbccb8ad7acf308496f5/src/client/MnemonSaveAction.tsx#L66-L100)。

### 3.3 对 YOLO 的实际结论

| 参考仓库 | 借什么 | 不借什么 |
|---|---|---|
| dsh-memory-evolve | 待确认队列、采纳前可编辑 | 完整上下文自审、靠模型判断来源、字符串去重 |
| dsh-mnemon | 用户事实与 assistant artifact 分流、显式 Save | 通用记忆三层模型、用 persona 代替 Host 校验 |

YOLO 应该把两点组合起来，并增加两个仓库都没有的东西：**父事项/步骤结构，以及每条顶层事项对应的用户原话证据。**

## 4. 推荐的新流程

```text
第零步：触发门禁
  本 turn 有 source.kind=user 的 direct-human 消息？
    是 → 允许在 turn 结束后抽取一次
    否 → 跳过；不得从 role=user 历史做宽泛 fallback

  source.kind=goal / plugin / tool？
    一律不进入承诺抽取

第一步：保存用户证据
  direct-human 消息 → message_id + 原文 + 时间 + workspace

第二步：抽取“用户承诺”，不是抽取“所有可执行动作”
  输出：0 个、1 个或多个承诺候选
  每个候选必须引用用户原话

第三步：判断候选与步骤的关系
  新承诺        → CREATE
  已有事项变化  → UPDATE
  某事项的步骤  → ATTACH_STEP
  不是承诺      → NOOP
  无法判断      → ASK

第四步：Host 检查后提交
  只有顶层承诺进入看板和提醒调度
  步骤默认不单独提醒
```

这里的关键不是让 LLM 更聪明，而是让 Host 拥有几条不能绕过的规则：

1. 没有 direct-human capturedMessages 就不运行抽取；删除宽泛 fallback，或把 fallback 同样限制为 `source.kind='user'`。
2. Goal round、plugin context、tool result 永远不能触发承诺抽取。
3. 新建顶层事项必须有 direct-human 原话作为授权证据。
4. assistant 提议不能单独授权新建事项。
5. 用户说“就按你刚才的三步做”时，这句话是授权证据，上一条 assistant 计划只能提供步骤内容。
6. 同一段用户原话不能随意生成多个顶层事项；一轮突然生成多项或与现有事项重叠时，进入待确认。

## 5. 几种常见表达应该怎样处理

| 用户表达 | 建议结果 | 原因 |
|---|---|---|
| “今天把演示稿发给研发” | 1 个 todo | 一个明确承诺 |
| “帮我拆一下发布前要做什么” | 0 个自动 todo，返回计划草稿 | 用户要求规划，没有承诺执行 |
| “v0.4 上线前要完成迁移、测试和文档” | 1 个上线事项 + 3 个步骤 | 共同服务于一个完成结果 |
| “周三交报告，周五去体检” | 2 个 todo | 截止、场景和完成状态相互独立 |
| “把报告写完，然后发给研发” | 默认 1 个事项 + 2 个步骤 | 是一个连续交付流程 |
| “按你刚才的三步做，并分别提醒我” | 3 个可独立提醒事项，或父事项下 3 个可提醒步骤 | 用户明确采纳并要求分别跟踪 |
| “报告已经写完了” | UPDATE 已有事项 | 状态变化，不是新事项 |

## 6. 用户会看到什么变化

### 明确的一件事

仍然自动进入看板，不增加确认负担。

### assistant 给出的拆解

只在对话里展示。用户点击“保存为计划”后，才挂到某个父事项下面。

### 系统拿不准是一件还是多件

展示一个低打扰确认：

> 我理解为“准备新版发布”这一件事，下面包含迁移、测试、文档三个步骤。这样记录吗？

用户可以：

- 按一件事保存；
- 拆成三件事；
- 编辑后保存；
- 不记录。

待确认内容在用户确认前不触发提醒。

## 7. 为什么不先只改 prompt

可以在 prompt 中写“一件事不要拆成多个 todo”，但这只能临时降低概率：

- 不同模型对“一件事”的理解会变化；
- prompt 无法保存父子关系；
- 存储层仍然只接收扁平 todo；
- 出错后无法指出每项对应用户哪句话；
- Host 无法阻止模型一次写入多项。

因此 prompt 可以先止血，但最终仍需要“用户证据 + 父事项/步骤 + 待确认”三个结构。

## 8. 推荐验证顺序

这部分以后真要实现时，不建议一次切换：

1. 先修触发门禁：Goal 连续多 round 的抽取调用数必须为 0；Goal 期间新收到的真实用户 steering 只抽取该真实消息一次。
2. 再保存逐项用户证据，但不改变看板。
3. 新抽取器以 shadow mode 运行，只记录它会生成几个父事项和几个步骤。
4. 用真实句子检查“一件事被拆多”的比例，以及真实多事项有没有被错误合并。
5. 最后加入待确认界面；数据稳定后再切换自动写入。

## 9. 这次需要讨论的四个决定

### 决定零：Goal 自动 round 是否参与承诺抽取

**我的建议：完全不参与。** Goal 内部进展属于执行轨迹，不是新的用户承诺；只有期间到达的真实用户 steering 才单独抽取一次。

### 决定一：默认粒度

“把报告写完，然后发给研发”默认是一件事带两个步骤，还是两件事？

**我的建议：默认一件事；只有用户要求分别跟踪，或两件事有独立截止/状态时才拆。**

### 决定二：assistant 计划是否自动保存

**我的建议：不自动保存。** 普通拆解留在对话里；用户点击“保存为计划”或明确表示采纳后再持久化。

### 决定三：歧义确认放在哪里

**我的建议：Today 只显示一条“有 N 个待确认整理”的低打扰摘要；完整列表放单独的待确认区。**

如果这四个默认值与你的直觉一致，下一版才能进一步细化数据表、API 和迁移；在此之前不应该开始改抽取代码。
