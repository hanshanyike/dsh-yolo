# AGENTS.md — WorkBuddy (dsh-yolo)

运行约定与工程约束，供 agent 与协作者在本仓库内工作时遵循。

> 一句话：**从对话中整理计划，在合适的时候提醒，并持续跟进。**
>
> 当前实现与工程契约以 [`docs/architecture/`](docs/architecture/) 和
> [`docs/testing.md`](docs/testing.md) 为事实源；长期产品边界见 [`docs/VISION.md`](docs/VISION.md)，
> 已交付变化见 [`CHANGELOG.md`](CHANGELOG.md)。阶段计划、评审稿和交互原型不作为远端长期文档维护。

## 这个项目是什么

一个「Jarvis 式的个人 AI 助手」，核心主张是**管理而非代办**：它不帮你执行，
而是记住你说过的话，并在合适的时刻提醒、把计划沿着轨道稳稳推进。

仓库里的 `YOLO` 是内部代号（模块名 / 包名 / `ctx.yolo` 等大量标识符依赖它，
**不要重命名**）。产品文案统一用「管理工作与生活的助手」「助手看板」，**不用**
「记忆助手」「记忆看板」。

## 技术栈与约定

- TypeScript（`moduleResolution: node16`，**相对导入必须带 `.ts` 扩展名**）。
- 运行在 dsh（deepseek-harness）宿主生态：`@deepseek-ai/cordis` 插件、`dsh-settings` 配置、
  `dsh-llm`（模型运行时）、`dsh` UI 插件。
- 存储：SQLite。UI：React + 自研 `Mono` 设计系统（见下）。
- 配置用 `schemastery` schema；**插件 `apply()` 里必须 `Config(config ?? {})` 归一化默认值**，
  防止加载器传 `undefined` 时空指针（历史事故：`reading 'enabled'`）。
- Windows 优先；涉及文件权限时用管理员预处理工作区 ACL（见 `docs/architecture/overview.md`）。

### 设计系统（Mono）

现代、克制的高级感：单色系（≤4 色：中性色 + 单一 indigo）、排版驱动层级、
发丝线结构、动效 ≤200ms。**拒绝**过度的隐喻装饰。主看板是 YOLO 助手看板（侧栏常驻，
跨会话），对话是同一面板里可展开/收起的一种表面（侧边 340px ↔ 全屏）。

## 常用命令

```bash
pnpm install            # 安装依赖
pnpm check              # tsc --noEmit 类型检查（改代码后必跑）
pnpm test:run           # vitest 单测（不依赖 host）
pnpm build              # 产物到 dist/（host 从 dist 加载插件）
node scripts/clean-test-data.mjs   # 手动清理 [E2E] 测试夹具（e2e runner 拉起宿主前会自动做）
npx @deepseek-ai/dsh plugin --profile web add .   # 一次性：把插件链接进 dsh web profile
pnpm dsh web --no-open --port 4080    # 启动宿主（标准 dsh；`web` 已隐含 --profile web，默认端口 3080，本机被占故用 4080）
node scripts/e2e.mjs                 # E2E：拉起/复用宿主后跑全套（当前 66 用例，约 5 分钟）
node scripts/e2e.mjs --suite api     # 仅 api 套件（HTTP 接口测试，无浏览器，秒级反馈；改 src/** 后首选）
node scripts/e2e.mjs --suite ui      # 仅 ui 套件（浏览器端到端测试）
node scripts/e2e.mjs --spec panel-flow   # 只跑某个 spec（tests/e2e/ui|api/<spec>.spec.ts）
```

> **启动与宿主保持一致**：用官方 CLI 执行 `dsh plugin --profile web add .` + `dsh web`，
> 不要自建 `dev.mjs` / 本地 host checkout（那会因本地 checkout 的宿主凭证格式与全局不一致而要求扁平化凭证，
> e2e runner 的 bring-up 同样遵循此约定：全局 dsh 优先）。
> 开发时用 `--port 4080`（3080 被本机宿主占用），默认端口 3080。
> **[E2E] 夹具清理已自动化**：runner 拉起自己的宿主前会 DB 级清扫 `[E2E]` 行；
> 只有复用已有宿主（`--no-host`）时才需要手动跑 `clean-test-data.mjs`。
> E2E 场景矩阵、套件划分、慢因根因记录见 **docs/testing-e2e.md**。

## 记忆 / 提醒 / 看板的核心机制

- **记忆抽取**：`agent/pre-step` 捕获本轮直接用户输入，`turn-stopping` 只排队；待 durable
  `turn/end` 与 agent 空闲后，由独立后台任务执行 **LLM 语义抽取**（不是正则），不依赖主 agent 主动写入。
