# E2E 测试规范（场景 · 用例 · 车道）

> 浏览器端到端测试的单一事实源：有哪些场景、怎么跑、为什么之前慢/不稳定、
> agent 如何按规范执行与归因。运行/配置总览见 [testing.md](testing.md) 第五节。
> 本文由 2026-08 的 E2E 治理（分支 `test/e2e-standardization`）落地并实测背书。

---

## 一、车道模型

| 车道 | 位置 | 载体 | 验证什么 | 期望耗时 |
|---|---|---|---|---|
| L0 单测 | `tests/**/*.test.ts` | vitest + 内存 SQLite / ctx stub | 纯逻辑、领域动作、插件接线 | ~70s 全量 |
| **L1 api** | `tests/e2e/api/` | 真实宿主 HTTP（无浏览器） | 端点契约：dashboard 形状、动作路由、审计事件 | **< 10s** |
| **L2 ui** | `tests/e2e/ui/` | 真实宿主 + Edge（Playwright） | 表达层与宿主集成：看板交互、主题、锚定对话 | ~1-2min |
| L3 真机走查 | docs/testing.md 第八节 | 人肉 W1–W10 清单 | 自动化盲区（IME、动效观感、DPI…） | 按触发范围 |

选择原则：**能用 L1 就不用 L2，能用 L0 就不用 L1。** 断言落在持久元素
（看板行）而非易消失的 toast；夹具经真实端点种入，绝不 mock 存储。

## 二、场景 × 用例矩阵

### L1 api 车道

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `api/dashboard-scope.spec.ts` | `GET /yolo/dashboard?scope=all` 返回 200 与合法看板形状（todos/notifications 数组、无 error、聚合标记带 workspace 信息） | v0.3.0/v0.3.3 聚合 |
| `api/actions-consolidate.spec.ts` · P35 | 合并两条待办：保留方继承字段、被并方退场、台账留 `todo_consolidated` | product-design P35 |
| `api/actions-consolidate.spec.ts` · P34 | 非法动作 400 且落 `action_denied` 审计——拒绝绝不静默 | product-design P34 |

### L2 ui 车道

| spec · 用例 | 场景 | 验收来源 |
|---|---|---|
| `ui/panel-flow.spec.ts` · TA-1/TA-2 | 打开助手看板按真实任务渲染今日行（到期槽读「今天」） | TA-1/TA-2, 5.2 |
| `ui/panel-flow.spec.ts` · TA-3 | 完成 → retire → toast 带 4 秒「撤销」→ 撤销恢复原位 | TA-3, 5.4 |
| `ui/panel-flow.spec.ts` · TA-4 | 逾期聚焦胶囊过滤：只留逾期行 | TA-4 |
| `ui/panel-flow.spec.ts` · TA-2′ | 捕获条回车快速记一条并落入看板 | TA-2 快捷入口 |
| `ui/panel-flow.spec.ts` · TA-5 | 卡片「聊一聊」打开侧栏对话并锚定该任务 | TA-5 |
| `ui/panel-flow.spec.ts` · TA-6 | Esc 逐级退出：全屏对话 → 侧栏 → 关面板 | TA-6 |
| `ui/reminder-badge.spec.ts` · TB-3~6 | 未处理提醒驱动角标+通知卡；「知道了」后归零 | TB-3~TB-6 |
| `ui/theme-narrow.spec.ts` · W6 | 亮/暗宿主下 `--background` 解析为 light/dark | frontend-redesign W6 |
| `ui/theme-narrow.spec.ts` · W7 | 窄面板(<480px)紧凑态、对话直接全屏、Esc 退回 | W7 |
| `ui/panel-v032.spec.ts` · W10 | 「聊一聊」全新锚定对话，无常驻历史泄漏 | R19/W10 |
| `ui/panel-v032.spec.ts` · W9 | 看板描边从侧栏开始；侧栏区点击让面板让位 | R18/W9 |
| `ui/ledger-panel.spec.ts` | 合并事件进入今日台账并在台账 tab 渲染 | v5 台账面 |
| `ui/board-scope.spec.ts` | 面板头部保留工作区切换开关时可用 | v0.3.3 |

### 已知覆盖缺口（真机走查兜底）

