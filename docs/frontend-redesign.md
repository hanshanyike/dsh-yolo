# 前端重设计文档 ·「Mono」设计系统（v2.2 提案）

> 状态：**待评审**（2026-08-22）
> 版本记录：v1「轨道站厅」方向（信号琥珀 + 铁路隐喻系统）已否决——评审意见：隐喻过重、装饰元素过多、色彩预算失控。v2 为全新方向：单色、精密、排版主导。v1 原文存档于 [frontend-redesign-v1-trackhall.md](frontend-redesign-v1-trackhall.md)。
> **v2.1 修订**：对齐工作区未提交的 v0.3.1 前端改动（`git diff HEAD`：YoloPanel / KanbanView / state / filters / dashboard / index）——① 看板/对话双 Tab 已合并为「一个对话面、两种尺寸」（侧栏 ⇄ 全屏，Esc 逐级退出）；② 筛选新增「时段」维度（今天/本周/本月预设 + 自定义起止区间）；③ 台账来源徽标可跳转源会话（`openSession`）；④ 快速记一条与 footer 文案更新。本文所有视图结构与交互语法均以 v0.3.1 为基线。
> **v2.2 修订**（真机走查反馈）：① 画布底色统一为纯白 `#FFFFFF`（原 `#FAFAFA`），与会话面一致，消除「看板灰、会话白」的割裂；② 提升层级辨识度——分区标 13px w700 text-1、折叠头 13px w700 text-1 + 上缘 line-strong、品牌名 14px w700、激活分段 w700、`进行中` 标签改 accent-soft chip；③ 通知块补 e1 投影 + line-strong 描边；④ 修复折叠区收起时露出部分文字（padding 移入 `.fold-pad`，grid 0fr 可完全塌缩）；⑤ 呼吸感与可读性——分区间距 14→20px、任务行高 40→44px、行 meta 由 text-3 提为 text-2。
> 上游输入：[VISION.md](VISION.md) + [product-design.md](product-design.md)（功能与信息架构已定稿）。**本文零功能增删**，只重设计表达层；数据契约（`GET /yolo/dashboard`、`POST /yolo/actions`）与交互语法（卡片 → 聊一聊 → 侧栏对话 → 就地生效）不变。
> 阅读地图：立场 → 第二章；视觉 token → 第三章；布局 → 第四章；组件 → 第五章；动效 → 第六章；质量 → 第八章。
> 交互原型：[frontend-redesign-prototype.html](frontend-redesign-prototype.html)（单文件，可直接在浏览器打开，完整实现本文的 token、布局、动效与双主题，左下角「原型控制」可切换主题/宽度/动效降级）。

---

## 一、v1 复盘：问题出在哪

v1 被否决不是执行问题，是立场问题。三条教训：

| # | v1 的错误 | 后果 |
|---|---|---|
| 1 | **隐喻当结构**：轨道脊柱、地铁线路图、站牌、广播、行车记录——每个隐喻都要求专属视觉载体（装饰线、辉光、动画仪式感） | 视觉税层层累加，形成「主题公园感」 |
| 2 | **色彩预算失控**：5 种信号色 + 琥珀辉光 + 行级 tint 背景，同屏色彩事件过多 | 花哨、廉价、与宿主抢戏 |
| 3 | **动效表演化**：脊柱绘制、行进标记辉光、信号 ping | 动效在「演出」而非「反馈」，拖慢感知速度 |

结论：辨识度不来自往界面上**加**东西，而来自把不需要的东西全部**减**掉之后剩下的精确。

## 二、设计立场

三句话，也是全系统的三条公理：

1. **排版建立层级，而非颜色。** 字号、字重、灰阶承担 90% 的信息层级；颜色只做语义与焦点。
2. **发丝线建立结构，而非卡片。** 列表区不出现卡片盒：行与行之间是 1px 发丝线，区块与区块之间是留白；只有真正浮在内容之上的东西（菜单、toast、通知）才有面与影。
3. **动效表达状态，而非情绪。** 每个动画回答「什么变了」，时长 ≤200ms，快到接近感知阈值。高级感的动效是「察觉不到动效、只察觉到结果」。

参照系（取其共识，不模仿皮肤）：Linear 的克制与速度、Vercel Geist 的中性色阶与排版纪律、Raycast 的键盘优先、Things 的平静。

### 2.1 硬约束：色彩预算

常规工作状态下，用户可见的颜色种类 **≤ 4**：中性墨阶 + 1 个强调色（indigo）。语义红/绿只在对应状态实际存在时出现（逾期/完成）。

强调色全域只允许出现在 **6 个触点**：焦点环、激活 Tab 指示线、主按钮、进行中状态、进度条填充、刷新指示线。出现在第 7 处即为违规。

### 2.2 负面清单

- 无隐喻系统、无主题化命名（组件就叫 TaskRow，不叫「日轨行」）；
- 无辉光、无渐变、无装饰线、无行级背景色块（hover 除外）；
- 列表区不用卡片盒；投影只给浮层；
- 无 >200ms 的入场动画、无弹性缓动、无循环动画、无呼吸效果；
- 不引入字体/图标/动画库（系统字体栈 + 自绘 16px SVG + 纯 CSS）；
- 继承 v1 红线：不做拖拽排序（顺序由产品规则决定）、偏好不上板、目标进度只读。

