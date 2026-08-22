# M9 设计文档 · Phase 2 Manager（一）：召回质量与机制加固

> 状态：已评审（定稿 · 2026-08-22）
> 依据：`docs/research/00-total.md`（总报告）与 `docs/research/09-borrowables.md`（可借鉴清单 P1–P46）。
> 版本线：v0.4.0。红线不变：**管理而非代办；绝不打扰工作会话；类型安全 + 真机验证。**

## 一、背景：调研结论与现有缺口

调研报告的核心判断：dsh-yolo 的差异化位（长期记忆 + due 调度 + 看板状态机 + 审计）在公开生态里几乎无人占据，
下一步最该盯的方向是 **M9「语义召回 + 提醒质量」**，同时短期可贴着既有 `applyYoloAction` 动作路径收敛若干机制债。

对照源码（2026-08-22 现状），确认五个真实缺口：

| # | 缺口 | 现状证据 | 对应借鉴 |
|---|---|---|---|
| G1 | **召回几乎不命中**：整句查询被包成单个 FTS5 短语，要求全部 trigram 连续出现 | `src/storage/search.ts:18` `toFtsPhrase(q)` 把整条用户消息当短语匹配 | P6 语义+关键词混合召回 |
| G2 | **注入无去重、无治理**：同一批命中每轮重复注入（撑爆上下文 + 击穿前缀缓存）；偏好全量注入无上限 | `src/memory/recall.ts:48-75` 每次装配全量重渲染 | P42 会话内注入去重 / P5 字节预算 / P7 recall policy |
| G3 | **模板注入风险**：宿主对 section/context 文本做严格 `{{name}}` 插值，记忆内容含 `{{...}}` 会静默替换甚至抛错炸掉装配 | 全仓无转义；宿主 `dsh-system-prompt` `interpolate()` | P11 防模板注入 |
| G4 | **动作失败无审计**：校验失败只返回 `{ok:false}`，不留痕；`memory_forget` 绕过领域动作直调 `setTodoStatus`（无事件）；无 consolidate 合并动作 | `src/shared/actions.ts`、`src/memory/tools.ts:115-131` | P34 门下沉 + `<action>-denied` / P35 consolidate |
| G5 | **频控参数是死配置**：`reminder.checkIntervalSec/aheadMin` 有 schema 无接线（永远用 DEFAULTS）；`extractionTokenBudgetPerDay` 是死常量；抽取失败不落 error 审计 | `src/reminder/index.ts:84-103`、`src/shared/constants.ts:28-29` | P44 频控参数化闸门 |

## 二、方案总览

三条工作流，全部背靠既有结构（FTS5 + applyYoloAction + extraction_log），不引入向量库、不引入新依赖：

```
召回质量（A）                          动作加固（B）                     频控可观测（C）
─────────────                        ─────────────                    ─────────────
用户消息                              yolo_action / POST /actions       agent/turn-stopping
  │ 整句短语 + token OR 多路            │ 校验失败 → action_denied 审计     │ 寒暄门槛 minTurnChars
  ▼                                    │ memory_forget → 统一动作路径      │ 每日上限 maxRunsPerDay
ftsRecallSearch                        │ consolidate 新领域动作            │ 失败 → error 审计行
  │ 短语优先 + OR 广撒 + LIKE 兜底        ▼                                  ▼
  ▼                                    todo_consolidated 事件            extraction_log(status=error)
applyRecallPolicy（纯函数）
  │ 已注入过滤 / kind 配额 / 字节预算贪心
  ▼                                   会话内注入去重（A3）：keptKeys 在下一条用户消息到达时
注入文本 {{ 转义 + 偏好上限             才提交进 injected 集合 —— 同一轮多个 model step 的装配文本保持稳定
```

## 三、详细设计

### 3.1 混合多路召回（G1 → P6）

`src/storage/search.ts` 新增 `ftsRecallSearch(db, query, topK, kinds)`，取代 `search()` 内部的单短语查询：

1. **token 提取**（纯宿主代码，确定性）：
   - 拉丁/数字词 ≥3 字符（`/[A-Za-z0-9]+/`），如 `react`、`vitest`；
   - CJK 连续段滑窗 trigram（「把演示稿发给研发」→ 把演示/演示稿/…/给研发）；
   - 独立 2 字 CJK 段（如「研发」）走 `title LIKE` 子串兜底（FTS5 trigram 无法匹配 <3 字符）；
   - token 去重、总数封顶 8，查询本身仍截 64 字符。
