# 测试文档

> 面向维护者的测试入口。测试数量与最近一次结果以命令输出为准；E2E 场景矩阵和运行细节见
> [testing-e2e.md](testing-e2e.md)。

## 一、常用命令

```bash
pnpm check                         # TypeScript 类型检查
pnpm test:run                      # 全部单元测试
pnpm test:run -- --coverage        # 单元测试与覆盖率
pnpm build                         # 构建宿主插件和浏览器客户端
node scripts/e2e.mjs               # API + UI E2E
node scripts/e2e.mjs --suite api   # 真实宿主 HTTP 接口
node scripts/e2e.mjs --suite ui    # 真实浏览器交互
node scripts/e2e.mjs --spec panel-flow
node scripts/todo-resolver-eval.mjs export <yolo.db> <samples.jsonl>
node scripts/todo-resolver-eval.mjs evaluate <labeled-samples.jsonl>
pnpm eval:todo-resolver -- tests/fixtures/todo-resolver-labeled-cases.jsonl output/todo-resolver-predictions.jsonl --report output/todo-resolver-report.json
```

单元测试只运行 `tests/**/*.test.ts`，不要求启动 dsh。E2E 使用真实 dsh 宿主、真实 SQLite 和系统安装的 Edge，默认串行执行。

## 二、测试分层

### 单元测试

- **纯函数**：筛选、文本处理、日期、质量护栏、看板投影和客户端状态模型。
- **内存 SQLite**：schema、存储动作、FTS、审计、提醒查询和跨工作区作用域。
- **插件接线**：用最小 `ctx` stub 捕获事件、工具、system prompt 和 HTTP 端点注册。
- **失败隔离**：模型、存储或单个工作区失败时不得拖垮会话或整个聚合看板。
- **架构契约**：静态 import graph、package/Cordis loader、durable catalog、single-owner observation 和 compatibility façade。

相关测试按模块命名，例如 `storage-*.test.ts`、`memory-*.test.ts`、`reminder-*.test.ts`、`ui-*.test.ts` 和 `shared-*.test.ts`。新增行为应放到最接近其事实源的测试文件；独立状态机可单独建文件。

### 架构与 package contract

Phase 0–4 的结构不是只靠文档约定，以下自动门禁是当前交付契约：

| 测试 | 证明内容 |
|---|---|
| `tests/architecture-dependencies.test.ts` | shared 不反向依赖 UI；extract/memory/reminder 不依赖 `ui/session`；client 只从 contracts 获取受控类型；legacy allowlist 为空且只能收紧 |
| `tests/package-loader-contract.test.ts` | package exports、Cordis patch rows、五插件 default/name/inject/apply、`yolo` 配置默认值、host/client build 与 schema/wrapper 资产 |
| `tests/workspace-catalog.test.ts` | catalog 重启恢复、幂等注册、损坏隔离、stale/invalid、marker-proven relocate 与 forget 不删数据 |
| `tests/turn-observation.test.ts` | 并发 session 隔离、late steering、turn 幂等、YOLO session 排除、状态上限与 provider 单 owner 接线 |
| `tests/storage-actions.test.ts`、`tests/ui-actions.test.ts` | 单 workspace transaction、`ScopeRef` 路由、state/event/evidence/idempotency 一致性与 HTTP compatibility |

静态门禁当前只冻结已迁移的高风险边界，不等于所有 application-to-infrastructure 依赖都已抽象成 ports。新增规则必须先独立表达目标，再决定是否有短期、逐文件、只能收紧的例外；不得自动学习当前 import 作为新基线。

### API E2E

API 套件通过真实宿主调用 `GET /yolo/dashboard`、`GET /yolo/badge`、`GET /yolo/notifications`、
`POST /yolo/notifications/seen`、`POST /yolo/actions` 等端点，验证持久化、作用域和载荷契约。修改
`src/**` 或共享 payload 后优先运行此层。

### UI E2E

UI 套件使用 Playwright 驱动真实 Edge，验证看板打开、捕获、筛选、事项处理、对话、主题、窄宽度和提醒交互。修改 `client/**`、设计 token 或 API payload 时必须运行相关 UI spec。

### 真机走查

自动化无法替代对真实宿主的视觉和会话检查。UI 变化还要执行第八节中受影响的 W1–W16 场景，并实际发送和接收至少一轮对话。

## 三、测试数据

- 自动化夹具统一带 `[E2E]` 唯一前缀，并由 `createFixtures` 按 id 精准清理。
- 测试对话使用真实用户措辞，例如“提醒我把演示稿发给研发”。不要使用“更新测试文档”“走查临时任务”之类只在测试语境出现的句子。
- runner 拉起独立宿主前会清理残留 `[E2E]` 数据；复用已有宿主时不主动清扫其数据库。
- SQLite 测试结束前先关闭数据库，再删除临时目录，避免 Windows 文件锁。

## 四、关键回归

改动相关模块时，至少覆盖以下不变量：

