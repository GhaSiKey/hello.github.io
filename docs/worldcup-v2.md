# 世界杯赔率页 V2（H5 Tab + ViewPager）· 实现方案

> 状态：方案待确认。仅针对 H5（移动端），独立新页，先本地起服务测试不 push。

## 目标

现有 worldcup.html 把所有比赛卡片纵向平铺，页面极长、翻后面的比赛要滑很久。
V2 仿 Android Tab + ViewPager：**日期条做 Tab，每个 Tab 是一天；下方只展示当天比赛卡片，
左右滑动切换天，Tab 联动高亮**。

## 关键决策（已确认）

| 决策 | 选择 |
|------|------|
| 载体 | 新建 `worldcup-v2.html`，现有页面完全不动 |
| 滑动实现 | 原生 CSS scroll-snap + touch，零外部依赖 |
| Tab 天数 | 仅"有赔率数据的天"（matches 里有对阵的日期） |
| 部署 | 本地起服务测试，先不 push |

## 架构：最大化复用，新增最小化

复用现有零改动的资产：
- `data.js` — 数据加载 + `parseMatchTime`（解析日期/星期/时间）
- `render.js` — `renderCard()`（卡片渲染，含已结束比分）、`renderDetail()`（详情面板）、
  `buildDayMeta`/`dayColorClass`（阶段配色）等所有函数
- `worldcup.css` — 全部卡片/详情/配色样式

新增 3 个文件：
```
worldcup-v2.html              # V2 页面骨架（引入复用的 js/css + V2 专属）
assets/worldcup/css/v2.css    # V2 专属布局（tab 条 + viewpager + 滑动）
assets/worldcup/js/v2.js      # V2 入口（分组分天、tab 渲染、滑动联动、详情）
```

## 交互设计（H5 竖屏）

```
┌──────────────────────────┐
│ 🏆世界杯赔率 V2   [赔率|战绩]│  顶栏(精简,复用现有header样式)
│ 🕐赔率截止 ··· 🧠分析 ···   │
├──────────────────────────┤
│ ‹ 6/12 6/13 [6/14] 6/15 › │  ← Tab日期条(横向滚动,当前居中高亮)
│      R1   R1   R1   R1     │     每项:日期+星期+轮次标,联动下方
├──────────────────────────┤
│  ┌────────────────────┐  │
│  │ 卡片1 (当天比赛)     │  │  ← ViewPager:一屏=一天
│  │ 卡片2               │  │     横向scroll-snap,左右滑切天
│  │ 卡片3               │  │     卡片复用renderCard
│  └────────────────────┘  │
│         ● ○ ○ ○           │  (可选)页码指示
└──────────────────────────┘
        ⚠ 免责声明
```

### Tab 与 ViewPager 联动（核心机制）
- **结构**：一个横向 scroll-snap 容器，每个子页 `width:100vw` `scroll-snap-align:start`，
  装当天卡片（纵向可滚）。
- **滑动切天**：手指左右滑 → 浏览器原生 snap 到下一页 → `scroll` 事件算出当前页索引 →
  更新 Tab 高亮 + 把该 Tab 滚到可视居中。
- **点 Tab 切天**：`scrollIntoView`/`scrollLeft` 让 ViewPager 横滚到对应页。
- **互不死循环**：用 `isSyncing` 标志位区分"用户滑"和"代码滚"，避免回环触发。

### 复用的能力
- 卡片点击 → `openDetail()`（详情面板，直接搬现有逻辑）
- 已结束比赛 → renderCard 已支持比分展示，自动生效
- 阶段/轮次配色 → 复用 calendar.js 的 dayColorClass

## 数据分组

```js
// 按 datetime 前10位(YYYY-MM-DD)分天，只保留有 matches 的天，按日期升序
// 每天: { date, md, weekday, round/phase标签, matches:[...] }
// 默认定位：今天(todayStr)那页；今天无数据则定位最近的未来一天/最后一天
```

## 不做 / 边界
- **不动现有 worldcup.html / app.js**（V2 完全独立，失败可弃）
- **不 push**，本地 `python3 -m http.server` 起服务，开 worldcup-v2.html 测
- Web 宽屏不特殊处理（V2 定位 H5；宽屏打开也能用，但布局按移动端）
- 详情面板：复用现有滑出面板（H5 现有 CSS 已是全屏形态）

## 验证
- 本地起服务，手机尺寸（DevTools 设备模拟）测：滑动切天、Tab 联动、点 Tab 跳页、
  卡片点击详情、已结束比分显示、默认定位今天。
- node 静态校验 v2.js 语法。

## UX 增强（ui-ux-pro-max 体检后补强）

借 `ui-ux-pro-max` 插件的 UX 规则库对 V2 做了一轮移动端体检，落地 6 项改进。
**全部限定在 V2 范围**（worldcup-v2.html / v2.css 的 `.v2` 作用域 / v2.js），
共享的 worldcup.css、render.js、data.js 与经典版 worldcup.html **零改动**。

| 改进 | 落点 | 规则依据 |
|------|------|----------|
| 恢复双指缩放 + 适配刘海屏 | html viewport 去掉 `user-scalable=no`，加 `viewport-fit=cover` | viewport-meta（禁缩放是无障碍硬伤） |
| 赔率/比分/时间等宽数字 | 引入 Fira Code，`.v2` 下数字类用 `--font-num`；中文仍 PingFang | number-tabular |
| Tab 触控目标 ≥44px | `.v2-tab` 加 `min-height:48px` + `touch-action:manipulation` | touch-target-size |
| 卡片/Tab 按压反馈 | `:active` 轻微 scale（纯 transform，不触发 CLS） | press-feedback / scale-feedback |
| 横滑切天卡片入场动画 | v2.js 切页时给当前页打 `.is-current` 重播 CSS 动画 | continuity |
| 尊重「减少动态效果」 | `@media (prefers-reduced-motion)` 关背景/发光/翻页动画 | reduced-motion |

**判断取舍**（插件是顾问不是自动改图）：
- 插件推荐整体换 Fira 字体族——**未采纳**。页面主体是中文，换拉丁字体族对满屏中文
  无效且会砸掉与其他 4 页的一致性；只取「数字等宽」这个真收益。
- 插件 `no-emoji-icons` 建议 emoji 换 SVG——**未采纳**。🏆🔥💎 是本项目活泼调性的
  一部分，个人站无需照搬企业 App 规范。
- 插件的 React/Tailwind/Apple HIG stack 指南与本项目「纯静态无构建」技术栈不符，全部过滤。
