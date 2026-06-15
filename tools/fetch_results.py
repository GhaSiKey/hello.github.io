#!/usr/bin/env python3
"""fetch_results.py — 赛果取数（只读，不写 json）。

从 ESPN 公开接口拉世界杯赛果，按 mid 贴回 data/worldcup.json 里待结算的
场次，输出"主队 X:Y 客队，半场 a:b，FT"清单 + 可直接复制的 settle 命令。

设计原则 · 取数与判定隔离：
    本脚本只负责"拿到可信比分"，绝不碰 commentary/betSummary、绝不写回。
    判定与写入是 settle_results.py 的职责。两步分开，互不污染。

为什么用 ESPN：体彩接口已 403 封禁；中文比分站多为博彩 SEO 垃圾，不可信。
ESPN 是其官网后端，免费无需 key、含分段比分(半场)、homeAway 明确不会搞反。

数据来源：
    scoreboard?dates=YYYYMMDD  → 当天全部场次：全场比分 + 状态 + 主客方向
    summary?event=<id>         → 单场分段比分：linescores[0] 即上半场

用法：
    fetch_results.py                 # 扫所有"已开赛未结算"的场次
    fetch_results.py 2040162         # 只查指定 mid
    fetch_results.py 2040162 2040163 # 查多个 mid

输出仅供人工核对；确认无误后用打印出的 settle_results.py 命令落地结算。
"""
import sys
import os
import json
import time
import urllib.request
import urllib.error

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "worldcup.json")

API = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world"
UA = "Mozilla/5.0"

# ── 队名映射：体彩中文名 -> ESPN 三字码(abbreviation) ──
# 用三字码而非 displayName 作匹配键：displayName 含特殊字符(Türkiye/Curaçao)
# 且可能随语言/版本漂移，三字码稳定。新增场次只需在此补条目，集中不散落。
CN_TO_ESPN = {
    "墨西哥": "MEX", "南非": "RSA", "韩国": "KOR", "捷克": "CZE",
    "加拿大": "CAN", "波黑": "BIH", "美国": "USA", "巴拉圭": "PAR",
    "卡塔尔": "QAT", "瑞士": "SUI", "巴西": "BRA", "摩洛哥": "MAR",
    "海地": "HAI", "苏格兰": "SCO", "澳大利亚": "AUS", "土耳其": "TUR",
    "德国": "GER", "库拉索": "CUW", "荷兰": "NED", "日本": "JPN",
    "科特迪瓦": "CIV", "厄瓜多尔": "ECU", "瑞典": "SWE", "突尼斯": "TUN",
    "西班牙": "ESP", "佛得角": "CPV", "比利时": "BEL", "埃及": "EGY",
    "沙特": "KSA", "乌拉圭": "URU",
    # 第二批（首轮后半程登场，48队补全）
    "伊朗": "IRN", "新西兰": "NZL", "法国": "FRA", "塞内加尔": "SEN",
    "伊拉克": "IRQ", "挪威": "NOR", "阿根廷": "ARG", "阿尔及利": "ALG",
    "奥地利": "AUT", "约旦": "JOR", "葡萄牙": "POR", "刚果金": "COD",
    "英格兰": "ENG", "克罗地亚": "CRO", "加纳": "GHA", "巴拿马": "PAN",
    "乌兹别克": "UZB", "哥伦比亚": "COL",
}

# 完赛状态：仅这些才取比分结算；进行中/未开赛一律跳过
FINISHED_STATES = {"STATUS_FULL_TIME", "STATUS_FINAL"}


