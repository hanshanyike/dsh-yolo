# 测试文档（Testing Guide）

> 面向开发者的测试体系说明：如何运行、每个测试文件测什么、测试手法、如何新增测试。
> 当前状态：**16 个测试文件 / 114 个用例全部通过**，`tsc --noEmit` clean。

---

## 目录

1. [如何运行](#一如何运行)
2. [测试配置](#二测试配置)
3. [测试文件清单](#三测试文件清单)
4. [测试手法与模式](#四测试手法与模式)
5. [如何新增测试](#五如何新增测试)
6. [覆盖率](#六覆盖率)

---

## 一、如何运行

```bash
pnpm check       # tsc --noEmit（类型检查，改代码后必跑）
pnpm test        # vitest 监听模式（开发时用）
pnpm test:run    # vitest 跑一遍并退出（CI / 提交前用）
pnpm test:run -- --coverage   # 带覆盖率报告（输出到 ./coverage/）
```

> 测试只跑 `tests/**/*.test.ts`，**不依赖 host**（无需 `dev.mjs` 启动）。
> 依赖已全部来自 npm registry，一条 `pnpm install` 即可跑测试。

---

## 二、测试配置

`vitest.config.ts` 关键点：

- **include**：`tests/**/*.test.ts`（只跑 YOLO 自己的测试）。
- **exclude**：`host/**`、`node_modules/**`、`dist/**` —— **必须排除 `host/deepseek-harness/**`**：
  dev host 里带 200+ spec 文件，在 Windows 上会挂起导致"空输出/任务被杀"。
- **pool**：`forks` + `singleFork: true`（Windows 上比 worker threads 稳定）。
- **coverage**：provider `v8`；只统计 `src/**` 与 `client/**`（绝不把 dev host 计入）；
  reporter `text` + `text-summary`；输出目录 `./coverage`。

---

## 三、测试文件清单

| 测试文件 | 用例数 | 测什么 |
|---|---|---|
| `storage.test.ts` | 23 | 存储层纯函数：建表、去重、状态流转、FTS 搜索与软删、快照渲染、待提醒、抽取日志（用**内存 SQLite**） |
| `extract-index.test.ts` | 9 | extract 插件接线：turn 结束抽取、节流、配置开关、去重摘要、失败隔离 |
| `memory-tools.test.ts` | 9 | 4 个模型可见工具的 `execute()`：读写各类记忆、搜索、软删、状态流转、快照、待提醒 |
| `memory-index.test.ts` | 8 | memory 插件接线：注册工具与 prompt、跟踪最新用户消息、FTS5 语法字符回归 |
| `reminder.test.ts` | 8 | 提醒逻辑：到期文本、注入/排队、每日快照、N 轮快照 |
| `extract-llm.test.ts` | 8 | LLM 提取核心：JSON 解析容错、stream 折叠、畸形条目处理 |
| `scope.test.ts` | 8 | 作用域解析：scope key、数据目录、DB 文件名、git 分支回退 |
| `shared-text.test.ts` | 8 | 文本工具：内容块拼接、标题归一化、本地日期 |
| `extract-prompt.test.ts` | 6 | 提取提示词：日期内嵌、JSON-only 约束、scheduled commitments 分类、去重摘要上限 |
| `memory-recall.test.ts` | 5 | 动态召回：section/context 注册、偏好渲染、FTS 命中渲染 |
| `ui-index.test.ts` | 5 | ui 插件接线：`config: undefined` 回归、端点注册、scope 跟随最近会话 |
| `ui-dashboard.test.ts` | 4 | 看板投影：五类数据投影、JSON 序列化、端点 200/500 |
| `reminder-index.test.ts` | 4 | reminder 插件接线：session-start 回放、turn 快照触发 |
| `shared-dashboard.test.ts` | 4 | 看板载荷：行投影形状、todoSummary、空载荷往返 |
| `ui-config.test.ts` | 3 | 配置 schema：默认值、覆盖、越界校验 |
| `reminder-scheduler.test.ts` | 2 | 调度器生命周期：间隔 tick、失败隔离、cleanup |
| **合计** | **114** | |

> `tests/fixtures/` 目前是空目录（保留给未来的测试夹具）。

---

## 四、测试手法与模式

### 三类被测对象

1. **纯函数单测**（无 SQLite）：`extract-prompt`、`extract-llm`、`shared-*`、`scope`、`ui-config`。
   直接构造输入调用导出函数，断言输出。

2. **真实 `Yolo` 服务 + 临时目录**：`extract-index`、`memory-index`、`memory-tools`。
   ```ts
   import { mkdtempSync } from 'node:fs'
   const dir = mkdtempSync(join(tmpdir(), 'yolo-test-'))
   vi.spyOn(process, 'cwd').mockReturnValue(dir)
   // beforeEach 建目录、afterEach 删目录（Windows 上先 close() DB 再删，避免 EBUSY）
   ```

3. **存储层用真实内存 SQLite**：`storage.test.ts` 用 `openDb(':memory:')` 直接测
   repository/search/snapshot 纯函数，不依赖 Cordis host。

### context 构造（不依赖真实 host）

手写 ctx stub：

```ts
// on() 用 Map 捕获 handler，测试里手动触发
const handlers = new Map<string, Function>()
const ctx = { on: (ev, fn) => { handlers.set(ev, fn) }, ... }
// 触发：await handlers.get('agent/turn-stopping')!({ agent, turn: 1 })
```

- `tools.register` / `systemPrompt.section/context` → 捕获注册项到数组再断言。
- `settings.get` / `webServer.register` / `inject` → `vi.fn()`。
- LLM：mock `LlmRuntime.stream` 返回生成器构造的 `AsyncIterable<StreamChunk>`。

### 时间控制

- `vi.useFakeTimers()` + `advanceTimersByTimeAsync`（scheduler 测试）。
- `vi.spyOn(Date, 'now')` 拨快时间（节流测试）。

### 重点回归（改这些地方务必跑对应测试）

- **FTS5 语法字符**：`<div>`、`a<b`、引号、`AND OR NOT`、`C:\Users\x*y` 等不能崩 turn
  （`memory-index`、`storage` 的 `it.each`）。
- **`config: undefined`**：loader 不传 config 时 `apply(ctx, undefined)` 不抛（`ui-index`）。
- **失败隔离**：模型/存储抛错时 handler 不向 agent 循环抛（`extract-index`、`reminder-index`、`reminder-scheduler`）。

---

## 五、如何新增测试

1. **放对位置**：新测试放 `tests/<模块>-<功能>.test.ts`，命名与现有文件一致
   （如 `extract-*`、`memory-*`、`reminder-*`、`ui-*`、`shared-*`、`storage`、`scope`）。
2. **选对手法**：
   - 纯函数 → 直接调用断言；
   - 涉及存储 → 真实 `Yolo` + 临时目录，或 `openDb(':memory:')`；
   - 涉及插件接线 → 手写 ctx stub 捕获 handler。
3. **覆盖回归**：如果改动涉及 FTS5 语法字符、config 归一化、失败隔离，务必补对应回归用例。
4. **验证**：`pnpm check && pnpm test:run` 全绿；如改动了 README 里的测试徽章数字，同步更新。

---

## 六、覆盖率

```bash
pnpm test:run -- --coverage
```

- 只统计 `src/**` 与 `client/**`（dev host 不计入）。
- 历史基线（M4b 时）：Statements 82.24% / Branches 80.5% / Functions 84.09%。
- CI（`.github/workflows/ci.yml`）在 Linux 与 Windows 上跑 typecheck + tests + build，
  并上传覆盖率报告产物。
