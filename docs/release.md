# 发布流程

本文说明如何发布 `dsh-plugin-yolo`。整个流程由人工发起、脚本辅助：更新一次版本、发布一次、
创建一个标签。

## 前置条件

- 拥有 `dsh-plugin-yolo` 包发布权限的 npm 账号（首次发布会占用包名；
  `publishConfig.access` 已设为 `public`）。
- 发布凭据通过环境变量注入 npm Access Token；不得把 token 写进仓库、脚本参数或提交记录。
  环境中没有可用凭据时停止发布并向维护者确认。
- main 分支上的 `pnpm build`、`pnpm check` 和 `pnpm test:run` 均通过；
  CI 会在 Linux 和 Windows 上确认这些检查。
- 如果发布内容涉及界面，必须基于当前构建完成一次面板真机端到端走查
  （见 [testing.md 第八节](testing.md#八真机端到端验证)）。

## 操作步骤

```bash
# 1. 确认 main 工作区干净且 CI 通过
git checkout main && git pull

# 2. 关闭 CHANGELOG.md 中的 Unreleased 小节：
#    将“## [Unreleased]”改为“## [<新版本>] — <当天日期>”
#    并在文末补充版本比较链接

# 3. 更新版本号（同时更新 package.json、提交并打标签）
npm version <new-version>  # 也可以使用：pnpm version <new-version>

# 4. 构建并快速检查产物
pnpm build
npm pack --dry-run         # 核对文件清单（dist/、bundle yml、schema.sql、README/许可/版本记录）

# 5. 发布
npm publish --access public --tag rc   # 候选版；稳定版发布时省略 --tag rc

# 6. 推送提交和标签
git push --follow-tags
```

发布完成后，在 CHANGELOG 顶部新建一个 `## [Unreleased]` 小节。

## 发布内容

发布文件由 `package.json` 中的 `files` 白名单控制：

- `dist/`——构建后的宿主插件（ESM）+ 包装后的客户端包（CJS）+ `schema.sql`
- `cordis.patch.yml`——宿主读取的插件包清单（由 `dsh plugin add` 自动应用）
- `README.md`、`LICENSE`、`CHANGELOG.md`

不发布源码、测试、`docs/` 和 `scripts/`；使用者只需要运行时产物。

## 安装已发布插件（面向使用者）

发布后，deepseek-harness profile 可以按包名解析插件，不再依赖仓库检出。使用 dsh 官方插件管理
命令安装后，CLI 会同时维护 profile 依赖与 Bundle 列表：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-yolo@rc
npx @deepseek-ai/dsh web
```

也可以安装固定 GitHub 标签：

```bash
npx @deepseek-ai/dsh plugin --profile web add github:hanshanyike/dsh-yolo#<tag>
```

GitHub 安装依赖 `prepare` 从源码构建，pnpm ≥10 要求使用方先把 `dsh-plugin-yolo` 加入该 profile
的 `allowBuilds`。npm 包和 tarball 已含 YOLO 构建产物，但原生运行时依赖 `better-sqlite3`
仍需通过 `dsh plugin --profile web approve-builds` 批准安装脚本。YOLO 的 patch-overlay 格式见
[运行与装配](architecture/runtime.md)，浏览器端装载条件见[客户端构建契约](architecture/client.md)。

## 版本策略

- `0.x`——dsh 平台本身仍是 `0.1.0-rc`；允许在次版本升级中引入破坏性变更，且必须记录在 CHANGELOG 中。
- 修复只提升补丁版本；功能发布提升次版本（记忆基础 → `0.2.0`，有状态计划 + 回复即操作 → `0.3.0`，依此类推）。
- `@deepseek-ai/cordis` 的 peer dependency 保持为 `*`，由宿主提供。