- **动作统一**：看板上每个操作（完成/推迟/取消/撤销/新增/改筛选…）都走
  `POST /yolo/actions` → `applyYoloAction`，与模型工具 `yolo_action` 同一条路径，
  保证状态迁移 + 审计事件一致。
- **看板数据**：`GET /yolo/dashboard` 始终**聚合所有已知工作区**（不在看板中切换工作区）。
  打开时加载一次，动作与手动刷新才重新拉取（**打开时不 30s 轮询**）；侧栏角标独立轻量轮询（关闭时也能更新）。
- **提醒**：调度器按 `checkIntervalSec` 产生**通知卡**（未处理角标 + 看板卡），并投递到
  **YOLO 常驻线程**（`ctx.yolo` 的 resident thread），**绝不注入或打扰工作会话**。
  页面加载后新到达的提醒还会显示一个右下角非模态提示：10 秒自动消失、点击打开看板、
  历史提醒不补弹、多条不堆叠。
  `完成` toast 带 4 秒「撤销」窗口（服务端 `reopen` 领域动作）；提醒正文只给用户可读文本，
  agent 处理规则放 system 段（`memory/recall.ts` 的 yolo-instructions）。
- **动作归属**：聚合看板上的每一行都带其所在工作区（`ws.cwd`）；`POST /yolo/actions` 按该行
  `scope_cwd` 路由到对应工作区，因此跨工作区行也能操作（不再是只读）。

> 产品红线：**管理而非代办；绝不打扰工作会话；本地优先；类型安全 + 真机验证。**

## 测试（重要）

- **单测**：`tests/**/*.test.ts`，`pnpm test:run`。用内存 SQLite 等隔离手段，**不依赖 host**。
- **E2E**：`tests/e2e/{api,ui}/*.spec.ts`，Playwright + **真实宿主**，按测试分层拆成
  **api（HTTP 接口测试，无浏览器）/ ui（真实 Edge 浏览器端到端）** 两个套件。
  运行 `node scripts/e2e.mjs`（全套 ~1 分钟）；`--suite api|ui` 选套件、`--spec <名>` 选单个用例文件。
  - 通过 HTTP 接口 + 真实浏览器驱动；夹具统一带 `[E2E]` 唯一前缀，经 `createFixtures` 按 id 在 afterEach 精准清理（幂等）。
  - 配置见 `playwright.config.ts`（缺省 `msedge`、中文、`workers:1`）。
  - 场景矩阵 / 根因记录 / agent 手册：**docs/testing-e2e.md**。
- **用语真实（回归约束）**：测试里的对话/提醒夹具必须用**贴合真实场景的用户句子**
  （例如「提醒我把演示稿发给研发」），**禁止**“更新测试文档”“提醒处理”“走查临时任务-勿删”
  这类只在测试语境才会出现的自指性措辞。机器夹具（`[E2E]` 前缀）除外。
- **真机端到端验证（W1–W16）**：UI 变更、设计系统、API payload 改动，提交/发布前必须在真机
  浏览器走一遍 W1–W16 清单（见 `docs/testing.md` 第八节）。触发范围与通过/SKIP 规则照此执行。
- UI 变更在提交与发布的准入条件里**必须通过受影响的 W1–W16 场景**，且修改 `client/**`、设计系统、API payload
  都会触发该验证。


## 提交前检查清单

1. `pnpm check` 通过。
2. `pnpm test:run` 全部通过。
3. 改动了 `src/**` 或 `client/**` 的：
   - 单测同步更新；
   - E2E / W1–W16 按触发范围执行。
4. 夹具措辞符合「用语真实」约束。
5. UI 变更按 `docs/testing.md` W1–W16 清单通过。
6. 用户可感知变化同步 `README.md` / `docs/usage.md`；架构或契约变化同步对应
   `docs/architecture/*.md` / `docs/testing*.md`，并在发布时写入 `CHANGELOG.md`。

## 文档索引

- **愿景**：`docs/VISION.md`（四阶段：Keeper → Organizer → Manager → Companion）
- **调研 / 参考**：`docs/research/`（00–18 · 18 为借鉴落地结论，作为"得数"入口；其余为逐库素材）
- **架构**：`docs/architecture/overview.md`（跨模块数据流与决策）· `docs/architecture/modules.md`（按模块拆分的中文架构索引，改代码前先查）
- **测试**：`docs/testing.md`（含真机 W1–W16 清单）· `docs/testing-e2e.md`
- **发布**：`docs/release.md` · `CHANGELOG.md`
- **使用**：`docs/usage.md`
- **入口**：`README.md` · `docs/README.md`（文档地图）
- **schema 事实源**：`src/storage/schema.sql`
