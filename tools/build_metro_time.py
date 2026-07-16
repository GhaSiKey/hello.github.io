#!/usr/bin/env python3
"""build_metro_time.py — 上海地铁运行图·时刻表填充（阶段②）

把「方案 B」的时间维度合并进 data/shmetro.json 的各线 service 字段：

    · first / last —————— 首末班车（各线公开运营信息，人工整理）
    · intervals ————————— 分时段发车间隔（高峰/平峰/低谷，公开近似值）
    · run_times_sec ————— 相邻站运行时间（由几何里程差 ÷ 表定旅行速度推算，
                          不逐站硬编码；仅极少数需修正的可在 OVERRIDES 里覆盖）

设计取舍：中国地铁不公开逐车次时刻表，只公开首末班+间隔。站间运行时间也无
逐段公开数据，故用「里程 ÷ 平均旅行速度 + 常数项」估算——地铁站间加减速模式
高度一致，此估算在观感上足够。这不是硬编码某段耗时，而是数据驱动的物理模型。

用法：
    python3 build_metro_time.py            # 为 shmetro.json 现有各线填 service

依赖：python3 标准库。需先跑 build_metro_geo.py 生成几何。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(HERE, "..", "data", "shmetro.json")

# ---- 运行时间物理模型（数据驱动，非逐段硬编码）----
# 站间耗时 = 常数项(加减速+停站前后) + 里程 / 巡航速度
DWELL_BUFFER_SEC = 25.0      # 每段固定开销（进出站加减速），秒
CRUISE_SPEED_MPS = 12.5      # 巡航速度约 45km/h，市区地铁典型值

# ---- 各线运营参数（公开信息：首末班 + 分时段发车间隔）----
# interval sec：高峰约 2.5min，平峰 4-5min，低谷 6-8min（上海地铁公开近似值）
# 间隔档位（秒）——按线路类型归纳的近似值，非逐车次官方时刻表。
#   高峰 peak / 平峰 mid / 低谷 off / 早晚低频 edge
def _sched(first, last, peak, mid, off, edge,
           am_from="07:00", am_to="09:30", pm_from="16:30", pm_to="19:00"):
    """生成标准五段式 intervals：早低频 / 早高峰 / 平峰 / 晚高峰 / 晚低频。"""
    return {
        "first": first, "last": last,
        "intervals": [
            {"from": first, "to": am_from, "sec": edge},
            {"from": am_from, "to": am_to, "sec": peak},
            {"from": am_to, "to": pm_from, "sec": mid},
            {"from": pm_from, "to": pm_to, "sec": peak},
            {"from": pm_to, "to": last, "sec": off},
        ],
    }


# 各线：首末班为公开运营信息；间隔按骨干/常规/外围分档的近似值。
SERVICE = {
    # —— 骨干高频线：高峰约 2.5min ——
    "1":  _sched("05:30", "22:30", 150, 300, 360, 360),
    "2":  _sched("05:30", "22:30", 165, 300, 360, 360),
    "8":  _sched("05:30", "22:30", 165, 300, 360, 360),
    "9":  _sched("05:30", "22:30", 165, 300, 360, 360),
    "10": _sched("05:30", "22:30", 165, 300, 360, 360),
    # —— 常规线：高峰约 3min ——
    "3":  _sched("05:30", "22:30", 200, 360, 420, 420),
    "4":  _sched("05:30", "22:30", 200, 360, 420, 420),
    "6":  _sched("05:30", "22:30", 210, 360, 420, 420),
    "7":  _sched("05:30", "22:30", 200, 330, 420, 420),
    "11": _sched("05:30", "22:30", 200, 330, 420, 420),
    "12": _sched("05:30", "22:30", 210, 360, 420, 420),
    "13": _sched("05:30", "22:30", 210, 360, 420, 420),
    # —— 外围/新线：高峰 3.5-4min，平峰间隔更宽 ——
    "5":  _sched("05:30", "22:30", 240, 420, 480, 480),
    "14": _sched("05:30", "22:30", 210, 360, 420, 420),
    "15": _sched("05:30", "22:30", 240, 420, 480, 480),
    "16": _sched("06:00", "22:00", 300, 540, 660, 660),  # 大站快线，间隔大
    "17": _sched("05:30", "22:00", 300, 480, 600, 600),
    "18": _sched("05:30", "22:30", 240, 420, 480, 480),
    # —— 短线 ——
    # 市域机场线：站距大、班次疏
    "airport": _sched("06:00", "22:00", 480, 660, 900, 900),
    # 浦江线：APM 胶轮，高频短线
    "pujiang": _sched("05:45", "22:30", 240, 360, 480, 480),
}

# 个别站间需人工修正的运行时间（如跨江长区间），(线id, 上游站名): 秒
OVERRIDES = {}

# 说明：10/11 号线的支线端点站排除在 build_metro_geo.py 的 EXCLUDE_STATIONS 处理，
# 不在本脚本。


def estimate_run_times(stations):
    """按相邻站里程差估算站间运行时间(秒)，返回长度 = 站数-1 的列表。"""
    rt = []
    for i in range(len(stations) - 1):
        dist = stations[i + 1]["mileage_m"] - stations[i]["mileage_m"]
        sec = DWELL_BUFFER_SEC + max(0.0, dist) / CRUISE_SPEED_MPS
        rt.append(round(sec, 1))
    return rt


# 与 scheduler.js 的 stationOffsets 保持一致：站间停靠 30s（首段不含）。
SCHED_DWELL_SEC = 30.0


def _time_to_index(run_times, idx):
    """从始发站(0)沿 up 方向到第 idx 站的累计到达时间(秒)，模型同 scheduler。"""
    t = 0.0
    for i in range(idx):
        t += (0.0 if i == 0 else SCHED_DWELL_SEC) + run_times[i]
    return t


def _shared_bounds(branches):
    """返回共线段的两个边界站名 (lo_name, hi_name)，按第 0 支的 up 站序。

    lo_name = 共线段中 up 索引最小的站；hi_name = 最大的站。
    - "先合后分"（5号线，共享起点）：lo=公共始发站(莘庄)，hi=分叉站(东川路)
    - "先分后合"（11号线，共享终点）：lo=汇合站(嘉定新城)，hi=公共终点(迪士尼)
    列车 up 方向从 lo 进入共线段，down 方向从 hi 进入。
    """
    name_sets = [set(s["name"] for s in b["stations"]) for b in branches]
    shared = set.intersection(*name_sets) if name_sets else set()
    names0 = [s["name"] for s in branches[0]["stations"]]
    shared_idx = [i for i, nm in enumerate(names0) if nm in shared]
    if not shared_idx:
        return None, None
    return names0[min(shared_idx)], names0[max(shared_idx)]


def fill_branch_line(line, svc, filled):
    """Y 形分支线：两支共用一条「合并发车流」，交替取班次，保证共线段绝不重叠。

    模型（交替发车，比固定相位更根本）：
      · 合并流以主干正常频率(svc.intervals)生成一串「入口通过时刻」，第 k 班
        分给第 (k % 支数) 支——每支自然是半频率，合并后主干恰为正常频率。
      · 每支存 merge.entry_up / entry_down = 从始发到「共线段入口站」的行进时间；
        scheduler 用它把入口时刻反推成本支发车时刻（dep = 入口时刻 − entry）。
      · 入口站：up 从共线段低索引端(lo)进入，down 从高索引端(hi)进入。
      · 因两支在入口按合并流交替、下游共线段几何/里程完全一致 → 全程等距、
        无论间隔怎样随时段变化都绝不重叠。
    """
    branches = line["branches"]
    n = len(branches)
    lo_name, hi_name = _shared_bounds(branches)

    parts = []
    for i, b in enumerate(branches):
        rt = estimate_run_times(b["stations"])
        names = [s["name"] for s in b["stations"]]
        total = _time_to_index(rt, len(names) - 1)
        lo_i = names.index(lo_name) if lo_name in names else 0
        hi_i = names.index(hi_name) if hi_name in names else len(names) - 1
        entry_up = _time_to_index(rt, lo_i)            # 始发→lo 入口
        entry_down = total - _time_to_index(rt, hi_i)  # 末站→hi 入口
        b["service"] = {
            "first": svc["first"],
            "last": svc["last"],
            "intervals": svc["intervals"],   # 主干正常频率，供合并流生成
            "run_times_sec": rt,
            "merge": {
                "first": svc["first"],
                "last": svc["last"],
                "count": n,
                "index": i,
                "entry_up": round(entry_up),
                "entry_down": round(entry_down),
            },
        }
        parts.append(f"{b['name']}(第{i}班起, ↑入口{round(entry_up)}s ↓入口{round(entry_down)}s)")
    filled.append(f"{line['name']}（{n}支·主干{lo_name}↔{hi_name}·交替发车）: "
                  + "，".join(parts))


def main():
    if not os.path.exists(DATA_PATH):
        raise SystemExit("未找到 data/shmetro.json，请先运行 build_metro_geo.py")

    data = json.load(open(DATA_PATH, encoding="utf-8"))
    filled, skipped = [], []

    def make_service(svc, stations):
        """按一组站点算 run_times，组装 service。"""
        return {
            "first": svc["first"],
            "last": svc["last"],
            "intervals": svc["intervals"],
            "run_times_sec": estimate_run_times(stations),
        }

    for line in data["lines"]:
        lid = line["id"]
        svc = SERVICE.get(lid)
        if not svc:
            skipped.append(line["name"])
            continue
        if line.get("branches"):
            fill_branch_line(line, svc, filled)
        else:
            line["service"] = make_service(svc, line["stations"])
            total_min = sum(line["service"]["run_times_sec"]) / 60
            filled.append(f"{line['name']}: 全程约 {total_min:.0f} 分钟，"
                          f"{len(line['service']['run_times_sec'])} 个区间")

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("已填充 service：")
    for s in filled:
        print("  " + s)
    if skipped:
        print(f"未配置时刻表（跳过）：{', '.join(skipped)}")


if __name__ == "__main__":
    main()