---

## 三、Token 系统

### 3.1 色彩：中性墨阶 + 单一 indigo

**中性阶（真中性微冷，Zinc 系）**

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--y-bg` | `#FFFFFF` | `#0A0A0B` | 面板画布 |
| `--y-surface` | `#FFFFFF` | `#111113` | 浮层、通知块、停靠面板 |
| `--y-surface-2` | `#F4F4F5` | `#17171A` | 悬停底、输入底 |
| `--y-surface-3` | `#EBEBEF` | `#1E1E22` | 按下态 |
| `--y-line` | `#E9E9EC` | `#1F1F23` | 发丝线 |
| `--y-line-strong` | `#D6D6DB` | `#2A2A30` | 控件描边 |
| `--y-text-1` | `#18181B` | `#F4F4F5` | 主文字 |
| `--y-text-2` | `#52525B` | `#A1A1A8` | 次文字 |
| `--y-text-3` | `#71717A` | `#909098` | 弱文字（对比度已校准） |

**强调色（唯一品牌色，indigo）**

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--y-accent-text` | `#4F46E5` | `#9E9CF5` | 文字级强调 |
| `--y-accent-fill` | `#5B5BD6` | `#5B5BD6` | 主按钮底、进度填充 |
| `--y-accent-soft` | `rgba(91,91,214,.10)` | `rgba(110,107,232,.16)` | 选中底 |

**语义色（低饱和，只在状态出现时可见）**

| Token | 亮色 | 暗色 | 用途 |
|---|---|---|---|
| `--y-danger-text` | `#BE3A31` | `#F0716B` | 逾期日期、删除、错误 |
| `--y-ok-text` | `#1F7A53` | `#52C58F` | 完成勾、已完成标签 |
| `--y-scrim` | `rgba(0,0,0,.20)` | `rgba(0,0,0,.44)` | 侧栏遮罩 |

### 3.2 对比度矩阵（G3 质量门实测项）

| 前景 / 背景 | 亮色 | 暗色 |
|---|---|---|
| text-1 / bg | 16.4:1 | 19.1:1 |
| text-2 / surface | 7.4:1 | 7.3:1 |
| text-3 / surface | 4.8:1 | 5.7:1 |
| accent-text / surface | 6.3:1 | 7.5:1 |
| danger-text / surface | 5.3:1 | 5.9:1 |
| 白字 / accent-fill 按钮 | 5.8:1 | 5.8:1 |

规则：正文与可交互文字 ≥4.5:1；图形与描边 ≥3:1；禁止用 soft 底色叠弱文字。

### 3.3 字体：系统栈 + 等宽数字

不加载字体。质感来自字重对比与数字纪律。

- UI 栈：`"Segoe UI Variable Text", -apple-system, "SF Pro Text", "PingFang SC", "Microsoft YaHei UI", sans-serif`（Win11 原生 Segoe UI Variable 是现代感的关键）；
- Mono 栈（一切时间、日期、计数）：`ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace`；
- **所有数字强制 `font-variant-numeric: tabular-nums`**——30s 轮询刷新时数字不跳宽，这是「精密感」的排版级来源。

字阶：

| 角色 | 规格 |
|---|---|
| 面板标题 | 15px / 20 · w600 |
| 正文（基准） | 13px / 18 |
| 次文字 | 12px / 16 |
| caption | 11px / 16 · text-2/3 |
| micro | 10px / 14 · w500 |
| 计数 display | 20px / 24 · w600 · mono（仅空态与统计，克制使用） |

中文不加字距；Latin 与数字标签允许 `.02em`。

### 3.4 空间 · 圆角 · 描边 · 投影

- **空间**：4px 网格。行内 gap 4/8；区块间 16/20；面板左右 padding 16。
- **圆角只有两档**：`--y-r-sm: 6px`（chip、小控件）、`--y-r-md: 8px`（输入、通知块、浮层）。比 v1 三档更收敛。
- **描边**：1px `--y-line`（结构线）、1px `--y-line-strong`（交互控件）；焦点 = 2px accent `outline` + 2px offset。
- **投影只有一档**：`--y-e1: 0 4px 12px rgba(0,0,0,.08)`（暗色 `0 4px 12px rgba(0,0,0,.40)`）——只给真正浮起的元素（菜单、toast）。停靠面板、列表一律无影。

### 3.5 图标

16×16 视窗、1.5px 描边、圆帽、`currentColor`、无填充（状态点除外）。15 枚：`check`、`clock`、`plus-day`、`chat`、`dots`、`filter`、`close`、`refresh`、`flag`、`bell`、`plus`、`send`、`chevron`、`source-pin`、`target`。现有 Emoji 图标（`💬 ✕ ✓ 🚩`）全部退役。

### 3.6 工程载体

沿用 v1 的基建结论（零依赖）：

