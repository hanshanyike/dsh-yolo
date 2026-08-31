# E2E 测试规范（场景 · 用例 · 套件）

> 浏览器端到端测试的单一事实源：有哪些场景、怎么跑、为什么之前慢/不稳定、
> agent 如何按规范执行与归因。运行/配置总览见 [testing.md](testing.md) 第五节。
> 本文由 2026-08 的 E2E 治理（分支 `test/e2e-standardization`）落地并实测背书。

---

## 一、测试分层与套件划分

按标准测试分层（自下而上）：单元测试 → 集成测试（HTTP 接口）→ 端到端测试（浏览器）→ 手工验收走查。
中间两层合称 E2E，按载体拆成两个可独立运行的套件：

| 分层 | 套件 | 位置 | 载体 | 验证什么 | 期望耗时 |
|---|---|---|---|---|---|
| 单元测试 | vitest | `tests/**/*.test.ts` | 内存 SQLite / ctx stub | 纯逻辑、领域动作、插件接线 | ~15s 全量 |
| 集成测试（HTTP 接口） | **api** | `tests/e2e/api/` | 真实宿主 HTTP（无浏览器） | 端点契约：dashboard 形状、动作路由、审计事件 | **< 10s** |
| 端到端测试（浏览器） | **ui** | `tests/e2e/ui/` | 真实宿主 + Edge（Playwright） | 表达层与宿主集成：首页/计划/历史、主题、助手对话与事项讨论 | ~1min |
| 手工验收走查 | — | [testing.md](testing.md) 第八节 | 人肉清单 | 自动化盲区（IME、动效观感、DPI…） | 按触发范围 |

选择原则：**能跑低层就不跑高层**——接口层的问题不进浏览器，交互问题才上真机。
断言落在持久元素（事项行或详情）而非易消失的 toast；夹具经真实端点种入，绝不 mock 存储。

## 二、场景 × 用例矩阵

### api 套件 · HTTP 接口测试

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `api/dashboard-scope.spec.ts` | 真实 HTTP 的 `single / all` 聚合契约、workspace/source owner、未知 scope 拒绝后恢复；`partial / all-fail / recovery` 与同 id 双 scope 由 `tests/dashboard-aggregate.test.ts` 确定性覆盖 | W13 / WS-01 / WS-03 |
| `api/dashboard-surfaces.spec.ts` | 首页安静/正常/高压和 partial；最多一个首要事项、跨区去重、计划与历史边界、最近变化过滤 | W2 / W11 / W13 / HOME / HIST |
| `api/source-provenance.spec.ts` | 会话来源保存有界摘录、时间、工作区、session id 和可选 turn；manual/tool/legacy/旧数据降级；capability 与字段一致 | W8 / W16 / SRC-01～03 |
| `api/identity-feedback.spec.ts` | R2c 错误关联纠错：原 evidence 保留、有效来源排除、无后续冲突时安全恢复自动截止时间，并写 feedback/audit | R2C-API |
| `ui/identity-feedback.spec.ts` | R2c 回执与纠错：事项详情显示关联依据/置信度，用户可标记错误关联并看到纠正结果 | R2C-UI |
| `ui/todo-merge.spec.ts` | R3 语义合并建议：resolver 理由/置信度、误推荐抑制、实验开关、终态冲突预览、明确选择保留项、确认合并与可审计撤销 | R3-UI |
| `api/due-semantics.spec.ts` | date-only、精确 datetime 与终态的 overdue/attention/summary 一致，并正确进入首页和计划投影；快速记录不会立即生成提醒 | W2 / W4 / W11 |
| `api/notifications.spec.ts` | 未读与处理分离、20 条稳定分页、完整可达和已读基线 | W12 / W14 / NOTIF-API-01 |
| `api/history.spec.ts` | 完整时间线分页、内部审计排除、稳定事项身份、改名连续、终态筛选和结构化字段变化 | W8 / W15 / HIST-03～04 |
| `api/actions-consolidate.spec.ts` · P35 | 合并两条待办：保留方继承字段、被并方退场、审计保留；最近变化是否展示只按产品白名单 | W3 / HIST-01 |
| `api/actions-consolidate.spec.ts` · P34 | 非法动作 400 且落 `action_denied` 审计——拒绝绝不静默，UI 不把内部审计伪装成用户进展 | W12 / W16 |
| `api/actions-range.spec.ts` | 日期闭区间批量取消只处理开放规范事项；永久删除要求强确认并清除所有状态的事项与直接关联数据 | W3 / W12 / W13 / W15 |

### ui 套件 · 浏览器端到端测试

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `ui/panel-flow.spec.ts` | 默认首页、快速记录、完成/取消/推迟、四秒撤销和跨首页/计划/历史同步 | W1～W4 / W12 / W15 |
| `ui/home-plan-history.spec.ts` | 首页安静/正常/高压；计划“今天/接下来/目标/全部”；历史“按时间/按事项”、状态筛选与事项展开；没有“进展”或“Agent 任务”入口 | W2 / W8 / W11 / W15 / HOME / HIST |
| `ui/source-navigation.spec.ts` | 首页、计划、历史和详情使用同一来源行为；预览、失败不关闭、成功打开宿主会话、重开恢复；旧数据降级 | W8 / W9 / SRC-01～04 |
| `ui/foreground-exclusion.spec.ts` | 助手对话、事项讨论、详情、来源预览互斥；返回、Esc、焦点和单/双栏语义一致 | W5 / SM-01～03 / A11Y-01 |
| `ui/context-responsive.spec.ts` | 可用容器宽度 340、479 和阈值两侧；宿主侧栏展开/收起；resize 保留 thread/draft/pending/scroll/focus，至多一个上下文区 | W7 / RSP-01～02 |
| `ui/panel-v032.spec.ts` · `ui/chat-request-lifecycle.spec.ts` | 顶层 fresh ephemeral、事项 A、事项 B 隔离；响应式隐藏继续事项 episode，显式结束后新建 episode；慢回复不串写 | W10 / CHAT-01～02 |
| `ui/chat-scroll.spec.ts` | 单栏和双栏上下文各自真实 scroll owner；首载、发送、回复贴底，上翻后只提示新消息 | W5 / W7 / W10 |
| `ui/chat-request-lifecycle.spec.ts` | 单/双栏、Esc 和 panel 重挂载保持 accepted/stale；POST 恰好一次，旧轮询不覆盖当前前景 | W5 / W7 / W10 / CHAT-02 |
| `ui/dashboard-trust.spec.ts` | 服务端回执、撤销、partial scope、reason/evidence/source 与 payload 一致，首页不重复 | W11～W16 |
| `ui/reminder-badge.spec.ts` | badge 按未读投递精确计数；通知记录逐条可达但不复制事项动作；首页按事项聚合且 handled 与已读分离 | W12 / W14 / REM-HOME-01 |
| `ui/reminder-popup.spec.ts` | 历史通知不补弹、新通知不抢前景、面板已开只刷新、点击定位事项或通知记录 | W14 / REM-HOME-02 |
| `ui/theme-narrow.spec.ts` | 新表面深浅主题、340px 和 `<480px` 单栏，无横向滚动或遮挡，reduced-motion 退化正确 | W6 / W7 |
| `ui/accessibility-feedback.spec.ts` | 一级 Tab 键盘、单栏 focus trap/背景 inert、双栏非 modal、返回焦点、live region 和所有控件可读名 | W2 / W5 / W14 / A11Y |
| `ui/dashboard-trust.spec.ts` · `api/dashboard-scope.spec.ts` · `tests/dashboard-aggregate.test.ts` | UI 中 partial 只提示一次且动作固定原 `scope_cwd`；API 验证真实 owner/未知 scope recovery；同 id 双 scope 与 all-fail recovery 由确定性聚合单测验证 | W13 / WS-01～03 |
| `ui/capture-composition.spec.ts` | 中文输入法组合态 Enter 不误提交，组合结束后只新增一次真实事项 | W4 |
| `ui/settings-card.spec.ts` | 提醒与简报设置可保存并在刷新后回读；设置不泄漏内部实现入口 | W14 |
| `ui/data-management.spec.ts` | 更多菜单进入日期范围预览；批量取消、强确认永久删除、区间外隔离和单条永久删除 | W3 / W12 / W13 / W15 |

