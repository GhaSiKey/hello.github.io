# OtakuMap 番剧日历

## 概述

OtakuMap 是一个高级二次元风格的番剧每日更新查看网站，从 Bangumi API 获取数据。

## 访问地址

https://ghasikey.github.io/hello.github.io/otakumap.html

## 核心功能

- 展示每日（周一~周日）更新的番剧列表
- 点击日期标签切换星期
- 点击番剧卡片查看详情弹窗
- 响应式设计，移动端友好

## 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **API**: Bangumi API (`https://api.bgm.tv/calendar`)
- **字体**: Google Fonts (Noto Sans JP / Zen Maru Gothic / Inter)
- **部署**: GitHub Pages

## UI 设计

- 深色系 + 霓虹渐变背景
- 玻璃拟态卡片
- 缓慢浮动的光斑背景
- 卡片 hover 放大 + 发光边框
- 星期标签渐变高亮
- 卡片切换动画（向上滑出 + 从下方滑入）
- 弹窗底部滑入动画

## 文件结构

```
├── otakumap.html      # 主页面
├── css/style.css       # 样式
└── js/app.js          # 主逻辑
```

## 数据来源

`GET https://api.bgm.tv/calendar` — 每日放送接口，返回本周每日更新的番剧列表。

详见 [api.md](api.md)。

## 更新日志

### v1.0 (2026-04-15)
- 初始版本
- 实现每日番剧列表展示
- 实现星期切换动效
- 实现详情弹窗
