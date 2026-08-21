# YOLO 文档中心

> 本项目所有文档的入口。按"使用者 / 开发者 / 发布者"三条线组织，改代码前先来这里定位。

## 快速导航

| 我想… | 看这份文档 |
|---|---|
| 了解项目的愿景与愿景驱动的路线图 | [愿景文档](VISION.md)（中文） |
| 安装、配置、日常使用 | [使用文档](usage.md)（中文） |
| 了解整体架构、设计决策、已验证的平台行为 | [架构设计](architecture.md)（英文） |
| 查某个模块的文件/类型/API | [模块设计](modules.md)（中文） |
| 跑测试 / 加测试 | [测试文档](testing.md)（中文） |
| 看 M8（Phase 1 Organizer）怎么做 | [M8 设计文档](design-m8-organizer.md)（中文） |
| 发版流程 | [发布流程](release.md)（英文） |
| 版本历史 | [CHANGELOG](../CHANGELOG.md) |
| 项目总览与快速开始 | [README](../README.md) |

## 文档地图

```
dsh-yolo/
├── README.md               项目总览 · 快速开始 · Roadmap（英文）
├── CONTRIBUTING.md         贡献指南（英文）
├── CHANGELOG.md            版本历史（英文）
└── docs/
    ├── README.md           ★ 本文档：文档中心
    ├── architecture.md     架构设计：数据流 · 插件接缝 · 设计决策 · 已验证平台行为（英文）
    ├── modules.md          模块设计：逐模块文件/类型/API/坑 · 故障排查（中文）
    ├── usage.md            使用文档：安装 · 配置 · 功能 · 数据存储 · FAQ（中文）
    ├── testing.md          测试文档：运行 · 文件清单 · 手法 · 新增测试（中文）
    └── release.md          发布流程（英文）
```

## 维护约定

- **改代码时**：如果改了模块结构、公开 API、配置项或测试，请同步更新 `modules.md`、
  `usage.md`、`testing.md` 中对应章节——这是"避免挨个查代码"的前提。
- **平台行为**：新验证的 dsh 运行时行为（loader 规则、事件载荷、构建契约、Windows 环境坑）
  记到 `architecture.md` 的"Verified platform behavior"章节；环境/构建问题记到 `modules.md`
  的"故障排查"章节。
- **语言**：面向使用者的新文档用中文；`architecture.md` / `release.md` 保持英文
  （与历史一致），改动时沿用原语言。
