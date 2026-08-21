# 使用文档（User Guide）

> 面向**使用者**：安装、配置、功能、数据存储与常见问题。
> 安装与快速开始见 [README](../README.md#-quick-start)；开发者请转向 [modules.md](modules.md) 与 [architecture.md](architecture.md)。

---

## 目录

1. [安装与启动](#一安装与启动)
2. [配置](#二配置)
3. [核心功能](#三核心功能)
4. [模型可见工具](#四模型可见工具)
5. [侧边栏看板](#五侧边栏看板)
6. [数据存储位置](#六数据存储位置)
7. [常见问题](#七常见问题)

---

## 一、安装与启动

> **前置要求**：Node ≥ 22.19，pnpm ≥ 11。Windows 上请用 **PowerShell** 运行命令
> （Git Bash 会破坏 pnpm 的安全删除）。

```bash
git clone https://github.com/hanshanyike/dsh-yolo.git
cd dsh-yolo

pnpm install           # 安装 YOLO 自身依赖（含 better-sqlite3 原生绑定）
pnpm dev:web:setup     # 一次性：克隆并构建 host、建立 profile 链接、生成运行时 patch
pnpm dev:web           # 启动 dsh web → http://127.0.0.1:4080
```

`dev.mjs` 是幂等的——随时可重跑 `pnpm dev:web`；`pnpm dev:web:update` 会先拉取最新 host。

启动后打开 **http://127.0.0.1:4080**，选择工作区开始对话即可。YOLO 会自动开始工作：
提到截止时间、设定目标、或说"记住这个"，然后打开左侧边栏底部的 **YOLO 面板** 查看
时间线、任务板与目标进度。

---

## 二、配置

在 dsh 的 **Settings → Plugins → YOLO** 中可调整全部配置（有默认值，通常无需改动）：

| 分组 | 配置项 | 默认值 | 说明 |
|---|---|---|---|
| 总开关 | 启用 | `true` | 插件总开关 |
| 抽取 | 启用 LLM 提取 | `true` | 每轮对话结束后用大模型语义提取记忆 |
| 抽取 | 模型 | `deepseek-chat` | 提取用的模型名 |
| 抽取 | 最小间隔（秒） | `30` | 同一会话内两次提取的最小间隔（节流） |
| 提醒 | 启用提醒 | `true` | 到期任务自动注入对话 |
| 提醒 | 扫描间隔（秒） | `300` | 后台扫描到期任务的频率 |
| 提醒 | 提前量（分钟） | `60` | 到期前多久视为"该提醒" |
| 存储 | 作用域 | `workspace` | 记忆作用域模式 |
| 存储 | 快照节奏 | `daily` | `daily` 每天一次 / `every_10_turns` 每 10 轮一次 Markdown 快照 |
| 召回 | 最大 token | `512` | 动态召回注入 system prompt 的 token 预算 |
| 召回 | 条数 | `5` | 每次召回的最大命中条数 |

> 配置在每轮对话时实时读取，修改后下一轮生效，无需重启。

---

## 三、核心功能

### 1. 语义提取（自动记忆）

每轮对话结束后，YOLO 用大模型把整轮对话读一遍，结构化提取五类记忆：

- **待办（todos）**：用户承诺的具体任务 + 带时间的**日程承诺**（会议、出行、预约、交付、截止）。
- **目标（goals）**：跨天/跨周想达成的长期目标。
- **里程碑（milestones）**：有目标日期的命名阶段或检查点。
- **偏好（preferences）**：持久的用户偏好——回复语言、代码风格、工作习惯、工具选择。
- **事件（events）**：决策、里程碑达成、带日期的计划等时间线事实。

提取是**去重的**：调用前会把已存记忆压缩成摘要随提示词下发，模型不会重复提取未变化的事实。
因此重复轮次几乎不产生重复记忆，也不浪费 token。

### 2. 自动召回

- **偏好前置**：已记录的偏好会以 `## User preferences` 形式常驻 system prompt。
- **动态召回**：每次对话根据你的**最新消息**做全文搜索，把相关记忆以 `## Related memory` 注入上下文——不用你说"还记得吗"。

### 3. 主动提醒

到期任务（含提前量）会通过 `agent.inject` 主动注入对话并唤醒 agent。若 host 当时离线，
提醒会进入队列，在下次会话开始时自动回放——不会丢失。

### 4. 记忆持久化

记忆按 **工作区 + git 分支** 隔离（两个项目互不串记忆）。SQLite 是快速存储，
**Markdown 快照是持久记录**——每天（或每 10 轮）生成一份可 diff、可提交到 git 的快照。

---

## 四、模型可见工具

YOLO 向模型暴露 4 个工具，agent 可以自己读写记忆：

| 工具 | 作用 |
|---|---|
| `memory_search` | 全文搜索记忆（CJK 建议用 ≥3 个字符的关键词） |
| `memory_write` | 显式写入 todo / milestone / goal / preference / event |
| `memory_forget` | 软删除记忆（todo→cancelled，milestone→abandoned） |
| `yolo_query` | 查询看板视图：timeline / todos / goals / milestones / preferences |

> 一般无需手动调用——YOLO 已自动提取。工具主要用于"用户明确要求记住/追踪某件事"，
> 或 agent 需要查看当前记忆时。

---

## 五、侧边栏看板

左侧边栏底部有一个 **YOLO 按钮**（🎯），带**待办角标**（未完成待办数量）。点击打开全高抽屉：

- 📋 **待办任务**：按截止时间排序，显示优先级
- 🎯 **进行中目标**：显示进度百分比
- 🚩 **里程碑**：显示目标日期
- 💡 **偏好**：key-value 列表
- 🕒 **时间线**：最近的决策与事件

看板是**全局的**（与具体会话无关），作用域跟随最近会话的工作区。打开期间每 30 秒自动刷新，
也可点「↻ 刷新」手动刷新；点击外部区域或按 `Esc` 关闭。

---

## 六、数据存储位置

```
<工作区>/.dsh/yolo/
├── yolo-<scopeKey>.db     # SQLite（WAL + FTS5 trigram）——快速存储
└── snapshots/             # Markdown 快照——持久、可 diff 的记录
    ├── 2026-08-22.md      #   每日快照
    └── turn-10-....md     #   every_10_turns 模式的轮次快照
```

- **scopeKey** = `sha1(cwd) 前 12 位` + `/` + `git 分支`（非 git 仓库用 `default`）。
- 换工作区或分支 = 换一套记忆，互不干扰。
- 快照是真相源：DB 可随时从快照重建。

---

## 七、常见问题

| 问题 | 说明 |
|---|---|
| 看板显示"加载失败" | 插件未加载或服务未启动；确认 `pnpm dev:web` 在运行 |
| 看板一直为空 | 完成一轮对话后 YOLO 才会提取；确认配置里"启用 LLM 提取"为开 |
| 提醒没触发 | 检查"启用提醒"与"扫描间隔"；离线期间的提醒会在下次会话开始回放 |
| 记忆串到别的项目了 | 记忆按工作区隔离；确认你在正确的目录/分支下工作 |
| 想清空记忆 | 删除对应工作区的 `.dsh/yolo/` 目录（会同时删掉快照） |
| 中文搜索不到 2 字词 | FTS5 trigram 对 ≥3 字符的 CJK 召回最好；2 字查询可能漏，请用更长关键词 |
| 启动报 `SetNamedSecurityInfoW failed (Win32 5)` | Windows 下工作区目录 owner 是 `BUILTIN\Administrators` 时 dsh 沙箱授权失败。以管理员身份运行一次 dsh，或 `node scripts/dev.mjs --fix-acl` 提权修复 |
| pnpm 报 `[safe-delete] trash operation` | Git Bash 下的坑；请用 **PowerShell** 运行 pnpm |