### 事项身份与多会话关联验收矩阵（TI）

本矩阵是 v0.4.0-rc5 最小结构闭环的准入契约。它验证输入幂等、多会话 evidence 和记录状态分离，
不把“标题相似”当作已经实现的语义自动合并。每项都必须检查 SQLite 和领域结果；只看助手回复或看板
数量不足以证明通过。

| 编号 | 层级 | 场景与硬断言 |
|---|---|---|
| TI-01 | unit + api | 同一 `source_fingerprint` 连续/并发重放：返回同一 canonical todo id；todo、evidence 和创建事件各只有一份 |
| TI-02 | unit | 同一 session/turn 触及两个不同 canonical todo 时，各自获得 operation + canonical id evidence；一项不能吞掉另一项的来源 |
| TI-03 | unit + api | 同一 tool operation 重试返回第一次结果；助手写入与后台抽取对齐到同一 canonical 事项，分别保留 assistant action 与 human evidence，不生成第二个事项 |
| TI-04 | unit | 两个 session/turn 关联同一事项：一个 todo、两条不可变 evidence；origin 不被后续 mention/update 覆盖，排序稳定 |
| TI-05 | unit + host | 在会话 A 创建，在会话 B 改期/开始/完成：始终操作同一 canonical id；每次关系和来源可追溯，提醒使用新状态 |
| TI-06 | migration | fresh/current/缺少新表列的 legacy DB 各连续打开两次：origin 回填恰好一次、旧来源投影不丢、`integrity_check=ok` |
| TI-07 | unit | 同 dedup key 同时存在终态、merged 与 open canonical：只命中 open canonical；若没有开放规范项则按明确新建契约处理 |
| TI-08 | unit + api | consolidate 后副本 `record_status=merged` 且指向 canonical；原业务 status 不被改写为 cancelled，旧 id 可解析到 canonical |
| TI-09 | unit + api | 旧 merged id 的 complete/cancel/postpone/update 路由到 canonical 且只作用一次；reopen 不复活 merged 副本，任何路径都不能让 alias 重新提醒 |
| TI-10 | unit + api | 合并前后的来源、事件、通知、FTS、快照和 dashboard 一致：仅 canonical 可操作，merged 默认不进入业务列表 |
| TI-11 | unit + host | YOLO 助手明确“记录这件事”后工具重试、刷新或慢回复不重复创建；证据标明 assistant action 和触发会话 |
| TI-12 | unit + host | 两个普通会话近同时复述同一明确事项：当前仅确定性 id/fingerprint/dedup 关联；近义但无确定依据不得静默 consolidate |
| TI-13 | future | 同标题不同项目、客户或明确不同日期 occurrence 保持两项；本轮 exact-title dedup 尚不能可靠区分，作为已知缺口留在路线中，不得记为 rc5 已通过 |
| TI-14 | host | dashboard、SQLite `todos/todo_evidence`、events、`extraction_log`、来源会话列表、提醒和快照逐项一致 |

发布候选至少执行 TI-01～12、TI-14。TI-12 验证当前不会自动 consolidate 近义候选；TI-13 是后续
occurrence 准入契约，不计入 rc5 通过数。不得把“没有自动合并”写成已经实现语义身份裁决，也不得把
TI-13 的已知缺口写成保守策略已经生效。

### 首页 / 计划 / 历史重构验收矩阵

本矩阵是本轮信息架构、来源证据和宿主原生布局的准入契约。用例可以合并到同一个 spec，
但每个编号都必须有独立断言，不能只在测试名中出现。任何 `if (visible)`、新旧任一界面出现即通过、
捕获异常后继续或仅截图的软断言都不计入覆盖。

#### 状态机与响应式

| 编号 | 层级 | 场景与硬断言 |
|---|---|---|
| SM-01 | unit + ui | 参数化覆盖 `home / plan / history × none / assistant-chat / item-detail / item-discussion / source-preview` 的允许进入和返回；状态断言包含页面、前景 kind/id、thread key、呈现偏好与焦点返回目标 |
| SM-02 | unit + ui | `item-detail → source-preview → back=item-detail`；`source-preview → discuss` 替换前景而非叠层；DOM 中任一时刻只能存在一个前景，不能只是隐藏第二个 |
| SM-03 | unit + ui | Esc 优先级为菜单/弹层 → 当前前景 → YOLO 面板；单栏和双栏语义一致，焦点回到原触发器 |
| RSP-01 | unit + ui + host | 可用容器宽度 340、479、阈值 `-1 / = / +1`；改变宿主侧栏宽度而非只改变 viewport，验证布局由侧栏右侧空间推导 |
| RSP-02 | ui + host | `wide → narrow → wide` 三次往返期间保留未发草稿、pending POST（恰好一次）、thread key、上翻滚动位置/新消息提示和焦点；resize 不创建或结束讨论 |
| A11Y-01 | ui + host | 单栏前景使用正确 dialog/focus trap 且背景 inert；双栏上下文不使用 `aria-modal=true`，主面仍可操作；返回后焦点恢复 |
| A11Y-02 | ui + host | 一级 Tab 支持 roving tabindex、Left/Right/Home/End；live region 不因刷新重复播报；高压状态不只靠颜色；reduced-motion 生效 |

#### 来源、工作区与恢复

