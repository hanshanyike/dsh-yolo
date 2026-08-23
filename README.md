<div align="center">

<img src="docs/logo.svg" width="120" alt="YOLO logo"/>

# YOLO

**把对话里说过的重要事情，变成持续可跟进的计划。**

*为 deepseek-harness 打造的个人助手：从对话中整理事项、跟踪变化，并在需要时提醒你。*

[English](README.en.md) · [文档中心](docs/README.md)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

待办、截止时间和阶段目标经常散落在不同对话里。会话一多，你很难记住哪些事情还没完成、哪些安排已经变化。**YOLO** 会从对话中识别需要继续跟进的内容，整理成跨会话可查看、可更新、会提醒的计划。

YOLO 负责整理信息和提醒进度；是否执行、如何执行仍由你决定。它会：

- **自动整理**：在一轮对话结束后，识别明确的待办、目标、里程碑和提醒规则。
- **跨会话保存**：按工作区保存并支持搜索，不必在新会话里重复交代。
- **同步变化**：当你说「完成了」「推迟到周五」或「已经进行一半」，对应事项会更新并留下记录。
- **按时提醒**：到期提醒进入 YOLO 的通知和常驻对话，不会插入正在进行的工作会话；错过的提醒会在宿主恢复后补发。
- **集中查看和处理**：在侧栏看板查看今天、即将、已完成、目标和台账，也可以完成、推迟、编辑或讨论某项事项。

YOLO 使用大模型做语义提取，而不是依赖关键词匹配。它只保留需要管理的事项和规则，并过滤「好的」「收到」等寒暄、人物画像与通用知识，减少无关内容进入长期记录。

## 快速开始

YOLO 是 dsh 插件。下面的命令会从源码构建插件、把它加入 dsh 的 `web` profile，然后启动 Web UI。

> **前置要求**：系统已安装 Node.js ≥ 22.19 和 pnpm ≥ 11。Windows 请使用 PowerShell。

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install
pnpm build
npx @deepseek-ai/dsh plugin add . --profile web
npx @deepseek-ai/dsh web
```

`dsh web` 默认打开 [http://127.0.0.1:3080](http://127.0.0.1:3080)，并尝试在默认浏览器中打开页面。如果不希望自动打开浏览器，使用：

```bash
npx @deepseek-ai/dsh web --no-open
```

如果 3080 端口已被占用，可以追加 `--port 4080`，然后打开 [http://127.0.0.1:4080](http://127.0.0.1:4080)。进入页面后选择工作区并开始对话；左侧边栏底部的 **YOLO** 按钮用于打开助手看板。

日常修改代码后，只需重新运行 `pnpm build` 并刷新浏览器。只有插件清单发生变化时，才需要再次运行 `plugin add`。测试数据清理、E2E 参数等开发命令见[测试文档](docs/testing-e2e.md)。

### 一个典型流程

```
在任意 dsh 对话中说明事项和时间
        ↓
YOLO 将它整理为待办、目标或里程碑
        ↓
你可以在后续对话或看板中更新状态
        ↓
到期时，YOLO 通过通知和自己的常驻对话提醒你
```

## 数据保存在哪里

```
data/
├── yolo-<scope>.db            # SQLite（WAL + FTS5）——快速读写
└── snapshots/                 # Markdown——人类可读、可版本化
    └── 2026-08-20.md          #   可阅读、可比较的记录快照
```

数据按**工作区 + git 分支**隔离，两个项目不会混用记录。SQLite 用于日常查询和状态更新，Markdown 快照便于阅读、版本管理和恢复。

## 路线图

YOLO 分四个阶段发展：**记得 → 组织 → 预判 → 陪伴**。当前已经具备跨会话记录、计划整理、到期提醒和看板处理能力；后续会继续改进优先级判断、节奏适配和 agent 协作。完整方向见[愿景文档](docs/VISION.md)。

## 文档

从[文档中心](docs/README.md)开始——它把每篇文档归到对应读者：

- [使用文档](docs/usage.md) —— 安装、配置、功能、数据存储（中文）
- [愿景](docs/VISION.md) —— 项目的愿景与愿景驱动的方向（中文）
- [产品设计](docs/product-design.md) —— 面板 1.0 的全景蓝图（中文）
- [架构总览](docs/architecture/overview.md) —— 数据流、插件接缝、设计决策（英文）
- [模块索引](docs/architecture/modules.md) —— 按模块查找实现文档（中文）
- [测试文档](docs/testing.md) —— 如何跑测试、怎么加、真机走查（中文）
- [发布流程](docs/release.md) —— 如何发版到 npm（英文）
- [CHANGELOG](CHANGELOG.md) —— 版本历史

## 参与贡献

欢迎来[贡献](CONTRIBUTING.md)：有 bug 或想法就开 issue；动手前先保持 `pnpm check` 干净、`pnpm test` 全绿。UI 改动额外需要跑一遍真机走查（见[测试文档·真机端到端验证](docs/testing.md#七真机端到端验证)）。

## 许可证

[MIT](LICENSE) © dsh-yolo contributors

---

<p align="center"><sub>为 deepseek-harness 而做 —— <i>把对话里说过的重要事情，变成持续可跟进的计划。</i></sub></p>