W1 控制台零报错未断言 · W2 工具条筛选交互仅单测 · W3 行内编辑表单 ·
W4 中文 IME 组合态回车（Playwright 无法模拟组合态）· W8 台账数字精确性 ·
reduced-motion / 特定 DPI。

## 三、如何运行

```bash
node scripts/e2e.mjs                 # 全部车道（拉起或复用宿主）
node scripts/e2e.mjs --lane api      # 仅 L1（秒级反馈，改 src/** 后首选）
node scripts/e2e.mjs --lane ui       # 仅 L2
node scripts/e2e.mjs --spec panel-flow   # 单个 spec（--spec= 同价）
node scripts/e2e.mjs --no-host       # 复用已在跑的宿主（绝不碰它的数据库）
node scripts/e2e.mjs --no-clean      # 跳过拉起前的 [E2E] 夹具清扫
```

环境变量：`YOLO_E2E_PORT`(默认 3080) · `YOLO_E2E_HOST` ·
`YOLO_E2E_PROBE_MS`(健康探测预算，默认 15000) ·
`YOLO_E2E_REPORT=<path>`(额外产出机器可读 JSON 报告)。

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
| 1 | `Yolo.resolve()` 每次调用都 `execSync git rev-parse`；一次 dashboard 请求触发 ~15 次 | 实测 15 次孵化 = 2985ms ≈ 端点延迟 | `perf(storage)` scope-key 按 TTL 记忆化（5s），一次请求 1 次孵化 |
| 2 | 每个 test 前后全量拉看板扫 `[E2E]` 行做清理（≥2 次完整 GET/用例 ×17） | cleanupPrefixed* 在 beforeEach/afterAll | `createFixtures` 按 id 追踪、O(创建数) 精准清理 |
| 3 | 健康探测超时 3s < 实际延迟 3s+，健康宿主被判死 → `--no-host` 报"没起来"、bring-up 报"not ready" | 4080 宿主 3117ms 响应 vs probe 3000ms | 探测超时提到 15s（`YOLO_E2E_PROBE_MS` 可调） |
| 4 | runner 生成的 patch 与 web profile 里 `dsh plugin add` 注册的同 id 行冲突 → **拉起必炸**(duplicate loader entry id: yolo) | 手动复现 boot stack | 标准 profile 捆绑路径不再打 patch；patch 只留给无标准安装的回退路径 |
| 5 | host-checkout 方式启动撞凭证格式差异(`.credentials.yaml version` 类型) → 启动即崩 | AGENTS.md 早有警告，本次实锤复现 | bring-up 改为**全局 dsh 优先**，checkout 构建降级为回退 |
| 6 | `child.kill()` 只杀 pnpm 外壳，node 孙进程变孤儿占端口 → 下次拉起 EADDRINUSE/ECONNREFUSED 漂移 | 4090 孤儿存活观察 | `killTree`（Windows `taskkill /T /F`） |
| 7 | 角标 30s 轮询节奏被测试硬等 ≤45s | reminder-badge 旧版 timeout 45s | 卡片先种后开页面：角标 mount 即拉取，断言即时确定 |
| 8 | `[E2E]` 夹具跨 run 累积膨胀载荷(57KB→清理后 6KB)、拖慢一切 | AGENTS.md 手工清理习惯 | runner 拉起前自动 DB 级清扫（只动 `[E2E]` 行）；`--no-clean` 可关 |
| 9 | 忙等 `sleep()` 自旋烧 CPU | e2e.mjs 旧 while 循环 | 真 `setTimeout` 异步休眠 |

效果（同机复测，改造后）：API 车道秒级、UI 车道分钟级；详见提交记录中的
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
node scripts/e2e.mjs --lane api

# 2) UI 准出（改了 client/**、src/ui/**、payload 形状后）
node scripts/e2e.mjs --lane ui

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

## 七、变更触发范围（何时必须跑哪条）

| 改动 | 必须 |
|---|---|
| `src/storage/**`, `src/shared/**`, `src/memory/**`, `src/extract/**`, `src/reminder/**` | L0 相关文件 + `--lane api` |
| `client/**`, `src/ui/**`, dashboard/actions payload 形状 | L0 + `--lane ui` + 真机 W1–W10（docs/testing.md 第八节） |
| `playwright.config.ts`, `tests/e2e/**`, `scripts/e2e.mjs` | 全套 E2E 自证 |
| 版本发布（UI 相关） | 全量 E2E + 真机走查 |