1. `client/design/tokens.ts`——token 唯一事实源（TS 常量 + CSS 变量名映射）；
2. `<YoloGlobalStyle />` 挂载时一次性注入 `<style id="yolo-design-system">`：`.yolo-scope` 双主题变量（`[data-y-theme="dark"]`）、`@keyframes`、工具类；
3. 面板根节点 `className="yolo-scope"`，变量全部作用域化，不泄漏宿主；
4. 组件 inline style 只允许引用 `var(--y-*)` 与 tokens 常量，ESLint 拦截字面量色值（见 8.5）。

---

## 四、布局

### 4.1 整体蓝图

```
┌──────────────────────────────────────────────────┐
│ YOLO 8月22日 · 周六              [💬 对话]  ⟳  ✕ │ ① 头部 48px（无 Tab）
├──────────────────────────────────────────────────┤
│ 今日 全部 已完成  (8/18~8/24 ✕) (逾期3)(今日5)…筛选▾│ ② 工具条 40px sticky
├──────────────────────────────────────────────────┤
│ ▎早报 08:00 · 今日 5 · 逾期 3 · 遗留 2      聊一聊 │ ③ 通知块
│ ▎提醒 · 修复 ACL 权限报错 · 昨天      ✓ +1d 聊一聊  │   （唯一 surface 面）
├──────────────────────────────────────────────────┤
│ 逾期 · 3                                         │ ④ 任务列表（主体）
│ ○ 修复 ACL 权限报错                昨天 · 高      │   无卡片、无底色
│ ○ v0.2.0 发布清单                  周四          │   行间发丝线
│ 今日 · 5                                         │
│ ◐ 重设计文档评审          今天 18:00 · 进行中      │
│ ○ 回复合作方邮件                    今天          │
│ 未来 7 天 · 7                                     │
│ 滞留 · 2                                         │
├──────────────────────────────────────────────────┤
│ ▸ 目标与里程碑 · 3 · 平均 42%                     │ ⑤ 折叠区 36px/行
│ ▸ 今日台账 · 12 条记录 · 来自 5 个会话             │
├──────────────────────────────────────────────────┤
│ [ + 快速记一条，回车保存（默认今日到期）    ↵ ]    │ ⑥ 捕获条 52px sticky
├──────────────────────────────────────────────────┤
│ 看板每 30 秒自动刷新 · 作用域 d:\Code\…            │ ⑦ footer 28px
└──────────────────────────────────────────────────┘
              ┌────────────────┐
              │ 锚定 · 早报  ⤢ ✕│ ⑧ 侧栏对话 340px
              │  …消息流…        │   （⤢ 展开为全屏 ⑨）
              │ [ 和 YOLO 说… ↵ ]│
              └────────────────┘

  ⑨ 全屏对话（同一对话面的放大态）：
  ┌──────────────────────────────────────────────────┐
  │ YOLO 8月22日 · 周六          [⤡ 侧栏]  ⟳    ✕   │
  │ ▎锚定 · 早报                                      │
  │  …消息流（全宽，max-width 720 居中）…             │
  │ [ 和 YOLO 说…（Enter 发送）              ↵ ]     │
  └──────────────────────────────────────────────────┘
```

与 v0.3.1 代码一一对应（对照表见附录 C）：**面板永远是看板，对话是一个可变尺寸的面**——侧栏 ⇄ 全屏是同一 `ChatPane` 的两个 variant，共享锚定上下文与同一线程。功能零增删。

**结构性决策：列表区彻底去卡片化。** v1 的问题一半出在「什么都装进盒子里」。v2 里，屏幕上只有两个「面」：画布（bg）和浮在其上的东西（surface）。任务行直接躺在画布上，行间是发丝线；视觉层级由留白与分区标完成。这是「高级感」最大的单一来源。

### 4.2 分区规格

**① 头部（48px）**：左 = 16px Logo + `YOLO`（14px w700，`letter-spacing .02em`）+ 日期（mono 11px text-3）；右 = `💬 对话` toggle 按钮（28px 高，r-sm；关闭态 = ghost，开启态 = accent-soft 底 + accent-text）+ 刷新/关闭图标按钮（28×28，hover surface-2）。**全屏对话态下**，对话 toggle 换成 `⤡ 侧栏` 按钮（ghost）。底部 1px line。无 Tab——v0.3.1 已把看板/对话 Tab 合并，看板是面板本体，对话是可开合的面。

**② 工具条（40px，sticky）**：左 = 预设分段（今日/全部/已完成，激活 = text-1 w700 + 底部 2px accent 短线）；中 = **时段 chip（条件出现）**——`rangeFrom/rangeTo` 任一非空时显示紧凑区间标签（如 `8/18~8/24`，`8/18 起`，`至 8/24`，mono 11px，可点击 ✕ 清除）；右 = 焦点胶囊 ×4 + `筛选 ▾`。胶囊 = 标签 + mono 计数，1px line 描边、无底色、24px 高；激活 = accent-soft 底 + accent-text 文字 + 45% accent 描边。计数变化 120ms crossfade。**工具条底部 1px 线之上运行「刷新指示线」**（见 6.2）。筛选下拉：surface + e1 + r-md，分组（状态 / **时段** / 里程碑 / 关键词），28px 行；时段组 = 预设单选（不限/今天/本周/本月）+ 两个 date input（起~止，任一填写即自定义区间；区间激活时无截止日的任务自动排除——产品规则）。有生效筛选时 `筛选` 按钮旁显示 4px accent 点。

