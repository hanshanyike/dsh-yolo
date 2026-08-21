# YOLO 开发笔记（session log）

> 面向贡献者的踩坑与契约记录：代码审查修复、运行脚本、client bundle 构建契约、依赖与故障排查。
> 面向用户的安装与使用见 [README](../README.md)；架构与设计决策见 [architecture.md](architecture.md)；
> 版本历史见 [CHANGELOG](../CHANGELOG.md)。

---

## 目录

1. [总览](#一总览)
2. [源码 review 修复](#二源码-review-修复)
3. [运行环境修复](#三运行环境修复)
4. [看板 tab 的发现机制与构建契约](#四看板-tab-的发现机制与构建契约)
5. [快速开始](#五快速开始)
6. [本仓库自身的依赖](#六本仓库自身的依赖)
7. [与动态 Cordis 插件的关系](#七与动态-cordis-插件的关系)
8. [故障排查](#八故障排查)
9. [文件变更清单](#九文件变更清单)
10. [最终运行状态](#十最终运行状态)
11. [M7 语义提取与 UX 重构](#十一m7-语义提取与-ux-重构)

---

## 一、总览

本次会话围绕"先本地运行感受效果"这一目标，经历了三个阶段：

| 阶段 | 目标 | 结果 |
|---|---|---|
| 代码审查 + 早期修复 | review 全项目，修复非阻塞问题 | 3 处源码修复（scope import、rules 日期 bug、tools 注释） |
| 运行脚本 + dev host 启动 | 写脚本让 YOLO 在本地 dev host 跑起来 | `scripts/dev.mjs`，解决端口冲突 + better-sqlite3 + 依赖安装 |
| client bundle 可用 | 看板 tab 能在浏览器真正加载 | 修复构建契约（CJS 格式 + `__ModuleLoader__` 包裹 + process shim） |

### 设计依据

本仓库的运行方式遵循 deepseek-harness 官方文档：

1. **Run from source**（host 仓库 README `#run-from-source`）：
   ```sh
   git clone https://github.com/deepseek-ai/deepseek-harness.git
   cd deepseek-harness
   pnpm install
   pnpm run build
   pnpm dsh web
   ```
2. **Your first plugin**（[develop/basic](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)）：插件是导出 `apply(ctx)` 的 TypeScript 模块，用 `cordis.yml` patch overlay 注册，`pnpm dsh web --patch ./cordis.yml` 启动。

`scripts/dev.mjs` 把上述两步合并为一个幂等命令，并修复了 client bundle 在 dev 模式下的发现机制。

---

## 二、源码 review 修复

### F1：`src/storage/scope.ts` — 规范化 import 位置

**问题**：`import { sep } from 'node:path'` 原写在文件底部（lazy import），与顶部其它 `node:path` 导入（`resolve, posix, join`）分裂，可读性差。

**修复**：把 `sep` 并入顶部已有的 `node:path` 导入，删除底部 lazy import。

```diff
- import { resolve, posix, join } from 'node:path'
+ import { resolve, posix, join, sep } from 'node:path'
```

**影响**：无行为变化（`toPosix` 仍用 `sep`，`posixJoin` 仍 re-export `posix.join`）。纯代码组织优化。

### F2：`src/extract/rules.ts` — `parseDate` 跨年判断 bug

**问题**：原逻辑 `month < now.getMonth() + 1` 在"今天 8/25、用户说 8/20前"时误判：
- `month = 8`，`now.getMonth() + 1 = 9`
- `8 < 9` 为 `true` → 误判为**明年**
- 但 8/20 已经过去，"8/20前" 指的应是**今年**

更严重的反例："今天 8/20、用户说 8/25前"也会因 `8 < 9` 误判为明年。

**修复**：区分两种情况——月份严格更早（去年→明年），或同月但日已过（去年→明年）：

```diff
  if (m) {
    const month = Number(m[1])
    const day = Number(m[2])
-   const year = month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear()
+   const curMonth = now.getMonth() + 1
+   const curDay = now.getDate()
+   const pastMonth = month < curMonth
+   const sameMonthPastDay = month === curMonth && day < curDay
+   const year = pastMonth || sameMonthPastDay ? now.getFullYear() + 1 : now.getFullYear()
    return `${year}-${pad(month)}-${pad(day)}`
  }
```

**验证**：现有测试 `now=2026-08-20`、`parseDate('8/20前') → '2026-08-20'` 仍通过（`sameMonthPastDay = (8===8 && 20<20) = false` → 今年）。

### F3：`src/memory/tools.ts` — 修正 `cwdOf` 过时注释

**问题**：注释写"M1 用 host process cwd; M2/M3 will bind"，但 M2/M3 已完成且 tools 仍用 `process.cwd()`，注释与实现严重不符。

**修复**：更新注释说明实际原因——tools 的 `execute` 回调执行时无 live Session 在作用域内，故回退 `process.cwd()`；extract/reminder 优先用 `session.meta?.cwd`，两者在 web profile 下实际一致。

---

## 三、运行环境修复

### M1：`pnpm-workspace.yaml` — 修复 better-sqlite3 native binding

**问题**：pnpm 11 默认拦截 better-sqlite3 的 C++ 编译脚本（`ERR_PNPM_IGNORED_BUILDS`），`allowBuilds` 字段原是占位符 `"set this to true or false"`，未生效。导致 `Could not locate the bindings file`。

**修复**：改为 `true`，并删掉 pnpm 11 不再识别的 `onlyBuiltDependencies`：

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
nodeLinker: hoisted
```

### M2：`scripts/dev.mjs`（新增）— 跨平台运行脚本

从零编写，负责：clone host → install → build → 生成 patch → 启动 `dsh web`。经历的迭代：

1. **首版**：用 `file:///` URL 作 entry name，`pnpm dsh web` 启动。
2. **端口冲突**：默认端口从 3080 改为 4080（3080 被当前 GUI 占用），`--port` 始终传递。
3. **YOLO 依赖**：加一步在 YOLO 根目录 `pnpm install`（解决 `Cannot find package 'better-sqlite3'`）。
4. **YOLO 构建**：加一步 `pnpm build`（生成 `dist/client/index.mjs`，client bundle 发现所需）。
5. **profile junction**：在 `~/.dsh/profiles/node_modules/` 建 junction（host 从 profile 解析包名）。
6. **包名 entry**：patch 改用 `dsh-plugin-yolo/dist/src/storage` 等子路径 + 一个裸包名 entry（让 `ClientModuleRegistry` 解析到 package.json）。

**脚本的 8 个步骤**：

1. 确保 host 检出（`host/deepseek-harness` 不存在则 `git clone --depth 1`）。
2. 安装 host 依赖（`node_modules` 缺失时 `pnpm install`）。
3. 构建 host 制品（`apps/web/dist` 缺失时 `pnpm run build`）。
4. 安装 YOLO 依赖（`node_modules` 缺失时 `pnpm install`，含 better-sqlite3 native binding）。
5. 构建 YOLO 产物（`dist/client/index.mjs` 缺失时 `pnpm build`）。
6. 建立 profile junction（`~/.dsh/profiles/node_modules/dsh-plugin-yolo` → YOLO 仓库根）。
7. 生成运行时 patch（`cordis.dev.local.yml`，entry name 用包名子路径 + 裸包名）。
8. 前台启动（`pnpm dsh web --patch <yml> --no-open --port 4080`）。

### M3：`package.json` — exports 扩展 + scripts 入口 + dsh.client 格式

**exports 扩展**：原只有 `.` 和 `./client`。加 `./package.json`（让 `require.resolve` 能解析包根）和 5 个 `./dist/src/*` 子路径（让 host 插件 entry name 可解析）：

```json
"exports": {
  ".": "./dist/src/index.mjs",
  "./client": "./dist/client/index.mjs",
  "./package.json": "./package.json",
  "./dist/src/storage": "./dist/src/storage/index.mjs",
  "./dist/src/memory": "./dist/src/memory/index.mjs",
  "./dist/src/extract": "./dist/src/extract/index.mjs",
  "./dist/src/reminder": "./dist/src/reminder/index.mjs",
  "./dist/src/ui": "./dist/src/ui/index.mjs"
}
```

**dsh.client 格式**：从字符串 `"./client"` 改为对象 `{ "platform": "web" }`（`ClientModuleRegistry.parseDshClient` 要求 object，字符串会被拒）：

```json
"dsh": {
  "bundle": "./cordis.bundle.yml",
  "client": { "platform": "web" }
}
```

**scripts**：加 `dev:web` / `dev:web:setup` / `dev:web:update`；`build` 改为 `tsdown && tsdown -c tsdown.client.config.ts && node scripts/wrap-client.mjs`。

### M4：`tsdown.config.ts` — host 插件构建配置

**问题演进**：

1. 原配置只有 5 个子目录 entry + client，缺 `src/index.ts`（裸包名 entry 加载 `dist/src/index.mjs` 会找不到）→ 加 `src/index.ts` 到 entry。
2. 拆成 host + client 两套配置时，共享 chunk `lib-DabqEFZE.mjs` 里有 `@deepseek-ai/dsh-llm` 的 `createRequire('../package.json')`，相对 chunk 路径解析失败（`Cannot find module '../package.json'`）→ 加 `external: [/^@deepseek-ai\//]`。
3. `outDir` 必须设为 `dist/src`，否则输出结构错乱。

**最终配置**：

```ts
export default defineConfig({
  entry: ['src/index.ts', 'src/storage/index.ts', 'src/memory/index.ts',
          'src/extract/index.ts', 'src/reminder/index.ts', 'src/ui/index.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'dist/src',
  clean: true,
  external: [/^@deepseek-ai\//],  // host 运行时提供这些包，不打包
  outExtensions: () => ({ dts: '.d.ts' }),
})
```

### M5：`tsdown.client.config.ts`（新增）— client bundle 单独 CJS 构建

**问题**：`__ModuleLoader__.load` 的 factory 期望 CJS（`module.exports`），但原 ESM 构建输出 `export {}` 语句，在浏览器 classic `<script>` 里无法执行，且 factory 返回空 `module.exports`。报错 `loaded without registering`。

**修复**：client bundle 用单独配置，`format: 'cjs'` + `platform: 'browser'`：

```ts
export default defineConfig({
  entry: ['client/index.ts'],
  format: 'cjs',
  platform: 'browser',
  outDir: 'dist/client',
  outExtensions: () => ({ js: '.mjs' }),
  clean: false,
})
```

### M6：`scripts/wrap-client.mjs`（新增）— client bundle `__ModuleLoader__` 包裹 + process shim

**问题 1**：dsh 的 client bundle 契约要求 bundle 调用 `window.__ModuleLoader__.load({ id, factory })`。host 官方 `clientBundle()` helper 在 tsdown 的 banner/footer 注入这个包裹，但 YOLO 的 tsdown 配置不能对 host 插件也注入（会破坏 ESM 入口）。

**修复**：post-build 脚本，构建后在 `dist/client/index.mjs` 外面包一层。

**问题 2（process shim）**：React 的 CJS 入口用 `process.env.NODE_ENV` 切换 dev/production 分支。浏览器里没有 `process` 全局，报 `process is not defined`。

**修复**：factory 顶部加 `var process = (typeof process !== 'undefined' && process) || { env: {} };`。

**最终包裹结构**：

```js
window.__ModuleLoader__.load({ id: "dsh-plugin-yolo", factory: (require) => {
  var process = (typeof process !== 'undefined' && process) || { env: {} };  // React 需要
  var module = { exports: {} }; var exports = module.exports;
  ...原 CJS bundle...
  return module.exports;
} });
```

### M7：`cordis.dev.yml` — 修正硬编码路径 + 模板标注

原 `name` 硬编码旧路径，现标注为模板——实际运行用 `dev.mjs` 生成的 `cordis.dev.local.yml`（包名 entry，见第四节）。

### M8：`.gitignore` — 忽略生成物

加 `cordis.dev.local.yml`（运行时生成的本地 patch，含真实绝对路径）。

---

## 四、看板 tab 的发现机制与构建契约

### 发现机制

dsh 的 `ClientModuleRegistry`（`host/deepseek-harness/packages/client/modules/src/index.ts`）负责发现 client bundle：

1. 启动时扫描所有 loader entries；
2. 对每个 entry 调 `require.resolve(`${entry.name}/package.json`)`；
3. 若解析成功且 `package.json` 声明了 `dsh.client: { platform: 'web' }`（必须是 object），就发现该包的 client bundle；
4. 通过 `exports["./client"]` 找到 `dist/client/index.mjs` 并服务。

> `docs/extension-points.md` M4b 当时"dev 模式不注入"的结论是**错误的**。真正原因当时没构建 client bundle，且 entry name 用 `file://` URL 无法解析回 package.json。

### 三个必须同时满足的条件

| 条件 | 如何实现 |
|---|---|
| entry name 能解析到 package.json | patch 用包名子路径 `dsh-plugin-yolo/dist/src/storage` + 裸包名 entry；`~/.dsh/profiles/node_modules/` 建 junction |
| `dsh.client` 是 object | `package.json` 写 `"dsh": { "client": { "platform": "web" } }` |
| client bundle 是 CJS + `__ModuleLoader__` 包裹 | `tsdown.client.config.ts` 用 `format: 'cjs'`；`scripts/wrap-client.mjs` post-build 包裹 |

### client bundle 构建契约

dsh 的 client bundle 作为 classic `<script>` 标签加载，必须：

1. 调用 `window.__ModuleLoader__.load({ id, factory })`，其中 `factory(require)` 返回 `module.exports`；
2. 是 CJS 格式（`module.exports = ...`），不是 ESM（`export {}` 在 classic script 里不执行）；
3. 不引用 Node 全局（如 `process`），否则浏览器报 `process is not defined`。

### 验证方式

不只看状态码——用 `new Function()` 在无 Node 全局的沙箱里模拟浏览器执行 bundle，确认 `__ModuleLoader__.load` 的 factory 真正执行并返回了 `{ apply: [Function], inject: [...], name: 'yolo-client' }`。

---

## 五、运行与命令

安装与首次启动见 [README Quick Start](../README.md#-quick-start)（`pnpm install` → `pnpm dev:web:setup` → `pnpm dev:web`，默认端口 4080——3080 是 dsh GUI 本身占用的端口，不能冲突）。

### 命令选项

| 命令 | 作用 |
|---|---|
| `node scripts/dev.mjs` | 完整流程：确保 host 就绪，构建 YOLO，前台启动 web |
| `node scripts/dev.mjs --setup` | 只 clone + install + build，不启动（首次准备用） |
| `node scripts/dev.mjs --update` | 先 `git pull` host，再重装重构建，再启动 |
| `node scripts/dev.mjs --port 4081` | 自定义端口（默认 4080） |
| `pnpm dev:web` | 等同 `node scripts/dev.mjs` |
| `pnpm dev:web:setup` | 等同 `--setup` |
| `pnpm dev:web:update` | 等同 `--update` |

### 停止

`Ctrl+C` 终止前台进程，端口释放。若端口被残留进程占用（`EADDRINUSE`），在 PowerShell：

```powershell
Get-NetTCPConnection -LocalPort 4080 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 六、本仓库自身的依赖

> **2026-08-21 更新（M6）**：devDependencies 已从 `link:./host/...` 全面切换到 npm registry 的
> `@deepseek-ai/*@0.1.1-rc.2` 版本线。原因：`link:` 使 pnpm-lock 不可移植、CI 无法冻结安装。
> 现在仓库根目录一条 `pnpm install` 即可完成 check/test/build，**不再需要 host checkout**——
> host 仍由 `scripts/dev.mjs` 按需 clone，仅供**运行时**（dsh web 启动）使用。

- `@deepseek-ai/cordis` 同时是 peerDependency（host 运行时提供）与 devDependency（类型 + 测试）。
- `better-sqlite3` 是唯一的 `dependencies`（native binding，需 pnpm `allowBuilds` 放行编译）。
- `pnpm-workspace.yaml` 的 `minimumReleaseAge: 0` 跳过 pnpm 11 对刚发布包的冷却期（rc 依赖线全是新包）。
- `pnpm-lock.yaml` **已提交**（registry deps 后可移植），CI 用 `--frozen-lockfile`。

```bash
pnpm install   # 仅装 YOLO 自身依赖（无 host）
pnpm check     # tsc --noEmit
pnpm test      # vitest（仅 tests/，host/** 已 exclude）
pnpm build     # tsdown host + client + wrap-client + copy-assets
```

### 历史坑：pnpm link 空目录 / 手工 junction（已随 M6 依赖切换作废）

切换前，`@deepseek-ai/*` 靠 `link:` devDeps + 手工 junction 指向 host checkout，且 pnpm `link:`
偶尔生成空目录导致 `Cannot find module`。如检出的是旧提交需要复现该环境，参照
`git log` 中 M6 之前的 `package.json`（`link:` 写法）与 host 目录布局。

---

## 七、与动态 Cordis 插件的关系

本仓库**不走**动态 Cordis 插件机制（`cordis_define` + `cordis_run`）。原因：动态插件的 `code.host` 是纯 JavaScript 函数体，无模块解析、无 `fs`、无 `better-sqlite3` 原生绑定，无法承载这个 TypeScript + SQLite 项目。本项目的设计目标是持久化记忆（SQLite + FTS5 + Markdown 快照），改写为内存版会与目标不一致。`scripts/dev.mjs` 是正确的本地运行路径。

---

## 八、故障排查

| 症状 | 原因与解决 |
|---|---|
| `EADDRINUSE 4080` | 残留进程；见第五节"停止" |
| `frontend dist not built` | host 未 build；跑 `node scripts/dev.mjs --setup` |
| `Cannot find package 'better-sqlite3'` | YOLO 未 `pnpm install`；或 `pnpm-workspace.yaml` 的 `allowBuilds` 没设 `true` |
| `Could not locate the bindings file` | better-sqlite3 native binding 未编译；确认 `allowBuilds: { better-sqlite3: true }` 后重跑 `pnpm install` |
| `Cannot find package 'dsh-plugin-yolo'` | profile junction 缺失；重跑 `node scripts/dev.mjs`（会重建 junction） |
| `loaded without registering "dsh-plugin-yolo" via __ModuleLoader__.load` | client bundle 缺少 `__ModuleLoader__` 包裹；确认 `pnpm build` 跑了 `wrap-client.mjs` |
| `process is not defined` | client bundle 的 process shim 缺失；确认 `wrap-client.mjs` 是最新版（含 `var process = ...` shim） |
| `Cannot find module '../package.json'` | tsdown 把 `@deepseek-ai/*` 打包进共享 chunk；确认 `tsdown.config.ts` 有 `external: [/^@deepseek-ai\//]` |
| 看板 tab 不出现 | 见第四节"三个必须同时满足的条件" |
| `Cannot find module '@deepseek-ai/dsh-llm'` | pnpm link 空目录坑；见第六节 |
| pnpm 报 `[safe-delete] trash operation` | Git Bash 下的坑；用 PowerShell 跑 |

更多历史踩坑记录见 `docs/extension-points.md`。

---

## 九、文件变更清单

### 新增

| 文件 | 作用 |
|---|---|
| `scripts/dev.mjs` | 跨平台运行脚本：clone host → install → build → 生成 patch → 启动 dsh web |
| `scripts/wrap-client.mjs` | post-build：把 client bundle 包进 `__ModuleLoader__.load` + process shim |
| `tsdown.client.config.ts` | client bundle 单独 CJS 构建配置 |
| `CHANGES.md`（本文件前身） | 开发笔记，后迁移为 `docs/dev-notes.md` |

### 修改

| 文件 | 修改内容 |
|---|---|
| `package.json` | exports 扩展（加 `./package.json` + 5 个子路径）；`dsh.client` 改为 object；scripts 加 `dev:web*` + `build` 改为多步 |
| `pnpm-workspace.yaml` | `allowBuilds` 从占位符改为 `true`；删 `onlyBuiltDependencies`（pnpm 11 改用 `allowBuilds`） |
| `tsdown.config.ts` | 加 `src/index.ts` entry；加 `outDir: 'dist/src'`；加 `external: [/^@deepseek-ai\//]` |
| `cordis.dev.yml` | 标注为模板（实际运行用 dev.mjs 生成的包名 entry patch） |
| `.gitignore` | 加 `cordis.dev.local.yml` |
| `src/storage/scope.ts` | import 位置规范化（F1） |
| `src/extract/rules.ts` | `parseDate` 跨年判断 bug 修复（F2） |
| `src/memory/tools.ts` | `cwdOf` 注释修正（F3） |

### 运行时生成（被 .gitignore 忽略）

| 文件 | 作用 |
|---|---|
| `cordis.dev.local.yml` | 运行时生成的 patch，用包名子路径 entry |
| `dist/` | 构建产物 |
| `node_modules/` | YOLO 自身依赖 |
| `host/deepseek-harness/` | dev host 检出 |
| `~/.dsh/profiles/node_modules/dsh-plugin-yolo` | junction → YOLO 仓库根 |

---

## 十、最终运行状态

```
[yolo] plugin loaded                            ← host 插件 ✓
dsh web: http://127.0.0.1:4080                  ← 启动成功 ✓
GET / → 200, dsh-plugin-yolo in boot graph      ← 看板已注册 ✓
client.js → 200, 117428 bytes, CJS module.exports  ← client bundle ✓
factory 返回 { apply, inject, name }（模拟浏览器验证） ← 注册契约 ✓
```

---

## 十一、M7 语义提取与 UX 重构（2026-08-22）

第一阶段"能跑"之后的首轮真实体验反馈驱动的一次重构。用户报告了 3 个问题，排查过程中又发现了 2 个隐藏 bug。

### 反馈与根因

| # | 用户反馈 | 根因 | 修复 |
|---|---|---|---|
| 1a | `Cannot read properties of undefined (reading 'enabled')` | cordis loader 在 bundle yml 无该插件 config 段时传 `undefined`，schemastery 的 default 只在显式归一化时生效 | `src/ui/index.ts`：`Config((config ?? {}) as ConfigSchema)` 先归一化再访问 |
| 1b | `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)` | 工作区目录 owner 是 `BUILTIN\Administrators`，当前用户无 `WRITE_DAC`，host 沙箱授权失败 | `scripts/dev.mjs`：启动前用 `icacls` 做 ACL 预检，打印修复命令；`--fix-acl` 走 UAC 提权执行 `takeown` + `icacls /grant` |
| 2 | 每个会话一个 YOLO 看板 tab，侧边栏只有悬浮窗 | 记忆天然是跨会话的，逐会话发布 `yolo/snapshot` durable 事件纯属膨胀 | 见"UX 重构" |
| 3 | 逐条消息正则提取不合适，应该用大模型语义提取 | 正则无法判断语义：打招呼匹配了就入库（噪声），换个说法就漏掉（漏召回） | 见"架构重构" |
| 隐藏 1 | — | `memory` / `reminder` 用 `process.cwd()` 兜底，与提取写入的 session cwd 不是同一 scope → 召回和提醒读不到刚提取的记忆 | 两个插件都跟踪最近会话的 `meta.cwd` |
| 隐藏 2 | — | `session/event` 载荷无 session 对象时 `session.meta` 直接崩（与 1a 同类：对外部载荷不做防御） | 空值防御 |

### 架构重构：LLM-only 语义提取

删除 `rules.ts` / `buffer.ts` / `merge.ts` 与 `extraction.enableRules` 配置。业界对齐
（Mem0、Claude Code auto-memory）都是"一次有价值的交互之后做一次 LLM 提取"，
而非逐消息打正则：

- **触发**：仅 `agent/turn-stopping`，整轮消息折叠成一个 ≤8k 字符的文本（超长保尾部——最新消息承载本轮决策）。
- **去重上下文**：调用前把已存记忆压缩成 digest（todos/goals/milestones/prefs/events 标题列表，≤1500 字符）随 prompt 下发，明示"不要再提取未变化的事实"——重复轮次不产生重复行。
- **配置真正生效**：`extraction.enableLLM / model / minIntervalSec` 逐轮从 settings 读取（此前 `enableLLM` 写了但没人读）。
- **流量隔离**：`ctx.llm.stream` 的 `purpose` 只接受 host 枚举，借用 `'session-title'` 把辅助流量与主对话分开。
- **分类学修正（实测发现）**：初版 prompt 的 todos 定义是"有 owner 的任务"，实测模型把"明天 9 点赶高铁去上海出差"判为"非任务非目标非决策"而整体返回空。修正后 todos 明确覆盖 **scheduled commitments**（会议/出行/预约/交付），events 覆盖 **scheduled plans**。用真实 API 对拍验证：修正前全空，修正后正确产出 todo+event，且"随口一提不用记录"仍返回空（不过度提取）。

### UX 重构：全局侧边栏看板

- 删除会话级看板（`YoloTab` / `ViewBuilder` / `DashboardNode` / `HeaderButton` / `/yolo` 命令 / 每回合 `yolo/snapshot` 发布）。
- 侧边栏 footer 升级为完整看板抽屉（`client/sidebar/YoloSidebarDashboard.tsx`）：打开待办角标、五板块、手动刷新、打开期间 30s 轮询、外点/Esc 关闭、锚定侧边栏右缘自适应宽度。
- 数据通道改为 host 端 `GET /yolo/dashboard` JSON 端点，scope 跟随最近会话的工作区。

### 测试

删除 4 个针对已删模块的测试文件；改写 `extract-index`（LLM-only 行为 + 配置门控 + 去重上下文断言）、`ui-index`（含 1a 的回归测试：`apply(ctx, undefined)` 不抛）、`ui-dashboard`；新增 `extract-prompt`、`shared-dashboard`。16 文件 113 测试全过，`tsc --noEmit` clean。
