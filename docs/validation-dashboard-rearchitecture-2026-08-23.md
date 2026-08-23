# 助手看板重构最终验证报告

- 验证日期：2026-08-23
- 范围：`docs/prd-assistant-dashboard-rearchitecture.md`、助手看板 v2、处理/信任链、锚定对话与 W1–W16
- 环境：Windows，Node.js 22.19.0，系统 Edge，独立 dsh web 宿主 `http://127.0.0.1:4097`
- 数据路径：独立启动的最新构建宿主、真实 SQLite、真实 dashboard/action/session 端点；E2E 夹具按 id 精准清理

## 结论

本批重构通过类型、单元、构建、真实 API、真实 Edge UI 和真实 LLM 对话门禁。
独立最新构建宿主上的 UI 套件为 **27/27 PASS**，W1–W16 均有对应验证证据；1440、960、400
三个宽度的 headed Edge 走查未发现横向溢出、控制台错误、U+FFFD 替换字符或 Emoji 图标残留。

唯一需要保留的验证边界是 W4：computer-use 受安全限制，未能自动操纵 Windows 原生中文输入法。
本轮在真实 Edge 页面派发并观察了 composition 生命周期，确认组合态 Enter 不提交、组合结束后只提交一次；
这验证了应用的浏览器事件契约，但不能表述为“已完成操作系统输入法全自动化”。

## 门禁结果

| 门禁 | 结果 | 证据 |
|---|---:|---|
| Node 22 `pnpm check` | PASS | TypeScript `tsc --noEmit` 无错误 |
| Node 22 `pnpm test:run` | **44 文件 / 404 用例 PASS** | 包含判断、信任动作/存储、Today 模型、Chat pending/scope、样式契约等重构回归 |
| Node 22 `pnpm build` | PASS | 宿主实际加载的 `dist` 成功生成 |
| API E2E | **3/3 PASS** | 独立最新构建宿主，真实 HTTP 与 SQLite |
| UI E2E | **27/27 PASS** | 独立 `127.0.0.1:4097`，Playwright 驱动系统 Edge，单 worker |
| Headed Edge 视觉走查 | PASS | 1440 / 960 / 400；无溢出、console error、U+FFFD、Emoji 图标残留 |
| 真实 LLM 对话 | PASS | 自然语言创建事项后再自然语言完成；同一 id 从 pending 迁移为 done |

E2E 使用独立启动的最新 `dist` 宿主，避免复用旧进程造成构建版本漂移；用例通过唯一前缀和精确 id
隔离自身夹具，但保留真实用户数据库作为兼容性背景。运行时同时设置
`YOLO_E2E_HOST=http://127.0.0.1:4097` 与 `YOLO_E2E_PORT=4097`。

## W1–W16 逐项映射

| # | 结果 | 验证证据 |
|---|---:|---|
| W1 打开面板 | PASS | headed Edge 亮色首屏在 1440/400 完整渲染，960 为暗色复核；console error 为 0；未见 U+FFFD、Emoji 图标或损坏字形 |
| W2 工具条 | PASS | `accessibility-feedback.spec.ts` 验证关闭菜单从可见性/键盘序列移除；UI 套件同时覆盖 Tab、筛选、More 菜单和 Esc 恢复焦点 |
| W3 任务处理 | PASS | `panel-flow.spec.ts` 覆盖完成、4 秒内撤销与恢复；处理面板覆盖编辑字段可访问名称及主要动作 |
| W4 捕获条 | PASS（有限制） | `capture-composition.spec.ts` 在真实 Edge 验证 composition 中 Enter 不提交、结束后一次入库且默认今日；未执行 Windows 原生 IME 自动化 |
| W5 对话与全屏 | PASS | `panel-flow.spec.ts` 覆盖锚定侧栏、全屏与 Esc 逐级退出；`accessibility-feedback.spec.ts` 验证真实新 assistant 回复到达前持续显示处理中 |
| W6 主题 | PASS | `theme-narrow.spec.ts` 在真实 Edge 分别验证 light/dark 宿主主题映射；headed 视觉检查未见亮色残留或不可读文字 |
| W7 窄面板 | PASS | 400px headed Edge 与 `theme-narrow.spec.ts`/`dashboard-v2.spec.ts` 验证紧凑布局、三主视图、More 入口、对话直接全屏和无横向溢出 |
| W8 今日台账 | PASS | `ledger-panel.spec.ts` 通过真实事件与 dashboard 验证台账渲染、来源和会话投影 |
| W9 会话切换 | PASS | `panel-v032.spec.ts` 验证看板打开时侧栏会话可切到前台且面板让位 |
| W10 全新锚定对话 | PASS | `panel-v032.spec.ts` 验证“聊一聊”不带常驻历史且回复留在同一锚定线程；真实 LLM 对话另行验证自然语言闭环 |
| W11 判断首读/复读 | PASS | `dashboard-v2.spec.ts` 验证 full 首读、seen 后 compact、evidence/fingerprint 变化后重新 full，并验证唯一重点和固定阅读顺序 |
| W12 学习回执/撤销 | PASS | `dashboard-trust.spec.ts` 验证服务端回执、作用范围、前后变化、postpone 的服务端 undo 恢复原日期；`preferenceUndo=false` 时不声称偏好已学习 |
| W13 partial 安全 | PASS | `dashboard-trust.spec.ts` 在一次真实 dashboard 响应中注入 partial/workspaceErrors，验证单一提示、可用数据仍可处理且 `scope_cwd` 保持 |
| W14 图标/读屏名 | PASS | `dashboard-trust.spec.ts` 验证通知、对话、更多、关闭和事项处理按钮可读名称；headed 检查确认无 Emoji 代替图标 |
| W15 done/cancelled | PASS | `dashboard-v2.spec.ts` 验证完成与取消严格分离、cancelled 不计 completed，且两类终态都可重开为 pending |
| W16 reason/evidence | PASS | `dashboard-trust.spec.ts` 对照真实 dashboard 响应验证 explanation/evidence 标签一致、无额外无依据文本，主判断不在列表重复 |