| 编号 | 层级 | 场景与硬断言 |
|---|---|---|
| SRC-01 | unit + api + ui | session 来源可预览并跳转；预览包含来源时间、workspace、session id 和有界 excerpt，Unicode/换行不损坏且不复制完整 transcript；同一事项的主来源与多个关联会话保持稳定顺序；capability 与字段实际可用性一致；manual/tool/legacy、`session_id=null` 和旧记录无 excerpt 明确降级；本期无精确 turn 导航时不得伪造 |
| SRC-02 | unit + ui | 宿主 `openSession` 不可用、抛错或目标不存在时不先关闭 YOLO，保留页面/事项/来源前景并显示可恢复反馈 |
| SRC-03 | api + ui | 两个工作区使用相同 todo id 或 session id 时，来源和动作均按 `scope_cwd` 指向正确 owner；若宿主 API 无法消歧，测试必须失败而非跳过 |
| SRC-04 | ui + host | 导航成功后 YOLO 收起；重新打开恢复原页面、事项和来源预览，返回一步到事项；不重复发送请求 |
| WS-01 | unit + api + ui | 同 id 双工作区同时出现；操作其中一行，请求、SQLite 与 dashboard 只改变对应 `scope_cwd` |
| WS-02 | unit + api + ui | `partial → 切页 → 来源预览 → 动作 → 刷新 → recovery`，owner 不漂移，partial 只提示一次，恢复后数据补齐 |
| WS-03 | unit + api | `tests/dashboard-aggregate.test.ts` 参数化 `single / all / partial / all-fail / recovery` 五态，且 all-fail 后同一服务下一次读取恢复；`api/dashboard-scope.spec.ts` 验证真实 HTTP single/all 与未知 scope 拒绝后的恢复；同 basename 标签稳定消歧 |

#### 首页、提醒、历史和对话

| 编号 | 层级 | 场景与硬断言 |
|---|---|---|
| HOME-01 | unit + api + ui | 普通无日期积压不为填空进入首页；判断、提醒、关注和今天事项按 `(scope,id)` 只出现一次；5 个待处理项只突出 1 个，其余可达 |
| HOME-02 | unit + api + ui | partial 计数只代表已加载数据；reason/evidence 逐字段来自 payload，客户端不拼接推断；首页没有 Agent 任务入口或区块 |
| REM-HOME-01 | unit + api + ui | 同 todo 两条新提醒时 badge 为 2、首页事项为 1、通知记录为 2 行；打开记录后 badge 2→0 但两条仍未处理，首页“知道了”只改变目标 `handled_at`，todo 保持开放 |
| REM-HOME-02 | ui + host | 已打开 item/source/chat 前景时新通知不抢占；panel 已开只刷新不弹；点击 reminder popup 定位首页事项，brief/独立提醒定位通知记录，scope/source 正确 |
| HIST-01 | unit + api + ui | 混合 `completed / cancelled / reopened / postponed / todo_updated / reminder_fired / attention_seen / brief_generated`，断言最近变化白名单与噪声排除，摘要计数等于可见集合 |
| HIST-02 | unit + ui | 跨工作区按全局时间排序；完成/取消分区且各自可 reopen；reopen 后退出终态集合；merged 副本不进入“已取消”或普通 reopen，partial 明示 |
| HIST-03 | unit + api + ui | 独立 `/yolo/history` 按打开时刻稳定分页；时间线跨工作区全局排序，用户可见白名单排除内部审计，结构化前后值与 SQLite 一致 |
| HIST-04 | unit + api + ui | 按事项使用 `(scope,type,id)` 聚合；改名前后保持一项，同名不同 id 不合并；状态筛选在分页前生效，展开按需读取单事项历史，旧未关联事件只留在时间线 |
| CHAT-01 | unit + ui + host | 顶层“和助手聊聊”每次显式打开生成新的空历史 ephemeral thread 且不读取 resident；事项 A/B 历史隔离；响应式返回/隐藏后再次打开 A 继续同一 episode，显式结束后再讨论 A 创建新 episode |
| CHAT-02 | unit + ui | 慢回复和旧轮询不得写入当前 B；单/双栏切换、panel unmount/remount 后 POST 恰好一次，pending/draft/scroll 连续 |

#### 数据库迁移

| 编号 | 层级 | 场景与硬断言 |
|---|---|---|
| MIG-01 | unit | 分别使用 fresh、current 和真正缺少来源列的旧单库；每种连续打开两次，迁移幂等，todo/event/session summary/notification/client action/FTS 行数与关键字段不丢，`PRAGMA integrity_check=ok` |
| MIG-02 | unit | `tests/storage-scope-migration.test.ts` 用原生 SQLite 创建真正缺少 `source_excerpt/source_turn` 的 legacy branch DB（建库不经 current `openDb`），合入 canonical 两次；新字段降级 NULL，引用与 FTS 完整，`integrity_check=ok` |

#### 旧用例迁移规则

- `ledger-panel.spec.ts` 文件退役；其“事件进入用户历史并正确渲染”的价值迁移到 HIST-01/02。
- `board-scope.spec.ts` 文件退役；跨工作区 UI 动作路由迁移到 WS-01，不能只留下 API 断言。
- `chat-responsive-actions.spec.ts` 重写为容器驱动的单栏/双栏契约，不保留固定 959/960 产品语义。
- `today-tab-count.spec.ts` 重写为首页准入、计数、去重、空/正常/高压和 partial；不保留 Today 一级 Tab。
- `panel-v032.spec.ts` 的宿主侧栏让位与事项新讨论隔离必须迁移，不能因旧文件名退役而删除。
- 完成加四秒撤销、快速记录、中文 IME、提醒角标/弹窗、深浅主题、慢回复、滚动、服务端回执、
  partial scope、完成/取消分离和 reason/evidence 一致性全部保留原行为断言。

### 已知自动化盲区（真机走查兜底）

W1 控制台零报错 · W4 中文 IME 组合态 · 宿主侧栏展开/收起后的真实可用宽度 · 125%/150% DPI ·
reduced-motion 观感 · 原会话实际身份与来源摘录人工核对。

### 真实宿主重构回归（RH-01～RH-06）

所有场景使用隔离 `DSH_HOME`、工作区和数据库；正文必须是真实用户语言。每次结束后检查
`PRAGMA integrity_check=ok`、`[E2E]` 残留为零、浏览器控制台无未解释 error。

| 编号 | 真实操作 | 必须证据 |
|---|---|---|
| RH-01 | 在普通工作会话说“明天下午三点提醒我把客户访谈纪要发给产品组” | 真实回复、唯一事项、正确 datetime、SQLite、`extraction_log`、provider/model、来源摘录/会话/工作区；打开原会话后收起，重开恢复来源预览；普通会话零提醒注入 |
| RH-02 | 在另一普通会话说“把客户访谈纪要改到后天下午四点发” | 仍为一条事项、日期更新、旧时间不提醒、历史显示改期而非“进展”；来源规则与规格一致，不静默覆盖得无法解释 |
| RH-03 | 连续两次显式打开“和助手聊聊”并分别发送问题；事项讨论发送“我需要先确认收件人名单，怎么安排更稳妥？” | 两次顶层聊天均从空历史开始并获得真实回复，不显示内部 resident；事项 episode 在隐藏/响应式切换后复用且与顶层线程隔离；不丢 pending/draft、不重复 POST；YOLO 自有对话不被抽取成重复事项 |
| RH-04 | 普通会话说“一分钟后提醒我起身活动一下”并保持前台 | 到时恰好一张 notification；普通会话零注入/零切换；popup、badge、首页一致；“知道了”只 handled 提醒，SQLite 与审计一致 |
| RH-05 | 真实 Edge 依次走 340px、`<480px`、标准宽和宽屏，再展开/收起宿主侧栏 | 单栏/双栏正确、至多一个上下文区、无横滚/遮挡；resize 保留页面/事项/thread/draft/scroll/focus；深浅主题、DPI、reduced-motion、Tab/Shift+Tab/Esc 可用 |
| RH-06 | 使用隔离 `DSH_HOME` 创建两个工作区事项，完整停止并重启同一标准 dsh profile，再分别读取、操作并制造一个 workspace 暂时不可用 | `control.db` 恢复相同 opaque WorkspaceId 与 scope owner；可用 workspace 仍返回/可写，失效 workspace 显式 partial；普通 session 的最近 cwd、提取和快照 cadence 不受 YOLO 自有线程污染；无第二份 workspace 或重复事项 |

