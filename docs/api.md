# OtakuMap API 文档

## API 1: 每日番剧排程

**Endpoint:** `GET https://api.bgm.tv/calendar`

**认证:** 无

**用途:** 获取本周每日更新的番剧列表，用于首页卡片展示。

**响应示例:**
```json
[{
  "weekday": { "id": 1, "cn": "星期一", "en": "Mon", "ja": "月耀日" },
  "items": [
    {
      "id": 123456,
      "url": "https://bgm.tv/subject/123456",
      "name": "作品名(原名)",
      "name_cn": "作品名(中文)",
      "summary": "简介...",
      "air_date": "2026-04-06",
      "images": {
        "large": "http://lain.bgm.tv/pic/cover/l/xx/xx/123456_xxxx.jpg",
        "common": "http://lain.bgm.tv/pic/cover/c/xx/xx/123456_xxxx.jpg",
        "medium": "...",
        "small": "...",
        "grid": "..."
      },
      "eps": 12,
      "currentEp": 3
    }
  ]
}]
```

**字段说明:**
| 字段 | 类型 | 说明 |
|------|------|------|
| weekday.id | integer | 星期 ID (1=周一, 7=周日) |
| items[].id | integer | Bangumi 条目 ID |
| items[].name | string | 原始名称 |
| items[].name_cn | string | 中文名（可能为空字符串） |
| items[].summary | string | 简介（可能为空字符串） |
| items[].air_date | string | 放送日期 YYYY-MM-DD |
| items[].images | object | 封面图（5种尺寸），可能为 null |
| items[].eps | integer | 总集数，可能为 null |
| items[].currentEp | integer | 当前播放集数，可能为 null |
| items[].url | string | Bangumi 页面链接 |

**注意:** `images` 字段可能为 `null`，渲染时需做空值保护。

---

## API 2: 条目详情（增强弹窗）

**Endpoint:** `GET https://api.bgm.tv/v0/subjects/{id}`

**认证:** 无

**用途:** 获取单个番剧的完整详情，用于点击卡片后弹窗增强展示。

**请求示例:**
```bash
curl https://api.bgm.tv/v0/subjects/467 \
  -H 'User-Agent: OtakuMap/1.0'
```

**响应字段说明:**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 条目 ID |
| type | integer | 类型 (1=书籍, 2=动画, 3=音乐, 4=游戏, 6=三次元) |
| name | string | 原始名称 |
| name_cn | string | 中文名（可能为空） |
| summary | string | 剧情简介 |
| date | string | 放送日期 "YYYY-MM-DD" |
| platform | string | 播放平台 "TV" / "剧场" / "OVA" 等 |
| total_episodes | integer | 总话数 |
| eps | integer | 实际集数 |
| rating.score | float | 平均分 (1-10) |
| rating.rank | integer | Bangumi 排名 |
| rating.total | integer | 评分总人数 |
| rating.count | object | 各分数段人数 {1: N, 2: N, ..., 10: N} |
| collection.wish | integer | 想看人数 |
| collection.collect | integer | 看过人数 |
| collection.doing | integer | 在看人数 |
| collection.on_hold | integer | 搁置人数 |
| collection.dropped | integer | 抛弃人数 |
| infobox | array | 详细信息 KV 对数组 [{key, value}] |
| tags | array | 标签列表 [{name, count}] |
| images | object | 封面图（同 calendar API） |

**infobox 示例:**
```json
[
  { "key": "中文名", "value": "四月是你的谎言" },
  { "key": "别名", "value": [{ "v": "四月は君の嘘" }, { "v": "君嘘" }] },
  { "key": "话数", "value": "22" },
  { "key": "放送开始", "value": "2014年10月" },
  { "key": "导演", "value": "石原立也" },
  { "key": "音乐", "value": "横山克" },
  { "key": "制作公司", "value": "A-1 Pictures" }
]
```

**tags 示例:**
```json
[
  { "name": "音乐", "count": 1319 },
  { "name": "恋爱", "count": 892 },
  { "name": "青春", "count": 743 }
]
```

---

## API 3: 条目角色/声优

**Endpoint:** `GET https://api.bgm.tv/v0/subjects/{id}/characters`

**认证:** 无

**用途:** 获取角色列表和对应声优，用于 Cast 区域展示。

**响应字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 角色 ID |
| name | string | 角色名 |
| summary | string | 角色简介 |
| relation | string | 与作品关系 "主角" / "配角" 等 |
| images | object | 角色立绘图（5种尺寸） |
| actors | array | 声优列表 |
| actors[].id | integer | 声优 ID |
| actors[].name | string | 声优名 |
| actors[].images | object | 声优头像（5种尺寸） |

---

## API 4: 条目 STAFF

**Endpoint:** `GET https://api.bgm.tv/v0/subjects/{id}/persons`

**认证:** 无

**用途:** 获取制作 STAFF 信息（导演、音乐、制作公司等）。

**响应字段:**
| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 人物 ID |
| name | string | 人名 |
| relation | string | 职务分类 "製作" / "音乐" / "动画制作" |
| career | array | 职业类型 ["director", "composer"] |
| images | object | 人物头像 |

**常用 relation 值:** "导演", "原作", "音乐", "制作公司", "动画制作", "脚本", "分镜", "演出"

---

## 数据获取策略

### 首页（calendar）
- 页面加载时 fetch 一次
- 存入 localStorage，30 分钟过期
- 缓存 key: `otakumap_calendar`

### 详情弹窗（subject detail）
- 点击卡片时 **异步** fetch，不阻塞弹窗显示
- 先用 `calendar` API 已缓存数据渲染基础信息
- `subjects/{id}` 数据到来后填充增强区域（评分/标签/Cast 等）
- 弹窗内显示加载态（骨架屏或 spinner）

### 并发
- `characters` 和 `persons` 与 `subjects/{id}` 可并行 fetch
- 都完成后填入弹窗增强区