2. **三路查询合并**：整句短语（精确重问，排最前）→ token `OR` 短语表达式（BM25 排序）→ LIKE 兜底（rank 置最差）。
   按 `(row_type, row_id)` 去重后截 `topK`。`ftsSearch` 保留导出（单路精确查询，测试用）。
3. **效果**：`memory_search` 工具与上下文注入同步受益（同走 `Yolo.search()`）。
   「语义同但措辞异」中的**词面重叠**类（中文同词不同句）由 OR 多路覆盖；跨语言（季度总结 ↔ Q3 report）明确不在本轮（见第五节）。

### 3.2 召回决策层 + 注入去重（G2 → P7/P42/P5）

**策略层**（`src/memory/recall.ts` 新纯函数，可单测）：

```ts
applyRecallPolicy(hits, { injected, kindQuota, budgetChars })
  → { keep: SearchHit[]; drops: { key: string; reason: string }[] }
```

按序裁决，每条 drop 带机器可读 reason（`already-injected` / `kind-quota` / `over-budget`）：
1. 已注入集合过滤（会话内去重，见下）；
2. kind 配额（默认每种 `row_type` ≤2 条，防止同类刷屏）；
3. 字节预算**贪心**装袋（按 rank 顺序，单条超限跳过继续，不再整段 break —— 修复现有 `break` 丢余量问题）。

**会话内注入去重**（`src/memory/index.ts` 扩展现有 session/event 缓存）：

- 状态：`{ sessionId, keptKeys[], injected: Set<string> }`；
- 装配时：用 `injected` 过滤 → keep 的 key 存入 `keptKeys`；**同一轮的多次装配（多 model step）查询与过滤条件不变，文本稳定**（不击穿前缀缓存）；
- 下一条 `user/message` 到达时：`keptKeys` 才提交进 `injected`（此后不再重复注入）；
- 会话切换（user/message 的 session.id 变化）：清空 `injected`（新会话从头注入）。
- 与现有 `lastUserText` 全局缓存同一粒度 —— 多会话并发本来就是近似，行为一致。

### 3.3 注入安全与偏好上限（G3 → P11 + P5）

- `escapePromptTemplates(s)`：注入前把 `{{` 替换为 `｛｛`（全角），破坏宿主插值模式。应用于 `yolo-prefs` 每行与 `yolo-recall` 每行（用户派生文本的全部注入点）。
- 偏好注入上限：`listPreferences` 结果按 `updated_at` 取最新 N 条（默认 12，`DEFAULTS.recallPrefsMax`），超出的不进 system prompt（仍可被 `memory_search` 召回）。

### 3.4 动作失败审计 + forget 收编 + consolidate（G4 → P34/P35）

**denied 审计**：`applyYoloAction` 每个失败返回点改走内部 `deny()` helper —— 先写 `action_denied` 事件
（summary `⚠ 拒绝 {action}/{kind}：{error}`，detail 截断 300 字符，带 session_id），再返回 `{ok:false}`。
唯一例外：`handled` 的「已处理」404 是幂等 no-op，不落审计。新增 EventKind：`action_denied`。

**memory_forget 收编**：`src/memory/tools.ts` 的 forget 不再直调 `setTodoStatus`/`setMilestoneStatus`/`setGoalProgress`，改走 `applyYoloAction`：
- todo → `cancel`（审计 `todo_cancelled`）；
- milestone → `set_status abandoned`（审计 `milestone_status`）；
- goal → `abandon`（审计 `goal_status`，同时修掉「forget goal 只是把进度清零」的语义错误）。

**consolidate 显式原子动作**（P35：合并/去重是显式动作，不做隐式魔法）：

- 请求形状：`{ action:'consolidate', kind:'todo', id|title = 被并入方(source), into_id|into_title = 保留方(target) }`（`YoloActionRequest` 新增 `into_id`/`into_title`）。
- 领域函数 `applyTodoConsolidate(db, sourceRef, intoRef, sessionId)`（repository 层，与 `applyTodoAction` 同级）：
  - 双方必须都是**未终态** todo；source == target → 400；任一未找到 → 404；
  - 合并规则（确定性）：target.detail 追加 `（已并入「source.title」…原截止 …）`；target.due_at 为空则继承 source 的；priority 取两者较高；source → cancelled + FTS 软删；
  - 单条 `todo_consolidated` 审计事件（summary `合并：「source」→「target」`，detail 记录继承字段）；source 的未处理通知卡一并落处理；
  - 返回合并后的 target 行。