**③ 通知块**：纵向堆叠 gap 8，规格见 5.3。无通知时整区不占位。

**④ 任务列表（主体，flex:1）**：分区顺序 `逾期 → 今日 → 未来 7 天 → 滞留`；分区标 = 名称（13px w700 text-1）+ mono 计数（逾期计数用 danger-text，其余 text-2）+ 右侧延伸发丝线，高 32px；分区空则隐藏。行规格见 5.2。键盘 ↑↓ 行间漫游。

**⑤ 折叠区**：每项一行 36px：`▸ 图标`（展开旋转 90°，150ms）+ 名称（13px w700 text-1）+ 统计（mono 11px text-2，右对齐）。上缘 1px line-strong 与列表分隔；整行 hover = surface-2 底。

**⑥ 捕获条（52px，sticky 底）**：surface 底 + 上缘 1px line。输入框 flex-1：surface-2 底、r-md、36px 高、13px；placeholder `+ 快速记一条，回车保存（默认今日到期）`（v0.3.1 文案）；右侧内嵌 `↵` 提示（text-3，有内容时转 accent-text）；聚焦 = 底色转 surface + 1px line-strong + 2px accent 焦点环。回车提交（`isComposing` 防中文输入法误触）；空值时回车无效。

**⑦ footer（28px）**：`看板每 30 秒自动刷新 · 作用域 {scopeKey}`（11px text-3，截断）。v0.3.1 已删除记忆提取说明文案——footer 只保留服务性信息。

**⑧ 侧栏对话（340px，min 300 / max 420）**：surface 底 + 左缘 1px line，**无投影**（停靠面板不是浮层）；打开 200ms 位移 + 淡入，scrim 渐显；Esc / 点 scrim 关闭。头（44px）= `锚定` 标签 + 上下文标题（11px text-2，accent 2px 左规，截断 24ch）+ **`⤢ 全屏` ghost 按钮** + 关闭按钮。消息流：助手 = 无底色正文（13/19）；用户 = surface-2 气泡右对齐（r-md，max-width 78%）。输入与捕获条同款。侧栏打开时列表主体收窄（`min(400px, 40%)` 上限，与实现一致），不出现横向滚动。

**⑨ 全屏对话（ChatPane variant="full"）**：侧栏对话的放大态，**同一线程、同一锚定**——通过 `⤢` 展开、`⤡ 侧栏` 收回；展开/收回 200ms 交叉淡入。全屏态独占面板 body：顶部锚定条（同侧栏规格，若有 anchor）+ 消息流（max-width 720 居中，行距 19px）+ 底部输入区（与捕获条同规范，placeholder `和 YOLO 说…（Enter 发送）`）。看板不卸载（保持滚动位置与筛选），收回时即恢复。

### 4.3 响应式

| 档 | 宽度 | 规则 |
|---|---|---|
| Compact | <480px | 侧栏对话直接进入全屏态（窄面板不并排）；工具条两行（预设一行、胶囊一行）；头部日期隐藏 |
| Regular | 480–760px | 标准布局，侧栏对话 320px |
| Wide | >760px | 列表内容 max-width 720px 居中；侧栏对话 380px |

### 4.4 数据 → 视觉映射

| 数据 | 视觉处理 |
|---|---|
| `due_at` < now（开放） | 截止文字 danger-text；行首控件描边 danger；分区计数红 |
| `due_at` = 今日 | 琥珀不再存在：日期 mono text-2（`今天 18:00`） |
| `status` in_progress | 控件半弧 accent + `进行中` micro 标签（accent-text，accent-soft 底 chip） |
| 开放且 `updated_at` > 7 天 | meta 追加 `· 7 天未动`（text-3） |
| `priority` urgent / high | 标题前 12px flag 图标（urgent = danger / high = text-3）；medium/low 不显示 |
| `milestone_id` | meta 内 `里程碑名`（text-3 + chevron 图标），点击滚动到目标区并高亮 |
| `session_id` / `source`（任务行） | meta 内来源徽标：source-pin 图标 + 会话摘要（截断），tooltip 显示全文 |
| `session_id`（台账事件）且有 openSession 注入 | 来源徽标升级为可点按钮：`{label} ↗`（hover accent-text，点击跳转源会话） |
| `session_id` 为空 / 无 openSession | 徽标保持纯文本（早期记录、快速记一条等） |
| `progress`（目标） | 进度条填充宽度（只读） |
| `handled_at` null | 通知块处于未处理态；处理后退出 |
| `events.kind` | 台账行类型文字（text-2），仅 `todo_completed` 行首加 ok 勾 |

---

## 五、组件规格

### 5.1 原语（design/primitives）

