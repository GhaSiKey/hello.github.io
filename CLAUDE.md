# CLAUDE.md

## 项目摘要

hello.github.io 是一个 **GitHub Pages 静态网站**，托管多个 HTML 页面：

1. **index.html** — 邀请网页（"婷，周六出来玩嘛～"），用于活动和趣味互动
2. **anr-report.html** — BStar Android ANR 问题分析报告
3. **otakumap.html** — OtakuMap 番剧每日更新查看网站

技术栈：纯 HTML + CSS + JavaScript，无构建工具，直接部署到 GitHub Pages。

## 文件结构

页面 HTML 留在根目录（GitHub Pages 部署 URL 不变）；各页面的 css/js/图片
资源按子项目收纳到 `assets/<子项目>/` 下。worldcup（赔率页）与 simbet
（战绩页）共享数据/CSS/导航，同属「世界杯」子项目，归入 `assets/worldcup/`。

```
hello.github.io/
├── index.html          # 邀请网页（飘落爱心、逃跑按钮、烟花效果）
├── anr-report.html     # ANR 分析报告（完全内联，零外部依赖）
├── otakumap.html       # OtakuMap 番剧每日更新查看
├── worldcup.html       # 世界杯赔率页（读 data/worldcup.json 静态渲染）
├── simbet.html         # AI 模拟买盘战绩页（与 worldcup 同子项目）
├── anniversary.html    # 恋爱一周年纪念页（月日口令门帘 + 漂浮拍立得照片墙）
├── assets/             # 页面资源，按子项目收纳
│   ├── invite/
│   │   └── 1.jpg              # 邀请页表情包
│   ├── otakumap/
│   │   ├── style.css          # OtakuMap 样式
│   │   └── app.js             # OtakuMap 逻辑
│   ├── anniversary/           # 一周年纪念页子项目
│   │   ├── style.css          # 配色/门帘/照片墙/放大层样式
│   │   ├── app.js             # 门帘校验+照片墙轮转+逐字显影
│   │   └── 01.jpg ~ 20.jpg    # 20 张照片
│   └── worldcup/             # 世界杯子项目（赔率+战绩共用）
│       ├── css/  worldcup.css, simbet.css
│       └── js/   data.js, render.js, calendar.js, app.js  # 赔率页
│              simbet/{judge,render,app}.js                # 战绩页
├── data/               # 静态数据（不随重组移动）
│   └── worldcup.json   # 世界杯赔率+赛程+战绩（脚本生成，页面唯一数据源）
├── docs/               # 项目文档
│   ├── arch.md / index-page.md / anr-report.md / otakumap.md
│   ├── anniversary.md   # 一周年纪念页设计与维护
│   ├── api.md          # Bangumi API 接口文档
│   ├── worldcup.md / worldcup-web.md / sim-bet.md
│   └── round1-review.md # 第一轮娱乐方案复盘
├── tools/              # 命令行工具（不参与网页运行，路径相对自身不受重组影响）
│   ├── wc_odds.sh / _wc_parse.py
│   ├── build_wc_data.py    # 生成赔率数据
│   ├── build_schedule.py   # 生成赛程总览(schedule)
│   ├── fetch_results.py    # ESPN 取赛果
│   ├── settle_results.py   # 赛后结算战绩
│   └── add_bet_meta.py
├── .claude/skills/     # /worldcup /settle skill（引用 tools/data，不受重组影响）
└── .vscode/
```

## 部署方式

GitHub Pages 直接托管根目录：
- https://ghasikey.github.io/hello.github.io/ → index.html
- https://ghasikey.github.io/hello.github.io/anr-report.html → ANR 报告
- https://ghasikey.github.io/hello.github.io/otakumap.html → OtakuMap
- https://ghasikey.github.io/hello.github.io/worldcup.html → 世界杯赔率

## 开发工作流约束

1. **文档先行** — 先阅读 docs/ 下相关文档，理解现有设计与约定
2. **方案确认** — 给出实现方案，等待用户确认后再动手
3. **代码修改** — 按确认的方案执行改动
4. **验证** — 浏览器预览，确保无回归
5. **文档收尾** — 更新 docs/ 中受影响的文档，保持文档与代码同步

## 关键约定

- 所有文件均为静态资源，无构建步骤
- index/anr-report 页面内联 CSS/JS（自包含）；otakumap/worldcup/simbet
  的 CSS/JS 外置到 `assets/<子项目>/` 下
- **页面 HTML 一律留根目录**：GitHub Pages 部署 URL 据此而定，移动会断链
- 资源按子项目收纳到 `assets/`，新增页面资源遵循此结构（勿再平铺到根）
- 部署：push 到 GitHub 自动生效
