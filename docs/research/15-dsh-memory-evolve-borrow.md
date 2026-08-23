# dsh-memory-evolve 专项借调报告（结合 dsh-yolo 已实现）

> 只针对 [csyangwen/dsh-memory-evolve](https://github.com/csyangwen/dsh-memory-evolve)。
> 源码克隆：`D:\Code\WorkBuddy\dsh-research\dsh-memory-evolve`（本地核实，逐行读 `lib/advisor/*`、
> `lib/todo.js`、`lib/coi/tasks-store.js`、`lib/coi/scheduler.js`）。
> 结论先行：**这个库在「提醒投递纪律」和「待办建模」上最值得借；但它的「提醒到点调度」其实落后于 dsh-yolo，
> 而且它有一条红线级做法坚决不能抄。**
> 配套：`00-total.md`（洞察1）· `02-dsh-memory-evolve.md`（首次深读）·
> `14-borrow-pass.md`（B1–B8 差额清单，本报告为其 dsh-memory-evolve 专项展开）。

---

## 0. 为什么这个仓库值得单独深挖

dsh 生态里，多数记忆插件只做「存与取」；**只有 dsh-memory-evolve 真正把「长期记忆 + 待办状态机 +
主动提醒」揉在一起**——这和 dsh-yolo「整理事项、跟踪变化、低打扰提醒」的产品范围最接近。所以它既是"前方有同行"，也是
最贴近的对标实现。

但有个关键事实要先说清：**它的"提醒"是注入式弱主动**（`CALENDAR.md`/`reminder` 字段仅作备注、
缺 due scheduler，见 `08`/`13` 号结论）。所以在"到期该做什么"这一点上，**dsh-yolo 是反超它的**。
真正值得借的，是它在"该不该说、说多响、说了怎么不烦人"上的**投递纪律**，以及它的**待办领域建模**。

---

## 1. 真正值得借的 4 个机制（出处 → dsh-yolo 现状 → 改法 → 验收）

### D1 投递分级 + immuneTurns 冷却 —— 把「一条投递」升级为「一封有级别的信封」

- **出处**：`lib/advisor/delivery.js` 的 `AdvisorDelivery.route()`；
  `lib/advisor/kinds.js` 的严重度 `info < nit < concern < blocker`。
- **机制**：`route(sessionId, note)` 按严重度+配置产出四态——
  `recorded`（info 默认仅记录，不打扰）→ `inject`（非唤醒，静默放入）→ `steer`（真唤醒）。
  且 `steer` 之后用 `immuneTurns` 冷却：接下来 N 个完成的 turn 内任何再次 `steer` 都降级为 `inject`，
  **失败/成功都算一次尝试**（防噪声循环）。`steerSeverities` 配置哪些级别才配唤醒。
- **dsh-yolo 现状**：`src/reminder/scheduler.ts` 的 `runReminderTick` 是**单强度**投递——
  对每条 due todo 调一次 `deliver(cwd, text)` 进常驻线程 + 落一张通知卡；有 `aheadMin`（提前量），
  但**没有级别**（info/高优先）、**没有冷却窗口**（多卡并发时角标/会话会一起涌出）。
- **改法**：把投递抽象成 `grade(delivery)`：`aheadMin` 内 → 温和预告（角标弱强调）；到点 → 到期提醒
  （卡片+角标高亮）；逾期/紧急 → 升级（常驻线程 followup）。加一个 `immuneWindowTurns` 或时间窗冷却：
  一段时间内不重复强提醒同一条/同类。`severity` 与 `q1`（紧急重要）联动。
- **验收**：单测——同一条 todo 在冷却窗内不二次强提醒；紧急+到点走强投递、低优先+预告走弱投递。
  真机——W1–W8 提醒可见性项；角标不会因多卡"一次性全亮"。
- **对应**：`14-borrow-pass.md` B5 的工程化精确版（分级投递 + 频控）。**这正是 AGENTS.md 红线说的
  「取频率控制，舍身份伪装」的频率控制本体。**

### D2 发射闸门 EmissionGuard —— 在"到投递之前"掐掉噪声

- **出处**：`lib/advisor/guard.js` 的 `EmissionGuard.accept(note)`。
- **机制**：纯确定性闸门，`true=放行 / false=静默抑制`。规则按序：
  1) 归一化身份键（NFKC → 小写 → 非字母数字折叠为单空格 → trim，`"Stop."`/`*stop*`/`"  STOP  "` 全部归一到 `stop`）；
  2) **空泛短语抑制**（`stop/done/complete/lgtm/ok/okay/good/fine/looks good/nothing/...` 17 个，精确匹配，含短语的完整句子不受影响）；
  3) **每轮一条**闩锁；4) **归一化去重 + 只允许真升级**（FIFO 4096 有界历史；同级/降级重复抑制，`nit→concern→blocker` 真升级放行）。