| 组件 | 规格 |
|---|---|
| `TaskStatusControl` | 14px 圆环控件，**同时是完成按钮**：空心 = 开放；半弧 accent = 进行中；danger 描边 = 逾期开放；ok 填充 + 白勾 = 完成。点击即完成，150ms 填充过渡 |
| `YButton` | 三型：primary（accent-fill + 白字）、ghost（透明，hover surface-2）、danger-ghost（danger-text + danger 描边）。高 28px；按压 `scale(.98)` 100ms |
| `YInput` | 36px 高、r-md、surface-2 底；聚焦见捕获条规范 |
| `SegmentedControl` | 文字段 + 下划线位移动画（transform 驱动，不重排） |
| `Chip` | 10px micro；默认无底（text-2），激活 accent-soft + accent-text |
| `Tooltip` | 延迟 400ms、100ms 淡入；surface + e1 + 1px line-strong；可含 kbd 提示（mono 10px） |
| `ConfirmPop` | 删除确认：锚定行下方的内联浮层（非模态）：danger 描边卡 + `确认删除`（danger-ghost）+ `取消`；Esc/外点关闭；`role="dialog"` |
| `MicroToast` | 捕获条上方居中浮层，r-md + e1，150ms 淡入，2.4s 自动退场；可含 `撤销` 文字按钮 |

### 5.2 TaskRow 状态矩阵（核心组件）

几何：高 44px；第一行 = 标题（13px text-1，单行省略）+ 右侧操作组；第二行 = meta（11px text-2：截止 mono · 优先级 flag · 里程碑 · 来源 pin）。**hover = surface-2 全出血**（延伸至面板左右缘，Linear 式）；操作组（✓ / +1d / ⋯ / 💬，24×24 图标按钮）默认 opacity 0，行 hover 或键盘聚焦时 100ms 淡入。行间 1px 发丝线。

| 状态 | 控件 | 截止文字 | 附加 |
|---|---|---|---|
| 逾期 | ○ danger 描边 | `昨天` danger-text | 排序最高 |
| 今日 | ○ 空心 | `今天 18:00` mono text-2 | — |
| 进行中 | ◐ accent 半弧 | 同上 | `进行中` accent micro 标签（accent-soft chip） |
| 未来 | ○ 空心 | `周四 8/27` mono text-3 | — |
| 滞留 | ○ 空心 | 原截止 + `· 7 天未动` | — |
| 完成（过渡） | ● ok 填充 | `完成 14:32` | 行 opacity .45，见 5.4 |
| 行内编辑 | ○ 空心 | — | 标题转输入；meta 行变日期输入（mono）+ 优先级/里程碑下拉 + 保存/取消 |

### 5.3 NotificationBlock（通知块）

- 容器：surface 底、r-md、1px line-strong、e1 投影、padding 12/14；左侧 2px 语义条（brief = accent，reminder = danger）；
- 头行：bell 图标 + 类型（`早报` / `晚报` / `到期提醒`，12px w600）+ 时间（mono 11px text-3）；
- 正文：13/19，6 行 clamp，`展开` ghost 续读；
- 操作行：reminder = `[✓ 完成] [+1d] [聊一聊] [知道了]`；brief = `[聊一聊] [知道了]`。全部 ghost 型；**`聊一聊` 唯一例外用 accent 描边 ghost**——产品签名动作配全系统唯一强调按钮；
- 到达：150ms 上移淡入；处理后：150ms 淡出 + 高度收起。

### 5.4 完成流（含撤销）

```
点控件 → 控件 150ms 填充 ok + 勾 → 行 opacity 降至 .45、截止位换「完成 14:32」
       → 500ms 后行高收起（150ms）→ 底部 toast「已完成 · 撤销」
       → 撤销（4s 窗口）：行原地恢复 + POST /yolo/actions 还原
```

### 5.5 GoalsBlock（目标与里程碑）

v1 地铁线路图退役。替换为**刻度进度条**——常规、安静、信息密度不损失：

```
重构 v0.4 · 发布                              68%
──────────────●────────◐───────○──────○───
              存储层        检索层       面板
              8/30 ✓       进行中       9/20
```

- 每目标一块，高 56px：目标名（13px w600，点击原地改名）+ 百分比（mono w600 accent-text，右对齐）；
- 进度轨：3px 高、r-full、track = line-strong；填充 = accent-fill；百分比变化时宽度 200ms 过渡；
- 里程碑 = 轨上 8px 点：done = ok 填充 / active = accent 填充 / planned = line-strong 空心；标签（10px text-3）+ 目标日（mono）置于轨下，相邻交错避让；
- 里程碑点点击 = 高亮 + 浮出改名/改状态菜单；进度只读（产品红线）。

### 5.6 LedgerBlock（今日台账）

头部双行信息：`今日台账 · {N} 条记录`（13px w600 text-1）+ `来自 {M} 个会话`（11px text-3，tooltip：「今天发生过对话、且产生了记录的去重会话数；点行末会话标签可跳回该对话」）。倒序流水，行高 28px：`14:32`（mono 11px text-3，固定 44px 列）· 事件类型（11px text-2）· 摘要（13px text-1，省略）· **来源徽标**——有 `session_id` 且 openSession 可用时为可点按钮 `{label} ↗`（hover accent-text + 下划线，点击跳转该 dsh 会话），否则纯文本。行间发丝线。**无彩色 chip**：仅 `todo_completed` 行首加 12px ok 勾。

