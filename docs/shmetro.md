# 上海地铁运行图（shmetro）设计文档

模拟运行图：按公开的首末班 + 分时段发车间隔推演列车位置，非实时逐车次数据。
覆盖 20 条线（1–18 号线 + 市域机场线 + 浦江线；磁浮线暂缓，OSM 几何抽取持续超时）。

## 数据流与构建

两个离线脚本产出 `data/shmetro.json`，前端只读：

- `tools/build_metro_geo.py` —— 抓几何 + 站点投影
  - `LINE_SPECS`：线路 id → { amap_name, osm_ref, osm_route }。数字线走默认
    （osm_ref=id, route=subway）；特殊线显式覆盖：
    - 浦江线：route=light_rail, ref=浦江
    - 市域机场线：**route=train**（非 subway，早期误配才退兜底）, ref=市域机场线
  - OSM 优先，多镜像 + 多轮退避重试（endpoints 含 maps.mail.ru / kumi /
    overpass-api.de）。抓不到则高德站点直连兜底（`amap_fallback`）。
  - 增量追加：读入已有 json，本次抓的线覆盖/新增，其余原样保留；单线失败只告警。
  - 站点用 `mileage_m` 投影回轨道折线定位，避免 GCJ→WGS 与 OSM 的系统偏差。

- `tools/build_metro_time.py` —— 填 service（首末班 / 分时段间隔 / 站间运行时间）
  - 站间运行时间用物理模型估算：`常数(加减速) + 里程 / 巡航速度`，非逐段硬编码。

## 数据模型

线对象（非分支线，向后兼容）：
```
{ id, name, color, geometry:[[lon,lat]...], stations:[{name,lon,lat,mileage_m}],
  service:{first,last,intervals,run_times_sec}, geom_source }
```

分支线（5/10/11，Y 形）新增 `branches`，见下节。

## 分支线（Y 形线路）

5/10/11 号线各有 3 个终点、两支共享主干。单折线模型装不下，早期兜底最近邻连线
画出跨城长直线。**高德原始数据已按分支拆分**，每支是干净的线性路径，故按分支建模：

```
{ id:"11", name, color,
  branches:[ { key, name, geometry, stations:[...含mileage_m], service:{...} }, ... ],
  stations:[ ...全线去重站点，供图例/换乘/站点图层... ] }
```
- 每支独立 geometry + mileage + service，各自建 geoIndex、各自跑车。
- 顶层 stations = 各支站点去重合并，供站点图层与悬停（共享站不画两次）。
- 汇合点（5=东川路 / 10=龙溪路 / 11=嘉定新城）由拓扑自动识别。

真正的分支线仅 5/10/11。16 号线（快慢车）、1 号线（上海火车站短交路）虽有多
relation 但非分支，不处理。

### 分支线几何：按端点匹配 OSM 真实轨道
每支不再用站点直连折线，而是抓 OSM 真实几何：
- `fetch_osm_branches(ref, route)` 一次抓该 ref 的所有 relation（每支往返 2 个方向），
  各自 `_chain_ways` 拼接，返回候选（含首末端点坐标）。
- `_match_branch_relation`：用本支高德首末站坐标匹配最接近的候选（端点距离和最小、
  容忍方向翻转，阈值 4km）。命中 → OSM 几何投影取里程（geom_source=osm）；
  未命中/抓取失败 → 退回站点直连兜底（Catmull-Rom 平滑，geom_source=amap_fallback）。
- `_normalize_branch_directions`：各支 OSM relation 端点翻转可能导致方向不一致，
  使共线段在某些支里程反向 → 交替发车 entry 错乱。以第 0 支为基准，把共线段落在
  相反里程端的支整体反转（几何倒序 + 重投影），保证所有支共线段里程方向一致。
- 现状：11 号线（677/815 点）、10 号线（441/460 点）用 OSM 真实轨道；
  5 号线 OSM 几何本身断裂（2.5~5.8km 接缝）→ 匹配失败退兜底（用断裂几何反而错乱）。

### 交替发车（保证共线主干列车不重叠）

两支若各自独立发车，会在共享主干上重叠、甚至同时到站。解决方案是**交替发车**
（比固定相位更根本，对分时段间隔免疫）：

- 两支共用一条「合并发车流」，以主干正常频率生成入口通过时刻序列，第 k 班分给
  第 `k % 支数` 支——每支自然半频率，合并后主干恰为正常频率。
- service 存 `merge = { first, last, count, index, entry_up, entry_down }`。
  `entry_*` = 从始发到「共线段入口站」的行进时间；scheduler 用它把合并流的入口
  时刻反推成本支发车时刻：`dep = 入口时刻 − entry`。
- 入口站按方向取：up 从共线段低索引端进入，down 从高索引端。共线段内两支几何/
  里程完全一致，入口交替后全程等距、无论间隔怎样随时段变化都不重叠。
