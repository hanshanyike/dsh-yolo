# AGENTS.md — WorkBuddy (dsh-yolo)

运行约定与工程约束，供 agent 与协作者在本仓库内工作时遵循。愿景与路线图见
[`docs/VISION.md`](docs/VISION.md)；设计、架构、测试、发布细节见 `docs/`。

## 这个项目是什么

一个「Jarvis 式的个人 AI 助手」，核心主张是**管理而非代办**：它不帮你执行，
而是记住你说过的话，并在合适的时刻提醒、把计划沿着轨道稳稳推进。
一句 slogan：**“Say it once. Keep it on track.”（说一遍，它帮你把这件事沿着轨道稳稳推进）**。

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
- Windows 优先；涉及文件权限时启动前做 ACL 预检（`node scripts/dev.mjs --fix-acl`）。

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
node scripts/dev.mjs    # 本地拉起 dev host 到 :4080
node scripts/e2e.mjs    # E2E：保证 host 起来后跑 Playwright 全套
node scripts/e2e.mjs --spec panel   # 只跑某个 spec
```

## 记忆 / 提醒 / 看板的核心机制

- **记忆抽取**：每轮对话结束时用 **LLM 语义抽取**（不是正则）写入，带去重与节流。
- **动作统一**：看板上每个操作（完成/推迟/取消/撤销/新增/改筛选…）都走
  `POST /yolo/actions` → `applyYoloAction`，与模型工具 `yolo_action` 同一条路径，
  保证状态迁移 + 审计事件一致。
- **看板数据**：`GET /yolo/dashboard`，打开时每 30s 轮询；侧栏角标独立轻量轮询。
- **提醒**：调度器按 `checkIntervalSec` 产生通知卡（未处理角标 + 看板卡），
  **绝不打扰工作会话**；`完成` toast 带 4 秒「撤销」窗口（服务端 `reopen` 领域动作）。

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

## 文档索引

- `docs/VISION.md` — 愿景、根问题、原则、四阶段路线（Keeper → Organizer → Manager → Companion）。
- `docs/architecture.md` — 架构、数据流、决策表、扩展点。
- `docs/testing.md` — 测试体系，含真机端到端验证 W1–W8。
- `docs/frontend-redesign.md` — Mono 设计系统规范。
- `README.md` — 定位、slogan、愿景驱动的路线图。
- `CHANGELOG.md` — 版本变更记录。