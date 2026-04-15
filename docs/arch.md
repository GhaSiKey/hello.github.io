# 架构说明

## 项目类型

GitHub Pages 静态网站，无构建工具，直接托管 HTML/CSS/JS 文件。

## 页面清单

### 1. index.html — 邀请网页

用于趣味活动邀请，包含以下交互：

| 功能 | 实现方式 |
|------|----------|
| 飘落爱心背景 | CSS animation + JS 动态生成 div |
| 逃跑的"不要"按钮 | mouseenter 事件随机移动按钮位置 |
| 接受后烟花效果 | Canvas 2D 粒子系统 |
| 表情包展示 | 点击接受后显示 1.jpg |

### 2. anr-report.html — ANR 分析报告

BStar Android ANR 问题的数据分析报告，包含：

| 区块 | 内容 |
|------|------|
| 汇总统计 | 问题总数、用户数、ANR 率 |
| 问题分类总览 | 8 个根因类别，每类包含用户数、报告数、占比 |
| 类别详情 | 可折叠的问题列表、错误堆栈、源码分析、修改建议 |
| 版本分析 | 各版本 ANR 率对比 |
| 每日趋势 | ANR 率随时间变化 |
| 优化优先级 | P0/P1/P2 分级建议 |
| 关键时间线 | 重要事件节点 |

### 3. 1.jpg

邀请网页使用的表情包图片，仅被 index.html 引用。

## 数据来源

anr-report.html 的数据来源是 AppInsight 工具（`asi google_play errors issues`），由主人手动更新。

更新流程：
1. 使用 AppInsight 查询 Google Play ANR 数据
2. 将数据填入 anr-report.html 对应位置
3. Push 到 GitHub 自动部署

## 部署

GitHub Pages 直接从 `master` 分支托管，访问：
- https://ghasikey.github.io/hello.github.io/ → index.html
- https://ghasikey.github.io/hello.github.io/anr-report.html → ANR 报告