### 覆盖充分门槛

1. SM/SRC/WS/MIG/RSP/REM-HOME/HIST/CHAT/A11Y/HOME 每个编号都有指定层级、夹具、操作和持久化或 DOM 硬断言。
2. 每个 P0 状态机、来源、跨工作区和迁移场景均有 normal、failure、recovery；不能只有 happy path。
3. 关键跨边界契约至少有纯状态/投影单测和 API 或真实 Edge 两层证据；来源往返、响应式、提醒和对话必须有真实宿主证据。
4. 最终必须通过 `pnpm check`、`pnpm test:run`、`pnpm build`、API/UI E2E、受影响 W1–W16 与 RH-01～RH-05；历史通过数量不作为当前证据。
5. 测试后检查隔离 SQLite 完整性、夹具残留和控制台；测试名存在但没有对应断言视为未覆盖。

### 真实语义对话手工回归（RM-DIALOG-01）

1. 在全新 dsh 宿主打开 YOLO →「和助手聊聊」，发送“请记住：明天下午三点提醒我把客户访谈纪要发给产品组”。
2. 断言用户气泡立即出现，且回复到达前持续显示明确的处理中状态。
3. 等待助手回复，断言首页或计划出现“把客户访谈纪要发给产品组”，到期时间为本地次日 15:00。
4. 继续发送“把刚才的「把客户访谈纪要发给产品组」标记完成”。
5. 断言助手确认完成、事项进入历史“已完成”，不再出现在首页或开放计划中。
6. 记录两轮端到端时延及 console error/warn。用例数据需加 `[E2E]` 前缀，并在验证后清理。

### 真实语义对话回归用例库

这组用例验证的是“用户原话 → 后台语义抽取 → 持久化 → 到期提醒”的整条链路，不以助手口头说
“记住了”为通过。受控时钟测试固定宿主时区为 `Asia/Shanghai`，除边界用例外，把当前时间固定为
`2026-08-26 10:00:00 +08:00`（周三）；真实宿主没有假时钟入口时，以发送时捕获的实际 `T0`
动态换算期望，不修改系统时钟。每条正向用例至少核对首页/计划投影、SQLite 中的行、
`extraction_log` 和到期后的通知卡；反向用例核对所有可管理实体表均无新增行。

时间验收口径：

- “今天、明天、周五、下周一”等只有日历日期、没有钟点或时长的表达，保存为本地
  `YYYY-MM-DD`，不得擅自补成午夜时间。
- 当前纯日期契约在本地当日 `23:59:59.999` 到期；`reminder.aheadMin=0` 时，通知卡应在这个
  日终触发点后的一个提醒扫描周期内产生，侧栏通常再经一个轻量轮询可见。仓库没有“无钟点事项
  的白天默认提醒窗口”；09:00 早报也不承担这个语义。
- 明确钟点或相对时长保存为含本地时区的 ISO-8601 datetime，按精确时刻触发；不得降级为纯日期。
- 若启用了安静时段，到期时只暂缓，不写 `last_reminded_at`；离开安静时段后第一个扫描周期补发一次。
- 所有到期提醒只进入通知卡和 YOLO 常驻线程；等待触发期间保持一个普通工作会话在前台，该会话不得
  出现提醒消息、system 注入或被强制切换。无论扫描多少次，同一 todo 都只能产生一次未处理提醒。
- 标题允许做去掉“提醒我/我需要”等管理话术的轻量归一化，但必须保留事项对象、动作和关键限定词；
  日期、状态、实体类型及“不应记录”是硬断言。

#### 日期与提醒

| 编号 | 真实用户原话 | 期望持久化 | 提醒验收 |
|---|---|---|---|
| RM-DIALOG-02 | 我今天要出一份 dsh-yolo 分析报告 | 新增开放 todo“出一份 dsh-yolo 分析报告”，`due_at=2026-08-26` | 当天日终触发点前不提醒；触发点后的一个扫描周期内恰好一张通知卡 |
| RM-DIALOG-03 | 明天把客户访谈纪要发给产品组 | 新增 todo，`due_at=2026-08-27` | 27 日日终触发点后提醒，不在 26 日误发 |
| RM-DIALOG-04 | 周五下班前把报销单交了 | 新增 todo，`due_at=2026-08-28`；“下班前”没有可验证钟点时不得臆造具体时间 | 周五日终触发点后提醒；若将来由工作时段配置解析钟点，必须另立契约与用例 |
| RM-DIALOG-05 | 下周一提交 0.3.1 的发布说明 | 新增 todo，`due_at=2026-08-31` | 31 日日终触发点后提醒，不能落到本周一或下周日 |
| RM-DIALOG-06 | 今天下午三点提醒我把演示稿发给研发 | 新增 todo，`due_at=2026-08-26T15:00:00+08:00` | 15:00 到点后的一个扫描周期内提醒；不能等到日终 |
| RM-DIALOG-07 | 14:30 跟设计师确认首页终稿 | 新增 todo，`due_at=2026-08-26T14:30:00+08:00` | 14:30 精确触发，分钟意图不丢失 |
| RM-DIALOG-08 | 一分钟后提醒我关掉测试环境 | 新增 todo，`due_at=2026-08-26T10:01:00+08:00` | 10:01 后触发一次；日期和时区均不能按模型实际返回时刻漂移 |
| RM-DIALOG-09 | 明天上午十点去医院复诊 | 新增开放 todo；可同时有 scheduled event，`due_at=2026-08-27T10:00:00+08:00` | 27 日 10:00 精确触发；若同时写 event，不得因此重复生成两条 todo 或两张提醒卡 |
| RM-DIALOG-10 | 9 月 1 日把合同盖章件寄给客户 | 新增 todo，`due_at=2026-09-01` | 9 月 1 日日终触发点后提醒，月界不能解析成 8 月 1 日 |

#### 事项类型与管理边界