- FTS 查询含引号、运算符、路径或尖括号时不会让会话崩溃。
- loader 传入 `config: undefined` 时插件仍使用默认配置。
- 所有状态迁移写入审计事件；完成、取消和重新打开同步维护 FTS 状态。
- 模型工具、HTTP actions 和提取 updates 走同一领域动作。
- 同一来源 fingerprint 重放只能解析到同一规范事项，不能重复创建事项、证据或状态事件。
- 一个事项可关联多个会话证据；新增 mention/update evidence 不覆盖首条 origin，旧库回填可重复执行。
- `pending/in_progress/done/cancelled` 业务状态与 `canonical/merged/rejected` 记录状态分离；merged 副本
  不进入开放列表、提醒或普通 reopen，旧 id 仍能解析到规范事项。
- 标题去重只在 open canonical 候选中确定性选择，终态和 merged 不得误命中；同名不同 occurrence 尚未
  建模，作为[后续路线](roadmap-todo-identity.md)的明确已知边界。
- resolver 专用召回必须覆盖 open、terminal、merged alias 和 evidence 改写，同时保持普通 FTS/提醒边界；
  shadow 裁决只能写 `todo_resolution_log`，resolver 错误不能改变或阻断原抽取。
- shadow 人工样本按改写、指代、省略、跨会话、同名异项、终态和步骤分层；统计 false-link 与 missed-link，
  不能只报告总体准确率，也不能把没有 prediction 的 gold 样本计为模型错误。
- 长期 gold corpus 必须保持候选 shape、decision/target 基数和风险标签自检；人工构造但没有当前模型
  prediction 的样本只能验证 schema 与策略边界，不能授权打开 `todoIdentityR2Enabled`。
- 模型回放必须由官方 dsh 宿主内的 `ctx.llm` 使用当前 profile 路由执行；输入 gold 不得原地改写，输出不得
  包含 credential 或原始模型文本。报告必须锁定 provider/model/resolver/as-of，并同时给出分层、置信度、
  false-link、missed-link、高置信误授权和安全覆盖；准入的 false-link=0 只针对达到 0.98 的自动候选，
  低置信错误仍在总体质量指标中报告但不能假装成运行时放权。handcrafted engineering gate 即使通过，也必须由独立
  隔离真实对话留出集复核后才能评审默认开启 R2a。
- R2a 开启路径只允许唯一开放候选的高置信 LINK 或明确 due_at UPDATE；状态、priority/title/detail、终态、
  occurrence、step、多候选与多 mention 均应有 blocked 回归，application receipt 必须与 SQLite 实际结果一致。
- 每个聚合事项显式携带并保留自己的 `scope_cwd`；未知 scope 被拒绝。
- 工作区身份只取 canonical cwd；同一 cwd 的非 Git/main/feature 状态和 Windows 等价路径不得重复注册或拆库。
- 顶层“和助手聊聊”每次显式打开都是新的 ephemeral thread 且不显示 resident 历史；事项讨论按事项 episode 复用，旧请求或轮询结果不能覆盖新对话。
- 提醒首次载入只建立基线；新通知去重、非堆叠，并在超时后关闭。
- WorkspaceId 必须跨 catalog 重启和显式 relocate 保持稳定；cwd/scope key 不能冒充 opaque identity。
- catalog 与 workspace DB 不组成跨库事务；catalog 损坏或单 workspace 不可用必须可恢复/partial，不能污染其他 workspace。
- direct-human turn、latest cwd/text 与 snapshot cadence 只由 `ctx.yolo.observations` 更新；各插件不得恢复第二份运行状态。
- 旧 `shared/actions`、`ui/session`、`ui/config` 等 compatibility path 与新 owner 返回相同行为，且新代码不能增加旧边界依赖。

## 五、E2E 运行约定

```bash
node scripts/e2e.mjs --suite api
node scripts/e2e.mjs --suite ui
node scripts/e2e.mjs --spec <spec-name>
```

- runner 优先使用官方 dsh CLI，并为自有宿主选择隔离端口和数据目录。
- UI 套件默认使用 `channel: msedge`、中文环境、`workers: 1`。
- 不通过放大超时掩盖竞态；先检查首屏载荷、宿主日志和持久状态。
- 断言尽量落在持久页面状态，而不是短暂 toast。
- 完整的场景清单、环境变量和失败归因见 [testing-e2e.md](testing-e2e.md)。

## 六、新增测试

1. 选择离事实源最近的层：纯逻辑用单测，端点和持久化用 API E2E，宿主交互和布局用 UI E2E。
2. 构造最小输入，覆盖正常路径、边界、重复请求和失败恢复。
3. 使用真实措辞和可精准清理的夹具。
4. 跨模块改动先为 owner、scope、事务、read model、失败模式和 compatibility path 写测试，再运行对应测试、`pnpm check` 与 `pnpm test:run`。
5. 若改动 UI 或 payload，继续运行相关 E2E 和第八节真机走查。

## 七、覆盖率

```bash
pnpm test:run -- --coverage
```

覆盖率用于发现缺少的分支，不以历史百分比作为当前承诺。报告只统计 `src/**` 与 `client/**`；重点关注领域动作、失败隔离、作用域和提醒状态机。

## 八、真机端到端验证

### 触发范围

