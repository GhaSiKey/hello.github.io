#!/usr/bin/env python3
"""build_wc_data.py — 世界杯赔率页数据构建（阶段①）

拉取 mid 区间内所有比赛的对阵 + 赔率，算好 A 类数学指标，产出
data/worldcup.json（数据契约见 docs/worldcup-web.md §12）。

关键行为 · 合并保留点评：
    若 data/worldcup.json 已存在，按 mid 保留其中的 commentary（AI 写的
    主观点评/购买方案），只覆盖 odds/metrics/tags（机器产出）。
    注意：保留 != 自动更新。赔率变了，点评需重新让 AI 分析才能跟上。

用法：
    python3 build_wc_data.py                  # 用默认区间
    python3 build_wc_data.py 2040162 2040176  # 指定区间

依赖：python3（标准库）+ 同目录 _wc_parse.py
"""
import sys
import os
import json
import time
import urllib.request
import urllib.error

import _wc_parse as P

# ── 接口常量（从体彩前端 JS 逆向，非业务硬编码）──
API_BASE = "https://webapi.sporttery.cn/gateway/uniform/football"
CLIENT_CODE = "3001"
UA = "Mozilla/5.0"
REFERER = "https://www.sporttery.cn/"

# 默认区间（仅默认值，可由命令行覆盖；不写死在逻辑里）
DEFAULT_RANGE = (2040162, 2040176)

# 输出路径（相对脚本：../data/worldcup.json）
OUT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "data", "worldcup.json"
)

# ── A 类价值标签阈值（集中可调，勿散落）──
TH_HOT = 0.60        # 某方去水概率 ≥ 此值 → 大热盘
TH_EVEN = 0.12       # 三项概率极差 ≤ 此值 → 均势盘
TH_DRAW = 0.30       # 平局去水概率 ≥ 此值 → 关注平局
TH_LOW_GOAL = 1      # 总进球众数 ≤ 此值 → 小球倾向（收紧，避免满屏）

REQ_INTERVAL = 0.3   # 请求间隔（礼貌限流，避免被封 IP）


def fetch_json(url):
    """GET 并解析 JSON。返回 (data, ok)：
    ok=False 表示请求失败(403/超时/解析错)，需与"正常空响应"区分——
    前者应保留旧数据，后者才是真正的空 mid。"""
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Referer": REFERER}
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8")), True
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"  ! 请求失败 {url}: {e}", file=sys.stderr)
        return {}, False



def normalize_logo(path):
    """补全 logo 协议：//static... -> https://static..."""
    if not path:
        return ""
    return ("https:" + path) if path.startswith("//") else path


def compute_tags(metrics, odds):
    """A 类价值标签：套阈值，纯客观。"""
    tags = []
    had = metrics.get("had")
    if had:
        p = had["prob"]
        vals = [p["h"], p["d"], p["a"]]
        if max(vals) >= TH_HOT:
            tags.append("大热盘")
        if (max(vals) - min(vals)) <= TH_EVEN:
            tags.append("均势盘")
        if p["d"] >= TH_DRAW:
            tags.append("关注平局")
    ttg = metrics.get("ttg")
    if ttg and ttg.get("mode") is not None and ttg["mode"] <= TH_LOW_GOAL:
        tags.append("小球倾向")
    return tags


def build_match(mid):
    """拉单场并组装为契约对象。
    返回值三态：
      - dict          ：正常抓到
      - None          ：真正的空 mid（接口正常响应但无对阵）
      - "FETCH_FAILED"：请求失败(403/超时)，调用方应保留旧数据，勿当空场
    """
    head, ok = fetch_json(
        f"{API_BASE}/getMatchHeadV1.qry?source=web&sportteryMatchId={mid}"
    )
    if not ok:
        return "FETCH_FAILED"  # 请求失败，不可判定该 mid 死活
    hv = head.get("value", {}) or {}
    home = hv.get("homeTeamShortName")
    if not home:
        return None  # 接口正常但无对阵 → 真空 mid，跳过

    bonus, _ = fetch_json(
        f"{API_BASE}/getFixedBonusV1.qry?clientCode={CLIENT_CODE}&matchId={mid}"
    )
    oh = (bonus.get("value", {}) or {}).get("oddsHistory") or {}

    odds = P.extract_odds(oh) if oh else {}
    metrics = P.compute_metrics(odds) if odds else {}
    tags = compute_tags(metrics, odds) if metrics else []
    # 状态：有胜平负=open；仅让球等其它玩法=hhad_only；无任何赔率=not_open
    if odds.get("had"):
        status = "open"
    elif odds:
        status = "hhad_only"
    else:
        status = "not_open"

    return {
        "mid": mid,
        "matchNum": hv.get("matchNum", ""),
        "datetime": hv.get("matchDateTime", ""),
        "group": hv.get("groupName", ""),
        "phase": hv.get("phaseName", ""),
        "tournament": hv.get("tournamentCnShortName", ""),
        "status": status,
        "home": {"name": home, "logo": normalize_logo(hv.get("homeTeamLogoPath"))},
        "away": {"name": hv.get("awayTeamShortName", ""),
                 "logo": normalize_logo(hv.get("awayTeamLogoPath"))},
        "odds": odds,
        "metrics": metrics,
        "tags": tags,
        # commentary 由 AI 阶段②写入；这里给空壳，merge 时保留旧值
        "commentary": {},
    }


