# YOLO 文档中心

> 本项目所有文档的入口。按"使用者 / 开发者 / 发布者"三条线组织，改代码前先来这里定位。

## 快速导航

| 我想… | 看这份文档 |
|---|---|
| 了解项目的愿景与愿景驱动的路线图 | [愿景文档](VISION.md)（中文） |
| 安装、配置、日常使用 | [使用文档](usage.md)（中文） |
| 了解整体架构与跨模块数据流 | [整体架构](architecture/overview.md)（中文） |
| 查某个模块的文件、公开能力与实现约束 | [模块架构索引](architecture/modules.md)（中文） |
| 查宿主装载、构建契约和运行故障 | [运行与装配](architecture/runtime.md)（中文） |
| 跑测试 / 加测试 / 真机走查 | [测试文档](testing.md)（中文） |
| 看产品设计的全景蓝图与 v0.3.0 需求 | [产品设计文档](product-design.md)（中文）· [HTML 精装版 + 可交互原型](product-design.html) |
| 评审助手看板 2.0 大重构需求 | [助手看板 2.0 大重构 PRD](prd-assistant-dashboard-rearchitecture.md)（中文：产品边界 · 信息架构 · 状态/API · 迁移 · 验收） |
| 看当前开发计划（v0.3.3 批：全局聚合 / 跨工作区操作 / 宿主标准化） | [开发计划](development-plan.md)（中文） |
| 查 v0.3.3 代码与交互风险审查 | [v0.3.3 独立审查](code-review-v033.md)（中文） |
| 看借鉴了什么 / 不借什么（一句话收口） | [借鉴落地结论](research/18-adoption-verdict.md)（中文） |
| 发版流程 | [发布流程](release.md)（中文） |
| 版本历史 | [CHANGELOG](../CHANGELOG.md) |
| 项目总览与快速开始 | [README](../README.md)（中文，默认）· [README.en](../README.en.md)（英文） |

## 文档地图

```
dsh-yolo/
├── README.md               项目总览 · 快速开始 · 路线图（中文，默认）
├── README.en.md            项目总览 · 快速开始 · Roadmap（英文）
├── CONTRIBUTING.md         贡献指南（英文）
├── CHANGELOG.md            版本历史（英文）
└── docs/
    ├── README.md           ★ 本文档：文档中心
    ├── architecture/       （架构子目录）
    │   ├── overview.md     整体架构：模块关系 · 跨模块数据流 · 设计决策（中文）
    │   ├── modules.md      模块架构索引与旧链接兼容入口（中文）
    │   ├── shared.md       共享契约模块（中文）
    │   ├── attention.md    确定性助手判断模块（中文）
    │   ├── storage.md      SQLite 存储服务模块（中文）
    │   ├── extract.md      LLM 语义提取模块（中文）
    │   ├── memory.md       记忆工具、召回与上下文模块（中文）
    │   ├── reminder.md     提醒、简报与快照调度模块（中文）
    │   ├── ui.md           设置与看板服务端模块（中文）
    │   ├── client.md       浏览器客户端模块（中文）
    │   └── runtime.md      包装配、宿主约束与故障排查（中文）
    ├── usage.md            使用文档：安装 · 配置 · 功能 · 数据存储 · FAQ（中文）
    ├── testing.md         测试文档：运行 · 文件清单 · 手法 · 新增测试 · 真机端到端验证（中文）
    ├── VISION.md           愿景：Keeper → Organizer → Manager → Companion（中文）
    ├── roadmap-ux-priorities.md 体验优先级路线图（中文）
    ├── development-plan.md 当前开发计划（中文）
    ├── code-review-v033.md v0.3.3 独立审查（中文）
    ├── product-design.md  产品设计：全景蓝图 · 信息架构 · 面板 1.0（中文）
    ├── product-design.html 产品设计精装版：含可交互面板原型（单文件）
    ├── prd-assistant-dashboard-rearchitecture.md 助手看板 2.0 大重构 PRD（中文）
    ├── release.md         发布流程（中文）
```

## 维护约定

- **改代码时**：如果改了模块结构、公开 API 或配置项，请更新 `architecture/modules.md` 指向的
  对应模块文件；测试行为同步更新 `testing.md`。不要把模块正文重新堆回索引。
- **平台行为**：新验证的 dsh 运行时行为（loader 规则、事件载荷、构建契约、Windows 环境坑）
  统一记到 `architecture/runtime.md`；跨模块关系与设计决策才放在 `architecture/overview.md`。
- **语言**：`docs/` 下只维护中文正文；代码标识、命令、错误原文和必要技术名词保持原样。