| 编号 | 真实用户原话 | 期望持久化 | 不变量 |
|---|---|---|---|
| RM-DIALOG-11 | 这个月把 dsh-yolo 的真实对话回归补齐 | 新增阶段性 goal；不新增带日期 todo | schema 没有月份精度；不得把“这个月”臆造成 8 月某一天，因而本句本身不产生到期提醒 |
| RM-DIALOG-12 | 接下来三个月把助手的提醒误报率降下来 | 新增长期 goal；没有用户承诺的具体交付日时不新增带日期 todo | 目标不应伪装成“今天完成”的一次性待办 |
| RM-DIALOG-13 | 9 月 15 日完成内测，这是 0.3.2 的里程碑 | 新增 milestone，`target_date=2026-09-15`；仅在原话同时包含具体个人行动时才另建 todo | 一个事实不得被重复改写成多个同义里程碑 |
| RM-DIALOG-14 | 发布流程就定用 GitHub Actions，不再手工打包 | 新增 decision event，不新增提醒型 todo | 决策进入时间线，但没有凭空截止日期或通知卡 |
| RM-DIALOG-15 | 这个项目每天跟进一次，晚上十点到早上八点别提醒我 | 新增跟踪/提醒 preference；只有在用户同时承诺具体事项时才新增 todo | 偏好必须影响后续管理规则，不能把整句当待办标题 |
| RM-DIALOG-16 | 我喜欢深色主题，咖啡不加糖 | 不新增 todo、goal、milestone、preference 或 event | 个人口味不属于管理偏好；允许 session summary，但不可召回成长期管理记忆 |
| RM-DIALOG-17 | 能帮我解释一下 SQLite 的 WAL 吗？ | 不新增可管理实体 | 一次性知识问题不是承诺，也不应产生提醒 |

#### 否定、更正、去重与状态变化

| 编号 | 前置条件与真实对话 | 期望结果 | 不变量 |
|---|---|---|---|
| RM-DIALOG-18 | 无前置；“今天不用出 dsh-yolo 分析报告了” | 不新建 todo | 否定句不能因含“今天、报告”被误抽取为开放事项 |
| RM-DIALOG-19 | 已有“出一份 dsh-yolo 分析报告”；“分析报告改到明天交” | 对既有 todo 发出 due update，`match_title` 必须精确复用“出一份 dsh-yolo 分析报告”，改为 `2026-08-27` | 不新增第二条同义 todo；旧提醒状态随改期保持可再次触发 |
| RM-DIALOG-20 | 已有“把客户访谈纪要发给产品组”；“刚才说错了，是后天下午三点发” | 既有 todo 改为 `2026-08-28T15:00:00+08:00` | 保留一个 todo，旧日期不再触发 |
| RM-DIALOG-21 | 已有“把演示稿发给研发”；“演示稿已经发给研发了” | 既有 todo 状态改为 done | 不创建“已经发给研发”新待办，之后不再提醒 |
| RM-DIALOG-22 | 已有“准备周五评审”；“周五评审取消了” | 既有 todo 状态改为 cancelled | 取消与完成分离，不再提醒，不新建“取消评审”待办 |
| RM-DIALOG-23 | 连续两轮均说“明天把访谈纪要发给产品组” | 保持一条语义相同、日期相同的 todo | 重复表述不产生重复卡片或重复通知 |
| RM-DIALOG-24 | “提醒我今天交报告——等等，不用了，我已经交了” | 最终不留开放 todo；允许同轮创建后立即完成，或识别为无需新建 | 首页和开放计划不能留下待提醒事项；同轮最终语义优先于前半句 |
| RM-DIALOG-25 | 已有“周五提交预算表”；“周五的预算表不用再跟进了，取消吧” | 对已知 todo 发出 `status=cancelled` update，`match_title` 精确复用“周五提交预算表” | 当前 updates 没有 forget/delete 动作；本例只验业务取消，不把“忘掉/删除我的数据”偷换成取消，且绝不能新建提交预算表待办 |
| RM-DIALOG-26 | “记住这个”“好的”“到时候再说吧” | 不新增可管理实体 | 低信息、自指和模糊闲聊必须被质量闸门拦截 |

#### 跨日与调度边界

| 编号 | 固定时钟与真实用户原话 | 期望日期/时间 | 提醒验收 |
|---|---|---|---|
| RM-DIALOG-27 | `2026-08-26 23:58 +08:00` 收到输入，故意让 agent 在零点后空闲；“今天把值班记录发给组长” | `due_at=2026-08-26`；抽取必须复用宿主接受输入时捕获的时钟 | 即使后台任务零点后才启动也不漂到 27 日；定向回归同时核对传给模型的 authoritative clock |
| RM-DIALOG-28 | `2026-08-27 00:02 +08:00`；同一句“今天把值班记录发给组长” | `due_at=2026-08-27` | 27 日日终窗口触发，不沿用前一自然日 |
| RM-DIALOG-29 | `2026-08-26 23:59:30 +08:00`；“一分钟后提醒我关发布窗口” | `due_at=2026-08-27T00:00:30+08:00` | 跨午夜按精确 datetime 触发，不能截成 26 或 27 日的纯日期 |
| RM-DIALOG-30 | `2026-08-26 23:58 +08:00`；“明天早上八点半提醒我签到” | `due_at=2026-08-27T08:30:00+08:00` | 次日 08:30 精确触发 |
| RM-DIALOG-31 | 安静时段设为 22:00–08:00；21:59 说“一分钟后提醒我保存发布证书” | `due_at=2026-08-26T22:00:00+08:00` | 22:00 不发且不盖已提醒戳；08:00 后首个扫描周期补发一次 |
| RM-DIALOG-32 | “明天上午十点跟客户过方案，下午三点把修改稿发给设计师” | 分别新增两个 todo：`2026-08-27T10:00:00+08:00` 与 `2026-08-27T15:00:00+08:00` | 两个时刻各提醒一次；不能合并成一条、漏掉后半句或互相覆盖提醒戳 |

#### 执行与充分性判定

每次发布候选至少执行 RM-DIALOG-02、06、08、09、18、19、21、24、27、29、31；修改日期解析、
抽取提示词、合并/质量闸门或提醒调度时，执行全部 RM-DIALOG-02～32。每条记录模型路由、原始抽取
JSON、规范化结果、最终实体行、通知卡数量和实际触发时间；涉及相对时间时，实际触发时间相对
预期不得超过“一个提醒扫描周期 + 一个侧栏轮询周期”。

用例库只有同时满足以下条件才可评为“充足”：日期与精确时间、todo/goal/milestone/event/preference、
不记录边界、否定、更正、完成、取消、去重、同轮反转、跨日、安静时段都至少有一个通过用例；
并且 RM-DIALOG-02 这条核心自然表达在真实宿主上连续运行三次均入库到当天、没有重复、且在纯日期
日终触发点加扫描延迟内产生且只产生一张通知卡。任何维度缺测或只能从助手回复推断结果，都应判为
“不充足”。

当前待决风险：仓库没有独立的“无钟点事项白天默认提醒时间”设置，纯日期只能按日终契约触发。
如果产品期望“今天要出报告”在晚间某个更早时段提醒，必须先确定默认钟点、已过默认钟点时的
回退、与安静时段/早晚报的关系，再同步修改架构契约、配置、单测和本用例库，不能只改模型提示词。

