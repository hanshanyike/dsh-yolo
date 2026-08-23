# YOLO 文档中心

> 本项目所有文档的入口。按"使用者 / 开发者 / 发布者"三条线组织，改代码前先来这里定位。

## 快速导航

| 我想… | 看这份文档 |
|---|---|
| 了解项目的愿景与愿景驱动的路线图 | [愿景文档](VISION.md)（中文） |
| 安装、配置、日常使用 | [使用文档](usage.md)（中文） |
| 了解整体架构、设计决策、已验证的平台行为 | [整体架构](architecture/overview.md)（英文） |
| 查某个模块的文件/类型/API/坑 | [模块架构](architecture/modules.md)（中文） |
| 跑测试 / 加测试 / 真机走查 | [测试文档](testing.md)（中文） |
| 看有状态计划（状态/进度/可回复提醒）怎么设计 | [有状态计划设计文档](design-m8-organizer.md)（中文） |
| 看产品设计的全景蓝图与 v0.3.0 需求 | [产品设计文档](product-design.md)（中文）· [HTML 精装版 + 可交互原型](product-design.html) |
| 看后续开发计划（v0.3.0 批：语义召回/跨工作区聚合） | [开发计划](development-plan.md)（中文） |
| 查两个已定位待修的问题（时间线归属 / 提醒不可见） | [问题定位：时间线会话归属](issue-timeline-session-attribution.md) · [问题定位：提醒不可见](issue-reminder-visibility.md)（中文） |
| 发版流程 | [发布流程](release.md)（英文） |
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
    │   ├── overview.md     整体架构：数据流 · 插件接缝 · 设计决策 · 已验证平台行为（英文）
    │   └── modules.md      模块架构：逐模块文件/类型/API/坑 · 故障排查（中文）
    ├── usage.md            使用文档：安装 · 配置 · 功能 · 数据存储 · FAQ（中文）
    ├── testing.md         测试文档：运行 · 文件清单 · 手法 · 新增测试 · 真机端到端验证（中文）
    ├── issue-*.md         问题定位文档：现象 · 证据链 · 根因 · 修复方案（中文）
    ├── product-design.md  产品设计：全景蓝图 · 信息架构 · v0.3.0 需求（中文）
    ├── product-design.html 产品设计精装版：含可交互面板原型（单文件）
    ├── frontend-redesign.md 前端视觉重设计（Mono 设计系统）：规范 · 组件 · 动效 · 验收（中文）
    ├── frontend-redesign-prototype.html Mono 设计系统可交互原型（单文件）
    └── release.md         发布流程（英文）
```

## 维护约定

- **改代码时**：如果改了模块结构、公开 API、配置项或测试，请同步更新 `architecture/modules.md`、
  `usage.md`、`testing.md` 中对应章节——这是"避免挨个查代码"的前提。
- **平台行为**：新验证的 dsh 运行时行为（loader 规则、事件载荷、构建契约、Windows 环境坑）
  记到 `architecture/overview.md` 的"Verified platform behavior"章节；环境/构建问题记到 `architecture/modules.md`
  的"故障排查"章节。
- **语言**：面向使用者的新文档用中文；`architecture/overview.md` / `release.md` 保持英文
  （与历史一致），改动时沿用原语言。