### 5.7 四态

| 态 | 设计 |
|---|---|
| 加载 | 结构骨架：分区标占位 + 5 行 surface-2 色块（40px 高），1.5s 极缓 shimmer；无 spinner |
| 空 | `今天没有挂起的事`（15px w600 text-2）+ `说一句，我来记下`（caption）+ 光标自动聚焦捕获条 |
| 错误 | 列表区顶部一行：danger-text `看板加载失败` + `重试` ghost；保留上次成功数据降级渲染 |
| 首启 | 通知块形态的一次性引导：`YOLO 帮你把说过的事记在轨道上` + 两问说明 + `[知道了]`；localStorage 记忆，不再出现 |

---

## 六、动效系统

### 6.1 预算

| 级别 | 时长 | 用途 |
|---|---|---|
| 反馈 | 100ms | hover、按压、操作组显隐 |
| 切换 | 150ms | Tab、折叠、淡入淡出、控件填充 |
| 位移 | 200ms | 面板、dock、toast 入场 |

缓动两档：out `cubic-bezier(.2,0,0,1)`、in `cubic-bezier(.4,0,1,1)`。无 spring、无 bounce。只动 `opacity / transform`。

### 6.2 动画清单（全部 8 个）

| 名称 | 触发 | 规格 | 回答的问题 |
|---|---|---|---|
| `hover-reveal` | 行 hover / 键盘聚焦 | 操作组 opacity 0→1，100ms | 「伸手即得」 |
| `press` | 按钮按下 | `scale(.98)`，100ms | 「按下了」 |
| `tab-slide` | Tab / 预设切换 | 下划线 transform 位移，150ms | 「切过去了」 |
| `section-toggle` | 折叠区开合 | 高度 + opacity，150ms | 「展开了」 |
| `row-retire` | 完成后 500ms | 高度→0 + opacity→0，150ms | 「办完了」 |
| `surface-in` | 面板 / 侧栏对话 / toast | translateY(4px) + opacity，200ms | 「来了」 |
| `chat-expand` | 侧栏对话 ⇄ 全屏切换 | 两侧交叉淡入（opacity），200ms | 「同一个面，换了尺寸」 |
| `refresh-sweep` | 轮询数据**实际变化**时 | 工具条底 1px accent 线左→右扫过，240ms | 「刚更新」 |

**`refresh-sweep` 是全系统唯一的签名动效**：功能性大于装饰性——它只在数据真的变了的时候出现，告诉你看板不是死的。数据未变时什么都不发生（安静也是一种信息）。

**轮询 crossfade**：30s 轮询写回数据时，发生变化的区块做 120ms opacity .6→1 过渡；配合 tabular-nums，彻底消灭刷新闪烁（v1 审计问题 S4 的根治方案，且比 v1 的方案安静）。

### 6.3 reduced-motion

`@media (prefers-reduced-motion: reduce)`：全部动效退化为 ≤100ms 纯 opacity 切换；`refresh-sweep` 直接关闭；shimmer 骨架改静态。

---

## 七、主题与宿主集成

三层变量架构与暗色判定沿用 v1 结论（已验证可行）：

1. L1 宿主变量 → L2 `.yolo-scope` 语义 token → L3 组件只消费 `var(--y-*)`；
2. 挂载时读宿主 `--background` 亮度判定暗色（<0.5 → dark），宿主变量缺失则回退 `prefers-color-scheme`，结果写 `data-y-theme`；
3. `@media (forced-colors: active)`：移除全部底色，层级改用 1px 实线描边；`prefers-contrast: more`：text-3 提亮一档、发丝线加深一档。

暗色为本设计的**第一主题**（`#0A0A0B` 画布 + 中性浮层 + 单点 indigo 是「高级感」的原生场景），亮色完整对等交付，共用同一套语义 token。

---

## 八、质量保障体系

（v1 的质量体系未被否决，完整继承并按 v2 组件更新。）

### 8.1 六道质量门（CI 强制）

| 门 | 内容 | 工具 |
|---|---|---|
| G1 Token 单源 | `tokens.ts` 与注入 CSS 变量逐一对齐（50+ 项） | `scripts/check-tokens.mjs`（新增） |
| G2 无字面量色 | `client/**` 禁止 hex/rgb 字面量（tokens.ts 白名单） | ESLint `no-restricted-syntax` |
| G3 对比度审计 | 3.2 矩阵全表实测 ≥4.5:1 | harness 内对比度断言脚本 |
| G4 组件测试 | 原语 + 关键组件渲染与交互 | vitest + @testing-library/react + jsdom（新增 devDeps） |
| G5 视觉回归 | 基线矩阵截图比对，容差 0.1% | Playwright（新增 devDep）+ 8.2 harness |
| G6 a11y 审计 | axe-core 0 违规（serious+） | harness 内嵌 axe |

