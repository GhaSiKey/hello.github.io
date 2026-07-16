/**
 * geo.js — 几何工具（前端运行时）
 *
 * 核心职责：在一条轨道折线（geometry）上做「里程 ↔ 经纬度」双向映射。
 * scheduler.js 算出某列车此刻的里程数，这里把它插值成地图上的经纬度和朝向。
 *
 * 约定：geometry 为 [[lon,lat], ...]（WGS-84），与 build_metro_geo.py 产出一致。
 */
(function (global) {
  'use strict';

  const R = 6371000; // 地球半径（米）

  /** 两点 [lon,lat] 大圆距离（米）。 */
  function haversine(a, b) {
    const p1 = a[1] * Math.PI / 180;
    const p2 = b[1] * Math.PI / 180;
    const dp = (b[1] - a[1]) * Math.PI / 180;
    const dl = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 +
      Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /**
   * 预处理一条线：算出每个顶点的累计里程，返回可复用的查询结构。
   * 返回 { poly, cum, length }，供 locate() 反复调用（O(logN) 二分）。
   */
  function buildIndex(geometry) {
    const cum = [0];
    for (let i = 1; i < geometry.length; i++) {
      cum.push(cum[i - 1] + haversine(geometry[i - 1], geometry[i]));
    }
    return { poly: geometry, cum, length: cum[cum.length - 1] };
  }

  /**
   * 给定里程（米），在折线上定位，返回 { lon, lat, bearing }。
   * bearing 为前进方向方位角（度，正北为 0，顺时针），用于列车朝向。
   */
  function locate(index, mileage) {
    const { poly, cum, length } = index;
    const m = Math.max(0, Math.min(length, mileage));
    // 二分找到 m 落在的线段 [i, i+1]
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < m) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const segLen = cum[i] - cum[i - 1] || 1;
    const t = (m - cum[i - 1]) / segLen;
    const a = poly[i - 1], b = poly[i];
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    return { lon, lat, bearing: bearingOf(a, b) };
  }

  /** 两点间方位角（度）。 */
  function bearingOf(a, b) {
    const y = Math.sin((b[0] - a[0]) * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180);
    const x = Math.cos(a[1] * Math.PI / 180) * Math.sin(b[1] * Math.PI / 180) -
      Math.sin(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) *
      Math.cos((b[0] - a[0]) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  global.MetroGeo = { haversine, buildIndex, locate, bearingOf };
})(window);