## 助手看板重构专项浏览器资产

| Spec | 数量 | 信任边界 |
|---|---:|---|
| `capture-composition.spec.ts` | 1 | 浏览器 composition 事件与快速记录提交边界 |
| `dashboard-v2.spec.ts` | 4 | Today 信息架构、完整/紧凑判断、处理面板、终态分离与约 340px 布局 |
| `dashboard-trust.spec.ts` | 3 | 服务端回执/undo、partial 与 scope、ARIA、reason/evidence 不漂移 |

这些用例不 mock action 存储。`dashboard-trust` 只在 W13 首个 dashboard 响应的浏览器传输层加入
`partial/workspaceErrors`，底层读取和后续 action 仍走真实宿主；因此能同时验证降级表达和跨工作区动作安全。

## Headed Edge 视觉矩阵

| 视口宽度 | 关注点 | 结果 |
|---:|---|---:|
| 1440 | 宽屏 Today 阅读顺序、判断层级、处理面板、对话表面 | PASS |
| 960 | 中等宽度重排、文字/图标可读、控件不互相覆盖 | PASS |
| 400 | 紧凑三导航、More 辅助入口、全屏处理/对话、无横向滚动 | PASS |

三个宽度均检查：页面与关键容器无横向溢出；console error 为 0；可见文本不含 U+FFFD；
产品图标不以 Emoji 字形表达。

## 本机 dashboard 时延抽样

在同一 4097 真实宿主和现有兼容性数据上顺序请求 `GET /yolo/dashboard` 40 次：响应体约
105,940 bytes，p50 17.44ms、p95 45.30ms、最大 285.60ms。该抽样低于 PRD 的 500ms p95 目标，
但没有专门生成“10 个工作区 / 2,000 条事项”的参考数据集，因此只能证明本轮真实数据规模，
不能替代大规模容量基准。若聚合查询、排序或数据库索引再次改动，应补独立基准数据集复测。

## 真实 LLM 对话闭环

在真实宿主常驻助手对话中，以自然语言创建事项：

> 把新版助手看板的验收结论发给研发

解析并写入的截止时间为 `2026-08-24T15:00:00+08:00`。随后通过自然语言要求完成该事项，
再查询真实 API：返回的是创建阶段的**同一个事项 id**，状态已经迁移为 `done`。

这条证据验证了“对话理解 → 写入 → dashboard 投影 → 自然语言领域动作 → 同 id 状态更新”的闭环，
不是通过测试夹具或直接 action API 代替 LLM 对话。

## 限制与后续复核条件

- computer-use 的安全边界阻止了 Windows 原生中文 IME 自动化；W4 的 PASS 范围是应用层真实 Edge
  composition 事件处理。若输入组件或键盘框架再次改动，应补一次人工原生 IME 复核。
- 本轮真实 LLM 验证是一条创建并完成的代表性语义链，不代表长时运行、跨日调度或大规模随机对话压力测试。
- 本报告记录的是 2026-08-23 当前构建和独立宿主结果；后续若修改 `client/**`、`src/ui/**`、
  dashboard/action payload 或设计系统，必须按 `docs/testing.md` 重新执行受影响的 W1–W16。