### 8.2 测试金字塔与视觉 harness

- **组件测试用例（≥22）**：TaskStatusControl 四态 + 点击完成回调；YButton 三型 + 按压；SegmentedControl 键盘漫游；TaskRow 状态矩阵 7 态渲染；hover 操作组显隐；完成流（填充→retire→撤销还原，断言 POST `/yolo/actions` 载荷）；NotificationBlock 两类操作回调；GoalsBlock 站点状态与进度位置 + 改名；Ledger 记录渲染、会话数统计与徽标跳转回调（有/无 session_id 两分支）；时段筛选（预设 today/thisWeek/thisMonth 的区间解析、自定义起止、chip 标签与清除回调、无截止日任务被排除）；捕获条回车提交（含 isComposing 守卫）与空值无效；侧栏对话开合与锚定传参、⤢/⤡ 全屏切换、Esc unwind 链（全屏→侧栏→关闭）；ConfirmPop 焦点管理；暗色变量切换；reduced-motion 降级；
- **harness**：`tests/ui-harness/index.html` 静态页注入 mock dashboard fixture（与 `src/shared/dashboard.ts` 类型绑定，防 mock 漂移）；
- **基线矩阵**：2 主题 × 3 宽度（400/600/800）× 6 fixture（满载/空/仅逾期/仅简报/长标题/错误态）= **36 张基线**入库，PR 触发重截图比对。

### 8.3 可访问性

- 键盘地图：Tab 自然序；↑↓ 行漫游；Space 完成焦点行；`E` 进编辑；**Esc 逐级退出：筛选菜单 → 行内编辑 → 全屏对话 → 侧栏对话 → 关闭面板**（与 v0.3.1 Esc unwind 链一致）；Enter 提交输入（捕获条防 `isComposing` 误触）。全映射在 harness 有键盘走查用例；
- `:focus-visible` 全组件 2px accent outline + 2px offset；dock 开启焦点圈入、关闭归还触发按钮；
- 日轨列表 `role="list"`/`listitem` + `aria-label` 状态汇总；通知到达 `aria-live="polite"`；计数变化走隐藏读数节点；装饰 SVG `aria-hidden`，动作按钮带中文 `aria-label`。

### 8.4 性能预算

| 项 | 预算 | 手段 |
|---|---|---|
| 面板挂载到首帧 | <100ms | 样式注入一次缓存；骨架先行 |
| 30s 轮询重渲染 | 单帧 <8ms | 分区 `React.memo` + 数据浅比较；stable key |
| 轮询视觉抖动 | 0 | tabular-nums + 区块 crossfade |
| 样式基建体积 | ≤4KB（gzip 前） | 变量 + 7 keyframes + 15 图标，零运行时库 |
| 动画帧率 | 60fps | 仅合成层属性；同屏动画 ≤2 |

### 8.5 工程防线

ESLint 拦截 JSX style 中 `#`/`rgb(` 字面量；`check-tokens.mjs` 挂 `npm test` 前置；harness fixture 与 shared 类型绑定，接口变更编译期报错。

### 8.6 视觉验收场景（VA）

| # | 场景 | 通过标准 |
|---|---|---|
| VA-1 | 暗色 IDE 打开面板 | 无亮色残留；全屏颜色事件 ≤4；对比度矩阵实测通过 |
| VA-2 | 早晨首开 | 早报块淡入；首屏 ≥3 任务行；骨架不超过 300ms |
| VA-3 | 完成一项任务 | 填充→retire→撤销 toast 全链路 ≤1.2s，可撤销 |
| VA-4 | 通知到达（面板开启中） | 150ms 淡入 + 计数 crossfade，零布局跳动 |
| VA-5 | 窄面板开侧栏对话 | 直接进入全屏对话态，不产生横向滚动；Esc 逐级退回并归还焦点 |
| VA-6 | 轮询刷新 | 数据变化时 refresh-sweep 出现一次；未变化时完全静止 |
| VA-7 | 空库首启 | 引导块 + 空态 + 捕获条自动聚焦 |
| VA-8 | reduced-motion | 全部动效退化为即时切换，功能零损失 |

### 8.7 Definition of Done

- [ ] Token 全量落地，G1–G6 全绿；
- [ ] 36 张视觉基线入库，CI 比对通过；
- [ ] VA-1~8 真机走查签字（Windows 亮/暗各一轮）；
- [ ] axe 0 违规；键盘可完成「完成 → 撤销 → 记一条 → 聊一聊」全流程；
- [ ] 性能预算五项实测达标；
- [ ] 附录 C 对照表逐项核对，功能零增删。

---

## 九、实施路线（四个 PR，不做大爆炸）

| 阶段 | 内容 | 说明 |
|---|---|---|
| **A 地基** | tokens.ts + YoloGlobalStyle + 主题判定 + 8 个原语 + G1/G2 防线 + 原语测试 | ~500 行新增，风险最低 |
| **B 主舞台** | 头部 + 工具条 + 任务列表（TaskRow/完成流/行内编辑） | KanbanView 重构主体 |
| **C 两翼** | 通知块 + GoalsBlock + Ledger + 捕获条 + dock 对话视觉 | — |
| **D 收口** | 全部动效 + refresh-sweep + 视觉回归 harness + a11y + VA 走查 | 质量门全开 |

