# 前端重设计文档 ·「宿主原生」v5 提案

> 状态：**待评审**（原型已出）
> 交互原型：[frontend-redesign-v5-native.html](frontend-redesign-v5-native.html)（单文件，浏览器直开；左下角「原型控制」切主题/宿主侧栏宽度/动效；顶部横向 Tab 切 今日/即将/已完成/目标/台账）。
> **本提案零功能增删**：数据契约（`GET /yolo/dashboard`、`POST /yolo/actions`）与全部交互动词不变。

---

## 一、这一稿解决的是「和宿主打架」，不是配色

v4 之前各稿都错在一个地方：**把 YOLO 当成一个独立 App 去设计**，于是给它配了它自己的垂直侧栏、它自己的色板。但 YOLO 不是一个独立 App——它是 **DeepSeek Harness（dsh）宿主里的一个 UI 插件**，注入在侧栏底部的一个 footer action 上。

### 宿主事实（已从源码核实，见 `host/deepseek-harness/packages/client/`）

| 事实 | 出处 | 对 YOLO 的含义 |
|---|---|---|
| 宿主是 **三栏 AppFrame**：`sidebar \| center \| details` | `ui-layout/src/client/AppFrame.tsx` | 垂直导航是宿主侧栏的职责 |
| 宿主侧栏 `264–420px`，**收成 56px 图标轨**（<1024px 自动折叠） | `ui-layout/src/client/columns.ts` | YOLO 不该再画一条垂直导航 |
| YOLO 是 `sidebar.footer.action`，打开时**从宿主侧栏右缘撑满的抽屉** | `ui-sidebar/src/client/contract/slots.ts` | YOLO 是一个「面」，不是一个「栏」 |
| 宿主导入完整 `--dsw-*` 语义 token（bg/label/border/state-*，明暗两套） | `ui-theme/src/styles/design-platform.css` | YOLO 应**消费宿主 token**，跟随宿主明暗 |

**结论**：v4 在抽屉里再放一条 208px 垂直侧栏 = 宿主一条 + YOLO 一条 = **嵌套侧栏**，这正是 clash。v5 的两个硬改动：

1. **YOLO 不再自建垂直导航。** 宿主侧栏管垂直导航；YOLO 自己的视图切换做成抽屉内的**横向分段标签**（今日/即将/已完成/目标/台账）——一个右侧面本来就应该用横向标签分面。
2. **YOLO 直接消费宿主 `--dsw-*` token。** 结构层（surface/text/border/焦点）与语义状态色（error/success/business/warn）全部取宿主别名，宿主切暗色 YOLO 自动跟随，读起来是宿主的一等表面，不是外来面板。

---

## 二、辨识度的正确来源：信息架构，不是外来色板

前面你说「换色没用」「不要花里胡哨」。v5 把这两条都落实：

- **辨识度来自信息架构 + 交互**，不是一套自创的视觉语言：
  - **Today-first**：打开即「今天」，一天一个面（Things 3 / Todoist / Linear / Sunsama 的共识）；
  - **横向分面**：抽屉内的视图切换（coming/done/goals/ledger 各成一面，互不挤占）；
  - **捕获优先**：顶部命令式输入，回车即「记下」（Todoist/Things 的 + 键心智）；
  - **跨会话台账**：今日台账 + 会话标签跳回，这是 YOLO「管理而非代办」的产品脑最直接的具象。
- **颜色只用宿主语义**：唯一自家 accent 是宿主的 **warn-amber**，只做「关注/进行中/现在」的语义点，且只在少量触点出现。不再造一套 YOLO 专属色板。

这样，**任何配色下这套架构都是 YOLO 的东西**——因为产品主张在结构上直接可见，跟色相无关。

---

## 三、宿主协作原则（写进落地清单）

| 原则 | 落地 |
|---|---|
| 不复制宿主已拥有的结构 | 垂直导航归宿主侧栏；YOLO 用横向标签 |
| 消费宿主语义 token，不造色板 | `--y-*` 桥接 `--dsw-*`（见附录 A），只在 `.yolo` 作用域 |
| 跟随宿主明暗 | 结构层用 `--dsw-alias-*`，宿主切暗色 YOLO 自动跟随 |
| 尊重宿主宽度权衡 | 宿主侧栏折叠成 56px 图标轨时，YOLO 抽屉占满余下（同 AppFrame 的 concession 链语义） |
| 不打扰工作会话（红线） | YOLO 是侧栏 footer action 打开的**抽屉**，单独的面；不注入/覆盖当前会话，Esc 可关 |
| 作用域不泄漏 | 全部样式只在 `.yolo` 作用域；不污染宿主 |

---

## 四、信息架构（相对 v4：垂直侧栏 → 横向标签）

