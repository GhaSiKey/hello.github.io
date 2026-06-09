#!/usr/bin/env python3
"""wc_odds 的赔率解析后端。

由 wc_odds.sh 调用，避免在 shell 里内联 Python 导致的引号地狱。
从 stdin 读取 "head_json@@@bonus_json"，按模式输出。

用法：
    _wc_parse.py match <mid>   # 单场全部玩法
    _wc_parse.py scan  <mid>   # 一行摘要（对阵 + 胜平负）
"""
import sys
import json
import re


def load_value(raw):
    """解析接口响应，取 value 字段；失败返回空 dict。"""
    try:
        return json.loads(raw).get("value", {}) or {}
    except Exception:
        return {}


def margin(odds):
    """返回 (隐含概率和, 返还率)。"""
    inv = sum(1 / o for o in odds if o > 0)
    return inv, (1 / inv if inv else 0)


def fmt_score_name(key):
    """把比分字段名翻译成人类可读：s02s00 -> 2:0，s-1sh -> 胜其它。"""
    special = {"s-1sh": "胜其它", "s-1sd": "平其它", "s-1sa": "负其它"}
    if key in special:
        return special[key]
    m = re.match(r"s(\d\d)s(\d\d)", key)
    return f"{int(m.group(1))}:{int(m.group(2))}" if m else key


# 半全场字段 -> 中文
HAFU_MAP = {
    "hh": "胜/胜", "hd": "胜/平", "ha": "胜/负",
    "dh": "平/胜", "dd": "平/平", "da": "平/负",
    "ah": "负/胜", "ad": "负/平", "aa": "负/负",
}


# ── 标准化提取（纯函数，无副作用；供 build_wc_data.py 复用）─────────────

def extract_score_list(crs):
    """比分 dict -> [{"name":"1:1","odds":5.0}]，按赔率升序。"""
    items = []
    for k, v in crs.items():
        if k.endswith("f") or k in ("goalLine", "updateDate", "updateTime"):
            continue
        try:
            o = float(v)
        except (TypeError, ValueError):
            continue
        if o <= 0:
            continue
        items.append({"name": fmt_score_name(k), "odds": o})
    items.sort(key=lambda x: x["odds"])
    return items


def extract_odds(oh):
    """oddsHistory -> 标准化 odds 对象（与数据契约 §12 对齐）。"""
    had = (oh.get("hadList") or [{}])[0]
    ttg = (oh.get("ttgList") or [{}])[0]
    hafu = (oh.get("hafuList") or [{}])[0]
    crs = (oh.get("crsList") or [{}])[0]

    out = {}
    if had.get("h"):
        out["had"] = {"h": had["h"], "d": had["d"], "a": had["a"]}
    # 让球只取最新一条（hhadList 含历史变动记录，第一条为最新），
    # 与其它玩法一致，避免展示多行让球误导为多个盘口
    hhad_list = oh.get("hhadList") or []
    if hhad_list:
        x = hhad_list[0]
        out["hhad"] = [{"goalLine": x.get("goalLine", ""), "h": x.get("h"),
                        "d": x.get("d"), "a": x.get("a")}]
    else:
        out["hhad"] = []
    if ttg.get("s0"):
        out["ttg"] = {str(i): ttg.get("s" + str(i)) for i in range(8)}
    if hafu.get("hh"):
        out["hafu"] = {k: hafu.get(k) for k in HAFU_MAP}
    scores = extract_score_list(crs)
    if scores:
        out["crs"] = scores
    return out


def compute_metrics(odds):
    """由标准化 odds 算 A 类数学指标（返还率/去水概率/总进球众数）。"""
    m = {}
    had = odds.get("had")
    if had:
        o = [float(had["h"]), float(had["d"]), float(had["a"])]
        inv, ret = margin(o)
        m["had"] = {
            "return": round(ret, 4),
            "prob": {
                "h": round(1 / o[0] / inv, 4),
                "d": round(1 / o[1] / inv, 4),
                "a": round(1 / o[2] / inv, 4),
            },
        }
    ttg = odds.get("ttg")
    if ttg:
        pairs = [(int(k), float(v)) for k, v in ttg.items() if v and float(v) > 0]
        _, ret = margin([o for _, o in pairs])
        mode = min(pairs, key=lambda p: p[1])[0] if pairs else None
        m["ttg"] = {"return": round(ret, 4), "mode": mode}
    hafu = odds.get("hafu")
    if hafu:
        o = [float(v) for v in hafu.values() if v and float(v) > 0]
        _, ret = margin(o)
        m["hafu"] = {"return": round(ret, 4)}
    crs = odds.get("crs")
    if crs:
        _, ret = margin([c["odds"] for c in crs])
        m["crs"] = {"return": round(ret, 4)}
    return m