每阶段独立可合入、可回滚；B/C 期间新旧视觉以 `data-y-v1/v2` 双轨共存一个版本窗口。

---

## 十、风险与权衡

| 风险 | 评估 | 对策 |
|---|---|---|
| 全中性 + 单 indigo 在宿主中辨识度不足？ | 低。辨识度来自结构（去卡片化 + 发丝线 + 排版节奏）与唯一强调色的稀缺性，而非色相数量；稀缺本身制造记忆点 | 若评审仍觉不足，唯一升级位是 accent 色相（换一个 token 即可），架构不动 |
| indigo 与宿主 accent 同色系 | 低。accent 只在 6 个触点出现，接触面极小 | 观察 VA-1 真机效果，必要时仅调 `--y-accent-*` 三个值 |
| inline style → 变量混排迁移期分裂 | 中 | 阶段化 PR + 双轨 flag；G2 保证新代码不回退 |
| 视觉回归 CI 稳定性（字体渲染差异） | 中 | 固定字体栈 + 0.1% 容差 + 基线按平台分开 |
| 「太素」读作「没做完」 | 中 | 靠分区标/留白/字重的排版纪律兜底；空态与首启引导承担「产品感」 | 

---

## 附录 A：Token 结构索引

```css
.yolo-scope {
  /* 中性 */ --y-bg; --y-surface; --y-surface-2; --y-surface-3;
  --y-line; --y-line-strong; --y-text-1; --y-text-2; --y-text-3;
  /* 强调 */ --y-accent-text; --y-accent-fill; --y-accent-soft;
  /* 语义 */ --y-danger-text; --y-ok-text; --y-scrim;
  /* 几何 */ --y-r-sm: 6px; --y-r-md: 8px;
  /* 投影 */ --y-e1;
  /* 动效 */ --y-dur-1: 100ms; --y-dur-2: 150ms; --y-dur-3: 200ms;
  --y-ease-out; --y-ease-in;
  /* 字体 */ --y-font-ui; --y-font-mono;
}
/* [data-y-theme="dark"] 覆写颜色；@media (prefers-reduced-motion) 覆写动效 */
```

（色值见 3.1–3.4、6.1；`check-tokens.mjs` 以本清单为单源校验。）

## 附录 B：图标清单（16×16 · 1.5px · currentColor）

`check`、`clock`、`plus-day`、`chat`、`dots`、`filter`、`close`、`refresh`、`flag`、`bell`、`plus`、`send`、`chevron`、`source-pin`、`target`。

## 附录 C：功能零增删对照（v0.3.1 代码 → 本文）

| v0.3.1 实现的功能 | 本文落点 | 增/删 |
|---|---|---|
| 侧边栏入口 + 角标 | 入口重样式（mono 点角标，无呼吸） | 0 |
| `💬 对话` toggle（开合侧栏对话，锚定看板全局） | 4.2① | 0 |
| 一个对话面两种尺寸：侧栏 ⇄ 全屏（`⤢`/`⤡`，Esc unwind：全屏→侧栏→关闭） | 4.2⑧⑨ + 6.2 `chat-expand` | 0 |
| 预设 Tab（今日/全部/已完成） | 4.2② | 0 |
| 筛选下拉：状态 + **时段（今天/本周/本月/自定义起止）** + 里程碑 + 关键词 | 4.2② | 0 |
| 时段区间 chip（条件显示，点击 ✕ 清除；区间激活时无截止日任务排除） | 4.2② | 0 |
| 焦点胶囊（计数 + 点选过滤） | 4.2②（胶囊降装饰但保留交互） | 0 |
| 通知卡（完成/+1d/聊一聊/处理） | 5.3 | 0 |
| 任务行（✓/+1d/⋯/💬、行内编辑、删除确认） | 5.2 | 0 |
| 目标与里程碑折叠区（进度只读） | 5.5 刻度进度条 | 0 |
| 今日台账（N 条记录 · 来自 M 个会话 · 徽标 ↗ 跳源会话） | 5.6 | 0 |
| 快速记一条（回车入库、默认今日到期、不经 LLM、isComposing 守卫） | 4.2⑥ | 0 |
| 侧栏对话锚定上下文（聊一聊传 anchor） | 4.2⑧ | 0 |
| footer：「看板每 30 秒自动刷新 · 作用域 …」 | 4.2⑦ | 0 |
| 视图状态持久化（filter + sideChatOpen；chatFullscreen 为会话态） | 不变（`client/panel/state.ts`） | 0 |

新增仅为表达层物件：撤销 toast（5.4）、首启引导（5.7）、空/载/错三态（5.7）、刷新指示线（6.2）——均不触碰数据契约与产品规则。v0.3.1 已删除的表达层内容（看板/对话 Tab、footer 记忆提取说明）本文不再保留。