## 三、如何运行

```bash
node scripts/e2e.mjs                 # 全部套件（拉起或复用宿主）
node scripts/e2e.mjs --suite api     # 仅 api 套件（秒级反馈，改 src/** 后首选）
node scripts/e2e.mjs --suite ui      # 仅 ui 套件
pnpm exec playwright test tests/e2e/ui/panel-flow.spec.ts  # 单个 spec 的当前可靠方式
node scripts/e2e.mjs --no-host       # 复用已在跑的宿主（绝不碰它的数据库）
node scripts/e2e.mjs --no-clean      # 跳过拉起前的 [E2E] 夹具清扫
```

环境变量：`YOLO_E2E_PORT`(默认 3080) · `YOLO_E2E_HOST` ·
`YOLO_E2E_PROBE_MS`(健康探测预算，默认 15000) ·
`YOLO_E2E_REPORT=<path>`(额外产出机器可读 JSON 报告)。

> 已知 runner 缺陷：`node scripts/e2e.mjs --spec panel-flow` 目前错误映射到
> `tests/e2e/panel-flow.spec.ts`，会报 `No tests found`；修复 `scripts/e2e.mjs` 的
> suite 目录映射前，请使用上面的 Playwright 精确路径命令。

宿主注入两条路径：

1. **标准（AGENTS.md）**：全局 `dsh` + web profile 捆绑本插件
   （一次性 `pnpm dsh plugin add . --profile web`）。runner 直接
   `dsh web --port <port>`，**不生成 runtime patch** —— profile 已注册全部
   yolo 行，再 insert 同 id 是致命的 duplicate loader entry 错误。
2. **回退**：没有全局 dsh 时才 checkout host 仓库构建（旧行为，含 junction +
   patch），仅作过渡。

失败产物：trace/截图在 `test-results/`，`pnpm exec playwright show-trace <zip>` 查看。

## 四、为什么之前慢且经常出问题 —— 根因记录

2026-08-23 实测基线（改造前，17 用例）：**21.3 分钟，3 failed + 2 flaky**；
单用例 13s–60s 不等，多个用例 60s 超时靠 retry 才过甚至重试仍挂。

| # | 根因 | 证据 | 修复 |
|---|---|---|---|
| 1 | `Yolo.resolve()` 曾在每次调用时执行 `git rev-parse`；一次 dashboard 请求触发 ~15 次 | 实测 15 次孵化 = 2985ms ≈ 端点延迟 | rc4 起 scope 只取 canonical cwd，不再孵化 Git 子进程或维护探测 TTL |
| 2 | 每个 test 前后全量拉看板扫 `[E2E]` 行做清理（≥2 次完整 GET/用例 ×17） | cleanupPrefixed* 在 beforeEach/afterAll | `createFixtures` 按 id 追踪、O(创建数) 精准清理 |
| 3 | 健康探测超时 3s < 实际延迟 3s+，健康宿主被判死 → `--no-host` 报"没起来"、bring-up 报"not ready" | 4080 宿主 3117ms 响应 vs probe 3000ms | 探测超时提到 15s（`YOLO_E2E_PROBE_MS` 可调） |
| 4 | runner 生成的 patch 与 web profile 里 `dsh plugin add` 注册的同 id 行冲突 → **拉起必炸**(duplicate loader entry id: yolo) | 手动复现 boot stack | 标准 profile 捆绑路径不再打 patch；patch 只留给无标准安装的回退路径 |
| 5 | host-checkout 方式启动撞凭证格式差异(`.credentials.yaml version` 类型) → 启动即崩 | AGENTS.md 早有警告，本次实锤复现 | bring-up 改为**全局 dsh 优先**，checkout 构建降级为回退 |
| 6 | `child.kill()` 只杀 pnpm 外壳，node 孙进程变孤儿占端口 → 下次拉起 EADDRINUSE/ECONNREFUSED 漂移 | 4090 孤儿存活观察 | `killTree`（Windows `taskkill /T /F`） |
| 7 | 角标 30s 轮询节奏被测试硬等 ≤45s | reminder-badge 旧版 timeout 45s | 卡片先种后开页面：角标 mount 即拉取，断言即时确定 |
| 8 | `[E2E]` 夹具跨 run 累积膨胀载荷(57KB→清理后 6KB)、拖慢一切 | AGENTS.md 手工清理习惯 | runner 拉起前自动 DB 级清扫（只动 `[E2E]` 行）；`--no-clean` 可关 |
| 9 | 忙等 `sleep()` 自旋烧 CPU | e2e.mjs 旧 while 循环 | 真 `setTimeout` 异步休眠 |

效果（同机复测，改造后）：api 套件秒级、ui 套件分钟级；详见提交记录中的
前后对照数据。根因 #1 同时是产品修复 —— 侧栏角标每 30s 轮询、提醒调度器
周期 tick 此前都在反复孵化 git 进程。

## 五、夹具与清理约定

- **前缀即契约**：机器夹具一律 `[E2E]` 唯一前缀（`uid()`），与真实用户数据互不侵扰，
  也是 DB 清扫与「用语真实」检查的豁免标记。夹具句子必须贴合真实用户语境
  （如「提醒我把演示稿发给研发」）。
- **谁创建谁销毁**：用例通过 `createFixtures(api)` 创建/追踪夹具，
  `afterEach → fx.dispose()` 按 id 精准处理；浏览器内产生的行（捕获条）
  用 `fx.trackTodo(id)` 补登记。**禁止**再引入全量看板扫描式清理。
- **DB 级兜底**：runner 自己拉起宿主时，启动前对 `.dsh/yolo/` 与 `~/.dsh/yolo/`
  的 `yolo-*.db` 做 `[E2E]` 行清扫（此刻必然无宿主持锁）。手动等价物：
  `node scripts/clean-test-data.mjs`。
- **共享宿主礼貌**:`--no-host` 或复用已应答宿主时，runner 绝不触碰其数据库;
  需要干净状态就自己换端口拉一个。

## 六、测试 agent 运行手册

给任何要跑 E2E 的编码 agent（人或自动化）：

```bash
# 1) 快速反馈（改了 src/storage|shared|memory 后）
node scripts/e2e.mjs --suite api

# 2) UI 准出（改了 client/**、src/ui/**、payload 形状后）
node scripts/e2e.mjs --suite ui

# 3) 发布前全量 + 机器可读报告
YOLO_E2E_REPORT=.tmp-e2e/report.json node scripts/e2e.mjs
```

失败归因决策树：

1. **`--no-host but nothing answering` / bring-up not ready**
   → 宿主没起来或太慢：先 `curl <host>/yolo/dashboard` 手测；慢但 200 则调高
   `YOLO_E2E_PROBE_MS`；拒绝连接则换 `YOLO_E2E_PORT` 重跑让 runner 自己拉起。
2. **`duplicate loader entry id: yolo`**（手动 patch 启动时）
   → profile 已捆绑插件，去掉 `--patch`。