- **dsh-yolo 现状**：提醒去重只有 `todos.last_reminded_at`（每条 todo 触发一次，`src/storage/repository.ts` 的
  `listDueTodos` + `setTodoReminded`）；简报（`runBriefTick`）靠 `getBriefStamp` 每日本地一次。
  **没有"内容空泛/重复"这一层噪声闸门**——重复的近义通知、低信息"知道了"式提醒仍会进卡/进会话。
- **改法**：在 `src/reminder/scheduler.ts` 投递前接一个 `EmissionGuard`：对 `reminderText(t.title)`
  做归一化+空泛短语+每 tick 一条+去重。对 `brief` 同理（避免"你的报表写好了"这类低信息通知反复出现）。
  同时给 `notifications` 表加 `dedup_key`/`severity` 便于该闸门裁决与审计。
- **验收**：单测——"完成""好的""lgtm"这类空泛 reminder 被抑；两条同归一化文案第二次被抑。
- **对应**：`14-borrow-pass.md` B3 在"投递面"的姊妹机制（B3 管写入面，D2 管投递面）。

### D3 待办：`blocked` 状态 + 四象限 + 确定性智能视图 rank

- **出处**：`lib/todo.js` —— `TODO_STATUSES = ['pending','doing','done','blocked','cancelled']`；
  每行带 `[q1..q4]`（重要×紧急）/ `[due: ...]` / `[status: ...]`；`list` 用确定性 `rank`
  （`overdue(0) > today(1) > q1(2) > q2(3) > q3(4) > q4(5) > none(6)`，过往条目 `9` 垫底），
  智能视图**默认封顶 8 条**；`expired`/`past` 把过期未完成的历史条目"赶出默认视野"。
- **dsh-yolo 现状**：`src/storage/types.ts` — `TodoStatus = 'pending'|'in_progress'|'done'|'cancelled'`
  （**没有 `blocked`**）；`Priority = 'low'|'medium'|'high'|'urgent'`（**单轴，无象限**）。
  焦点视图（R9）用 `overdue`/`today` + `focusDefaultCount` + `partitionFocusRows`
  （`src/ui/dashboard.ts`、`client/panel/KanbanView.tsx`）——**按日期切，但没有 q1–q4 的确定性排序**。
- **改法**：
  - 状态机加 `blocked`（等待外部条件）；`applyTodoAction` 增加 `block`/`unblock` 动作 + `todo_blocked`
    审计事件。
  - 待办加 `quadrant`（`q1..q4`，重要×紧急）字段；`priority` 单轴保留为"紧急度"助记。
  - 焦点视图排序改为确定性 rank：`overdue > today > q1 > q2 > q3 > q4 > none`，默认封顶 N（复用
    `focusDefaultCount`），`done/cancelled`、过期未盯的历史条目默认折叠。
- **验收**：单测——`block`/`unblock` 走统一动作路径+审计；焦点视图排序与 rank 一致、封顶生效；
  过期未完成条目不在默认焦点。
- **对应**：`14-borrow-pass.md` B5/P20/P22/P24 的精确版（四象限 + 状态机 + 窄视图 + rank）。

### D4 崩溃恢复 `interrupted` + "保留活跃"的保留策略

- **出处**：`lib/coi/tasks-store.js`（`TASK_STATUSES` 含 `interrupted`；`prune()` 永不删
  `running/queued/interrupted`；写入用 `tmp+rename` 原子落盘）、`lib/coi/scheduler.js` 的 `recover()`
  （启动时把遗留 `running/queued` 标记为 `interrupted`）。
- **dsh-yolo 现状**：`src/storage/schema.sql` todos 状态无 `interrupted`；D1 的领域状态迁移本身
  **没有"重启后把半途状态标为异常"**；快照写用 `writeFileSync`（非原子，见 `14` B8）。
- **改法**（偏稳定性，优先级低于 D1/D3）：给领域状态机加"启动自检"——把遗留的
  `in_progress` 标为 `interrupted`（或带回滚提示）；`prune`/清理从不删活跃/异常项；
  快照/导出改用 `tmp+rename` 原子写。