- 实现：`scheduler.js` `departures(service, dir)`；`build_metro_time.py`
  `fill_branch_line`。全天 30s 采样验证：三线跨支列车最近间距均 >900m。

## 换乘站 UI

`render.js` `stationsGeoJSON` 按**站名聚合**（不再每线一个点堆叠）：
- 每个唯一站名一个 feature，坐标取各线投影坐标均值。
- properties：`name` / `isTransfer` / `transferCount` / `lineIds`(JSON 串) / `color`。
- 图层分两类：普通站（白心 + 本线色细环）、换乘站（`stations-transfer` 层，更大
  白心 + 深色粗环 `#2b2f3a`，半径随线数增大，画在最上层）。
- `app.js` `stationPopupHTML`：遍历 `lineIds` 所有线路，聚合各线到站信息按 ETA
  排序，每行带该线色点区分；标题下列换乘线路。彻底解决"选不到底层站台"。

换乘站规模：90 个（2 线 71 / 3 线 16 / 4 线 3：世纪大道·龙阳路·曹杨路）。

## 站点搜索

图标展开式（右上角放大镜，点开为搜索框），支持中文子串 / 拼音全拼前缀 /
首字母前缀（rmgc→人民广场）三路匹配。

- 索引：`tools/build_metro_search.py` 用 pypinyin 离线生成 `data/shmetro_search.json`
  （418 站，每站含 name/py/abbr/lineIds/colors/lon/lat）。独立文件，不污染主数据；
  加载失败静默降级（搜索不可用，不阻塞主图）。
- 匹配排序：前缀命中 > 子串命中，同分按站名短优先。最多 8 条，带线路色点。
- 选中 → `flyTo`（zoom 14）+ **钉住气泡**：`state.pinned` 记住站名，气泡不随鼠标
  移开消失，地图 `move` 时按站名 `querySourceFeatures` 重定位跟随；点空白处或
  移出画布后再无钉住才关闭。键盘 ↑↓/Enter/Esc 支持。

## 数据面板（HUD 展开）

时钟卡的"X 列运行中"改为按钮，点击展开数据面板（`state.panelOpen`，展开时每帧随
tick 刷新）：

- 概览四格：全网运行列车数、总里程（各线 `length_m`/分支末站里程求和，约 862km）、
  最繁忙线路（当前运行车最多）、最长线路（11 号线 73.4km）。
- 各线运行列车数排行：横向色条，`state.perLineCount`（tick 里按线累计，不受聚焦影响
  →面板反映全网）。点击某条 → 聚焦该线（复用图例 toggleFocus）。
- 换乘枢纽 Top 6：来自搜索索引 `lineIds.length>=2` 按线数排序（4 线：世纪大道/曹杨路/
  龙阳路）。点击 → 复用搜索的 `gotoStation` 飞到并钉住气泡。

## 线路详情吸底条

点图例线路（`toggleFocus`）除高亮+缩放外，底部弹通栏吸底条；再点或点✕关闭。
横向布局，不挡地图中间内容。

- 左侧信息区（固定 150px）：线名+色点、全长（`lineLengthKm`）、站数、在途列车数、
  首末班（各 route 取最早 first/最晚 last）。
- 右侧横向站点条：`stationSequences` 输出——非分支线一行。分支线（5/10/11）
  **主干只画一次**：取最长支为主行完整展示，其余支自动算与主行的公共前/后缀、
  只画独有段（避免共享主干重复画两遍）。分叉处补一个「锚点站」（`is-fork`，虚线
  弱化显示，标明从哪儿分出去），分支行整体缩进 + 蓝色「↳ X 方向」标签。
  每站是可点 chip（小圆点+连线视觉），换乘站加粗+深色环。点击 → `gotoStation`
  飞到并钉住气泡。
- "在途列车"数字每帧由 `updateLineDetailCount` 单独刷新（只改数字，不整块重渲染，
  避免丢失横向滚动位置与监听）。
- 让位：`body.has-line-bar` + JS 实测条高写入 `--line-bar-h`，图例与右下角版权上移
  避免遮挡（图例 z-index 提到 13 高于条）。

## 面板打磨要点

- **换乘枢纽榜被挤掉的 bug**：数据面板里 20 条线的运行排行会撑满高度，把下方
  「换乘枢纽 Top 6」挤出视口。修法：`.sp-bars` 独立限高滚动（桌面 210px / 移动 30vh），
  枢纽榜始终可见。
- **四格补数值**：`stat(label, val, sub)` 三参——最繁忙显示「54 列 · 9号线」，
  最长线路显示「73 km · 11号线」。
- **长线名换行**：市域机场线等 5 字线名在 `.sp-bar-name`(58px, nowrap+省略号) 与
  `.lb-name`/`.lb-service`(nowrap) 里不再折行。
- **排行榜滚动保持**：面板每帧随 tick 重建 innerHTML 会把 `.sp-bars` 滚动位置弹回
  顶部。`renderStatsPanel` 重建前记住 `scrollTop`、重建后恢复。