3. **assertion 超时**
   → 打开该用例 `test-results/*/trace.zip`（show-trace）定位是数据没渲染还是
   选择器漂移；数据缺失先查 `GET /yolo/dashboard` 是否含夹具行。
4. **偶发 ECONNRESET**：helpers 已内置一次退避重试；连续出现说明宿主不稳，
   回到分支 1。
5. **报告解读**：JSON 的 `stats.expected/unexpected/flaky/skipped/duration`；
   `unexpected > 0` 即红，不要靠 retry 掩盖——先归因再放行。

红线：不要为吸收慢而调大断言超时（那是症状缓解）；先确认是否踩了第四节
某个根因的回归。

## 七、变更触发范围（何时必须跑哪层）

| 改动 | 必须 |
|---|---|
| `src/domain/**`, `src/application/**`, `src/contracts/**`, `src/runtime/**`, `src/infrastructure/**`, `src/storage/**`, `src/shared/**`, `src/memory/**`, `src/extract/**`, `src/reminder/**` | 架构/package contract + 相关单元测试 + `--suite api` |
| `client/**`, `src/ui/**`, dashboard/actions payload 形状 | 单元测试 + `--suite ui` + 本文第八节对应组人工走查 |
| catalog、`ScopeRef`、observation、conversation runtime 或 package/patch/build | 隔离真实宿主 RH-01/RH-03/RH-06 中受影响项；package 改动还需标准 profile 重新链接/装载 |
| `playwright.config.ts`, `tests/e2e/**`, `scripts/e2e.mjs` | 全套 E2E 自证 |
| 版本发布（UI 相关） | 全量 E2E + 真机走查 |

## 八、人工验证清单（全场景）

> 自动化（E2E api/ui 两套件 + 单测）覆盖契约与交互回归；本清单汇总**所有需要人眼 / 真机 /
> 长周期等待**确认的场景，按用户旅程分组，是产品全量的人工走查底表。
> 标记说明：🤖 = E2E/单测已自动化（人工只需真机抽验观感）；👤 = 仅人工可验。
> 规则沿用 testing.md 第八节：全部 PASS 才收口；无法验证的项标 SKIP + 原因，
> 连续两次 SKIP 的项排进下个版本补验；走查结论记入提交说明。
> 来源：testing.md §八 W1–W16、当前 API/界面契约与 v0.3.x 已交付行为。

### 8.1 首页、计划、历史与恢复

- [ ] 👤 **W1 首开渲染**：骨架短暂出现后默认首页完整渲染；控制台零报错；无 Emoji 字形残留（图标全 SVG）
- [ ] 🤖 **W2 一级导航**：首页 / 计划 / 历史支持下划线指示、roving tabindex 与 Left/Right/Home/End；没有“进展”或“Agent 任务”一级入口
- [ ] 🤖 **W2 计划筛选**：计划内“今天 / 接下来 / 目标 / 全部”、高级筛选、时段 chip 与清除行为一致；首页不复用计划筛选状态
- [ ] 👤 **W11 首页四态**：分别走空、安静、正常和高压数据；普通积压不填首页，高压只突出一个首要事项，其余仍可达
- [ ] 👤 **W1 状态恢复**：在计划/历史打开事项、来源或讨论后关闭再打开 YOLO——原页面、筛选、事项和前景恢复；失效目标安全回首页
- [ ] 👤 **空库首启**：新库首启出现专业空态和快速记录入口，不白屏、不虚构待处理事项、不强迫创建计划

### 8.2 事项处理与跨页面一致性

- [ ] 👤 **W3 操作入口**：首页主卡、计划行、事项详情和历史终态提供符合上下文的动作；悬停、键盘和触控均可发现
- [ ] 🤖 **W3 完成→撤销**：勾选完成 → 退出首页/计划开放集合 → 历史已完成可见 → toast 带 4 秒“撤销”→ 撤销后所有页面同步恢复
- [ ] 👤 **W3 改标题**：改字回车即时刷新、快照同步、历史出现用户可读的改名变化且内部技术事件不暴露
- [ ] 👤 **W3 改截止日**：逾期事项改到下周 → 移出首页到期区并进入计划“接下来”，计数与摘要同步
- [ ] 👤 **W15 取消确认**：取消弹确认层；确认后退出开放计划并进入历史“已取消”，`todo_cancelled` 审计落库；完成与取消各自可重新打开
- [ ] 🤖 **W3 日期范围管理**：按截止/创建日期预览单日或闭区间；批量取消仅处理开放规范事项；永久删除要求输入确认词，区间外事项不变，partial 时禁止全部工作区
- [ ] 👤 **目标进度只读**：目标区无任何没有事实来源的手动进度编辑控件
- [ ] 👤 **快照一致**：任意编辑后 Markdown 快照、SQLite、dashboard 和三个页面一致

### 8.3 捕获条与快速记一条

- [ ] 🤖 **TA-5 快速记一条**：「周五取快递」回车入库——今日到期、来源=快速记一条、快照同步、**无 LLM 抽取调用**（查提取日志确认）
- [ ] 👤 **W4 IME 组合态**：中文输入法组合态回车不误触发（自动化无法模拟组合态）

### 8.4 提醒与角标（TB）

- [ ] 👤 **TB-1 静默红线（核心）**：造 1 分钟后到期待办，另开工作会话等到期——工作会话全程无任何新增消息，提醒只出现在 YOLO 侧
- [ ] 🤖 **TB-2 首页待处理**：面板开着等到期 → 首页“需要你处理”出现含标题、原因与快捷操作的卡片，不抢占已有详情/来源/讨论前景
- [ ] 🤖 **TB-3 角标、记录与聚合**：同一事项两条新提醒时 badge 精确为 2、首页事项只显示一次、通知记录显示两次投递；打开记录后 badge 2→0 但提醒仍未处理，首页“知道了”只改变目标 `handled_at`
- [ ] 👤 **TB-4 对话处理提醒**：从提醒卡“讨论这项安排”回复“推迟到明天”→ 待办改期、对应提醒处理、最近变化可追溯
- [ ] 👤 **TB-5 重启恢复**：提醒已投递未处理时重启插件 → 首页仍保留提醒；若尚未查看，通知角标和记录也保持一致
- [ ] 👤 **TB-6 并发到期**：同一 tick 两个不同事项到期 → 各自进入首页待处理且 badge 正确；多个提醒不会形成告警墙
- [ ] 🤖 **TB-7 Popup 定位**：历史未读首载不补弹；panel 已开只刷新不弹；点击新 popup 打开首页正确事项并保持 `scope_cwd/source`

### 8.5 早晚报（TD）

- [ ] 👤 **TD-1 早报准点**：`morningTime` 设为下一分钟 → 到点出早报卡，含优先处理/今日到期/逾期/昨日新增未完成/目标变化
- [ ] 👤 **TD-2 晚报内容**：到点出晚报卡，含今日完成/今日新增/未完成总数与逾期数/明日优先
- [ ] 👤 **TD-3 开关生效**：关闭晚报开关后到点不再生成，日志有跳过原因
- [ ] 👤 **TD-4 简报追问**：早报卡「和助手聊聊」→ 首条上下文携带简报全文可追问
- [ ] 👤 **TD-5 面板未开**：简报生成时面板关闭 → badge 计入新投递，打开通知记录后简报正文可见且 badge 归零
- [ ] 👤 **TD-6 空事项日**：无任何到期/完成/遗留 → 显示「今天没有到期事项」，不空白不报错