以下变更必须走受影响的 W1–W16 场景：

- `client/**` 中的组件、样式、动效或状态管理；
- `client/design/**` 或主题判定；
- `src/ui/**`，以及 dashboard、badge、actions 或 session payload；
- UI 相关版本进入发布前。

仅修改不影响载荷的存储、提取或提醒内部逻辑时，可以由类型检查、架构/单元测试和相关 API E2E 覆盖。若修改 catalog、ScopeRef、observation、conversation runtime 或 package loader，即使 UI 不变，也必须使用隔离 `DSH_HOME` 验证真实宿主重启、插件装载和数据恢复。

### 启动

```bash
pnpm build
npx @deepseek-ai/dsh web --no-open --port 4080
```

打开 <http://127.0.0.1:4080>，选择工作区，再点击侧边栏底部的 YOLO 入口。

### W1–W16

| # | 场景 | 通过标准 |
|---|---|---|
| W1 | 打开首页与恢复 | 骨架后完整渲染，无控制台错误；关闭和再次打开恢复上次有效页面、事项与前景位置，失效恢复目标安全降级到首页 |
| W2 | 页面导航与计划筛选 | 首页、计划、历史三入口，计划内“今天 / 接下来 / 目标 / 全部”和历史内“按时间 / 按事项”一致；标准 Tab 键盘导航、计数、空态和跨页去重正确；没有“进展”或“Agent 任务”一级入口 |
| W3 | 事项处理 | 首页、计划和历史中的完成、推迟、再提醒、编辑、取消与重新打开可用；数据管理按日期预览并区分可恢复批量取消和强确认永久删除；变化同步到所有投影，服务端撤销恢复原值 |
| W4 | 快速记录 | 首页快速记录回车只新增一次并默认今天到期；中文输入法组合态不会误提交 |
| W5 | 对话、详情与来源前景 | “和助手聊聊”与“讨论这项安排”隔离；对话、事项详情和来源预览任一时刻只存在一个前景；发送、回复、返回、Esc、草稿和滚动层级正确 |
| W6 | 主题与动效 | 首页、计划、历史和上下文区在深浅主题下无残留，文字、边框和强调色可读；高压状态不只依赖颜色，reduced-motion 生效 |
| W7 | 宿主原生响应式 | 340px、`<480px`、标准宽度和双栏阈值两侧核心操作可用，无横向滚动或遮挡；宽度由宿主侧栏右侧可用容器决定；resize 只改变呈现，不改变页面、线程、请求、草稿、滚动或焦点 |
| W8 | 历史变化与来源 | 时间线只展示用户可理解的变化并排除操作型审计噪声；按事项使用稳定 scope/type/id 聚合，改名不断链、同名不合并、旧事件不猜测；首页、计划、历史和详情中的来源行为一致，manual/tool/legacy 证据明确降级 |
| W9 | 宿主会话切换与来源往返 | 面板打开时切换普通会话会自动收起；打开来源成功后收起 YOLO，重新打开后恢复原页面、事项和来源预览；导航失败时不先关闭且提供可恢复反馈 |
| W10 | 助手对话与事项讨论隔离 | 每次显式打开“和助手聊聊”生成新的空历史 ephemeral thread，绝不读取内部 resident；事项 A/B episode 互不泄漏，返回只隐藏事项前景，显式结束才释放讨论；慢回复、重挂载和响应式切换不重复 POST 或串写线程 |
| W11 | 首页准入与首要关注 | 首页最多突出一个首要事项；普通积压不为填空进入首页；判断、提醒、关注与今日事项按 `(scope,id)` 去重，高压其余事项保持可达 |
| W12 | 服务端回执 | 处理后只展示服务端实际返回的变化和作用范围；通知已读不等于提醒已处理，提醒 handled 不等于事项完成，撤销恢复原值 |
| W13 | 跨工作区与失败隔离 | `single / all / partial / all-fail / recovery` 均符合契约；同 id 跨 scope 不误合并，动作和来源始终使用原 `scope_cwd`；可用内容继续操作且 partial 只提示一次 |
| W14 | 提醒与可访问性 | 新通知显示右下角非模态提示，历史通知不补弹、多条不堆叠；首页按事项聚合，badge 精确表示未读投递，通知记录完整分页且不复制事项动作；前景不被新通知抢占，所有按钮、焦点陷阱、焦点返回和 live region 可用 |
| W15 | 终态与记录状态边界 | 已完成和已取消严格分开且可重新打开；merged 副本不伪装成取消、不进入开放/终态业务集合且不能普通 reopen；规范事项仍保留可审计的合并轨迹 |
| W16 | 判断、来源与历史可审计 | 界面原因、来源摘录、关联会话和最近变化均来自 payload；同一 fingerprint、原会话、SQLite evidence、dashboard 与事件审计一致，客户端不生成不存在的推断 |

### 通过与记录

- 受影响场景全部 PASS 后才能提交；失败修复后重走对应场景。
- 无法验证的场景标记 `SKIP` 并写明环境原因，不能默认视为通过。
- 结果写入提交说明；用户可感知变化同步更新 CHANGELOG 和相应产品文档。
