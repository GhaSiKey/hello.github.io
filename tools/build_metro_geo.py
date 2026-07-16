#!/usr/bin/env python3
"""build_metro_geo.py — 上海地铁运行图·几何数据构建（阶段①）

抓取两个公开源并统一坐标系，产出线路/站点/轨道几何（不含时刻表）：

    · 站点坐标、线路拓扑、站名、换乘 —— 高德地铁图（GCJ-02 火星坐标）
    · 站间真实轨道几何 ——————————— OSM Overpass（WGS-84）

坐标统一到 WGS-84：高德站点用纯算法 GCJ-02→WGS-84 反解，OSM 几何本就是
WGS-84，二者叠加不再错位（否则整体偏移约 480m）。站点投影到轨道折线取里程，
供前端「里程↔经纬度」插值使用（车沿真实轨道跑，过弯不穿墙）。

数据契约见 docs/shmetro.md。页面运行时只 fetch 产出的 JSON，不联网。

用法：
    python3 build_metro_geo.py            # 默认线路集（1、2 号线）
    python3 build_metro_geo.py 1 2 10     # 指定线路 ref

依赖：python3 标准库（urllib/json/math）。与 tools/ 其余脚本一致，零第三方依赖。
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

# ---- 数据源（无 key、公开）。城市由 adcode 决定，非硬编码某线某站 ----
AMAP_URL = ("https://map.amap.com/service/subway"
            "?_{ts}&srhdata={adcode}_drw_shanghai.json")
AMAP_ADCODE = "3100"  # 上海。换城市只改这里 + Overpass 的 network 名
OVERPASS_ENDPOINTS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
OVERPASS_NETWORK = "上海|Shanghai"
OSM_RETRIES = 4       # Overpass 常超时，多轮重试
OSM_BACKOFF = 8       # 每轮失败后退避基数（秒），逐轮递增

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(HERE, "..", "data", "shmetro.json")

# ---- 线路规格表：id → 抓取参数 ----
# 数字线走默认（amap_name=f"{id}号线", osm_ref=id, route=subway）；
# 特殊线在此显式覆盖。磁浮线暂缓（OSM route=maglev 抓取持续超时）。
LINE_SPECS = {
    # 5/10/11 号线是 Y 形分支线，走 BRANCH_LINES 分支逻辑（每支高德直连），
    # 不在此配 force_fallback。
    # 市域机场线在 OSM 里 route=train（非 subway），故之前匹配不到轨道 relation
    # 而走兜底斜线。改用 train 抓取真实几何（含景洪路↔中春路的直角弯）。
    "airport": {"amap_name": "市域机场线", "osm_ref": "市域机场线",
                "osm_route": "train", "amap_fallback": True},
    "pujiang": {"amap_name": "浦江线", "osm_ref": "浦江",
                "osm_route": "light_rail"},
}


def spec_of(lid):
    """取某线抓取规格。数字线自动生成默认规格。"""
    if lid in LINE_SPECS:
        return LINE_SPECS[lid]
    return {"amap_name": f"{lid}号线", "osm_ref": lid, "osm_route": "subway"}


# ---- 支线端点站排除表：id → {站名} ----
# 高德把 Y 形线的支线站串进主线序，但 OSM 主干几何不含支线，导致该站投影塌缩。
# 主干几何是好的，仅需剔除这些无法在主干上定位的支线端点站。
# 现全部 Y 形分叉线改用高德兜底（force_fallback），保全所有站点，无需剔站。
EXCLUDE_STATIONS = {}


# Y 形分支线：高德已按支拆分。每支按首末站端点匹配 OSM 的分支 relation 抓真实
# 几何（fetch_osm_branches + _match_branch_relation），匹配不到才退高德站点直连。
BRANCH_LINES = {"5", "10", "11"}

# 全网默认范围（磁浮线 maglev 暂缓）
DEFAULT_LINES = [str(i) for i in range(1, 19)] + ["airport", "pujiang"]


# ======================================================================
# 一、坐标系：GCJ-02（火星坐标）→ WGS-84 纯算法反解
#   高德/腾讯等国内地图为 GCJ-02，OSM 为 WGS-84。不统一会整体偏移约 480m。
#   这里把高德站点反解回 WGS-84，与 OSM 轨道几何对齐。
# ======================================================================
_GCJ_A = 6378245.0          # 克拉索夫斯基椭球长半轴
_GCJ_EE = 0.00669342162296594323  # 偏心率平方


def _tf_lat(x, y):
    r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(y * math.pi) + 40 * math.sin(y / 3 * math.pi)) * 2 / 3
    r += (160 * math.sin(y / 12 * math.pi) + 320 * math.sin(y * math.pi / 30)) * 2 / 3
    return r


def _tf_lng(x, y):
    r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    r += (20 * math.sin(6 * x * math.pi) + 20 * math.sin(2 * x * math.pi)) * 2 / 3
    r += (20 * math.sin(x * math.pi) + 40 * math.sin(x / 3 * math.pi)) * 2 / 3
    r += (150 * math.sin(x / 12 * math.pi) + 300 * math.sin(x / 30 * math.pi)) * 2 / 3
    return r


def gcj02_to_wgs84(lng, lat):
    """GCJ-02 经纬度反解为 WGS-84。中国境外原样返回。"""
    if not (72.004 <= lng <= 137.847 and 0.833 <= lat <= 55.833):
        return lng, lat
    dlat = _tf_lat(lng - 105.0, lat - 35.0)
    dlng = _tf_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - _GCJ_EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_GCJ_A * (1 - _GCJ_EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_GCJ_A / sqrtmagic * math.cos(radlat) * math.pi)
    return lng - dlng, lat - dlat


# ======================================================================
# 二、几何工具：折线里程、点到折线投影
# ======================================================================
_R_EARTH = 6371000.0  # 地球平均半径（米）


def haversine(a, b):
    """两点 (lon,lat) 间大圆距离（米）。"""
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _R_EARTH * math.asin(math.sqrt(h))


def cumulative_mileage(poly):
    """折线各顶点的累计里程（米），poly 为 [(lon,lat), ...]。"""
    cum = [0.0]
    for i in range(1, len(poly)):
        cum.append(cum[-1] + haversine(poly[i - 1], poly[i]))
    return cum


def project_to_polyline(pt, poly, cum):
    """把点投影到折线，返回 (里程, 到折线最近距离)。

    在每一段线段上取投影点（clamp 到端点），比只取顶点更准。
    """
    best_dist = float("inf")
    best_mile = 0.0
    px, py = pt
    for i in range(len(poly) - 1):
        ax, ay = poly[i]
        bx, by = poly[i + 1]
        # 用平面近似（地铁尺度下误差可忽略）求投影比例 t
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        if seg2 == 0:
            t = 0.0
        else:
            t = ((px - ax) * dx + (py - ay) * dy) / seg2
            t = max(0.0, min(1.0, t))
        proj = (ax + t * dx, ay + t * dy)
        d = haversine(pt, proj)
        if d < best_dist:
            best_dist = d
            best_mile = cum[i] + haversine(poly[i], proj)
    return best_mile, best_dist


# ======================================================================
# 三、抓取：高德站点/拓扑 + OSM 轨道几何
# ======================================================================
def _http_get(url, data=None, timeout=90):
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": UA,
        "Referer": "https://subway.amap.com/",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def fetch_amap():
    """拉高德全网地铁数据，返回 {线路名: {color, branches:[...], stations:[去重全线]}}。

    高德把同线的上下行/支线拆成多个 lobj。**保留分支**：每个 lobj 作为一支
    （去掉上下行重复：同端点集合的支只留一个），供 Y 形线各支独立成几何。
    顶层 stations 为全线按 poiid 去重，供图例/换乘/站点图层。
    """
    url = AMAP_URL.format(ts=int(time.time() * 1000), adcode=AMAP_ADCODE)
    raw = _http_get(url)
    data = json.loads(raw)

    # 全网 poiid→所属线路名集合，用于识别换乘
    poi_lines = {}
    for lobj in data["l"]:
        ln = _norm_line_name(lobj["ln"])
        for st in lobj["st"]:
            poi_lines.setdefault(st["poiid"], set()).add(ln)

    def mk_station(st, ln):
        lng, lat = map(float, st["sl"].split(","))
        wlng, wlat = gcj02_to_wgs84(lng, lat)
        return {
            "name": st["n"],
            "poiid": st["poiid"],
            "lon": round(wlng, 6),
            "lat": round(wlat, 6),
            "transfer": sorted(poi_lines.get(st["poiid"], set()) - {ln}),
        }

    lines = {}
    for lobj in data["l"]:
        ln = _norm_line_name(lobj["ln"])
        color = "#" + lobj.get("cl", "888888")
        bucket = lines.setdefault(
            ln, {"color": color, "branches": [], "stations": [], "_seen": set(),
                 "_brseen": set()})
        br_stations = [mk_station(st, ln) for st in lobj["st"]]
        # 去掉上下行重复分支：以「端点站 poiid 的无序对 + 站数」为签名
        if br_stations:
            sig = (frozenset([br_stations[0]["poiid"], br_stations[-1]["poiid"]]),
                   len(br_stations))
            if sig not in bucket["_brseen"]:
                bucket["_brseen"].add(sig)
                bucket["branches"].append({
                    "la": lobj.get("la", ""),   # 高德给的方向标注，如"花桥-迪士尼"
                    "stations": br_stations,
                })
        # 顶层全线去重站点
        for s in br_stations:
            if s["poiid"] in bucket["_seen"]:
                continue
            bucket["_seen"].add(s["poiid"])
            bucket["stations"].append(s)

    for b in lines.values():
        b.pop("_seen", None)
        b.pop("_brseen", None)
    return lines


def _norm_line_name(ln):
    """'地铁1号线'/'1号线' → '1号线'，统一线路名。"""
    return ln.replace("地铁", "").strip()


def _chain_ways(ways):
    """把一组 way（可能乱序、方向不一）链式拼接成一条连续折线。

    OSM route relation 里成员 way 的顺序和方向都不保证。这里用贪心最近邻：
    从第一条 way 起，每次找与当前链头/尾端点最近的下一条 way，必要时翻转其方向，
    首尾相接。返回 (poly, max_gap)，max_gap 为拼接过程中最大接缝距离（米），
    用于判断这条线是否本就断裂。
    """
    segs = [[(p["lon"], p["lat"]) for p in w["geometry"]]
            for w in ways if w.get("geometry")]
    if not segs:
        return [], float("inf")

    remaining = segs[1:]
    chain = list(segs[0])
    max_gap = 0.0
    while remaining:
        head, tail = chain[0], chain[-1]
        best_i, best_rev, best_end, best_d = None, False, None, float("inf")
        for i, s in enumerate(remaining):
            # 该 way 可接在链尾（正/反）或链头（正/反），取四种里最近的
            cands = [
                (haversine(tail, s[0]), i, False, "tail"),
                (haversine(tail, s[-1]), i, True, "tail"),
                (haversine(head, s[-1]), i, False, "head"),
                (haversine(head, s[0]), i, True, "head"),
            ]
            for d, idx, rev, end in cands:
                if d < best_d:
                    best_d, best_i, best_rev, best_end = d, idx, rev, end
        seg = remaining.pop(best_i)
        if best_rev:
            seg = seg[::-1]
        max_gap = max(max_gap, best_d)
        if best_end == "tail":
            chain.extend(seg[1:] if chain[-1] == seg[0] else seg)
        else:
            chain = (seg[:-1] if seg[-1] == chain[0] else seg) + chain
    return chain, max_gap


def fetch_osm_geometry(ref, route="subway"):
    """抓某条线（ref）的轨道几何，返回 (折线[(lon,lat),...], 方向名)。

    一条线在 OSM 是多个 route relation（上/下行）。对每个方向用 _chain_ways
    链式拼接，再选「接缝最小（最连续）」的方向作为主线——而非盲目取点最多的，
    因为点多的方向可能恰恰是断裂的（2 号线即如此）。

    route: OSM route 类型（subway / light_rail 等）。浦江线是 light_rail。
    """
    query = (
        "[out:json][timeout:120];"
        'relation["route"="%s"]["ref"="%s"]'
        '["network"~"%s"];out geom;' % (route, ref, OVERPASS_NETWORK)
    )
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")

    # Overpass 公共实例常有 429/504。多轮 × 多端点 + 退避重试。
    last_err = None
    for attempt in range(OSM_RETRIES):
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                raw = _http_get(endpoint, data=body, timeout=180)
                d = json.loads(raw)
                rels = [e for e in d.get("elements", []) if e.get("type") == "relation"]
                if not rels:
                    last_err = "无 relation"
                    continue
                # 对每个方向链式拼接，记录 (接缝, 折线, 名字)
                cand = []
                for r in rels:
                    ways = [m for m in r.get("members", [])
                            if m["type"] == "way" and m.get("geometry")]
                    poly, gap = _chain_ways(ways)
                    if poly:
                        cand.append((gap, poly, r.get("tags", {}).get("name", "")))
                if not cand:
                    last_err = "几何为空"
                    continue
                # 选接缝最小者（最连续）
                cand.sort(key=lambda c: c[0])
                gap, poly, name = cand[0]
                if gap > 200:
                    print(f"    ⚠ {ref}号线最佳方向仍有 {gap:.0f}m 接缝，几何可能不完整")
                return poly, name
            except Exception as e:  # noqa: BLE001 —— 逐个 endpoint 兜底重试
                last_err = str(e)
                continue
        if attempt < OSM_RETRIES - 1:
            wait = OSM_BACKOFF * (attempt + 1)
            print(f"    OSM ref={ref} 第{attempt+1}轮失败（{last_err}），{wait}s 后重试 …")
            time.sleep(wait)
    raise RuntimeError(f"OSM 抓取 ref={ref} 失败：{last_err}")


def fetch_osm_branches(ref, route="subway"):
    """抓某 ref 的所有 route relation，各自 _chain_ways 拼接，返回候选列表：
    [{ poly, gap, from, to, name, head, tail }]。供分支线按端点匹配挑选。

    head/tail 为拼接后折线的首/末端点 (lon,lat)。分支线一次抓全部方向，
    再由 build_line 按各支首末站坐标匹配最合适的 relation。
    """
    query = (
        "[out:json][timeout:120];"
        'relation["route"="%s"]["ref"="%s"]'
        '["network"~"%s"];out geom;' % (route, ref, OVERPASS_NETWORK)
    )
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_err = None
    for attempt in range(OSM_RETRIES):
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                raw = _http_get(endpoint, data=body, timeout=180)
                d = json.loads(raw)
                rels = [e for e in d.get("elements", []) if e.get("type") == "relation"]
                if not rels:
                    last_err = "无 relation"
                    continue
                cands = []
                for r in rels:
                    ways = [m for m in r.get("members", [])
                            if m["type"] == "way" and m.get("geometry")]
                    poly, gap = _chain_ways(ways)
                    if not poly:
                        continue
                    tags = r.get("tags", {})
                    cands.append({
                        "poly": poly, "gap": gap,
                        "from": tags.get("from", ""), "to": tags.get("to", ""),
                        "name": tags.get("name", ""),
                        "head": poly[0], "tail": poly[-1],
                    })
                if not cands:
                    last_err = "几何为空"
                    continue
                return cands
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
                continue
        if attempt < OSM_RETRIES - 1:
            wait = OSM_BACKOFF * (attempt + 1)
            print(f"    OSM 分支 ref={ref} 第{attempt+1}轮失败（{last_err}），{wait}s 后重试 …")
            time.sleep(wait)
    raise RuntimeError(f"OSM 抓取分支 ref={ref} 失败：{last_err}")


def _match_branch_relation(br_stations, cands):
    """把一支（高德站点）匹配到最合适的 OSM relation 候选。

    用本支首末站坐标与候选折线两端点的距离和最小者；容忍方向翻转（若反向更近
    则翻转 poly）。返回 (poly, dist) 或 (None, inf) 当最小距离超阈值。
    """
    a = (br_stations[0]["lon"], br_stations[0]["lat"])
    z = (br_stations[-1]["lon"], br_stations[-1]["lat"])
    best_poly, best_d = None, float("inf")
    for c in cands:
        # 正向：a~head, z~tail；反向：a~tail, z~head
        d_fwd = haversine(a, c["head"]) + haversine(z, c["tail"])
        d_rev = haversine(a, c["tail"]) + haversine(z, c["head"])
        if d_fwd <= d_rev and d_fwd < best_d:
            best_d, best_poly = d_fwd, c["poly"]
        elif d_rev < d_fwd and d_rev < best_d:
            best_d, best_poly = d_rev, c["poly"][::-1]
    # 阈值：两端点距离和 < 4km（单端 <2km；GCJ→WGS 偏移约几百米，留足余量）
    if best_poly is None or best_d > 4000:
        return None, float("inf")
    return best_poly, best_d


# ======================================================================
# 四、组装：站点投影取里程、按里程排序、校验、写 JSON
# ======================================================================
def _fallback_polyline(stations):
    """兜底几何：把站点连成折线。用贪心最近邻排序而非高德原始线序，
    最小化 Y/三叉线在支线间跳转产生的长折返边（如 11 号线迪士尼→上海赛车场 47km）。

    从一个端点起步（取彼此距离最远的两站之一作端点），每次接最近的未访问站。
    这对分叉线不完美（分叉点后仍会先走完一支再折回），但比高德线序的
    盲目跳转显著更好，且里程单调、站点投影零偏移。
    """
    pts = [(s["lon"], s["lat"]) for s in stations]
    n = len(pts)
    if n <= 2:
        return pts
    # 选起点：离“质心最远”的站，通常是某个线路端点
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    start = max(range(n), key=lambda i: haversine((cx, cy), pts[i]))
    order = [start]
    used = {start}
    while len(order) < n:
        last = pts[order[-1]]
        nxt = min((i for i in range(n) if i not in used),
                  key=lambda i: haversine(last, pts[i]))
        order.append(nxt)
        used.add(nxt)
    return [pts[i] for i in order]


def _smooth_polyline(pts, seg_pts=16):
    """Catmull-Rom 样条平滑：曲线精确穿过每个原始点（站点），仅把相邻点间的
    直线段替换为缓和曲线。用于高德兜底几何——站点直连的生硬折角变顺滑，
    且因过控制点，站点投影里程几乎不变。

    pts: [(lon,lat)]；seg_pts: 每段插值点数。返回平滑后的点序列（含所有原始点）。
    """
    n = len(pts)
    if n <= 2:
        return list(pts)
    # 端点各复制一份作虚拟控制点，保证首末段也有切线
    ext = [pts[0]] + list(pts) + [pts[-1]]
    out = [pts[0]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(1, seg_pts + 1):
            t = s / seg_pts
            t2, t3 = t * t, t * t * t
            # Catmull-Rom 基函数（标准形式，tension 通过 0.5 系数体现）
            def crom(a, b, c, d):
                return 0.5 * ((2 * b) + (-a + c) * t +
                              (2 * a - 5 * b + 4 * c - d) * t2 +
                              (-a + 3 * b - 3 * c + d) * t3)
            out.append((crom(p0[0], p1[0], p2[0], p3[0]),
                        crom(p0[1], p1[1], p2[1], p3[1])))
    return out


def _project_stations(poly, src_stations, ln_name, exclude=frozenset()):
    """把一组站点投影到折线取里程，按里程排序。返回 (stations, max_off, warns)。"""
    cum = cumulative_mileage(poly)
    stations = []
    max_off = 0.0
    for st in src_stations:
        if st["name"] in exclude:
            continue
        mile, off = project_to_polyline((st["lon"], st["lat"]), poly, cum)
        max_off = max(max_off, off)
        stations.append({**st, "mileage_m": round(mile, 1)})
    stations.sort(key=lambda s: s["mileage_m"])

    warns = []
    if max_off > 300:
        warns.append(f"⚠ {ln_name} 站点投影最大偏移 {max_off:.0f}m（>300m）")
    for i in range(1, len(stations)):
        gap = stations[i]["mileage_m"] - stations[i - 1]["mileage_m"]
        if gap < 50:
            warns.append(f"⚠ {ln_name} 站序可疑：{stations[i-1]['name']}→"
                         f"{stations[i]['name']} 仅 {gap:.0f}m")
    return stations, cum[-1], warns


def _geometry_for(spec, ln_name, src_stations):
    """取几何：OSM 优先，失败/强制则高德站点直连兜底。返回 (poly, osm_name, fallback)。

    兜底几何默认做 Catmull-Rom 样条平滑，把站点直连的生硬折角变缓和曲线
    （曲线过每个站点，投影里程几乎不变）。spec 可设 smooth=False 关闭。
    """
    def fb():
        poly = _fallback_polyline(src_stations)
        if spec.get("smooth", True):
            poly = _smooth_polyline(poly)
        return poly, ln_name + "（高德坐标兜底）", True

    if spec.get("force_fallback"):
        print("    直接用高德站点直连几何（样条平滑）")
        return fb()
    try:
        poly, osm_name = fetch_osm_geometry(spec["osm_ref"], spec["osm_route"])
        return poly, osm_name, False
    except Exception as e:  # noqa: BLE001
        if not spec.get("amap_fallback"):
            raise
        print(f"    OSM 失败（{e}），回退高德站点直连几何（样条平滑）")
        return fb()


def _shared_names(branches):
    """各支站名集合的交集 = 共线段站名集合。"""
    sets = [set(s["name"] for s in b["stations"]) for b in branches]
    return set.intersection(*sets) if sets else set()


def _shared_side(branch, shared):
    """共线段站在该支里程序列里偏低端还是高端。返回共线站平均序位比例(0~1)。
    <0.5 → 共线段在低里程端；>0.5 → 高里程端。"""
    names = [s["name"] for s in branch["stations"]]
    idxs = [i for i, nm in enumerate(names) if nm in shared]
    if not idxs or len(names) < 2:
        return 0.5
    return (sum(idxs) / len(idxs)) / (len(names) - 1)


def _normalize_branch_directions(branches, ln_name):
    """统一各支方向：使「共线段」在所有支里程序列的同一端。

    以第 0 支为基准，把共线段落在相反端的支整体反转（几何倒序 + 重投影）。
    否则交替发车的 entry_up/down（依赖 up 方向站序）会因方向不一致而错乱。
    """
    if len(branches) < 2:
        return
    shared = _shared_names(branches)
    if not shared:
        return
    ref_side = _shared_side(branches[0], shared) < 0.5  # 基准：共线段是否在低里程端
    for b in branches[1:]:
        side = _shared_side(b, shared) < 0.5
        if side != ref_side:
            poly = b["_poly"][::-1]  # 反转几何
            sts, length_m, _ = _project_stations(poly, b["stations"], f"{ln_name}·{b['name']}")
            b["_poly"] = poly
            b["geometry"] = [[round(x, 6), round(y, 6)] for x, y in poly]
            b["length_m"] = round(length_m, 1)
            b["stations"] = sts
            print(f"    支「{b['name']}」方向与基准相反，已反转对齐共线段")


def build_line(lid, amap_lines):
    """组装一条线：几何(OSM) + 站点(高德，投影到几何取里程)。lid 可为数字或特殊线键。

    Y 形分支线（BRANCH_LINES）产出 branches 字段：每支独立几何+里程；每支线性、
    无分叉。方向经 _normalize_branch_directions 统一，保证共线段里程方向一致。
    顶层 stations 仍为全线去重站点。
    """
    spec = spec_of(lid)
    ln_name = spec["amap_name"]
    amap = amap_lines.get(ln_name)
    if not amap:
        raise RuntimeError(f"高德数据里找不到线路：{ln_name}")

    all_warns = []

    if lid in BRANCH_LINES:
        # 每支：优先按端点匹配 OSM 真实几何，失败退回高德站点直连兜底。
        cands = None
        if not spec.get("force_fallback"):
            try:
                cands = fetch_osm_branches(spec["osm_ref"], spec["osm_route"])
                print(f"    OSM 抓到 {len(cands)} 个分支候选 relation")
            except Exception as e:  # noqa: BLE001
                print(f"    OSM 分支抓取失败（{e}），全支退回高德兜底")
                cands = None

        branches = []
        for i, br in enumerate(amap.get("branches", [])):
            br_sts = br["stations"]
            label = br.get("la") or f"支{i+1}"
            poly, source = None, "amap_fallback"
            if cands:
                poly, dist = _match_branch_relation(br_sts, cands)
                if poly is not None:
                    source = "osm"
                    print(f"    支「{label}」匹配 OSM 几何（端点距 {dist:.0f}m，"
                          f"{len(poly)} 点）")
            if poly is None:
                poly = _smooth_polyline(_fallback_polyline(br_sts))
                print(f"    支「{label}」用高德站点直连兜底（样条平滑）")
            sts, length_m, warns = _project_stations(poly, br_sts, f"{ln_name}·{label}")
            all_warns.extend(warns)
            branches.append({
                "key": f"br{i}",
                "name": label,
                "geom_source": source,
                "geometry": [[round(x, 6), round(y, 6)] for x, y in poly],
                "length_m": round(length_m, 1),
                "stations": sts,
                "_poly": poly,   # 原始（未 round）折线，供方向归一化重投影
            })
        # 方向归一化：各支几何方向可能不一致（OSM relation 端点翻转所致），
        # 导致共线段在某些支里程反向，交替发车 entry 计算错乱。以第 0 支为基准，
        # 把「共线段」落在里程另一端的支整体反转（几何 + 重投影）。
        _normalize_branch_directions(branches, ln_name)
        for b in branches:
            b.pop("_poly", None)
        # 顶层去重站点：投影到「首个包含它的支」上取坐标不必要，
        # 前端用各支几何渲染站点；这里顶层 stations 保留高德去重坐标即可。
        top = [{k: v for k, v in s.items()} for s in amap["stations"]]
        # 顶层 geom_source：全支 osm→osm，全兜底→amap_fallback，混合→mixed
        srcs = {b["geom_source"] for b in branches}
        top_source = srcs.pop() if len(srcs) == 1 else "mixed"
        print(f"    分支线：{len(branches)} 支，"
              f"{'/'.join(str(len(b['stations'])) for b in branches)} 站，几何 {top_source}")
        return {
            "id": lid,
            "name": ln_name,
            "osm_name": ln_name + "（分支线）",
            "geom_source": top_source,
            "color": amap["color"],
            "branches": branches,
            "stations": top,   # 全线去重站点，供站点图层/换乘/图例
        }, all_warns

    # —— 非分支线：单折线（沿用原逻辑）——
    poly, osm_name, fallback = _geometry_for(spec, ln_name, amap["stations"])
    exclude = EXCLUDE_STATIONS.get(lid, set())
    stations, length_m, warns = _project_stations(
        poly, amap["stations"], ln_name, exclude)
    all_warns.extend(warns)

    return {
        "id": lid,
        "name": ln_name,
        "osm_name": osm_name,
        "geom_source": "amap_fallback" if fallback else "osm",
        "color": amap["color"],
        "geometry": [[round(x, 6), round(y, 6)] for x, y in poly],
        "length_m": round(length_m, 1),
        "stations": stations,
    }, all_warns


def main():
    refs = sys.argv[1:] or DEFAULT_LINES
    print(f"目标线路：{', '.join(refs)}")

    # 读入已有文件：增量追加的基础。保留整条线对象（含 service）。
    existing = {}
    if os.path.exists(OUT_PATH):
        try:
            old = json.load(open(OUT_PATH, encoding="utf-8"))
            for l in old.get("lines", []):
                existing[l["id"]] = l
        except Exception:  # noqa: BLE001
            pass
    print(f"  已有文件含 {len(existing)} 条线，本次抓取将覆盖/新增其中的目标线")

    print("→ 拉取高德全网站点 …")
    amap_lines = fetch_amap()
    print(f"  高德返回 {len(amap_lines)} 条线路名")

    all_warns = []
    failed = []
    for lid in refs:
        spec = spec_of(lid)
        print(f"→ 处理 {spec['amap_name']}（抓 OSM 几何 + 站点投影）…")
        try:
            line, warns = build_line(lid, amap_lines)
        except Exception as e:  # noqa: BLE001 —— 单线失败不中断整批，支持续抓
            print(f"  ✗ {spec['amap_name']} 抓取失败：{e}（跳过，保留已有）")
            failed.append(lid)
            continue
        if line.get("branches"):
            # 分支线：保留各支原有 service（按 key 匹配），时刻表由 time 脚本维护
            old = existing.get(lid, {})
            old_br = {b.get("key"): b.get("service")
                      for b in old.get("branches", []) if b.get("service")}
            for br in line["branches"]:
                if br["key"] in old_br:
                    br["service"] = old_br[br["key"]]
            print(f"  ✓ {line['name']}: {len(line['branches'])} 支, "
                  f"{len(line['stations'])} 站（去重）")
        else:
            # 保留该线原有 service（时刻表由 build_metro_time.py 维护）
            if lid in existing and "service" in existing[lid]:
                line["service"] = existing[lid]["service"]
            print(f"  ✓ {line['name']}: {len(line['stations'])} 站, "
                  f"几何 {len(line['geometry'])} 点, 全长 {line['length_m']/1000:.1f}km")
        existing[lid] = line
        all_warns.extend(warns)

    # 输出顺序：按 DEFAULT_LINES 的自然线序，其余（如遗留）追加在后
    order = {lid: i for i, lid in enumerate(DEFAULT_LINES)}
    out_lines = sorted(existing.values(),
                       key=lambda l: order.get(l["id"], 999))

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "coord_system": "WGS-84",
        "note": "模拟运行图数据，非实时。几何=OSM，站点=高德(GCJ→WGS)。",
        "lines": out_lines,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n✓ 写入 {os.path.relpath(OUT_PATH, HERE)}（当前共 {len(out_lines)} 条线）")
    if failed:
        print(f"⚠ 本批失败（可重跑续抓）：{', '.join(failed)}")
    if all_warns:
        print("\n构建告警：")
        for w in all_warns:
            print(" ", w)
    else:
        print("无告警，几何与站点对齐良好。")


if __name__ == "__main__":
    main()