def render_match(mid, hv, bv):
    """单场详情：对阵 + 全部玩法赔率。"""
    home = hv.get("homeTeamShortName")
    if not home:
        print(f"mid={mid}：无对阵数据（可能未开售或 mid 无效）")
        return
    away = hv.get("awayTeamShortName") or ""
    print(f"== {home} vs {away} ==")
    tn = hv.get("tournamentCnShortName", "")
    ph = hv.get("phaseName", "")
    grp = hv.get("groupName", "")
    dt = hv.get("matchDateTime", "")
    num = hv.get("matchNum", "")
    print(f"   赛事 {tn} {ph} {grp} | {dt} 北京 | {num} | mid={mid}")

    oh = bv.get("oddsHistory") or {}
    if not oh:
        print("   （赔率未开盘）")
        return

    # 胜平负
    had = (oh.get("hadList") or [{}])[0]
    if had.get("h"):
        o = [float(had["h"]), float(had["d"]), float(had["a"])]
        inv, ret = margin(o)
        print(f"\n[胜平负] 主胜 {o[0]}  平 {o[1]}  客胜 {o[2]}   返还率 {ret * 100:.1f}%")
        print(f"         去水概率: 主 {1 / o[0] / inv * 100:.0f}%  "
              f"平 {1 / o[1] / inv * 100:.0f}%  客 {1 / o[2] / inv * 100:.0f}%")

    # 让球胜平负
    for x in (oh.get("hhadList") or []):
        gl = x.get("goalLine", "")
        print(f"[让球{gl}] 让胜 {x.get('h')}  让平 {x.get('d')}  让负 {x.get('a')}")

    # 总进球
    t = (oh.get("ttgList") or [{}])[0]
    if t.get("s0"):
        cells = [f"{'7+' if i == 7 else i}球:{t.get('s' + str(i))}" for i in range(8)]
        print("[总进球] " + "  ".join(cells))

    # 半全场
    hf = (oh.get("hafuList") or [{}])[0]
    if hf.get("hh"):
        print("[半全场] " + "  ".join(f"{n}:{hf.get(k)}" for k, n in HAFU_MAP.items()))

    # 比分（按赔率升序取热门 8 项）
    crs = (oh.get("crsList") or [{}])[0]
    items = []
    for k, v in crs.items():
        if k.endswith("f") or k in ("goalLine", "updateDate", "updateTime"):
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f <= 0:
            continue
        items.append((f, fmt_score_name(k)))
    items.sort()
    if items:
        print("[比分] 热门: " + "  ".join(f"{nm}({o})" for o, nm in items[:8]))

    upd = (had.get("updateDate", "") + " " + had.get("updateTime", "")).strip()
    if upd:
        print(f"\n   赔率更新: {upd}")


def render_scan(mid, hv, bv):
    """区间扫描的单行摘要。"""
    home = hv.get("homeTeamShortName")
    if not home:
        print(f"{mid}  [空/未开盘]")
        return
    away = hv.get("awayTeamShortName") or ""
    num = hv.get("matchNum") or ""
    dt = hv.get("matchDateTime") or ""
    grp = hv.get("groupName") or ""
    had = ((bv.get("oddsHistory") or {}).get("hadList") or [{}])[0]
    hh, d, a = had.get("h", "-"), had.get("d", "-"), had.get("a", "-")
    matchup = f"{home} vs {away}"
    print(f"{mid}  {num:<8} {dt:<16} {grp:<4} {matchup:<22} {hh}/{d}/{a}")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("match", "scan"):
        print("用法: _wc_parse.py <match|scan> <mid>", file=sys.stderr)
        sys.exit(1)
    mode, mid = sys.argv[1], sys.argv[2]
    parts = sys.stdin.read().split("@@@")
    hv = load_value(parts[0]) if len(parts) > 0 else {}
    bv = load_value(parts[1]) if len(parts) > 1 else {}
    (render_match if mode == "match" else render_scan)(mid, hv, bv)


if __name__ == "__main__":
    main()