- **移动端**：数据面板限 68vh、宽 248px；吸底条信息区收窄到 118px。

## 入口可见性

- 搜索：图标旁加"搜索站点"文字标签（不再是纯图标）。
- 数据面板入口："X 列运行中 ▾"加蓝色描边+浅底卡片感 + hover 态，明确可点。
- **右上角控件对齐**：MapLibre 缩放控件默认 `margin:10px`（顶在 10px），与搜索框
  `top:16px` 差 6px。把 `.maplibregl-ctrl-top-right` 对齐到 `top:16px right:16px`
  并清按钮外边距，搜索框 `right:57px`（16+29控件+12间距），三者顶边齐平。

## 末班车倒计时

站点气泡在到站信息下方，每条经过线路一行末班车状态：未过显示
`末班车 HH:MM · 剩 N 分`，已过显示`今日已收班`（转灰）。取该线各支/各方向最晚
`service.last` 对比当前模拟时间。线路级（非本站精确末班），与"模拟·非实时"定位一致。

## 市域机场线几何

OSM 里 route=train（非 subway），早期误配 subway 才退兜底、站点直连成生硬斜线
（景洪路↔中春路本应是直角弯）。改用 route=train 抓到真实轨道（219 点、58km），
直角弯还原。兜底几何（如仍需）用 Catmull-Rom 样条平滑（`_smooth_polyline`），
曲线过每个站点、投影里程几乎不变。

## 已否决的方案

- **共线段 line-offset 平行排开**：`line-offset` 只视觉平移线条，而车/站用原始几何
  定位、不随之移 → 箭头脱线。要三者一致须把偏移烘焙进几何，成本高；且 3/4 号线
  共线段本是同一物理走廊，重合更真实。故撤销，两线共线段重合为一条。
- **重构为示意图（schematic）布局**：保持地理真实底图。
- **在建/未来线路（19/20/21/22/23 号线等）**：这些线在 OSM 与高德开放接口均无
  几何数据，只能按路线图手工估坐标。试做过 22 号线（status/虚线/不跑车一套已验证
  可行），但中间新站（高宝路/凌空北路/长兴岛）无真实坐标，估算走向失真，故撤销。
  除非拿到官方精确坐标，否则不加在建线——本工程只呈现有真实几何的运营线。

## 矢量层与底图解耦（部署环境底图挂掉仍可用）

底图瓦片走 CARTO CDN（`basemaps.cartocdn.com`），在部分网络（如中国大陆直连）
不稳定。**踩坑**：线路层原绑在 `map.on('load')`，而 MapLibre 的 `load` 需等底图
style + 首次瓦片渲染完成——底图瓦片超时时 `load` 迟迟不触发，导致本是本地矢量数据
的地铁线路一条都画不出（时钟/图例/数据面板不依赖地图，照常显示，更具迷惑性）。

修法（`app.js` init）：矢量层绘制改由 `style.load`（只等内联 style 解析，与瓦片
网络无关）触发，叠加 200ms 轮询 `isStyleLoaded()` 双保险（最多等 ~8s）。这样底图
即便空白，地铁图本身照常渲染。

注意底图坐标系：线路投影到 OSM 轨道（WGS-84），底图必须同为 WGS-84。高德/腾讯
瓦片是 GCJ-02 偏移，直接换会与线路错开数百米，故不能用。

**底图选型（国内可达 + WGS-84）**：实测 CARTO / OSM / Wikimedia 在国内直连全超时，
ESRI ArcGIS 可达且为 WGS-84。改用 ESRI Light Gray：`World_Light_Gray_Base`（浅灰底）
+ `World_Light_Gray_Reference`（街道/地名标注）两层 raster 叠加，风格接近原 Positron。
坑：ESRI 瓦片路径是 `/tile/{z}/{y}/{x}`（y 在 x 前，与 XYZ 相反）。

## 前端结构

- `geo.js`：`buildIndex` / `locate`（按里程投影到折线取坐标）/ `bearingOf`。
- `scheduler.js`：`departures` / `trainsOnLine` / `nextArrivals` / `nextStops`。
- `render.js`：线路层（casing + 彩线）/ 站点层（普通 + 换乘）/ 列车层（glow + 箭头）。
- `app.js`：`routesOf`（线 → 跑车/画线的 route 单元）、tick 主循环、悬停交互。
- 图例按 line.id 一条一项，可聚焦高亮 / 显隐。

## 验证要点

- 5/10/11：各支从主干干净分叉到各自终点，无跨城长直线；开往正确终点。
- 主干列车交替、不重叠、不同时到站；到站时间随时刻变化、非雷同。
- 换乘站单一标记，悬停显示全部线路到站；箭头落在线路上。
- 机场线景洪路↔中春路直角弯；其余 17 线渲染无回归。
