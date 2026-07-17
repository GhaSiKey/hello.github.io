/**
 * scheduler.js — 方案 B 车流推算（前端运行时核心）
 *
 * 思路：不存储任何"车对象"，而是给定时刻 T，纯函数算出此刻线上所有在途列车
 * 各自的里程数。无状态 → 切后台/系统休眠回来都不漂移，因为位置只由 T 决定。
 *
 * 数据依赖 line.service（由 build_metro_time.py 填充）：
 *   { first:"05:30", last:"22:30",
 *     intervals:[{from,to,sec}],        // 分时段发车间隔
 *     run_times_sec:[..] }              // 相邻站运行时间，len = stations-1
 *
 * 一条线跑两个方向：上行(沿 stations 里程递增)、下行(递减)。每个方向按发车
 * 间隔生成当天所有班次，对每班车用"已运行时间"映射到里程。
 */
(function (global) {
  'use strict';

  const DWELL_SEC = 30; // 每站停靠时间（秒），公开数据无此项，取常见经验值

  /** "HH:MM" → 当天零点起的秒数。 */
  function hmsToSec(hm) {
    const [h, m] = hm.split(':').map(Number);
    return h * 3600 + m * 60;
  }

  /** 某时刻(秒)对应的发车间隔(秒)。落在 intervals 里则取对应值，否则取最近段。 */
  function intervalAt(service, sec) {
    for (const iv of service.intervals) {
      if (hmsToSec(iv.from) <= sec && sec < hmsToSec(iv.to)) return iv.sec;
    }
    // 兜底：用第一段间隔（不应频繁触发）
    return service.intervals.length ? service.intervals[0].sec : 300;
  }

  /**
   * 生成某方向当天所有发车时刻(秒数组)。从 first 到 last，按当刻间隔递推。
   * 间隔随时段变化，所以逐班用"发车那一刻的间隔"决定下一班。
   */
  function departures(service, dir) {
    const start = hmsToSec(service.first);
    const end = hmsToSec(service.last);
    const m = service.merge;
    if (!m) {
      // 普通线：按当刻间隔从 first 递推到 last。
      const list = [];
      let t = start;
      while (t <= end) { list.push(t); t += intervalAt(service, t); }
      return list;
    }
    // Y 形分支线：两支共用一条「合并发车流」，交替取班次，保证共线段绝不重叠。
    // 合并流以主干正常频率(intervals)生成，第 k 班给第 (k % count) 支。
    // entry_up/entry_down = 本支从始发到「共线段入口站」的行进时间；用它把合并流
    // 的入口时刻换算回本支发车时刻：dep = mergeTime - entry。这样无论间隔如何随
    // 时段变化，两支在入口站始终均匀交替、下游共线段全程等距。
    const count = m.count || 1;
    const index = m.index || 0;
    const entry = (dir === 'down' ? m.entry_down : m.entry_up) || 0;
    // 合并流的“入口通过时刻”序列：从 merge_start 起按主干间隔递推
    const mStart = hmsToSec(m.first);
    const mEnd = hmsToSec(m.last);
    const list = [];
    let k = 0;
    for (let mt = mStart; mt <= mEnd; mt += intervalAt(service, mt), k++) {
      if (k % count !== index) continue;   // 只取分给本支的班次
      const dep = mt - entry;               // 入口时刻反推发车时刻
      if (dep >= start - 1 && dep <= end) list.push(dep);
    }
    return list;
  }

  /**
   * 构建一个方向的"站点累计到达时间表"：从始发站起，第 k 站的到达秒偏移。
   * 含每站停靠。返回长度 = 站数 的数组，[0]=0。
   */
  function stationOffsets(runTimes) {
    const offs = [0];
    for (let i = 0; i < runTimes.length; i++) {
      // 到第 i+1 站 = 到第 i 站 + 停靠 + 区间运行
      offs.push(offs[i] + (i === 0 ? 0 : DWELL_SEC) + runTimes[i]);
    }
    return offs;
  }

  /**
   * 算某方向、某时刻 T(秒) 的所有在途列车里程。
   * @param dir  'up' 沿里程递增 / 'down' 递减
   * @param stationMileage 各站里程(米)，与 stations 同序
   */
  function trainsForDirection(service, stationMileage, runTimes, nowSec, dir) {
    // 下行从终点站往回开：站序里程倒序，区间耗时也要对应翻转，二者才不错位。
    const mileageSeq = dir === 'up'
      ? stationMileage
      : stationMileage.slice().reverse();
    const rtSeq = dir === 'up' ? runTimes : runTimes.slice().reverse();

    const offs = stationOffsets(rtSeq);
    const totalRun = offs[offs.length - 1]; // 全程耗时(秒)
    const deps = departures(service, dir);
    const out = [];

    for (const dep of deps) {
      const elapsed = nowSec - dep;
      if (elapsed < 0 || elapsed > totalRun) continue; // 还没发车 / 已到终点

      // elapsed 落在第 k 区间内：offs[k] <= elapsed < offs[k+1]
      let k = 0;
      while (k < offs.length - 1 && elapsed >= offs[k + 1]) k++;
      const segDur = (offs[k + 1] - offs[k]) || 1;
      // 每段 = 先在第 k 站停靠 dwellDur 秒，再运行 runDur 秒到第 k+1 站。
      // stationOffsets 里除首段外每段都含一份 DWELL_SEC，这里把它拆回来，
      // 让列车真的在站点停住，而不是把停站时间摊进移动里匀速滑过。
      const runDur = rtSeq[k] || segDur;                 // 纯区间运行耗时
      const dwellDur = Math.max(0, segDur - runDur);     // 该段起点站停靠时长（首段 =0）
      const timeInSeg = elapsed - offs[k];

      let t, dwelling;
      if (timeInSeg <= dwellDur) {
        t = 0; dwelling = true;                          // 停站阶段：钉在第 k 站
      } else {
        t = Math.max(0, Math.min(1, (timeInSeg - dwellDur) / (runDur || 1)));
        dwelling = false;                                // 运行阶段：两站间插值
      }

      // mileageSeq 已按行进方向排好序，直接线性插值
      const mileage = mileageSeq[k] + (mileageSeq[k + 1] - mileageSeq[k]) * t;

      out.push({ mileage, dir, dep, seg: k, t, dwelling });
    }
    return out;
  }

  /**
   * 一条线在 nowSec 时刻的全部列车（上下行合并）。
   * 返回 [{ mileage, dir, ... }]，交给 geo.locate 变成经纬度。
   */
  function trainsOnLine(line, nowSec) {
    const svc = line.service;
    if (!svc || !svc.run_times_sec) return [];
    const mileage = line.stations.map(s => s.mileage_m);
    const rt = svc.run_times_sec;
    return [
      ...trainsForDirection(svc, mileage, rt, nowSec, 'up'),
      ...trainsForDirection(svc, mileage, rt, nowSec, 'down'),
    ];
  }

  /** 某方向的站名序列与到达时间偏移表（沿行进方向排序）。 */
  function dirSequences(line, dir) {
    const names = line.stations.map(s => s.name);
    const rt = line.service.run_times_sec;
    const nameSeq = dir === 'up' ? names : names.slice().reverse();
    const rtSeq = dir === 'up' ? rt : rt.slice().reverse();
    return { nameSeq, offs: stationOffsets(rtSeq) };
  }

  /**
   * 某站接下来的到站列车（两个方向合并，按到站时间升序）。
   * @param stIndex 站点在 line.stations 中的下标（上行站序）
   * @return [{ dir, toward, eta }]，eta 为距到站的秒数
   */
  function nextArrivals(line, stIndex, nowSec, count) {
    const svc = line.service;
    if (!svc || !svc.run_times_sec) return [];
    const n = line.stations.length;
    const res = [];
    for (const dir of ['up', 'down']) {
      // 该方向里该站的位置：上行=原下标，下行=倒序下标
      const pos = dir === 'up' ? stIndex : (n - 1 - stIndex);
      if (pos >= n - 1) continue; // 该方向的终点站，不作为可乘的"来车"
      const { nameSeq, offs } = dirSequences(line, dir);
      const toward = nameSeq[nameSeq.length - 1];
      for (const dep of departures(svc, dir)) {   // 按方向取发车流（含交替发车）
        const eta = dep + offs[pos] - nowSec;
        if (eta >= 0) res.push({ dir, toward, eta });
      }
    }
    res.sort((a, b) => a.eta - b.eta);
    return res.slice(0, count || 3);
  }

  /**
   * 某站两个方向的「末班车」：在本站还能坐上、开往各终点的最后一班车。
   * = 该方向最后一班发车时刻 + 从始发到本站的运行偏移。比线路级 service.last 准确，
   * 且天然分两方向（开往两端终点各有一班末车）。
   * @param stIndex 站点在 line.stations 中的下标（上行站序）
   * @return [{ dir, toward, arriveSec }]，arriveSec 为末班车到本站的当天秒数；
   *         本方向终点站（在该站无可乘末车）不产出。
   */
  function lastArrivals(line, stIndex, nowSec) {
    const svc = line.service;
    if (!svc || !svc.run_times_sec) return [];
    const n = line.stations.length;
    const res = [];
    for (const dir of ['up', 'down']) {
      const pos = dir === 'up' ? stIndex : (n - 1 - stIndex);
      if (pos >= n - 1) continue; // 该方向终点站，无可乘末车
      const { nameSeq, offs } = dirSequences(line, dir);
      const deps = departures(svc, dir);
      if (!deps.length) continue;
      const lastDep = deps[deps.length - 1];
      res.push({
        dir,
        toward: nameSeq[nameSeq.length - 1],
        arriveSec: lastDep + offs[pos],
      });
    }
    return res;
  }

  /**
   * 某列车接下来的停靠站到站时间。
   * @param train trainsOnLine 产出的对象，需含 dir/dep/seg
   * @return [{ name, eta }]，沿行进方向的后续站
   */
  function nextStops(line, train, nowSec, count) {
    const svc = line.service;
    if (!svc || !svc.run_times_sec) return [];
    const n = line.stations.length;
    const { nameSeq, offs } = dirSequences(line, train.dir);
    const out = [];
    for (let j = train.seg + 1; j < n && out.length < (count || 3); j++) {
      const eta = train.dep + offs[j] - nowSec;
      if (eta < 0) continue;
      out.push({ name: nameSeq[j], eta });
    }
    return out;
  }

  /** 当天秒数（本地时间），供主循环取"现在"。 */
  function nowSecOfDay(date) {
    const d = date || new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  global.MetroScheduler = {
    trainsOnLine, nowSecOfDay, hmsToSec, nextArrivals, nextStops, lastArrivals,
  };
})(window);