### 8.6 历史、最近变化与来源（TC）

- [ ] 👤 **TC-1 完成与取消**：按事项筛选严格区分完成、取消和重新打开；重新打开后退出终态筛选，历史更正轨迹不被静默改写
- [ ] 👤 **TC-2 历史双视图**：工作会话新增、改期、完成、取消、合并和目标变化进入按时间视图，并按稳定事项 ID 聚合；提醒扫描、简报生成、已读和反馈等操作型审计不显示
- [ ] 👤 **TC-3 来源一致**：同一事项在首页、计划、历史和详情显示相同“来自：会话名 · 工作区”行为；点击先打开来源预览
- [ ] 👤 **TC-4 来源数据边界**：预览显示来源时间、工作区、session id 和有界来源摘录；Unicode/换行不损坏，不复制或泄露完整 transcript；capability 与真实字段一致
- [ ] 👤 **TC-5 来源降级**：manual/tool/legacy、无 session 和旧行无 excerpt 均有明确文案且不伪造可点击按钮或精确 turn 定位
- [ ] 👤 **TC-6 来源往返**：打开原会话成功后 YOLO 收起；重开恢复原页面、事项和来源预览；宿主导航失败时不先关闭并显示可恢复反馈
- [ ] 👤 **TC-7 跨日与全局排序**：23:59 与 00:01 的变化分属正确自然日；跨工作区最近变化按全局时间排序，partial 计数只含已加载内容
- [ ] 🤖 **P35 合并历史**：合并两条待办 → 审计保留；最近变化按白名单展示一条用户可理解的合并摘要

### 8.7 对话、详情、来源与宿主会话

- [ ] 👤 **W9 会话切换让位**：YOLO 打开时点宿主侧栏其它会话 → 会话切前台、YOLO 自动收起
- [ ] 🤖 **W10 三类历史隔离**：连续两次顶层“和助手聊聊”各自是新的空历史 ephemeral；事项 A 新讨论、事项 B 新讨论互不泄漏，且都不展示内部 resident 历史，真实模型回复进入正确线程
- [ ] 👤 **W10 Episode 生命周期**：响应式返回或隐藏后再次打开 A 继续同一 episode；显式“结束讨论”清除它；之后再次讨论 A 创建新 episode
- [ ] 🤖 **W5 单一前景**：事项详情、来源预览、事项讨论和助手对话任一时刻只存在一个；从来源进入讨论是替换，不叠出第三层
- [ ] 👤 **W5 单/双栏一致**：标准宽单栏替换、足够宽时主面 + 一个上下文区；resize 只改变呈现，thread/pending/draft/scroll/focus 不丢
- [ ] 👤 **V1 会话能力**：“和助手聊聊”与“讨论这项安排”均真实回复模型（`{{model}}` 绑定生效）；旧轮询或慢回复不串写当前事项

### 8.8 记忆抽取与召回（M9）

- [ ] 👤 **抽取入库**：会话说截止时间/目标 → 首页或计划与历史出现对应投影，LLM 语义提取（非正则）
- [ ] 👤 **写入质量闸门（B3）**：「好的/收到」「记住这个」等自指/低信息句不落库
- [ ] 👤 **动态召回**：新会话提到相关主题 → 偏好/承诺注入 system 段（yolo-instructions 可查）
- [ ] 👤 **偏好时效（R14）**：过期偏好不再注入；被替代的偏好带出处历史
- [ ] 👤 **空召回降级（R15/P39）**：连续空召回触发保护性降级而非反复空跑

### 8.9 跨工作区聚合（v0.3.x）

- [ ] 👤 **多区同板**：多工作区行聚合展示，`ws` 标签正确
- [ ] 🤖 **跨区可操作**：直接完成/推迟其它工作区的行（`scope_cwd` 路由）
- [ ] 👤 **工作区统一（A3）**：同一 cwd 在非 Git、main 和 feature 状态下共享待办，且不会重复成多个工作区
- [ ] 👤 **Catalog 重启恢复（RH-06）**：完全停止并重启隔离宿主后两个 workspace 仍以原 WorkspaceId/owner 聚合；一个 store 暂不可用时只产生显式 partial，恢复后不重复注册或拆库
- [ ] 👤 **Observation 单 owner（RH-06）**：交错两个普通 session、内部 resident 投递、顶层 ephemeral 和事项 episode，最近 cwd、direct-human 抽取和每十 turn 快照只由普通 session 推进且不串区

### 8.10 视觉与动效（VA，亮/暗各一轮）

- [ ] 👤 **VA-1** 暗色 IDE 打开面板：无亮色残留，对比度实测通过
- [ ] 👤 **VA-2** 首页首开：摘要、首要事项和必要区块按层级出现；空区块不占位，骨架 ≤300ms
- [ ] 👤 **VA-3** 完成一项：填充→retire→撤销 toast 全链路顺滑可撤销
- [ ] 👤 **VA-4** 通知到达（面板开启中）：首页摘要更新且不抢占前景；淡入+计数 crossfade，零布局跳动
- [ ] 👤 **VA-5** 宿主原生响应式：340px、`<480px`、标准宽和宽屏均无横向滚动；至多主面 + 一个上下文区；Esc 一层退回并归还焦点
- [ ] 👤 **VA-6** 轮询刷新：数据变化时 refresh-sweep 出现一次，未变化完全静止
- [ ] 👤 **VA-7** 空库首启：专业空态、快速记录和“和助手聊聊”可用，不用普通积压填充首页
- [ ] 👤 **VA-8** reduced-motion：动效退化为即时切换，功能零损失

### 8.11 性能与资源（本轮治理引入的行为复核）

- [ ] 👤 **A1 助手页面响应体感**：`/yolo/dashboard` 数百 ms 到达，无 ~3s 停顿
- [ ] 👤 **A2 无 git 进程轮询孵化**：角标 30s 周期内任务管理器无 `git.exe` 闪现

### 8.12 E2E 工具链抽查（runner 行为）

- [ ] 👤 **B1 api 套件秒级反馈**：`--suite api` 数秒全绿，结束自动停自拉宿主
- [ ] 👤 **B2 无孤儿进程**：跑完后端口无 LISTEN 残留
- [ ] 🤖 **B3 ui 套件全套**：~1 分钟全绿
- [ ] 👤 **B4 自动清扫**：runner 拉起宿主时日志出现 `fixture sweep ... removed N rows`
- [ ] 👤 **B5 复用宿主不碰库**：`--no-host` 日志显示 `database is NOT touched`
- [ ] 👤 **B6 探测超时可诊断**：宿主不在时报错含 probe budget 与 `YOLO_E2E_PROBE_MS` 提示