def load_existing_matches(path):
    """读旧 JSON，返回 {mid: 完整场记录}。
    用途有二：① 合并保留 commentary；② 请求失败时沿用整条旧记录，防丢场。"""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
        return {m["mid"]: m for m in old.get("matches", [])}
    except (ValueError, KeyError) as e:
        print(f"  ! 旧数据解析失败，跳过合并: {e}", file=sys.stderr)
        return {}


def main():
    args = sys.argv[1:]
    if len(args) == 2:
        lo, hi = int(args[0]), int(args[1])
    elif not args:
        lo, hi = DEFAULT_RANGE
    else:
        print("用法: build_wc_data.py [<起始mid> <结束mid>]", file=sys.stderr)
        sys.exit(1)
    if lo > hi:
        print("起始 mid 需 <= 结束 mid", file=sys.stderr)
        sys.exit(1)

    old_matches = load_existing_matches(OUT_PATH)
    if old_matches:
        print(f"合并模式：已有 {len(old_matches)} 场（保留点评，失败场沿用旧数据）")

    matches = []
    failed_kept = 0
    for mid in range(lo, hi + 1):
        m = build_match(mid)
        if m == "FETCH_FAILED":
            # 请求失败：若旧数据有该场，沿用整条旧记录，绝不丢场
            if mid in old_matches:
                matches.append(old_matches[mid])
                failed_kept += 1
                print(f"  {mid}  [请求失败，沿用旧数据] ✎{old_matches[mid]['home']['name']}"
                      f" vs {old_matches[mid]['away']['name']}")
            else:
                print(f"  {mid}  [请求失败，无旧数据可保留，跳过]")
            time.sleep(REQ_INTERVAL)
            continue
        if m is None:
            print(f"  {mid}  [空，跳过]")
            time.sleep(REQ_INTERVAL)
            continue
        # 合并保留旧点评（按 mid）
        old = old_matches.get(mid)
        # ── 赔率防降级（核心）──
        # 反爬有时返回"200 但赔率为空"，绕过 FETCH_FAILED 判断，会把已有赔率
        # 覆盖成空、status 降级为 not_open。策略：有赔率绝不降级——本次赔率为空、
        # 而旧数据已有赔率时，沿用旧 odds/metrics/tags/status，只接受"空→有"。
        degraded = False
        if old and old.get("odds") and not m.get("odds"):
            m["odds"] = old["odds"]
            m["metrics"] = old.get("metrics", {})
            m["tags"] = old.get("tags", [])
            m["status"] = old.get("status", m["status"])
            degraded = True
        if old and old.get("commentary"):
            m["commentary"] = old["commentary"]
        # 若旧场已结算，保留其 result（build 只管赔率，不碰结算）
        if old and old.get("result"):
            m["result"] = old["result"]
        flag = "✎保留点评" if (old and old.get("commentary")) else ""
        if degraded:
            flag += " ⚠赔率空响应，沿用旧赔率"
        print(f"  {mid}  {m['home']['name']} vs {m['away']['name']}"
              f"  [{m['status']}] {flag}")
        matches.append(m)
        time.sleep(REQ_INTERVAL)

    now = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime())
    data = {
        "meta": {
            "title": "2026 FIFA World Cup",
            "crawledAt": now,
            "analyzedAt": None,  # 阶段②由 AI 填
            "source": "中国体育彩票 webapi.sporttery.cn",
            "midRange": [lo, hi],
            "disclaimer": "数据仅供参考，不构成投注建议；竞彩为负和游戏，长期期望为负",
        },
        "matches": matches,
    }

    # ── 数据保护 · 三道防线 ──
    # 防线1：完全抓空（接口全挂）→ 拒绝，避免清空。
    if not matches:
        print("\n✗ 本次未抓到任何比赛（接口可能 403/限流）。"
              "为保护已有数据，拒绝写入。", file=sys.stderr)
        sys.exit(2)
    # 防线2（核心）：已有的每个 mid 必须都在本次结果里——这是真正防丢场的闸门。
    # 旧 bug：只比总数，403 跳过旧场+新增场凑够总数时会悄悄丢已结算数据。
    # 经上面"失败沿用旧数据"后，正常不会触发；此处作为最后兜底。
    new_mids = {m["mid"] for m in matches}
    lost = sorted(set(old_matches) - new_mids)
    if lost and "--force" not in sys.argv:
        print(f"\n✗ 检测到 {len(lost)} 个已有场次将丢失：{lost}\n"
              f"  （这些 mid 旧数据里有、本次结果里没有，疑似接口失败未能保留）\n"
              f"  为防数据丢失，拒绝写入。确认要删除这些场才加 --force。",
              file=sys.stderr)
        sys.exit(2)
    if failed_kept:
        print(f"\n⚠ {failed_kept} 场请求失败，已沿用旧数据（赔率未更新）。")

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n已写入 {os.path.relpath(OUT_PATH)}：{len(matches)} 场")


if __name__ == "__main__":
    main()
