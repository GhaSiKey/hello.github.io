#!/usr/bin/env python3
"""settle_results.py — 赛后结算（不联网，比分由参数传入）。

读 data/worldcup.json，给指定 mid 填入真实比分、判定每注输赢、算本场与
全局盈亏，写回。只动指定场，不重新爬取、不碰其它场——与 build_wc_data.py
的"全量覆盖"彻底分开，避免误删。

判定规则与 js/simbet/judge.js 完全一致（同一套规则两端实现）。

用法：
    settle_results.py <mid> <主进球> <客进球> [半场主 半场客]
例：
    settle_results.py 2040162 2 0 1 0   # 墨西哥2:0南非，半场1:0
    settle_results.py 2040163 1 1       # 无半场比分(半全场注将标无法结算)
"""
import sys
import os
import json
import time

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "worldcup.json")


def judge(bet_type, pick, full, half):
    """返回 True(中)/False(不中)/None(无法结算)。与 judge.js 一致。"""
    if full is None:
        return None
    h, a = full["h"], full["a"]
    if bet_type == "had":
        r = "h" if h > a else ("a" if h < a else "d")
        return pick == r
    if bet_type == "hhad":
        H = h + pick["goalLine"]
        r = "h" if H > a else ("a" if H < a else "d")
        return pick["side"] == r
    if bet_type == "crs":
        return pick["h"] == h and pick["a"] == a
    if bet_type == "ttg":
        return pick == min(h + a, 7)
    if bet_type == "hafu":
        if half is None:
            return None  # 缺半场比分 → 无法结算
        hh, ha = half["h"], half["a"]
        half_r = "h" if hh > ha else ("a" if hh < ha else "d")
        full_r = "h" if h > a else ("a" if h < a else "d")
        return pick["half"] == half_r and pick["full"] == full_r
    return None


def recalc_summary(data):
    """重算全局 betSummary。无法结算的注不计入命中统计与派彩。"""
    total_stake = total_payout = 0
    hit_bets = settleable_bets = total_bets = 0
    finished = 0
    for m in data["matches"]:
        bets = m["commentary"]["plan"]["bets"]
        total_bets += len(bets)
        total_stake += sum(b["stake"] for b in bets)
        if m.get("result", {}).get("status") == "finished":
            finished += 1
            for b in bets:
                if b.get("hit") is True:
                    hit_bets += 1
                    total_payout += b.get("payout", 0)
                    settleable_bets += 1
                elif b.get("hit") is False:
                    settleable_bets += 1
                # hit is None → 无法结算，不计
    profit = total_payout - total_stake
    data["meta"]["betSummary"] = {
        "totalStake": total_stake,
        "totalPayout": round(total_payout, 2),
        "profit": round(profit, 2),
        "finishedMatches": finished,
        "totalMatches": len(data["matches"]),
        "hitBets": hit_bets,
        "settleableBets": settleable_bets,
        "totalBets": total_bets,
        "roi": round(profit / total_stake, 4) if total_stake else 0,
    }


def main():
    a = sys.argv[1:]
    if len(a) not in (3, 5):
        print(__doc__)
        sys.exit(1)
    mid = int(a[0])
    full = {"h": int(a[1]), "a": int(a[2])}
    half = {"h": int(a[3]), "a": int(a[4])} if len(a) == 5 else None

    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)

    match = next((m for m in data["matches"] if m["mid"] == mid), None)
    if match is None:
        print(f"✗ 找不到 mid={mid}", file=sys.stderr)
        sys.exit(1)

    # 填赛果
    match["result"] = {
        "status": "finished",
        "full": full,
        "half": half,
        "source": "manual",
        "filledAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime()),
    }

    # 判定每注
    bets = match["commentary"]["plan"]["bets"]
    print(f"结算 {match['home']['name']} {full['h']}:{full['a']} {match['away']['name']}"
          + (f" (半场 {half['h']}:{half['a']})" if half else " (无半场比分)"))
    payout = 0
    for b in bets:
        hit = judge(b["type"], b["pick"], full, half)
        b["hit"] = hit
        b["payout"] = b["potential"] if hit is True else (0 if hit is False else None)
        if hit is True:
            payout += b["payout"]
        mark = "✓中" if hit is True else ("✗不中" if hit is False else "—无法结算")
        print(f"  {mark}  {b['market']} @{b['odds']} 投{b['stake']}"
              + (f" → 派彩{b['payout']}" if hit else ""))
    stake = sum(b["stake"] for b in bets)
    print(f"  本场：支出{stake} 收入{round(payout,2)} 盈亏{round(payout-stake,2):+}")

    recalc_summary(data)
    s = data["meta"]["betSummary"]
    print(f"\n全局：已结算 {s['finishedMatches']}/{s['totalMatches']} 场 | "
          f"命中 {s['hitBets']}/{s['settleableBets']}(可结算) | "
          f"总盈亏 {s['profit']:+} | ROI {s['roi']*100:.1f}%")

    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("✓ 已写回")


if __name__ == "__main__":
    main()