- 入口：模型工具 `yolo_action`（参数文档同步）与 `POST /yolo/actions` 同路径；看板 UI 入口本轮不做（合并候选发现依赖去重检测，属后续「记忆健康度」面）。

### 3.5 频控参数化闸门（G5 → P44）

- **reminder 接线**：`src/reminder/index.ts` 启动时从 settings 读 `reminder.checkIntervalSec` / `reminder.aheadMin` 传入 scheduler（缺省回落 DEFAULTS）；aheadMs 在每次 tick 现读（与 brief 同模式）。修复「settings 有配置项但不生效」。
- **抽取闸门**（`src/extract/index.ts`，均在 LLM 调用前）：
  - **寒暄门槛**：最后一条 user 消息文本 < `extraction.minTurnChars`（默认 4）→ 跳过（「好的」「继续」不再触发抽取；「周三交稿」4 字仍保留）；
  - **每日上限**：当日 `extraction_log`（strategy=llm）条数 ≥ `extraction.maxRunsPerDay`（默认 300）→ 跳过并 warn 一次；
  - **失败审计**：LLM 调用或合并失败 → `logExtraction(status:'error', extracted_json:{error})`，补上可观测盲区。
- 新配置项（settings schema + DEFAULTS）：`extraction.minTurnChars=4`、`extraction.maxRunsPerDay=300`。

## 四、明确不做的（Scope 边界）

| 项 | 为什么不做 |
|---|---|
| 向量嵌入 / embedding 召回 | 本地无嵌入模型运行时；先用确定性多路召回吃掉词面重叠类 miss，跨语言语义留待真正需要时评估 |
| P36 提案式审批队列（全 ask） | 与「低打扰」红线冲突；现有「直接写 + 看板可见可审 + 4 秒撤销」已覆盖可纠错性 |
| P13/P15 时间有效性 / 矛盾自动失效 | 领域建模改动大，单独评估（候选 M9.5） |
| P26 记忆健康度 UI | 纯可观测性；本轮先把 drops reason 与 error 审计数据落下来，UI 后置 |
| M10 跨工作区聚合 | 下一个里程碑，独立立项 |
| 跨设备同步（P27-P29） | 长期项 |

## 五、测试计划

- **单测**（`pnpm test:run`，内存 SQLite，不依赖 host）：
  - `tests/storage-search` 或 `memory-recall`：token 提取（拉丁/CJK 滑窗/2 字兜底）、三路合并去重、整句短语优先；
  - 新 `tests/recall-policy.test.ts`：三种 drop reason、kind 配额、贪心预算（跳过单条不 break）、转义、偏好上限；
  - `tests/memory-recall.test.ts` 扩展：会话内去重状态机（多轮装配稳定、跨消息提交、换会话清空）；
  - `tests/storage-actions.test.ts` 扩展：consolidate 全分支 + denied 审计落事件 + handled 幂等不落事件；
  - `tests/reminder-scheduler.test.ts` / `tests/extract-index.test.ts` 扩展：间隔接线、寒暄门槛、每日上限、error 审计。
- **E2E**（真实宿主，`node scripts/e2e.mjs --spec consolidate`）：HTTP 建 2 条 todo → consolidate → 看板剩 1 条 + 台账出现 `todo_consolidated`；构造非法动作 → 台账出现 `action_denied`。夹具带 `[E2E]` 前缀、afterAll 幂等清理、用语真实。
- **真机 W1–W8**：本轮触碰 `src/ui/**`（config schema）与 `POST /yolo/actions` 载荷（新动作 + 台账新事件种类），按 `docs/testing.md` 第七节全量走查。

## 六、实施顺序与提交切分

1. 脚手架：DEFAULTS + settings schema 新增项（本次一并提交）；
2. 三条并行工作流（A 召回 / B 动作 / C 频控），文件不相交；
3. 集成：`pnpm check` → `pnpm test:run` → `pnpm build`；
4. E2E 全套 + W1–W8 真机走查；
5. 文档（本设计文档、CHANGELOG、architecture.md 召回与事件节）+ 单提交收口。

---
*关联：`docs/research/09-borrowables.md`（P5/P6/P7/P11/P34/P35/P42/P44 条目原文）· `docs/architecture.md`（数据流）· `docs/testing.md`（W1–W8）。*
