# ANR 分析报告 (anr-report.html)

## 概述

anr-report.html 是 BStar Android 应用的 ANR（Application Not Responding）问题分析报告，用于可视化和追踪 ANR 问题的根因和优化进展。

## 数据来源

数据来自 Google Play Developer Reporting API，通过 AppInsight 工具（`asi`）查询。

常用查询命令：
```bash
asi google_play errors issues          # 查看 ANR/Crash 问题列表
asi google_play errors diff            # 对比两时间段差异
asi google_play query "SELECT ..."     # 自定义 SQL 查询
```

## 页面结构

### 1. 头部区域

- 标题：ANR 问题全面分析报告
- 副标题：应用名、分析周期、更新日期

### 2. 数据更新提示

展示与上一周期的数据对比（用户数变化、趋势）

### 3. 汇总统计栏

5 个关键指标卡片：
- ANR 问题总数
- 最多用户数及其问题名
- 指定版本 ANR 率
- nativePollOnce 用户数
- Unsafe.park 用户数

### 4. 问题分类总览

表格展示 8 个根因类别：

| 类别 | 问题数 | 总用户 | 总报告 | 占比 | 可操作性 | 根因 |
|------|--------|--------|--------|------|----------|------|
| nativePollOnce | 9 | 189,814 | 262,668 | 47.0% | 低 | 系统负载/资源竞争 |
| Unsafe.park | 6 | 159,531 | 218,891 | 39.5% | 高 | BLRouter.performCreateModules |
| Gripper variantRunBlocking | 4 | 21,083 | 31,900 | 5.2% | 高 | Gripper 框架阻塞 |
| Native stack (DumpNativeStack) | 2 | 10,240 | 10,704 | 2.5% | 中 | Native IO/线程问题 |
| Facebook GKs Manager | 1 | 9,146 | 9,898 | 2.3% | 高 | Facebook SDK 初始化 |
| WaitHoldingLocks (Native) | 1 | 4,832 | 4,966 | 1.2% | 中 | Native 线程等待 |
| BPush.init | 1 | 4,725 | 4,872 | 1.2% | 高 | BPush 主线程初始化 |
| Firebase ConfigResolver | 1 | 4,601 | 4,544 | 1.1% | 高 | Firebase Performance 配置 |

### 5. 类别详情（可折叠）

每个类别包含：
- **问题列表** — 表格展示各问题的用户数、报告数、版本范围、状态
- **错误堆栈** — 语法高亮的堆栈信息
- **源码分析** — 问题代码片段
- **修改建议** — 按优先级（高/中/低）分类的优化方案

### 6. 版本 ANR 率分析

表格展示各版本的 ANR 率、用户数、风险等级

### 7. 每日趋势

表格展示 ANR 率随时间的变化

### 8. 优化优先级

P0/P1/P2 分级展示预计解决的 ANR 比例

### 9. 关键时间线

时间轴展示重要事件节点

## 更新流程

1. 使用 `asi sync` 同步最新数据
2. 使用 `asi google_play errors issues` 查看问题列表
3. 根据数据更新报告中对应位置：
   - 汇总统计的数字
   - 问题列表中的用户数/报告数
   - 表格和趋势数据
   - 时间线（如果有必要）
4. Push 到 GitHub 自动部署

## 关键指标说明

- **ANR 率** — 发生 ANR 的 session 占比（Google Play 定义）
- **用户感知 ANR 率** — 受 ANR 影响的用户占比
- **distinctUsers** — 发生 ANR 的独立用户数
- **crashRate/userPerceivedAnrRate** — Google Play 指标

## 相关文档

- 主人内部 ANR 排查流程：skill `anr-investigation-workflow`
- ANR 分析报告在线地址：https://ghasikey.github.io/hello.github.io/anr-report.html
