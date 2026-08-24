# 运行、装配与平台约束

## 职责

本文只记录包入口、插件 bundle、构建脚本和经真实宿主确认的平台约束。模块内部实现分别见
[模块索引](modules.md)，测试流程见 `docs/testing.md` 与 `docs/testing-e2e.md`。

## Bundle 装配

YOLO 是 5 个宿主插件加 1 个浏览器 bundle：

| entry | 作用 |
|---|---|
| `src/index.ts` / `dsh-plugin-yolo` | 包身份与加载标记，同时让 client registry 找到包根 manifest |
| `dist/src/storage` | `ctx.yolo` 服务 |
| `dist/src/memory` | 模型工具与 prompt context |
| `dist/src/extract` | turn-end 语义提取 |
| `dist/src/reminder` | 提醒、简报与快照调度 |
| `dist/src/ui` | 设置与看板 API |
| `exports['./client']` | 浏览器 bundle |

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。patch 第一行必须保留裸包 entry，
其余子路径分别装载宿主插件。宿主插件模块必须 default-export 可应用的插件；只有 named export
会让 loader 收到 module namespace 并报 `invalid plugin`。

## 构建脚本

`pnpm build` 依次执行：

1. `tsdown` 构建宿主 ESM，`@deepseek-ai/*` 保持 external，由宿主提供；
2. client 配置构建浏览器 CJS；
3. `wrap-client.mjs` 注入 ModuleLoader wrapper 与 `process` shim；
4. `copy-assets.mjs` 把 `src/storage/schema.sql` 复制到运行时 dist 位置。

| 脚本 | 作用 |
|---|---|
| `scripts/e2e.mjs` | 使用已安装的 dsh 拉起/复用真实宿主，支持 api/ui/spec 分层 |
| `scripts/clean-test-data.mjs` | 手工清理已有宿主中的 `[E2E]` 夹具 |
| `scripts/wrap-client.mjs` | 包装浏览器 bundle |
| `scripts/copy-assets.mjs` | 复制 schema 运行时资源 |

标准本地路径是先执行 `dsh plugin --profile web add .`，再执行
`pnpm dsh web --no-open --port 4080`。不要为本项目另造 host checkout 或 dev launcher；本机开发
端口 3080 已被其他宿主占用时使用 4080。

## 已确认的宿主约束

### 插件与生命周期

- 插件 entry 在 Windows 下由宿主解析为 URL；不要手工拼裸 `D:/...` ESM specifier。
- 模块级 `inject` 会被 loader 采用，patch row 无需重复声明。
- `ctx.effect(() => start())` 使用 `start()` 返回值作为卸载清理函数。
- 宿主终端不保证显示 `ctx.logger.info`，启动标记需要可观察时才使用项目现有的双重日志方式。

### LLM 与 prompt

- `ctx.llm.stream()` 返回 `AsyncIterable<StreamChunk>`，使用 `BlockAssembler` 收集内容块。
- `GenerateOptions.purpose` 是闭合联合 `compaction | session-title`，辅助流量使用后者。
- `AssembleContext` 没有最新 user message；memory 插件通过 `session/event` 自行缓存。
- system prompt name 不能重复；YOLO 当前顺序为 instructions 110、preferences 120、recall 220。

### Session 与 agent

- `agent/turn-stopping` 从 `agent.session` 取得 Session，并通过 `session.header.cwd` 定位工作区。
- `session/event` 的消息正文是 ContentBlock 数组。
- `Agent.followup` 接收带 `source` 的 `UserMessage`；`createUserMessage` 不能省略 source。
- 程序化创建 resident/anchored agent 时必须安装宿主 model selection。
- 提醒只进入 YOLO resident thread；旧的“在下一个工作 session 启动时回放”路径已经删除。

### Settings 与浏览器 bundle

- Settings host 半边使用 `installSettingsSection`，`settingsNamespace('yolo')` 是 host/client join key。
- schemastery 当前写法是显式接口加 `z<Config>`；不要假定有 `z.infer`、`z.literal` 或 `z.union`。
- client registry 需要裸包 entry、对象形态 `dsh.client`、CJS ModuleLoader wrapper 和 process shim；
  详见 [浏览器客户端构建契约](client.md#bundle-构建契约)。

### SQLite 与 Windows

- 存储使用 Node.js 内置的 `node:sqlite`；受支持的 Node 22/24 运行时均提供 FTS5 trigram。
- pnpm workspace 只需允许开发工具 `esbuild` 的构建脚本，并保持当前 hoisted 配置。
- SQLite 迁移不能使用 `ADD COLUMN IF NOT EXISTS`。
- Windows 工作区若无 `WRITE_DAC`，dsh 可能在 ACL grant 阶段失败；按项目约定以管理员预处理
  ACL，或把工作区放在当前用户拥有的目录。
- pnpm 的 trash/safe-delete 在 Git Bash 下可能失败，项目命令使用 PowerShell。

## 故障排查

| 症状 | 检查项 |
|---|---|
| `EADDRINUSE` | 用 PowerShell 检查并停止占用目标端口的残留 dsh 进程，或改用 4080 |
| `frontend dist not built` | 先完成宿主要求的构建，再启动 `dsh web` |
| `No such built-in module: node:sqlite` | 升级到 Node.js 22.19+ 或受支持的 Node.js 24 版本 |
| `duplicate loader entry id: yolo` | 不要同时叠加已安装 bundle 和额外 runtime patch |
| `Cannot find package 'dsh-plugin-yolo'` | 重新执行 `dsh plugin --profile web add .` |
| `loaded without registering` | 检查 client 是否为 CJS 且已运行 wrapper |
| `process is not defined` | 检查 wrapper 的 process shim |
| `Cannot find module '../package.json'` | 检查 host 构建是否把 `@deepseek-ai/*` 保持 external |
| 看板 API 存在但侧栏入口缺失 | 检查 patch 是否包含裸包名 entry 以及 manifest 的对象形态 `dsh.client` |
| `SetNamedSecurityInfoW failed` | 按 Windows ACL 约定修复目录所有权/权限 |

## 为什么不用动态 Cordis 插件

`cordis_define` / `cordis_run` 的动态插件 `code.host` 是纯 JavaScript 函数体，不提供常规模块
解析、文件系统或 `node:sqlite` 模块导入，无法承载本项目的 TypeScript + SQLite 插件。
因此项目使用已安装 dsh CLI、标准 profile 和包级 patch。
