<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**说一遍，它帮你把这件事沿着轨道稳稳推进。**

*为 deepseek-harness 打造的个人 AI 助手 —— 看着你的对话，管理你的工作与生活，跨会话提醒那些到期的事。*

[English](README.en.md) · [文档中心](docs/README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

每一段对话，你都在*失去*一些东西：刚说好的目标、定下的截止、做过的决定、偏好的方式——窗口一关就归零。**YOLO** 是一个不会忘记的助手：它把你在对话里交代过的事接住，整理成一份跨会话、可回看、会被提醒的计划。

它替你记，但不替你干：

- 它**看着每一段对话**，听懂哪些值得留下——承诺（要办的事）、计划（目标与里程碑）与跟踪规则（怎么盯、何时提醒）。
- 它把这些**跨会话**整理进一个按工作区隔离、可搜索的库，无论你开多少窗口都跟着你。
- 它**让计划活起来**：之后任意会话里说一句「做完了 / 进行中 / 推迟到周五 / 写了一半」，任务状态、目标进度和截止日自己就更新了，每次变动都留在时间线上。
- 它**在到期时主动提醒**——即使宿主设备离线错过截止，下次也会补上；它只在合适的时间出声（可设安静时段），而且提醒*可回复*：你回一句「推迟到明天 / 已完成 / 再提醒一次」，它就照做。
- 它**把一天摊开给你看**：dsh 侧栏里的全局看板——时间线、任务板、目标进度、里程碑与跟踪规则——不用离开就能完成 / 推迟 / 取消待办；每张卡片「聊一聊」开一段**全新**的锚定对话。

YOLO 不只是*记住*，它*理解*：每轮对话结束时，它用大模型做一次语义提取（与 [Mem0](https://github.com/mem0ai/mem0)、Claude Code 的自动记忆同一思路），**只留下真正影响「怎么管」的东西**——承诺、计划、跟踪规则——并把「好的 / 收到」这类寒暄和人物画像、通用知识挡在门外；计划始终准确，又不浪费你的 token。

## 快速开始

> **前置要求**：Node ≥ 22.19，pnpm ≥ 11，以及已安装的 `dsh`（deepseek-harness CLI）。Windows 上用 **PowerShell** 运行命令。

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install          # 安装依赖（better-sqlite3 原生绑定已含）
pnpm build            # 构建 host 插件 + browser client 到 dist/
node scripts/clean-test-data.mjs   # 开发前清理上轮 E2E 留下的 [E2E] 测试夹具（防载荷膨胀）
pnpm dsh plugin add . --profile web   # 一次性：把本插件按 dsh 标准方式链接进 web profile
pnpm dsh web --no-open --port 4080    # 启动 dsh 宿主 → http://127.0.0.1:4080
```

`dsh plugin add .` 用 dsh 生态的标准安装方式（把插件作为 bundle 挂进 `web` profile，`dsh.bundle.patch`
指向 `cordis.patch.yml` 自动注册全部 host 侧插件行）。`dsh web`（`web` 已隐含 `--profile web`）用**已安装的
dsh** 直接启动，与宿主环境一致（默认端口 **3080**；本机被宿主占用，故开发时用 `--port 4080`）。
改完代码重跑 `pnpm build`，刷新浏览器即可拿到新版本，无需重启宿主。

打开 **http://127.0.0.1:4080**，选好工作区开始对话。YOLO 已经在看着了：提到截止时间、设定目标，或说「记住这个」——然后打开左侧边栏底部的 **YOLO 面板**，就能看到时间线、任务板与目标进度。
> 插件更新（`cordis.patch.yml` 变更）后重跑 `pnpm dsh plugin add . --profile web` 重新 reconcile bundle。

### 十秒看懂它怎么工作

```
你:  帮我下周完成季度报告，然后记得周二开会前提醒我
yolo: [extract] +todo "季度报告" 截止=2026-08-27 优先级=高
      [extract] +todo "周二会议" 截止=2026-08-25
      [remind] ⏰ 已设好到点提醒
你:  (第二天，新会话)
yolo: ⏰ "周二会议" 今天到期——回复「推迟到明天」或「已完成」即可
你:  推迟到明天，报告已经写了一半
yolo: [yolo_action] 推迟 "周二会议" → 截止 2026-08-26 ✓
      [extract] 更新："季度报告" → 进行中，目标进度 50%
```

## 记忆在哪里

```
data/
├── yolo-<scope>.db            # SQLite（WAL + FTS5）——快速读写
└── snapshots/                 # Markdown——人类可读、可版本化
    └── 2026-08-20.md          #   你的记忆，可 diff、可提交
```

记忆按**工作区 + git 分支**隔离（两个项目互不串）。数据库是可重建的缓存，**Markdown 快照是可回看的真相源**——随时可以从快照重建。

## 路线图

YOLO 的旅程分四步：**记得 → 组织 → 预见 → 陪伴**。前两步已经落地——它记得你说过的，并把它们整理成有状态的计划。第三步「预见」很朴素：每条记录都带着目标时间，到点就触发，你回复一句就完成操作；不该出声时它就安静。终点「陪伴」，是理解你的节奏、与你的 agent 协作——那是远期的事。完整愿景见[愿景文档](docs/VISION.md)。

## 文档

从[文档中心](docs/README.md)开始——它把每篇文档归到对应读者：

- [使用文档](docs/usage.md) —— 安装、配置、功能、数据存储（中文）
- [愿景](docs/VISION.md) —— 项目的愿景与愿景驱动的方向（中文）
- [产品设计](docs/product-design.md) —— 面板 1.0 的全景蓝图（中文）
- [架构总览](docs/architecture/overview.md) —— 数据流、插件接缝、设计决策（英文）
- [架构参考](docs/architecture/modules.md) —— 逐模块文件、类型、公开 API、坑（中文）
- [测试文档](docs/testing.md) —— 如何跑测试、怎么加、真机走查（中文）
- [发布流程](docs/release.md) —— 如何发版到 npm（英文）
- [CHANGELOG](CHANGELOG.md) —— 版本历史

## 参与贡献

欢迎来[贡献](CONTRIBUTING.md)：有 bug 或想法就开 issue；动手前先保持 `pnpm check` 干净、`pnpm test` 全绿。UI 改动额外需要跑一遍真机走查（见[测试文档·真机端到端验证](docs/testing.md#七真机端到端验证)）。

## 许可证

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>为 deepseek-harness 而做 —— <i>「说一遍，它帮你把这件事沿着轨道稳稳推进。」</i></sub></p>
