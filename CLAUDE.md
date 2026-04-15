# CLAUDE.md

## 项目摘要

hello.github.io 是一个 **GitHub Pages 静态网站**，托管两个 HTML 页面：

1. **index.html** — 邀请网页（"婷，周六出来玩嘛～"），用于活动和趣味互动
2. **anr-report.html** — BStar Android ANR 问题分析报告，展示 Google Play ANR 数据的可视化分析

技术栈：纯 HTML + CSS + JavaScript，无构建工具，直接部署到 GitHub Pages。

## 文件结构

```
hello.github.io/
├── index.html          # 邀请网页（飘落爱心、逃跑按钮、烟花效果）
├── anr-report.html     # ANR 分析报告（统计数据、问题分类、修改建议）
├── 1.jpg               # 邀请网页的表情包图片
├── docs/               # 项目文档
│   ├── arch.md         # 架构说明
│   ├── index-page.md   # 邀请页面说明
│   └── anr-report.md   # ANR 报告说明
└── .vscode/
    └── settings.json   # VSCode 配置
```

## 部署方式

GitHub Pages 直接托管根目录，访问地址：https://ghasikey.github.io/hello.github.io/

## 开发工作流约束

1. **文档先行** — 先阅读 docs/ 下相关文档，理解现有设计与约定
2. **方案确认** — 给出实现方案，等待用户确认后再动手
3. **代码修改** — 按确认的方案执行改动
4. **验证** — 浏览器预览，确保无回归
5. **文档收尾** — 更新 docs/ 中受影响的文档，保持文档与代码同步

## 关键约定

- 所有文件均为静态资源，无构建步骤
- HTML 文件内嵌 CSS 和 JavaScript
- 部署：push 到 GitHub 自动生效
