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

## 版本与标签约定

- `package.json` 和 npm registry 使用不带 `v` 的 SemVer，例如 `0.4.0-rc1`。
- Git 标签在同一版本前加 `v`，例如 `v0.4.0-rc1`。候选版必须使用
  `-rc<递增数字>`，不要写成 `0.4.0.rc1`、`0.4.0-rc.1` 或重复使用已经发布的版本。
- 下文以 `<new-version>` 和 `<new-tag>` 表示这两个值；执行前先把占位符替换成实际值，
  并确认 `<new-tag>` 严格等于 `v<new-version>`。
- 已推送的标签和已发布的 npm 版本都视为不可变；不得强推、移动远端标签或取消发布来覆盖错误。

## 候选版发布步骤

### 1. 冻结发布候选并完成门禁

只从最新的 `main` 发布。先确认没有混入其他人的改动，并验证目标版本和标签尚未占用：

```bash
git checkout main
git pull --ff-only origin main
git status --short --branch
git ls-remote --tags origin refs/tags/<new-tag>
npm view dsh-plugin-yolo@<new-version> version
npm whoami
```

`git status` 必须为空；`git ls-remote` 必须没有输出；`npm view` 此时应返回未找到版本。
如果远端标签或 npm 版本已经存在，转到“失败恢复与幂等重试”核实，不要继续运行 `npm version`。

在改版本前完成代码门禁：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:run
pnpm build
```

涉及界面或 API payload 时，还必须通过对应 E2E 套件和
[W1–W16 真机场景](testing.md#八真机端到端验证)。发布所包含的每个修复都应已经作为独立逻辑提交
推送到 `main`，且当前 `main` 的 Linux、Windows 和 coverage CI 全部成功。

### 2. 独立提交发布说明

将 `CHANGELOG.md` 顶部的 `## [Unreleased]` 改为
`## [<new-version>] — <当天日期>`，补全本版本内容和文末比较链接。发布说明必须先成为一个独立提交，
这样 `npm version` 启动时工作区是干净的：

```markdown
[Unreleased]: https://github.com/hanshanyike/dsh-yolo/compare/<new-tag>...HEAD
[<new-version>]: https://github.com/hanshanyike/dsh-yolo/compare/<previous-tag>...<new-tag>
```

```bash
git add CHANGELOG.md
git diff --cached --check
git commit -m "docs: prepare <new-version> release notes"
git push origin main
git status --short
```

等待这个提交的 CI 全部成功。`git status --short` 有输出时必须先查明来源；不得用
`npm version --force` 绕过脏工作区，也不得顺手提交无关文件。

### 3. 生成版本提交和本地标签

确认仓库跟踪的锁文件，并让版本提交保持 `package.json`、适用锁文件和标签一致：

```bash
git ls-files package-lock.json npm-shrinkwrap.json pnpm-lock.yaml
npm version <new-version> -m "release: %s"
node -p "require('./package.json').version"
git status --short
git show --stat --oneline HEAD
git rev-parse HEAD
git rev-list -n 1 <new-tag>
```

`npm version` 会更新 `package.json`（以及 npm 管理且已跟踪的 lock/shrinkwrap 文件）、生成一个版本提交，
并创建带 `v` 前缀的 annotated tag。若仓库跟踪了其他锁文件，必须确认其中的依赖图仍与
`package.json` 一致；当前命令输出的包版本必须等于 `<new-version>`，最后两条命令输出的提交 SHA
必须相同，且工作区必须干净。任一条件不满足都应在推送前停止。

### 4. 验证版本提交和发布包

