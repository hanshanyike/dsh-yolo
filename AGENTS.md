# AGENTS.md — WorkBuddy (dsh-yolo)

运行约定与工程约束，供 agent 与协作者在本仓库内工作时遵循。

> 一句话：**说一遍，它帮你把这件事沿着轨道稳稳推进。**（Say it once. Keep it on track.）
>
> 规划与排期的**单一事实源**是 [`docs/roadmap-ux-priorities.md`](docs/roadmap-ux-priorities.md)
> 与 [`docs/development-plan.md`](docs/development-plan.md)（当前批）。本文件只讲"怎么干活"，不讲"做什么、为什么"。

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
node scripts/clean-test-data.mjs   # 开发前清理 [E2E] 测试夹具（防脏数据拖慢 E2E）
pnpm dsh plugin add . --profile web   # 一次性：把插件链接进 dsh web profile（标准 dsh 方式）
pnpm dsh web --no-open --port 4080    # 启动宿主（标准 dsh；`web` 已隐含 --profile web，默认端口 3080，本机被占故用 4080）
node scripts/e2e.mjs    # E2E：保证 host 起来后跑 Playwright 全套
node scripts/e2e.mjs --spec panel   # 只跑某个 spec（tests/e2e/<spec>.spec.ts）
```

> **启动与宿主保持一致**：用**已安装的 `dsh`**（全局 CLI）执行 `dsh plugin add . --profile web` + `dsh web`，
> 不要自建 `dev.mjs` / 本地 host checkout（那会因本地 checkout 的宿主凭证格式与全局不一致而要求扁平化凭证）。
> 开发时用 `--port 4080`（3080 被本机宿主占用），默认端口 3080。
> **开发前先跑 `node scripts/clean-test-data.mjs`**，清掉上一轮 E2E 留下的 `[E2E]` 夹具，避免看板载荷膨胀拖慢测试。

## 记忆 / 提醒 / 看板的核心机制

- **记忆抽取**：每轮对话结束时用 **LLM 语义抽取**（不是正则）写入，带去重与节流。
- **动作统一**：看板上每个操作（完成/推迟/取消/撤销/新增/改筛选…）都走
  `POST /yolo/actions` → `applyYoloAction`，与模型工具 `yolo_action` 同一条路径，
  保证状态迁移 + 审计事件一致。
- **看板数据**：`GET /yolo/dashboard` 始终**聚合所有已知工作区**（v0.3.3，不再区分工作区）。
  打开时加载一次，动作与手动刷新才重新拉取（**打开时不 30s 轮询**）；侧栏角标独立轻量轮询（关闭时也能更新）。
- **提醒**：调度器按 `checkIntervalSec` 产生**通知卡**（未处理角标 + 看板卡），并投递到
  **YOLO 常驻线程**（`ctx.yolo` 的 resident thread），**绝不注入/打扰工作会话**（红线 D7/TB-1）。
  `完成` toast 带 4 秒「撤销」窗口（服务端 `reopen` 领域动作）；提醒正文只给用户可读文本，
  agent 处理规则放 system 段（`memory/recall.ts` 的 yolo-instructions）。
- **动作归属**：聚合看板上的每一行都带其所在工作区（`ws.cwd`）；`POST /yolo/actions` 按该行
  `scope_cwd` 路由到对应工作区，因此跨工作区行也能操作（不再是只读）。

> 产品红线：**管理而非代办；绝不打扰工作会话；本地优先；类型安全 + 真机验证。**

## 测试（重要）

- **单测**：`tests/**/*.test.ts`，`pnpm test:run`。用内存 SQLite 等隔离手段，**不依赖 host**。
- **E2E**：`tests/e2e/*.spec.ts`，Playwright + **真实宿主**。运行 `node scripts/e2e.mjs`。
  - 通过 HTTP 接口 + 真实浏览器驱动；夹具数据统一带 `[E2E]` 前缀并在 `afterAll` 清理（幂等）。
  - 配置见 `playwright.config.ts`（缺省 `msedge`、中文、`workers:1`）。
- **用语真实（回归约束）**：测试里的对话/提醒夹具必须用**贴合真实场景的用户句子**
  （例如「提醒我把演示稿发给研发」），**禁止**“更新测试文档”“提醒处理”“走查临时任务-勿删”
  这类只在测试语境才会出现的自指性措辞。机器夹具（`[E2E]` 前缀）除外。
- **真机端到端验证（W1–W8）**：UI 变更、设计系统、API payload 改动，提交/发布前必须在真机
  浏览器走一遍 W1–W8 清单（见 `docs/testing.md` 第七节）。触发范围与通过/SKIP 规则照此执行。
- UI 变更在提交与发布的准入条件里**必须通过 W1–W8**，且修改 `client/**`、设计系统、API payload
  都会触发该验证。


## 提交前检查清单

1. `pnpm check` 通过。
2. `pnpm test:run` 全部通过。
3. 改动了 `src/**` 或 `client/**` 的：
   - 单测同步更新；
   - E2E / W1–W8 按触发范围执行。
4. 夹具措辞符合「用语真实」约束。
5. UI 变更按 `docs/testing.md` W1–W8 清单通过。
6. 功能更动若有"用户可感知"变化 → 同步 `docs/development-plan.md`（或 roadmap），避免计划过期。

## 文档索引

- **规划 / 排期（单一事实源）**：`docs/roadmap-ux-priorities.md` · `docs/development-plan.md`
- **愿景**：`docs/VISION.md`（四阶段：Keeper → Organizer → Manager → Companion）
- **产品定义**：`docs/product-design.md`（面板 1.0）· `docs/product-design.html`（可点击原型）
- **设计**：`docs/design-m8-organizer.md`（M8 · 已交付）· `docs/design-m9-recall-quality.md`（M9）·
  `docs/frontend-redesign.md` / `docs/frontend-redesign-v1-trackhall.md`（Mono 设计系统）
- **调研 / 参考**：`docs/research/`（00–18 · 18 为借鉴落地结论，作为"得数"入口；其余为逐库素材）
- **架构**：`docs/architecture/overview.md`（数据流、决策、扩展点）· `docs/architecture/modules.md`（逐模块代码地图，改代码前先查）
- **测试**：`docs/testing.md`（含真机 W1–W8 清单）
- **发布**：`docs/release.md` · `CHANGELOG.md`
- **使用**：`docs/usage.md`
- **真机反馈**：`docs/uiux-real-review.md`（交互/UI 真实体验评审，P0/P1 已修复）
- **入口**：`README.md` · `docs/README.md`（文档地图）
- **schema 事实源**：`src/storage/schema.sql`
