# 发布流程

本文说明如何发布 `dsh-plugin-yolo`。整个流程由人工发起、脚本辅助：更新一次版本、发布一次 npm 包、
创建一个不可变标签和与其一一对应的 GitHub Release。

## 前置条件

- 拥有 `dsh-plugin-yolo` 包发布权限的 npm 账号（首次发布会占用包名；
  `publishConfig.access` 已设为 `public`）。
- GitHub CLI 已登录且对仓库拥有创建 Release 的权限；GitHub Release 必须复用已经推送并验证过的标签，
  不得让 GitHub 在发布时隐式创建另一个 tag。
- 发布凭据通过环境变量注入 npm Access Token；不得把 token 写进仓库、脚本参数或提交记录。
  环境中没有可用凭据时停止发布并向维护者确认。
- develop 分支上的 `pnpm build`、`pnpm check` 和 `pnpm test:run` 均通过；
  CI 会在 Linux 和 Windows 上确认这些检查。
- 如果发布内容涉及界面，必须基于当前构建完成一次面板真机端到端走查
  （见 [testing.md 第八节](testing.md#八真机端到端验证)）。

## 版本与标签约定

- `package.json` 和 npm registry 使用不带 `v` 的
  [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)，例如 `0.5.0-rc.1`。
- Git 标签在同一版本前加 `v`，例如 `v0.5.0-rc.1`。预发布标识使用独立的数字段：
  `alpha.1`、`beta.1`、`rc.1`，随后按 `.2`、`.3` 递增；不要写成非 SemVer 的 `0.5.0.rc1`。
- 已发布的 `0.4.0` 候选版历史上采用了 `0.4.0-rc1` 至 `0.4.0-rc5`。这些版本不得重写；如果该版本线
  仍需候选版，为保持版本优先级单调递增，只能继续使用 `0.4.0-rc6`，不要中途改成优先级更低的
  `0.4.0-rc.6`。从下一条版本线开始统一使用点分格式，并避免再形成两套命名。
- 下文以 `<new-version>` 和 `<new-tag>` 表示这两个值；执行前先把占位符替换成实际值，
  并确认 `<new-tag>` 严格等于 `v<new-version>`。
- 已推送的标签和已发布的 npm 版本都视为不可变；不得强推、移动远端标签或取消发布来覆盖错误。

### 版本号如何选择

版本号表示一次可安装、可追踪的发布，不是 commit 计数器。每个完成的逻辑变更仍按 `AGENTS.md` 提交并
推送到 `develop`；只有用户明确授权组装发布时，才汇总这些提交、更新 CHANGELOG 并修改版本号。

| 变化 | `0.x` 阶段 | `1.x` 及以后 | 示例 |
| --- | --- | --- | --- |
| 向后兼容的缺陷修复 | 提升 PATCH | 提升 PATCH | `0.5.0` → `0.5.1` |
| 向后兼容的新功能 | 提升 PATCH，按一次发布批次汇总 | 提升 MINOR | `0.5.0` → `0.5.1`；`1.5.0` → `1.6.0` |
| 破坏性 API、配置、存储或行为变化 | 提升 MINOR，并提供迁移说明 | 提升 MAJOR，并提供迁移说明 | `0.6.0` → `0.7.0`；`1.6.0` → `2.0.0` |
| 纯文档、测试或不改变外部行为的内部重构 | 不单独 bump，随下一次适用发布归档 | 不单独 bump，随下一次适用发布归档 | — |

`0.x` 阶段的 PATCH 表示一次向后兼容的可安装发布，可以同时汇总多个相关修复和新增能力，不是“一个功能
对应一个版本号”。MINOR 保留给破坏性变化或明确的产品/架构大阶段切换。`0.x` 表示公共契约仍在演进，
不等于可以无提示破坏兼容性；所有破坏性变化都必须写入 CHANGELOG，涉及 SQLite schema、配置或 API
payload 时必须同时提供迁移或兼容策略。准备承诺稳定公共契约时发布 `1.0.0`。

### 预发布阶段

- `alpha.N`：方案仍在实验，功能和契约可能不完整。
- `beta.N`：目标功能基本完整，主要用于兼容性、真实使用和回归验证。
- `rc.N`：正式发布候选，只接受发布阻断修复；普通兼容功能进入稳定版后的下一条 PATCH 版本线，破坏性
  变化或明确大阶段进入下一条 MINOR 版本线。
- 无预发布后缀：稳定版，例如 `0.5.0`；必须通过完整发布门禁。

同一基础版本的正常顺序为：

```text
0.5.0-alpha.1 → 0.5.0-alpha.2 → 0.5.0-beta.1 → 0.5.0-rc.1 → 0.5.0 → 0.5.1
```

同一基础版本仍处于 alpha/beta 时，新增兼容能力只递增该阶段序号，例如
`0.5.0-beta.1 → 0.5.0-beta.2`；不要仅因又加入一个功能就改成 `0.6.0`。一个版本进入 RC 后即冻结普通
功能，避免在候选阶段改变发布范围。

候选版发现缺陷时继续增加 `rc.N`，不要为了表示候选版修复而从 `0.5.0-rc.N` 跳到
`0.5.1-rc.1`。只有 `0.5.0` 已经稳定发布、或者该版本被明确放弃且在 CHANGELOG 记录原因后，才开始
`0.5.1` 的预发布序列。

### npm dist-tag

- `latest` 只指向最新稳定版；普通的无版本安装会解析这个标签。
- `alpha`、`beta`、`rc` 分别指向对应阶段最新版本。预发布必须通过 `npm publish --tag <stage>` 显式发布，
  不得让默认发布意外覆盖 `latest`。
- 尚无当前稳定版时，README 和使用文档必须给出 `@rc`、其他适用阶段 tag 或固定版本，不能用裸包名暗示
  `latest` 就是当前候选版；也不要为修复一个过旧的 `latest` 而把 RC 指向 `latest`。
- 稳定版发布使用 `npm publish --access public --tag latest`，并在发布后查询精确版本和全部 dist-tag。
  `rc` 可以保留在最后一个候选版，直到下一条候选版本线开始。

## 预发布步骤

### 1. 冻结发布候选并完成门禁

只从最新的 `develop` 发布。功能分支只保留在本地，合入 `develop` 后仅推送 `develop`；远程长期分支保持
`main` 与 `develop`。先确认没有混入其他人的改动，并验证目标版本和标签尚未占用：

```bash
git checkout develop
git pull --ff-only origin develop
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
推送到 `develop`，且当前 `develop` 的 Linux、Windows 和 coverage CI 全部成功。

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
git push origin develop
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
`cordis.patch.yml`、`src/storage/schema.sql`、根 README、`docs/README.md`、许可、CHANGELOG 和明确白名单中的品牌资源，
且不得包含其他源码、测试、文档或凭据。最后工作区仍须干净。

### 5. 先推版本提交并等待 CI，再推标签

先只推 `develop`，让远端 CI 验证将要被标签指向的确切版本提交：

```bash
git push origin develop
```

CI 全部成功后，确认本地 `HEAD` 没有变化、`<new-tag>` 仍指向 `HEAD`，再显式推送这一个标签：

```bash
git rev-parse HEAD
git rev-list -n 1 <new-tag>
git push origin refs/tags/<new-tag>
git ls-remote origin refs/heads/develop "refs/tags/<new-tag>*"
```

对于 annotated tag，`git ls-remote` 会显示标签对象和带 `^{}` 的 peeled commit；peeled commit
必须与远端 `develop` 的提交相同。不要使用会捎带其他本地标签的 `git push --follow-tags`。

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

如果发布的是 `alpha` 或 `beta`，分别把命令中的 `--tag rc` 和验证目标改为 `alpha` 或 `beta`；阶段名必须
与版本后缀一致。

### 7. 创建并验证 GitHub prerelease

npm 版本、integrity 和对应 dist-tag 全部验证后，为同一个远端标签创建 GitHub Release。`alpha`、`beta`
和 `rc` 都必须标记为 prerelease；默认使用 GitHub 基于上一个标签生成的变更说明，并在发布页明确 npm
安装命令：

```bash
gh release create <new-tag> \
  --verify-tag \
  --prerelease \
  --latest=false \
  --title "<new-tag>" \
  --notes "npm 安装：npx @deepseek-ai/dsh plugin --profile web add dsh-plugin-yolo@<new-version>" \
  --generate-notes \
  --notes-start-tag <previous-tag>
gh release view <new-tag> --json tagName,isDraft,isPrerelease,publishedAt,url
```

验证结果必须满足：`tagName` 等于 `<new-tag>`、`isDraft=false`、`isPrerelease=true`，且 `publishedAt`
非空。GitHub Release 只是已经验证的 Git tag 与 npm 发布的用户入口，不能先于标签或 npm 包创建，
也不能用上传附件替代 npm registry 的 integrity 核验。

Release 页面优先给出固定版本安装命令。刚发布的 dist-tag 可能因 dsh profile 的 pnpm
`minimumReleaseAge` 策略暂时解析到上一个已满足等待期的版本；固定版本会让安装器明确确认并记录本次例外，
避免用户误装旧候选版。dist-tag 仍需验证，但不作为刚发布版本的唯一安装入口。

### 8. 恢复 Unreleased

发布成功后，在 CHANGELOG 顶部新建空的 `## [Unreleased]` 小节，并将 `[Unreleased]` 比较链接
更新为 `<new-tag>...HEAD`。将这项维护作为独立提交推送，并等待 CI：

```bash
git add CHANGELOG.md
git diff --cached --check
git commit -m "docs: reopen changelog after <new-version>"
git push origin develop
```

### 9. 同步 main 并完成远端闭环

恢复 `Unreleased` 的维护提交在 `develop` CI 全部成功后，将同一个已验证的 `develop` 快进到 `main`。
预发布同样是一次明确授权的仓库发布，因此 `main` 记录完整发布结果；tag 仍指向步骤 3～5 中通过门禁的
版本提交，不移动到维护提交：

```bash
git checkout main
git pull --ff-only origin main
git merge --ff-only develop
git push origin main
git fetch origin --prune
git rev-parse main
git rev-parse origin/main
git rev-parse develop
git rev-parse origin/develop
git ls-remote --heads origin
git checkout develop
```

`main`、`origin/main`、`develop` 和 `origin/develop` 必须一致，远端长期分支仍只能有 `main` 与
`develop`；随后等待 `main` CI 成功。任何无法快进的情况都必须停止并检查分支来源，不能使用强推或
生成未经评审的合并提交绕过。

## 正式版晋级

正式版不是给最后一个 RC 改标签，而是发布一个没有预发布后缀的新版本。例如 `0.5.0-rc.3` 通过验证后，
下一版本为 `0.5.0`，并拥有独立的 `v0.5.0` Git 标签和 npm 包版本。

正式版复用“预发布步骤”中的冻结、门禁、CHANGELOG、版本提交、包内容验证、远端 CI、推标签和恢复
Unreleased 流程，但步骤 6 必须显式发布到 `latest`：

```bash
git describe --tags --exact-match HEAD
npm publish --access public --tag latest
npm view dsh-plugin-yolo@<new-version> version dist.integrity
npm view dsh-plugin-yolo dist-tags --json
```

发布前必须确认 `<new-version>` 不含 `alpha`、`beta` 或 `rc` 后缀；发布后 `latest` 必须严格指向
`<new-version>`。不得通过移动 `rc` dist-tag、修改旧 Git 标签或取消发布来伪造正式版。

正式版的 GitHub Release 不使用 `--prerelease`，并应显式标记为最新稳定发布：

```bash
gh release create <new-tag> \
  --verify-tag \
  --latest \
  --title "<new-tag>" \
  --generate-notes \
  --notes-start-tag <previous-tag>
gh release view <new-tag> --json tagName,isDraft,isPrerelease,isLatest,publishedAt,url
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
- GitHub Release 创建结果不明确：先运行 `gh release view <new-tag>`。不存在时可从同一个已验证标签重试；
  已存在时核对 tag、draft/prerelease 状态和发布时间，不得删除 Release 后重建标签，也不得因此重发 npm 包。
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

- 具体版本号、预发布阶段和 dist-tag 按本文“版本与标签约定”执行；不得临时发明另一套编号方式。
- `0.x` 阶段的兼容修复和兼容新增能力都按发布批次提升 PATCH；MINOR 只用于有迁移说明的破坏性变化或
  明确的大阶段切换，并仍应尽量保持兼容。公共契约稳定后晋级 `1.0.0`。
- `@deepseek-ai/cordis` 的 peer dependency 保持为 `*`，由宿主提供。
