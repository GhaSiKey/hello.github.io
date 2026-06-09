# 世界杯赔率工具 (tools/wc_odds.sh)

## 用途

抓取中国体彩竞彩足球的实时赔率，用于查看 2026 世界杯（及其它竞彩足球）
各场次的胜平负、让球、比分、总进球、半全场赔率。

**定位**：开发/查询用的命令行工具，不参与 GitHub Pages 网页运行。

## 技术原理

体彩官网赔率页（`sporttery.cn/jc/zqdz/`）是 Vue 动态渲染，HTML 内不含
赔率数据，真实数据走后端 `webapi.sporttery.cn` 的 gateway 接口。本工具
顺着前端 JS 逆向出两个接口直接取 JSON：

| 接口 | 作用 | 关键参数 |
|------|------|----------|
| `getMatchHeadV1.qry` | 对阵信息（队名/赛事/时间/场次） | `source=web&sportteryMatchId=<mid>` |
| `getFixedBonusV1.qry` | 固定奖金（全部玩法赔率） | `clientCode=3001&matchId=<mid>` |

赔率数据全部在响应的 `value.oddsHistory` 下：

| 字段 | 玩法 |
|------|------|
| `hadList`  | 胜平负 |
| `hhadList` | 让球胜平负 |
| `crsList`  | 比分（`s02s00`=2:0，`s-1sh`=胜其它） |
| `ttgList`  | 总进球（`s0`~`s7`，s7 表示 7+） |
| `hafuList` | 半全场（`hh`/`hd`/.../`aa` 九项） |

接口返回 `access-control-allow-origin: *`，允许跨域，故前端也可直接 fetch。

## 文件构成

```
tools/
├── wc_odds.sh     # 入口：curl 取数 + 参数调度
└── _wc_parse.py   # JSON 解析与渲染（被 wc_odds.sh 调用）
```

拆成两个文件是为了避免在 shell 里内联 Python 造成的引号嵌套问题。

## 用法

```bash
./tools/wc_odds.sh <mid>               # 单场全部玩法赔率
./tools/wc_odds.sh <起始mid> <结束mid>  # 区间扫描，列对阵 + 胜平负摘要
./tools/wc_odds.sh                     # 不传参，演示默认区间
```

### 示例

```bash
./tools/wc_odds.sh 2040163             # 韩国 vs 捷克 全部赔率
./tools/wc_odds.sh 2040162 2040176     # 2026 世界杯首轮一览
```

### 如何拿到 mid

打开体彩某场比赛页面，URL 形如
`.../jc/zqdz/index.html?showType=2&mid=2040162`，末尾 `mid=` 后的数字即是。
世界杯首轮的 mid 是连续的（2040162 起，按场次号递增）。

## 注意事项

- **mid 会随赛事推进变化**，不要写死在调用方，始终通过参数传入。
  脚本里的 `DEFAULT_START/DEFAULT_END` 仅作不传参时的演示，逻辑不依赖。
- 赔率是**竞彩固定奖金**（销量倒推的派彩比例），返还率约：胜平负 88.6%、
  总进球/半全场 79.7%、比分 71.0%——非博彩真实概率，任何单注长期期望为负。
- 部分悬殊场次体彩只开部分玩法（如卡塔尔 vs 瑞士无胜平负，仅让球/比分），
  脚本会跳过空玩法、照常显示其余。

## 踩过的坑（实现备忘）

1. **`seq` 科学计数法**：macOS 上 `seq 2040162 2040176` 可能输出 `2.04016e+06`，
   导致 mid 非法。改用整数 `while` 循环递增。
2. **shell 变量插值进 Python 源码**：`python3 -c` 里用 `$mid` 会被当浮点。
   改用环境变量 / argv 传参。
3. **引号地狱**：`python3 -c '...'` 单引号内再写 `'h'` 会截断 shell 字符串。
   最终把 Python 整体拆到独立文件解决。