- **验收**：单测——重启后遗留 `in_progress` 转 `interrupted` 并落审计；清理策略跳过活跃/异常。
- **对应**：`14-borrow-pass.md` B8 + P25（审计可重建）+ P41（原子写）。

---

## 2. 红线：这个库有一条**坚决不能抄**（dsh-yolo 已有替代）

### ⛔ 绝不抄「伪装成用户指令」（kinds.js `buildAdvisorMessage` + delivery.js `steer`）

- **做法原文**（`lib/advisor/kinds.js` 注释）：注入消息**伪装成用户指令**——user-role、`source.kind='advisor'`，
  **不带任何 advisor 身份痕迹**（无 `[advisor:{severity}]` 前缀、无"来自评审员非用户指令"说明）。
  注释原话："实测：带身份说明时主 Agent 会质疑'用户没说过啊'、去查记忆、执行力与速度双降；伪装后
  Agent 把注入当成用户说的话直接执行。"（`delivery.js` 里 `agent.steer(message)` 真实唤醒/打断主会话。）
- **为什么 dsh-yolo 不能这样**：它把"提醒"做成**潜入工作会话、冒充用户口吻、实时打断**——
  直接违反 `docs/roadmap-ux-priorities.md` 红线 D7/TB-1 与 AGENTS.md：
  「**整理和提醒，不越权执行；提醒绝不打扰工作会话；提醒正文只给用户可读文本，agent 处理规则放 system 段**」。
- **dsh-yolo 的正确替代（已实现 R1/R7/R17）**：提醒走**通知卡 + 侧栏角标**（不注入主会话），
  正文是干净人话 `⏰ YOLO 提醒：周二开会`；**需要模型处理**时才投递到 **YOLO 常驻线程**（`ctx.yolo`），
  处理规则放 `src/memory/recall.ts` 的 `yolo-instructions` system 段。用户看到的是提醒，
  Agent 看到的是它在自己那条常驻会话里被要求的处理方式——**两不相扰**。
- **要借的只是 D1 的频率控制/分级（guard/severity/冷却），不借它的身份伪装与实时打断。**

---

## 3. dsh-yolo 已经领先 / 无需借的部分（诚实）

- **到期调度**：dsh-memory-evolve 无 due scheduler（提醒仅 done 布尔 + 注入式弱主动）；dsh-yolo 有
  `runReminderTick` + `listDueTodos` + `aheadMin` + `pending_reminders`（`src/reminder/*`）、
  简报日调度。**这一层 dsh-yolo 在前，不借。**
- **类型安全 + 真机验证**：dsh-memory-evolve 是 JS 无类型单文件巨石（`lib/` 全 `.js`、无 `tsconfig`、
  `client.js` 单文件 1.18MB）；dsh-yolo 用 TS + `pnpm check` + 单测 + `pnpm test:run` + 真机 W1–W8。
  **借它的"模式"，不借它的"工程形态"。**
- **动作统一 + 审计**：dsh-yolo 的 `applyYoloAction` + `action_denied` 审计 + `todo_consolidated` 原子动作，
  已对齐 dsh-memento/本库的"受监督写"取向。**这部分不用借。**

---

## 4. 结论与优先级

1. **先借 D1（投递分级+冷却）与 D3（blocked + 象限 + 智能视图 rank）**——这两条是"用户能感知的变好"，
   且都贴着现有 `src/reminder/*`、`src/storage/*`、`src/shared/actions.ts`。
2. **D2（发射闸门）顺手做**——低噪音、纯函数、易单测，直接补齐 D1 的"不烦人"。
3. **D4（interrupted + 保留活跃 + 原子写）偏稳定性**，可与 `14` 的 B8 一起做。
4. **红线（伪装用户指令 + 实时打断）坚决不碰**——借"频率控制"，舍"身份伪装"；这是 dsh-memory-evolve
   给 dsh-yolo 的**反例提示**，不是借鉴项。
5. 每项照旧走 `pnpm check` + `pnpm test:run`；改 `client/**`/设计系统/API payload 再跑对应 E2E 与
   真机 W1–W8（`docs/testing.md` 触发范围）。

---
*配套：`00-total.md` · `02-dsh-memory-evolve.md` · `08-dsh-ecosystem.md` ·
`09-borrowables.md`（P1–P46，尤见 P18/P19/P20/P22/P24）· `14-borrow-pass.md`（B1–B8）。*