def fetch_json(url):
    """GET 并解析 JSON；失败返回 {}。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"  ! 请求失败 {url}: {e}", file=sys.stderr)
        return {}


def beijing_dates(matches):
    """我方 datetime 是北京时间；比赛跨日，ESPN 按当地日期归档。
    取每场北京日期与其前一天两个候选，覆盖时差，去重后返回 YYYYMMDD 列表。"""
    days = set()
    for m in matches:
        dt = m.get("datetime", "")
        if len(dt) < 10:
            continue
        y, mo, d = int(dt[0:4]), int(dt[5:7]), int(dt[8:10])
        # 北京当天 + 前一天（北京 03:00 = 美洲前一天下午）
        t = time.mktime((y, mo, d, 12, 0, 0, 0, 0, -1))
        for off in (0, -1):
            tt = time.localtime(t + off * 86400)
            days.add(time.strftime("%Y%m%d", tt))
    return sorted(days)


def regular_time_score(linescores):
    """从分段比分取 90 分钟常规时间结果（前两段之和）。
    淘汰赛 linescores 含加时/点球段，竞彩按常规时间判定，故只取前两段。
    返回 (全场进球, 半场进球)；段数不足时半场为 None。"""
    segs = []
    for x in (linescores or []):
        try:
            segs.append(int(x.get("displayValue", "")))
        except (TypeError, ValueError):
            segs.append(None)
    half = segs[0] if len(segs) >= 1 and segs[0] is not None else None
    if len(segs) >= 2 and segs[0] is not None and segs[1] is not None:
        full = segs[0] + segs[1]
    else:
        full = None
    return full, half


def build_espn_index(matches):
    """拉相关日期的 ESPN 场次，建 {frozenset(主码,客码): 赛果}。
    赛果含 home/away 三字码、状态、全场/半场比分（已折算到 90 分钟）。"""
    index = {}
    for date in beijing_dates(matches):
        sb = fetch_json(f"{API}/scoreboard?dates={date}")
        for e in sb.get("events", []):
            comp = e["competitions"][0]
            state = comp["status"]["type"]["name"]
            detail = comp["status"]["type"].get("detail", "")
            cs = comp["competitors"]
            try:
                h = next(c for c in cs if c["homeAway"] == "home")
                a = next(c for c in cs if c["homeAway"] == "away")
            except StopIteration:
                continue
            hc = h["team"].get("abbreviation", "")
            ac = a["team"].get("abbreviation", "")
            rec = {
                "home_code": hc, "away_code": ac,
                "home_name": h["team"].get("displayName", hc),
                "away_name": a["team"].get("displayName", ac),
                "state": state, "detail": detail,
                "full_h": None, "full_a": None, "half_h": None, "half_a": None,
            }
            if state in FINISHED_STATES:
                summ = fetch_json(f"{API}/summary?event={e['id']}")
                scs = (summ.get("header", {}).get("competitions", [{}])[0]
                       .get("competitors", []))
                hl = next((c.get("linescores") for c in scs
                           if c.get("homeAway") == "home"), None)
                al = next((c.get("linescores") for c in scs
                           if c.get("homeAway") == "away"), None)
                rec["full_h"], rec["half_h"] = regular_time_score(hl)
                rec["full_a"], rec["half_a"] = regular_time_score(al)
                time.sleep(0.3)  # 礼貌限流
            index[frozenset((hc, ac))] = rec
    return index


def pick_targets(matches, want_mids):
    """筛出待查场次：指定 mid 则只取那些；否则取所有"已开赛未结算"。"""
    now = time.strftime("%Y-%m-%d %H:%M", time.localtime())
    out = []
    for m in matches:
        if want_mids:
            if m["mid"] in want_mids:
                out.append(m)
            continue
        # 未指定：开赛时间已过 且 尚未结算
        if m.get("result", {}).get("status") == "finished":
            continue
        if m.get("datetime", "")[:16] <= now:
            out.append(m)
    return out


def resolve(match, index):
    """把一场我方数据匹配到 ESPN 赛果。
    返回 (rec, full, half, warn)：full/half 为按我方主客方向校正后的比分 dict。"""
    hc = CN_TO_ESPN.get(match["home"]["name"])
    ac = CN_TO_ESPN.get(match["away"]["name"])
    if not hc or not ac:
        miss = match["home"]["name"] if not hc else match["away"]["name"]
        return None, None, None, f"队名未在映射表：{miss}"
    rec = index.get(frozenset((hc, ac)))
    if rec is None:
        return None, None, None, "ESPN 未找到该对阵（日期/未开赛？）"
    if rec["state"] not in FINISHED_STATES:
        return rec, None, None, f"未完赛（{rec['detail'] or rec['state']}）"
    if rec["full_h"] is None or rec["full_a"] is None:
        return rec, None, None, "完赛但拿不到分段比分"
    # 按我方 home 对齐 ESPN 方向（ESPN 主客可能与我方相反）
    if rec["home_code"] == hc:
        full = {"h": rec["full_h"], "a": rec["full_a"]}
        half = ({"h": rec["half_h"], "a": rec["half_a"]}
                if rec["half_h"] is not None and rec["half_a"] is not None else None)
    else:
        full = {"h": rec["full_a"], "a": rec["full_h"]}
        half = ({"h": rec["half_a"], "a": rec["half_h"]}
                if rec["half_h"] is not None and rec["half_a"] is not None else None)
    warn = "" if half else "无半场比分（半全场注将无法结算）"
    return rec, full, half, warn


def main():
    want_mids = {int(x) for x in sys.argv[1:]} if sys.argv[1:] else set()
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    targets = pick_targets(data["matches"], want_mids)
    if not targets:
        print("没有待查场次（无指定 mid，且无'已开赛未结算'的比赛）。")
        return

    print(f"查 {len(targets)} 场，拉取 ESPN 赛果…\n")
    index = build_espn_index(data["matches"])

    settled, cmds = [], []
    for m in targets:
        rec, full, half, warn = resolve(m, index)
        tag = f"{m['mid']} {m['matchNum']} {m['home']['name']} vs {m['away']['name']}"
        if full is None:
            print(f"  ⏳ {tag}\n       └ {warn}")
            continue
        hs = f"半场 {half['h']}:{half['a']}" if half else "半场未知"
        det = rec["detail"] or rec["state"]
        flag = f"  ⚠{warn}" if warn else ""
        print(f"  ✓ {tag}\n       └ 全场 {full['h']}:{full['a']}  {hs}  [{det}]{flag}")
        # 拼 settle 命令（有半场带 4 参，否则 2 参）
        args = f"{m['mid']} {full['h']} {full['a']}"
        if half:
            args += f" {half['h']} {half['a']}"
        cmds.append(f"python3 tools/settle_results.py {args}")
        settled.append(m["mid"])

    if cmds:
        print("\n── 核对无误后，逐条执行结算 ──")
        for c in cmds:
            print(f"  {c}")
        print("\n⚠ 比分务必人工核对（尤其主客方向、淘汰赛加时）后再结算。")
    else:
        print("\n无可结算场次。")


if __name__ == "__main__":
    main()


