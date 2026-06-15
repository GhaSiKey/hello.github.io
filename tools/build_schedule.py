#!/usr/bin/env python3
"""build_schedule.py — 整届赛程总览数据（供赔率页日历用）。

从 ESPN 公开接口拉整届世界杯赛程（含未开赛/对阵未定的淘汰赛），转北京时间，
按天聚合（日期/星期/场次数/各阶段计数），写入 data/worldcup.json 的
schedule 字段。页面据此渲染日历总览。

设计原则 · 与赔率数据隔离：
    本脚本只写 meta.schedule + 顶层 schedule 字段，绝不碰 matches（赔率/点评/
    战绩）。赔率由 build_wc_data.py 管，赛程由本脚本管，互不污染。

为什么用 ESPN：体彩接口只逐场查、无全程赛程；ESPN 区间接口一次拿全程，
含阶段(season.slug)、北京时间可由 UTC 换算。slug 是可靠的阶段字段——
name 含 "Round of 16"/"Final" 等关键词不可信（实测与 slug 矛盾）。

用法：
    python3 build_schedule.py                      # 默认整届 6/11~7/20
    python3 build_schedule.py 20260611 20260720    # 指定起止(UTC日期)
"""
import sys
import os
import json
import datetime
import urllib.request
import urllib.error

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "worldcup.json")
API = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world"
UA = "Mozilla/5.0"

# 默认整届区间（UTC 日期；决赛北京 7/20 凌晨=当地 7/19，故查到 0720）
DEFAULT_RANGE = ("20260611", "20260720")

# ESPN season.slug -> (中文阶段名, 阶段序号用于排序/配色)
# 序号也是阶段推进顺序，前端按此上色（小组赛→决赛 由浅入深）
PHASE_MAP = {
    "group-stage":     ("小组赛", 1),
    "round-of-32":     ("32强", 2),
    "round-of-16":     ("16强", 3),
    "quarterfinals":   ("8强", 4),
    "semifinals":      ("4强", 5),
    "3rd-place-match": ("季军赛", 6),
    "final":           ("决赛", 7),
}

WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def fetch_json(url):
    """GET 并解析 JSON；失败返回 None（区别于空结果）。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"  ! 请求失败: {e}", file=sys.stderr)
        return None


def to_beijing(utc_str):
    """ESPN 的 UTC 时间串(2026-06-11T19:00Z) -> 北京 datetime。"""
    u = datetime.datetime.strptime(utc_str[:16], "%Y-%m-%dT%H:%M")
    return u + datetime.timedelta(hours=8)


def build_schedule(lo, hi):
    """拉区间赛程，按北京日期聚合。返回 (days_list, 总场次)。

    分段查询：ESPN 单次区间约 100 场上限，整届 104 场会丢尾部淘汰赛。
    故拆成两段拉取、按 event id 去重合并，确保 4强/季军/决赛不漏。"""
    # 中点切分（小组赛+前段淘汰 / 后段淘汰赛），两段都覆盖以容错
    mid = "20260710"
    events_by_id = {}
    for seg_lo, seg_hi in ((lo, mid), ("20260711", hi)):
        data = fetch_json(f"{API}/scoreboard?dates={seg_lo}-{seg_hi}")
        if data is None:
            return None, 0
        for e in data.get("events", []):
            events_by_id[e["id"]] = e  # id 去重，重叠段自然合并
    events = list(events_by_id.values())

    # 小组赛轮次标记：72场按时间序每24场一轮（48队12组、每轮24场、共3轮）。
    # 轮次在日期上不重叠（实测 R1:6/12-18 R2:6/19-24 R3:6/25-28），可安全按天归属。
    gs = sorted((e for e in events
                 if e.get("season", {}).get("slug") == "group-stage"),
                key=lambda e: e.get("date", ""))
    round_of = {}  # event id -> 轮次(1/2/3)
    for i, e in enumerate(gs):
        round_of[e["id"]] = i // 24 + 1

    # 按北京日期聚合：{ '2026-06-12': {date, weekday, total, phases, groupRound} }
    by_day = {}
    for e in events:
        dt = e.get("date")
        if not dt:
            continue
        bj = to_beijing(dt)
        key = bj.strftime("%Y-%m-%d")
        slug = e.get("season", {}).get("slug", "")
        phase_name = PHASE_MAP.get(slug, ("其它", 9))[0]
        if key not in by_day:
            by_day[key] = {
                "date": key,
                "md": f"{bj.month}/{bj.day}",
                "weekday": WEEKDAYS[bj.weekday()],
                "total": 0,
                "phases": {},
                "groupRound": None,  # 小组赛轮次(1/2/3)，淘汰赛为 None
            }
        d = by_day[key]
        d["total"] += 1
        d["phases"][phase_name] = d["phases"].get(phase_name, 0) + 1
        if e["id"] in round_of:
            d["groupRound"] = round_of[e["id"]]  # 同一天同轮，直接覆盖即可
    # 排序成列表，并给每天标主阶段（场次最多的阶段，用于配色）
    days = []
    for key in sorted(by_day):
        d = by_day[key]
        # 主阶段 = 当天场次最多的阶段；其序号供前端配色
        main_phase = max(d["phases"].items(), key=lambda x: x[1])[0]
        order = next((v[1] for v in PHASE_MAP.values() if v[0] == main_phase), 9)
        d["mainPhase"] = main_phase
        d["phaseOrder"] = order
        days.append(d)
    return days, len(events)


def main():
    args = sys.argv[1:]
    if len(args) == 2:
        lo, hi = args
    elif not args:
        lo, hi = DEFAULT_RANGE
    else:
        print("用法: build_schedule.py [<起始UTC日期> <结束UTC日期>]", file=sys.stderr)
        sys.exit(1)

    print(f"拉取赛程 {lo}–{hi} …")
    days, total = build_schedule(lo, hi)
    if days is None:
        print("✗ 赛程接口请求失败，为保护已有数据，拒绝写入。", file=sys.stderr)
        sys.exit(2)
    if not days:
        print("✗ 未取到任何赛程，拒绝写入。", file=sys.stderr)
        sys.exit(2)

    # 读现有 json，只更新 schedule，绝不碰 matches
    with open(PATH, encoding="utf-8") as f:
        wc = json.load(f)
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00")
    wc["schedule"] = {
        "source": "ESPN site.api（赛程总览，非赔率）",
        "fetchedAt": now,
        "totalMatches": total,
        "days": days,
    }
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(wc, f, ensure_ascii=False, indent=2)

    # 报告
    from collections import Counter
    ph = Counter()
    for d in days:
        for p, c in d["phases"].items():
            ph[p] += c
    print(f"✓ 写入 schedule：{len(days)} 个比赛日，{total} 场")
    print(f"  阶段分布：{dict(ph)}")
    print(f"  跨度：{days[0]['date']} ~ {days[-1]['date']}")


if __name__ == "__main__":
    main()