在创建标签后的同一提交重新跑发布门禁，并核对实际打包清单：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:run
pnpm build
npm pack --dry-run --json
git status --short
```

`npm pack --dry-run` 会触发 `prepare`，但不会留下 tarball；保存 JSON 输出中的 `integrity` 供发布后核对。
清单必须包含 `dist/`、
`cordis.patch.yml`、`src/storage/schema.sql`、README、许可和 CHANGELOG，且不得包含源码目录、测试、
`docs/` 或凭据。最后工作区仍须干净。

### 5. 先推版本提交并等待 CI，再推标签

先只推 `main`，让远端 CI 验证将要被标签指向的确切版本提交：

```bash
git push origin main
```

CI 全部成功后，确认本地 `HEAD` 没有变化、`<new-tag>` 仍指向 `HEAD`，再显式推送这一个标签：

```bash
git rev-parse HEAD
git rev-list -n 1 <new-tag>
git push origin refs/tags/<new-tag>
git ls-remote origin refs/heads/main "refs/tags/<new-tag>*"
```

对于 annotated tag，`git ls-remote` 会显示标签对象和带 `^{}` 的 peeled commit；peeled commit
必须与远端 `main` 的提交相同。不要使用会捎带其他本地标签的 `git push --follow-tags`。

### 6. 发布并验证 npm dist-tag

只有远端提交、CI 和标签全部确认后才发布：

```bash
git describe --tags --exact-match HEAD
npm publish --access public --tag rc
npm view dsh-plugin-yolo@<new-version> version dist.integrity
npm view dsh-plugin-yolo dist-tags --json
```

第一条命令必须输出 `<new-tag>`。发布后的版本必须可查询，`rc` dist-tag 必须指向
`<new-version>`；候选版发布不得意外改动 `latest`。

### 7. 恢复 Unreleased

发布成功后，在 CHANGELOG 顶部新建空的 `## [Unreleased]` 小节，并将 `[Unreleased]` 比较链接
更新为 `<new-tag>...HEAD`。将这项维护作为独立提交推送，并等待 CI：

```bash
git add CHANGELOG.md
git diff --cached --check
git commit -m "docs: reopen changelog after <new-version>"
git push origin main
```

## 失败恢复与幂等重试

- `npm version` 因工作区不干净而失败：停止并检查 `git status`；提交应提交的发布说明，处理无关改动后
  再试。禁止添加 `--force`。
- 本地门禁失败且标签尚未推送：不得发布。修复并形成新提交后，删除这个**仅存在于本地**的旧指向，
  再在通过门禁的新 `HEAD` 创建同名 annotated tag；执行
  `git tag -d <new-tag>` 和 `git tag -a <new-tag> -m "<new-tag>"`，然后重新核对两条 SHA。
  不要重写已推送的提交或远端标签。
- 版本提交已推送但 CI 失败：不要推标签或发布。追加修复提交并重新通过门禁；若标签仍只在本地，
  让它重新指向最终通过 CI 的 `HEAD`，再按步骤 5 继续。
- 标签推送结果不明确：先用 `git ls-remote` 查询。标签不存在时可重试同一条 push；指向预期提交时
  直接继续；若已指向其他提交，立即停止并改用下一个未占用的候选版本，绝不强推或移动远端标签。
- `npm publish` 因网络、OTP 或超时而结果不明确：先运行
  `npm view dsh-plugin-yolo@<new-version> version dist.integrity`。版本不存在时，可从同一个干净标签提交
  重试完全相同的 publish 命令；版本存在时不得再次发布。
- 版本已经发布但 `rc` 指向不正确：核对版本内容后运行
  `npm dist-tag add dsh-plugin-yolo@<new-version> rc` 修复 dist-tag，再次查询确认；不要取消发布。
- 恢复操作中一旦发现远端标签、npm 包内容和预期提交无法证明一致，停止流程并使用新的 SemVer，
  保留现有对象供审计。

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

也可以克隆对应标签并从源码安装：

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo
git checkout <tag>
corepack enable
pnpm install --frozen-lockfile
pnpm build
npx @deepseek-ai/dsh plugin --profile web add .
```

GitHub 安装依赖 `prepare` 从源码构建，pnpm ≥10 可能要求使用方先把 `dsh-plugin-yolo` 加入该 profile
的 `allowBuilds`。npm 包和 tarball 已含 YOLO 构建产物；运行时使用 Node.js 内置 SQLite，
没有需要审批的原生依赖安装脚本。YOLO 的 patch-overlay 格式见
[运行与装配](architecture/runtime.md)，浏览器端装载条件见[客户端构建契约](architecture/client.md)。

## 版本策略

- `0.x`——dsh 平台本身仍是 `0.1.0-rc`；允许在次版本升级中引入破坏性变更，且必须记录在 CHANGELOG 中。
- 修复只提升补丁版本；功能发布提升次版本（记忆基础 → `0.2.0`，有状态计划 + 回复即操作 → `0.3.0`，依此类推）。
- `@deepseek-ai/cordis` 的 peer dependency 保持为 `*`，由宿主提供。
