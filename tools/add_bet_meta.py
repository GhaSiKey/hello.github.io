#!/usr/bin/env python3
"""add_bet_meta.py — 给 plan.bets 补结构化判定字段 type/pick（赛前一次性）。

中文 market 含主客歧义（如"捷克胜"要知道捷克是主还是客），无法纯正则解析，
故映射规则由 AI 逐注显式指定（见 PICK_MAP），脚本只负责套用与校验。

幂等：重复运行结果一致。不改 market/odds/stake/potential，只加 type/pick。
"""
import json
import os
import re

PATH = os.path.join(os.path.dirname(__file__), "..", "data", "worldcup.json")


def market_to_pick(market, home, away):
    """把中文 market 映射成 (type, pick)。返回 None 表示无法识别。"""
    m = market.strip()

    # 比分：比分 1:0
    mo = re.match(r"比分\s*(\d+):(\d+)", m)
    if mo:
        return "crs", {"h": int(mo.group(1)), "a": int(mo.group(2))}

    # 平局
    if m == "平局":
        return "had", "d"

    # 半全场 胜/胜（目前方案只出现胜/胜）
    mo = re.match(r"半全场\s*(\S)/(\S)", m)
    if mo:
        sd = {"胜": "h", "平": "d", "负": "a"}
        return "hafu", {"half": sd[mo.group(1)], "full": sd[mo.group(2)]}

    # 总进球：总进球3球（7=7+，判定端对 min(总进球,7) 封顶）
    mo = re.match(r"总进球\s*(\d+)\s*球", m)
    if mo:
        return "ttg", int(mo.group(1))

    # 让球：让球-1 让胜 / 让球+1 让胜(沙特) / 让球-1 让负 /
    #       让球+1 乌拉圭让负（队名夹中间仅作展示消歧，不参与 side——
    #       side 一律由"胜/平/负"字面决定，与队名主客无关）
    mo = re.match(r"让球([+-]?\d+)\s*\S*?让(胜|平|负)", m)
    if mo:
        gl = int(mo.group(1))
        side = {"胜": "h", "平": "d", "负": "a"}[mo.group(2)]
        return "hhad", {"goalLine": gl, "side": side}

    # 球队胜：XX胜 —— 判断该队是主还是客
    mo = re.match(r"(\S+?)胜$", m)
    if mo:
        team = mo.group(1)
        if team == home:
            return "had", "h"
        if team == away:
            return "had", "a"

    return None


def main():
    with open(PATH, encoding="utf-8") as f:
        data = json.load(f)
    total, failed = 0, []
    skipped = 0
    for mt in data["matches"]:
        # 未开盘/未写点评的场 commentary 为空 {}，无 plan——跳过，别崩。
        plan = (mt.get("commentary") or {}).get("plan")
        if not plan:
            skipped += 1
            continue
        home, away = mt["home"]["name"], mt["away"]["name"]
        for b in plan["bets"]:
            res = market_to_pick(b["market"], home, away)
            if res is None:
                failed.append((mt["mid"], b["market"]))
                continue
            b["type"], b["pick"] = res
            total += 1
    if failed:
        print("⚠ 无法映射的注（需补规则）:")
        for mid, mk in failed:
            print(f"   {mid}: {mk}")
        print("已中止，未写入。")
        return
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✓ 已为 {total} 注补充 type/pick，全部识别成功"
          + (f"（跳过 {skipped} 场未开盘/无点评）" if skipped else ""))


if __name__ == "__main__":
    main()
