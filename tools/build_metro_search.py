#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""站点搜索索引生成。

读 data/shmetro.json 的全部唯一站名，用 pypinyin 生成全拼与首字母，
连同经过线路（id + 色）写入 data/shmetro_search.json，供前端搜索用。

分离出独立小文件（而非塞进 shmetro.json）：搜索索引与运行图主数据关注点不同，
单独文件不污染主数据、按需加载、便于日后扩展（英文名等）。

用法：python3 build_metro_search.py
"""
import json
import os

from pypinyin import lazy_pinyin, Style

HERE = os.path.dirname(os.path.abspath(__file__))
IN_PATH = os.path.join(HERE, "..", "data", "shmetro.json")
OUT_PATH = os.path.join(HERE, "..", "data", "shmetro_search.json")


def build_index(payload):
    """站名 → { py: 全拼小写, abbr: 首字母, lineIds: [...], colors: [...] }。"""
    agg = {}
    for line in payload.get("lines", []):
        lid, color = line["id"], line.get("color", "#888")
        for st in line.get("stations", []):
            name = st["name"]
            e = agg.get(name)
            if not e:
                # 全拼：各字拼音拼接（去声调）；首字母：各字首字母
                syllables = lazy_pinyin(name, style=Style.NORMAL)
                initials = lazy_pinyin(name, style=Style.FIRST_LETTER)
                e = agg[name] = {
                    "name": name,
                    "py": "".join(syllables).lower(),
                    "abbr": "".join(initials).lower(),
                    "lineIds": [],
                    "colors": [],
                    "_lons": [],
                    "_lats": [],
                }
            if lid not in e["lineIds"]:
                e["lineIds"].append(lid)
                e["colors"].append(color)
            # 收集各线该站坐标，最终取均值（与前端 stationsGeoJSON 聚合一致）
            e["_lons"].append(st["lon"])
            e["_lats"].append(st["lat"])
    # 坐标取均值，落定 lon/lat，去掉临时字段
    for e in agg.values():
        n = len(e["_lons"])
        e["lon"] = round(sum(e["_lons"]) / n, 6)
        e["lat"] = round(sum(e["_lats"]) / n, 6)
        del e["_lons"], e["_lats"]
    return agg


def main():
    if not os.path.exists(IN_PATH):
        raise SystemExit("找不到 shmetro.json，请先运行 build_metro_geo.py")
    payload = json.load(open(IN_PATH, encoding="utf-8"))
    agg = build_index(payload)
    # 输出为数组，前端直接遍历；按站名排序保证稳定 diff
    stations = [agg[k] for k in sorted(agg)]
    out = {"stations": stations}
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"✓ 写入 {os.path.relpath(OUT_PATH, HERE)}（{len(stations)} 站）")
    # 抽样自检
    for s in stations[:3]:
        print(f"  {s['name']}  py={s['py']}  abbr={s['abbr']}  lines={s['lineIds']}")


if __name__ == "__main__":
    main()