```
宿主三栏（真实）：  sidebar(垂直导航)  |  center(会话)  |  details
                        │
   YOLO 抽屉（从宿主侧栏右缘撑满）：
   ┌────────────────────────────────────────────────────────────┐
   │ 品牌 + 日期           筛选 · 🔔 · 对话 · ⟳ · ✕   （头部 52px） │
   │ 今日● 即将8 已完成5 目标3 台账7                      ← 横向标签 │
   │ [+ 记一件事，回车保存…                            ↵]  ← 捕获   │
   ├────────────────────────────────────────────────────────────┤
   │ 今天 · 8月23日·周日            5 件待办 · 3 逾期   ← hero      │
   │ ▎早报 …   ▎到期提醒 …                            ← 通知       │
   │ ┃ 已逾期 · 3                                      ← 分区      │
   │ ┃ 今天 · 5                                                  │
   └────────────────────────────────────────────────────────────┘
```

各面（横向标签切换，均为独立滚动面）：**今日**（逾期+今天，主舞台）· **即将**（未来 7 天+滞留）· **已完成** · **目标与里程碑** · **今日台账**。目标/台账从底部折叠抬升为独立面，不再和核心任务抢一个滚动区。

---

## 五、与宿主 token 的对齐（附录 A：YOLO `--y-*` → 宿主 `--dsw-*`）

```
结构层（跟随宿主明暗）
  --y-bg         ← --dsw-alias-bg-base
  --y-surface    ← --dsw-alias-bg-layer-1
  --y-surface-2  ← --dsw-alias-bg-layer-2
  --y-surface-3  ← --dsw-alias-bg-layer-3
  --y-line       ← --dsw-alias-border-l1
  --y-line-strong← --dsw-alias-border-l2
  --y-text-1/2/3 ← --dsw-alias-label-{primary,secondary,tertiary}
  --y-caption    ← --dsw-alias-label-caption
  --y-hover      ← --dsw-alias-interactive-bg-hover
  --y-active     ← --dsw-alias-interactive-bg-active
  --y-menu       ← --dsw-specific-menu
  --y-toast      ← --dsw-alias-toast-bg
  --y-tooltip    ← --dsw-alias-tooltip-bg

语义状态（仅状态出现时可见）
  --y-danger     ← --dsw-alias-state-error-primary
  --y-ok         ← --dsw-alias-state-success-primary
  --y-focus      ← --dsw-alias-state-business-primary   (焦点环：宿主品牌蓝)

YOLO 唯一自家 accent（宿主 warn-amber，只做「关注/进行中」语义点）
  --y-accent       ← --dsw-alias-state-warn-primary
  --y-accent-fill  ← --dsw-alias-state-warn-primary
  --y-accent-soft  ← --dsw-alias-state-warn-tertiary
```

> 原型里那段 `<body>` 兜底 block 只是「沙盒离线渲染」用的宿主 token 缺省值；真机里宿主（`ui-theme`）已注入同名 `--dsw-*`，该块不生效。它同时是「YOLO 实际桥接哪些宿主别名」的清单。

---

## 六、红线与负面清单（全继承，绝不破）

- **管理而非代办；绝不打扰工作会话**（YOLO 抽屉独立，不注入会话）；**本地优先；类型安全 + 真机验证**。
- 无隐喻系统、无拟物、无主题化命名；无辉光/渐变/行级底色（hover 除外）；列表区无卡片盒；投影只给浮层。
- 无 >200ms 入场、无弹跳、无循环、无呼吸；零字体/图标库（系统栈 + 自绘 SVG）。
- **不做拖拽排序**；偏好不上板；**目标进度只读**。

---

## 七、落地（E2E 质量门，UI 变更必过）

- **零功能增删**：`GET/POST` 契约、`POST /yolo/actions` 单一动作路径、状态迁移、审计事件、Esc 逐级退出全不变。
- 改动面 = `client/**`（视觉层）+ 宿主协同策略，属 UI 变更 → 提交前必须：`pnpm check`、`pnpm test:run`、**W1–W8 真机端到端**（`docs/testing.md` 第七节）。fixture 措辞符合「用语真实」。
- 落点：在 v2 已交付基础上，把 `client/panel/` 重构为「宿主原生的抽屉 + 横向标签」；新增 `DayHero`/`CaptureBar`/`ViewTabs`；`tokens.ts` 的 `--y-*` 改为桥接宿主 `--dsw-*`（不再自造色板）；沿用 G2 无字面量色、组件测试、视觉回归基线。

---

## 八、风险与权衡

| 风险 | 评估 | 对策 |
|---|---|---|
| 宿主侧栏 collapse 时 YOLO 宽度骤变 | 已防 | 用宿主 `--hs` 相同语义做 concession；窄屏宿主收 56px 轨，YOLO 占满 |
| `--dsw-*` 在真机未注入？ | 低 | 宿主 `ui-theme` 注入；原型已留缺省兜底并列出桥接清单 |
| 只用宿主 warn-amber 是否够辨识 | 中 | 辨识度来源是 IA 不是色相；若仍不足，唯一升级位是 `--y-accent` 三个值（换色不换架构） |
| 横向标签在窄屏溢出 | 已防 | 窄屏标签可横向滚动 |
| 抽屉盖住宿主 center/details | 预期 | YOLO 是可关闭的独立面（Esc/外点），不持久打扰会话 |
