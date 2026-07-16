/**
 * app.js — 入口与主循环
 *
 * 流程：加载 shmetro.json → 建地图 → 画线路/站点 → 每秒按当前时间推算列车
 * 位置并更新。不做任何数据抓取或复杂计算，几何在 build 脚本里已算好。
 */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const els = {
    clock: $('#hudClock'),
    date: $('#hudDate'),
    legend: $('#legend'),
    errorState: $('#errorState'),
    errorHint: $('#errorHint'),
    search: $('#search'),
    searchToggle: $('#searchToggle'),
    searchBox: $('#searchBox'),
    searchInput: $('#searchInput'),
    searchClose: $('#searchClose'),
    searchResults: $('#searchResults'),
  };

  const state = {
    lines: [],
    indexById: {},   // 线路 id → { geoIndex, line }
    hidden: {},      // 线路 id → true 表示用户在图例里关掉了
    map: null,
    ready: false,
    focusLine: null, // 图例点击聚焦的线路 id
    trainById: {},   // 本帧列车：稳定 key → 列车对象（供悬停气泡跨帧跟随）
    hover: null,     // 当前悬停对象 { kind:'train'|'station', id, ... }
    mouse: null,     // 鼠标最后屏幕坐标（画布外为 null），每帧据此重判悬停
    searchIndex: [], // 搜索索引：[{name, py, abbr, lineIds, colors, lon, lat}]
    pinned: null,    // 搜索选中并钉住的站名（气泡不随鼠标关闭），null 表示无
    panelOpen: false,   // 数据面板是否展开
    perLineCount: {},   // 线路 id → 本帧运行列车数
    totalRunning: 0,    // 本帧全网运行列车数
  };

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /** 把一条线归一成「路径(route)」列表：跑车/画线的最小单元。
   * 分支线 → 每支一个 route；非分支线 → 单个 route（用 line 自身几何/站点/service）。
   * 每个 route 含 { key, geometry, stations, service }，结构与 scheduler 期望一致。
   */
  function routesOf(line) {
    if (line.branches && line.branches.length) {
      return line.branches.map(b => ({
        key: `${line.id}:${b.key}`,
        geometry: b.geometry,
        stations: b.stations,
        service: b.service,
      }));
    }
    return [{
      key: line.id,
      geometry: line.geometry,
      stations: line.stations,
      service: line.service,
    }];
  }

  function showError(msg) {
    els.errorState.hidden = false;
    els.errorHint.textContent = msg;
  }

  /** 渲染图例：每条线一个可点击条目（点击=聚焦高亮，再点=取消；勾选框控制显隐）。 */
  function renderLegend(lines) {
    els.legend.innerHTML =
      `<div class="legend-title">线路</div>` +
      lines.map(l =>
        `<div class="legend-item" data-line="${l.id}">
           <span class="legend-dot" style="background:${l.color}"></span>
           <span class="legend-name">${l.name}</span>
         </div>`
      ).join('');

    els.legend.querySelectorAll('.legend-item').forEach(item => {
      const id = item.dataset.line;
      item.addEventListener('click', () => toggleFocus(id, item));
    });
  }

  /** 点击图例：聚焦该线（高亮它、淡化其余）；再点同一条取消聚焦。 */
  function toggleFocus(id, item) {
    state.focusLine = state.focusLine === id ? null : id;
    els.legend.querySelectorAll('.legend-item').forEach(el =>
      el.classList.toggle('is-focus', el.dataset.line === state.focusLine));
    if (state.ready) {
      MetroRender.highlightLine(state.map, state.lines, state.focusLine);
      MetroRender.focusView(state.map, state.lines, state.focusLine);
    }
    renderLineDetail(state.focusLine);
  }

  /** 线路的车站序列（用于横向站点条）。非分支线一行；分支线每支一行
   * （5/10/11 各 2 支），每行带该支终点标签。返回 [{label, stations:[{name,transfer}]}]。 */
  function stationSequences(line) {
    // 换乘站集合缓存；搜索索引尚未加载时不缓存空集（等加载后再建）
    let transferSet = state._transferSet;
    if (!transferSet && state.searchIndex.length) {
      transferSet = state._transferSet = new Set(
        state.searchIndex.filter(s => s.lineIds.length >= 2).map(s => s.name));
    }
    transferSet = transferSet || new Set();
    const mark = st => st.map(s => ({
      name: s.name, transfer: transferSet.has(s.name), fork: !!s.fork,
    }));
    if (line.branches && line.branches.length) {
      // 以最长支为主行完整展示；其余支只画“分叉站 + 独有段”，避免主干重复。
      let mainIdx = 0;
      line.branches.forEach((b, i) => {
        if (b.stations.length > line.branches[mainIdx].stations.length) mainIdx = i;
      });
      const main = line.branches[mainIdx].stations;
      const mn = main.map(s => s.name);
      const rows = [{ label: '', stations: mark(main) }];

      line.branches.forEach((b, i) => {
        if (i === mainIdx) return;
        const bs = b.stations, bn = bs.map(s => s.name);
        // 与主行的公共前缀 p、公共后缀 s
        let p = 0; while (p < mn.length && p < bn.length && mn[p] === bn[p]) p++;
        let s = 0;
        while (s < mn.length - p && s < bn.length - p
          && mn[mn.length - 1 - s] === bn[bn.length - 1 - s]) s++;
        // 独有段（不含公共前/后缀）
        const unique = bs.slice(p, bn.length - s);
        // 拼上分叉锚点：前公共段的最后一站 / 后公共段的第一站，标记为 fork
        const seg = [];
        if (p > 0) seg.push({ ...bs[p - 1], fork: true });
        for (const st of unique) seg.push(st);
        if (s > 0) seg.push({ ...bs[bn.length - s], fork: true });
        // 方向标签：取该支独有的那个端点
        const dir = s > 0 ? bn[0] : bn[bn.length - 1];
        rows.push({ label: `↳ ${dir} 方向`, stations: mark(seg), branch: true });
      });
      return rows;
    }
    return [{ label: '', stations: mark(line.stations) }];
  }

  /** 渲染线路详情吸底条。lineId 为 null → 隐藏。 */
  function renderLineDetail(lineId) {
    const el = document.getElementById('lineDetail');
    if (!el) return;
    if (lineId == null) {
      el.hidden = true; el.innerHTML = '';
      document.body.classList.remove('has-line-bar');
      return;
    }
    const idx = state.indexById[lineId];
    if (!idx) { el.hidden = true; return; }
    const l = idx.line;

    const km = lineLengthKm(l).toFixed(1);
    const nStations = l.stations.length;
    const running = state.perLineCount[lineId] || 0;

    // 首末班：取各 route 的最早 first / 最晚 last
    let first = null, last = null;
    for (const { route } of idx.routes) {
      const s = route.service;
      if (!s) continue;
      if (first == null || s.first < first) first = s.first;
      if (last == null || s.last > last) last = s.last;
    }

    // 左侧信息区
    const info =
      `<div class="lb-info">
        <div class="lb-head">
          <span class="lb-dot" style="background:${l.color}"></span>
          <span class="lb-name">${l.name}</span>
        </div>
        <div class="lb-stats">
          <span><b>${km}</b> km</span>
          <span><b>${nStations}</b> 站</span>
          <span class="lb-running"><b>${running}</b> 列在途</span>
        </div>
        <div class="lb-service">${first || '—'} ~ ${last || '—'}</div>
      </div>`;

    // 右侧横向站点条：主干一行完整展示，分支行只画分叉段（含分叉锚点，弱化）
    const rows = stationSequences(l).map(seq => {
      const chips = seq.stations.map(s => {
        const cls = ['lb-stn'];
        if (s.transfer) cls.push('is-transfer');
        if (s.fork) cls.push('is-fork');
        return `<button class="${cls.join(' ')}" data-name="${s.name}"
          style="--c:${l.color}" title="${s.name}">${s.name}</button>`;
      }).join('');
      const label = seq.label
        ? `<span class="lb-row-label">${seq.label}</span>` : '';
      return `<div class="lb-row${seq.branch ? ' is-branch' : ''}">${label}` +
        `<div class="lb-stns">${chips}</div></div>`;
    }).join('');

    el.innerHTML =
      info +
      `<div class="lb-track">${rows}</div>` +
      `<button class="lb-close" id="ldClose" aria-label="关闭">✕</button>`;
    el.hidden = false;

    document.getElementById('ldClose').addEventListener('click', () => {
      toggleFocus(lineId, els.legend.querySelector(`.legend-item[data-line="${lineId}"]`));
    });
    el.querySelectorAll('.lb-stn').forEach(b =>
      b.addEventListener('click', () => gotoStation(b.dataset.name)));
    document.body.classList.add('has-line-bar');
    // 吸底条高度随行数变化，动态抬高图例避免遮挡
    requestAnimationFrame(() => {
      document.body.style.setProperty('--line-bar-h', el.offsetHeight + 'px');
    });
  }

  /** 只刷新吸底条里"在途列车"的数字（每帧调用，避免整块重渲染丢失滚动/监听）。 */
  function updateLineDetailCount(lineId) {
    const el = document.getElementById('lineDetail');
    if (!el || el.hidden) return;
    const b = el.querySelector('.lb-running b');
    if (b) b.textContent = state.perLineCount[lineId] || 0;
  }

  /** 更新时钟显示。 */
  function updateClock(now) {
    const p = n => String(n).padStart(2, '0');
    els.clock.textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    els.date.textContent =
      `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
  }

  /** 该方向的终点站名（列车"开往"）。up→末站，down→首站。 */
  function towardOf(line, dir) {
    const s = line.stations;
    return dir === 'up' ? s[s.length - 1].name : s[0].name;
  }

  /** 主循环：算每条线此刻所有车 → 定位 → 更新图层。 */
  function tick() {
    const now = new Date();
    updateClock(now);

    if (state.ready) {
      const nowSec = MetroScheduler.nowSecOfDay(now);
      const all = [];
      const byId = {};
      let running = 0;
      const perLine = {};  // 线路 id → 本帧运行列车数（用于数据面板；不受聚焦影响，全网统计）
      for (const l of state.lines) {
        const idx = state.indexById[l.id];
        if (!idx) continue;
        let lineCount = 0;
        // 遍历该线每个 route（分支线多个）：各自跑车、用各自几何定位
        for (const { route, geoIndex } of idx.routes) {
          if (!route.service) continue;
          const trains = MetroScheduler.trainsOnLine(route, nowSec);
          lineCount += trains.length;
          // 聚焦时只画该线的车（统计仍照常累计，面板反映全网）
          if (!state.focusLine || l.id === state.focusLine) {
            for (const tr of trains) {
              const pos = MetroGeo.locate(geoIndex, tr.mileage);
              // geo.bearing 是折线里程递增方向；下行列车逆里程行驶，朝向反 180°
              const heading = tr.dir === 'up' ? pos.bearing : (pos.bearing + 180) % 360;
              // 稳定身份：同一班车跨帧 key 不变（含 route.key 区分分支），供气泡跟随
              const id = `${route.key}|${tr.dir}|${tr.dep}`;
              const t = {
                id, lon: pos.lon, lat: pos.lat, color: l.color, lineId: l.id,
                line: l.name, dir: tr.dir, toward: towardOf(route, tr.dir), heading,
                seg: tr.seg, dep: tr.dep, routeKey: route.key, // 供"后续到站"查询
              };
              all.push(t);
              byId[id] = t;
            }
          }
        }
        perLine[l.id] = lineCount;
        running += lineCount;
      }
      state.trainById = byId;
      state.perLineCount = perLine;
      state.totalRunning = running;
      MetroRender.updateTrains(state.map, all);
      updateRunningCount(running);
      if (state.panelOpen) renderStatsPanel();
      if (state.focusLine) updateLineDetailCount(state.focusLine);
      refreshHoverPopup(); // 悬停中的列车气泡跟随移动
    }
    requestAnimationFrame(() => setTimeout(tick, 900));
  }

  /** HUD 显示当前在途列车数。 */
  function updateRunningCount(n) {
    const el = document.getElementById('hudRunningText');
    if (el) el.textContent = `${n} 列运行中`;
  }

  async function init() {
    let data;
    try {
      data = await loadMetroData();
    } catch (e) {
      showError(e.message);
      return;
    }
    state.lines = data.lines || [];
    // 搜索索引并行加载（失败降级为空，不阻塞主图）
    loadSearchIndex().then(idx => {
      state.searchIndex = idx.stations || [];
      setupSearch();
    });
    // 预建索引：每条线 → 其各 route 的几何里程索引（分支线多个，非分支线一个）
    for (const l of state.lines) {
      state.indexById[l.id] = {
        line: l,
        routes: routesOf(l).map(r => ({
          route: r,
          geoIndex: MetroGeo.buildIndex(r.geometry),
        })),
      };
    }
    renderLegend(state.lines);
    setupPanel();

    const map = MetroRender.createMap('map');
    state.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // 矢量线路层只依赖本地数据，不该被底图瓦片网络状况拖累。
    // 'load' 需等底图首次渲染完成，底图 CDN(CARTO) 在部分网络下超时会导致 'load'
    // 迟迟不触发、线路一条都画不出。改用 style.load（只等内联 style 解析，与瓦片无关），
    // 并加轮询兜底，确保底图挂掉时地铁图仍能显示。
    let layersAdded = false;
    const addLayers = () => {
      if (layersAdded) return;
      layersAdded = true;
      MetroRender.addStaticLayers(map, state.lines, state.indexById);
      MetroRender.addTrainLayer(map, state.lines);
      state.ready = true;
      bindInteractions(map);
    };
    if (map.isStyleLoaded()) addLayers();
    else {
      map.on('style.load', addLayers);
      map.on('load', addLayers);
      // 双保险：极端情况下事件都没来，轮询到 style 就绪即补画
      let tries = 0;
      const poll = setInterval(() => {
        if (layersAdded || map.isStyleLoaded()) { addLayers(); clearInterval(poll); }
        else if (++tries > 40) clearInterval(poll); // 最多等 ~8s
      }, 200);
    }

    tick(); // 时钟先转起来，地图 ready 后自动开始画车
  }

  /** 定位并显示气泡到某坐标。 */
  function placePopup(coord, html) {
    const popup = document.getElementById('trainPopup');
    popup.innerHTML = html;
    popup.hidden = false;
    const pt = state.map.project(coord);
    popup.style.left = `${pt.x}px`;
    popup.style.top = `${pt.y - 16}px`;
  }

  function hidePopup() {
    document.getElementById('trainPopup').hidden = true;
    state.hover = null;
    state.pinned = null;
  }

  /** 秒数 → 友好倒计时文案。 */
  function fmtEta(sec) {
    if (sec < 30) return '即将到站';
    if (sec < 60) return '不到 1 分钟';
    const m = Math.round(sec / 60);
    return `${m} 分钟`;
  }

  /** 按 route.key 找到该 route（分支线用）；找不到返回 null。 */
  function routeByKey(lineId, routeKey) {
    const idx = state.indexById[lineId];
    if (!idx) return null;
    const hit = idx.routes.find(r => r.route.key === routeKey);
    return hit ? hit.route : (idx.routes[0] && idx.routes[0].route);
  }

  /** 列车气泡 HTML：线路 + 开往 + 后续 3 站到站时间。 */
  function trainPopupHTML(t) {
    const route = routeByKey(t.lineId, t.routeKey);
    let rows = '';
    if (route) {
      const nowSec = MetroScheduler.nowSecOfDay(new Date());
      const stops = MetroScheduler.nextStops(route, t, nowSec, 3);
      rows = stops.map(s =>
        `<span class="tp-row"><span class="tp-stop">${s.name}</span>` +
        `<span class="tp-eta">${fmtEta(s.eta)}</span></span>`).join('');
    }
    return `<span class="tp-line" style="color:${t.color}">${t.line}</span>` +
           `<span class="tp-toward">开往 ${t.toward}</span>` +
           (rows ? `<div class="tp-list">${rows}</div>` : '');
  }

  /** 每帧调用：按鼠标最后位置重新判定悬停对象（处理"车开走/鼠标移开"两种情况）。 */
  function refreshHoverPopup() {
    updateHoverAt(state.mouse);
  }

  /** 站点气泡 HTML：站名 + 换乘线路 + 各线后续来车（带线路色点区分）。
   * 换乘站聚合所有经过线路；每条线合并其分支来车、按 toward 去重。
   */
  function stationPopupHTML(p) {
    // lineIds 由 render 聚合写入（JSON 串）；兜底用旧 lineId。
    let lineIds = [];
    try { lineIds = JSON.parse(p.lineIds || '[]'); } catch (e) { /* ignore */ }
    if (!lineIds.length && p.lineId) lineIds = [p.lineId];

    const nowSec = MetroScheduler.nowSecOfDay(new Date());
    // 换乘线路标签（多于 1 条时显示）
    let transfer = '';
    if (lineIds.length > 1) {
      const names = lineIds.map(id => {
        const l = state.indexById[id] && state.indexById[id].line;
        return l ? l.name : id;
      });
      transfer = `<span class="tp-toward">换乘 ${names.join(' · ')}</span>`;
    }

    // 按「线路 → 方向(开往某终点)」组织：每个方向一行，含下一班到站 + 该方向末班车。
    // 这样两个方向天然各有自己的末班车时刻（开往两端终点各一班末车）。
    let sections = '';
    for (const id of lineIds) {
      const idx = state.indexById[id];
      if (!idx) continue;
      const color = idx.line.color;
      const multi = lineIds.length > 1;

      // 汇总该线各 route 的方向信息：toward → { nextEta, lastArrive }
      const byToward = {};
      for (const { route } of idx.routes) {
        if (!route.service) continue;
        const stIndex = route.stations.findIndex(s => s.name === p.name);
        if (stIndex < 0) continue;
        // 下一班（各方向最近一班）
        for (const a of MetroScheduler.nextArrivals(route, stIndex, nowSec, 6)) {
          const e = byToward[a.toward] || (byToward[a.toward] = {});
          if (e.nextEta == null || a.eta < e.nextEta) e.nextEta = a.eta;
        }
        // 末班车（各方向）
        for (const l of MetroScheduler.lastArrivals(route, stIndex, nowSec)) {
          const e = byToward[l.toward] || (byToward[l.toward] = {});
          if (e.lastArrive == null || l.arriveSec > e.lastArrive) e.lastArrive = l.arriveSec;
        }
      }

      const dirRows = Object.keys(byToward).map(toward => {
        const e = byToward[toward];
        const next = e.nextEta != null
          ? `<span class="tp-next">${fmtEta(e.nextEta)}</span>`
          : `<span class="tp-next tp-muted">末班已过</span>`;
        let last = '';
        if (e.lastArrive != null) {
          const remain = e.lastArrive - nowSec;
          const hhmm = secToHM(e.lastArrive);
          last = remain > 0
            ? `<span class="tp-lastinfo">末班 ${hhmm}</span>`
            : `<span class="tp-lastinfo tp-muted">已收班</span>`;
        }
        return `<span class="tp-dir">` +
          `<span class="tp-toward-name">开往${toward}</span>` +
          `<span class="tp-dir-meta">${next}${last}</span></span>`;
      }).join('');
      if (!dirRows) continue;

      // 换乘站：每条线一个带色点的小标题；单线站省略标题
      const head = multi
        ? `<span class="tp-linehead"><span class="tp-dot" style="background:${color}"></span>${idx.line.name}</span>`
        : '';
      sections += `<div class="tp-section">${head}${dirRows}</div>`;
    }

    return `<span class="tp-line">${p.name}</span>${transfer}` +
           (sections ? `<div class="tp-list">${sections}</div>` : '');
  }

  /** 当天秒数 → "HH:MM"（跨天则对 24h 取模，末班车展示用）。 */
  function secToHM(sec) {
    const s = ((sec % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * 核心：查询屏幕点 pt 下方的要素，决定气泡显隐与内容。
   * 鼠标移开 → 查不到 → 关闭；列车开走 → 下一帧查不到 → 关闭。
   * 列车优先于站点。pt 为 null（鼠标在画布外）时直接关闭。
   */
  function updateHoverAt(pt) {
    const map = state.map;
    // 钉住的搜索气泡：鼠标在空白处不清除，回到空白时恢复钉住站的气泡
    if (!pt) {
      if (state.pinned) showStationPopupByName(state.pinned);
      else { hidePopup(); map.getCanvas().style.cursor = ''; }
      return;
    }

    const hits = map.queryRenderedFeatures([pt.x, pt.y], {
      layers: ['trains', 'stations', 'stations-transfer'],
    });
    if (!hits.length) {
      if (state.pinned) showStationPopupByName(state.pinned);
      else { hidePopup(); map.getCanvas().style.cursor = ''; }
      return;
    }

    // 列车优先
    const train = hits.find(f => f.layer.id === 'trains');
    if (train) {
      const t = matchTrain(train.properties, train.geometry.coordinates);
      if (t) {
        state.hover = { kind: 'train', id: t.id };
        placePopup([t.lon, t.lat], trainPopupHTML(t));
        map.getCanvas().style.cursor = 'pointer';
        return;
      }
    }
    const st = hits.find(f => f.layer.id === 'stations' || f.layer.id === 'stations-transfer');
    if (st) {
      state.hover = { kind: 'station', id: st.properties.name };
      placePopup(st.geometry.coordinates, stationPopupHTML(st.properties));
      map.getCanvas().style.cursor = 'pointer';
      return;
    }
    hidePopup();
    map.getCanvas().style.cursor = '';
  }

  /** 绑定地图交互：记录鼠标位置，悬停判定统一交给 updateHoverAt。 */
  function bindInteractions(map) {
    // 记录鼠标屏幕坐标，供每帧重新判定（这样车开走也能关掉气泡）
    map.on('mousemove', (e) => {
      state.mouse = e.point;
      updateHoverAt(e.point);
    });
    // 鼠标移出地图画布 → 关闭（钉住的搜索气泡保留）
    map.getCanvas().addEventListener('mouseout', () => {
      state.mouse = null;
      if (!state.pinned) hidePopup();
    });
    // 点击地图空白处 → 取消钉住的搜索气泡
    map.on('click', (e) => {
      if (!state.pinned) return;
      const hits = map.queryRenderedFeatures([e.point.x, e.point.y], {
        layers: ['stations', 'stations-transfer'],
      });
      if (!hits.length) hidePopup();
    });
    // 地图平移/缩放时，让钉住的气泡跟随其站点位置
    map.on('move', () => {
      if (state.pinned) showStationPopupByName(state.pinned);
    });
  }

  // ============ 数据面板 ============

  /** 一条线的运营里程(km)：非分支取 length_m，分支线取最长支的末站里程。 */
  function lineLengthKm(l) {
    if (typeof l.length_m === 'number') return l.length_m / 1000;
    if (l.branches && l.branches.length) {
      const max = Math.max(...l.branches.map(b => {
        const st = b.stations;
        return st.length ? st[st.length - 1].mileage_m : 0;
      }));
      return max / 1000;
    }
    const st = l.stations;
    return st.length ? st[st.length - 1].mileage_m / 1000 : 0;
  }

  /** 换乘枢纽榜数据：按换乘线数排序的站点（来自搜索索引，含坐标）。 */
  function topHubs(limit) {
    return state.searchIndex
      .filter(s => s.lineIds.length >= 2)
      .sort((a, b) => b.lineIds.length - a.lineIds.length
        || a.name.localeCompare(b.name))
      .slice(0, limit || 6);
  }

  /** 渲染数据面板内容（展开时每帧刷新）。 */
  function renderStatsPanel() {
    const panel = document.getElementById('hudPanel');
    if (!panel) return;

    // 各线运行列车数排行（降序，取有车的）
    const ranking = state.lines
      .map(l => ({ l, n: state.perLineCount[l.id] || 0 }))
      .sort((a, b) => b.n - a.n);
    const maxN = ranking.length ? (ranking[0].n || 1) : 1;

    // 全网概况
    const totalKm = state.lines.reduce((s, l) => s + lineLengthKm(l), 0);
    const busiest = ranking[0];
    const longest = state.lines
      .map(l => ({ l, km: lineLengthKm(l) }))
      .sort((a, b) => b.km - a.km)[0];

    // 四格：val 主数值，label 说明，sub 可选补充（线名等）
    const stat = (label, val, sub) =>
      `<div class="sp-stat"><span class="sp-stat-v">${val}</span>` +
      `<span class="sp-stat-l">${label}${sub ? ` · ${sub}` : ''}</span></div>`;

    const overview = `<div class="sp-stats">` +
      stat('全网运行', state.totalRunning + ' 列') +
      stat('总里程', Math.round(totalKm) + ' km') +
      stat('最繁忙',
        busiest && busiest.n ? busiest.n + ' 列' : '—',
        busiest && busiest.n ? busiest.l.name : '') +
      stat('最长线路',
        longest ? longest.km.toFixed(0) + ' km' : '—',
        longest ? longest.l.name : '') +
      `</div>`;

    // 运行列车数排行条
    const bars = ranking.filter(r => r.n > 0).map(r => {
      const pct = Math.max(4, Math.round((r.n / maxN) * 100));
      return `<div class="sp-bar-row" data-line="${r.l.id}" title="${r.l.name}">
        <span class="sp-bar-name">${r.l.name}</span>
        <span class="sp-bar-track"><span class="sp-bar-fill"
          style="width:${pct}%;background:${r.l.color}"></span></span>
        <span class="sp-bar-n">${r.n}</span>
      </div>`;
    }).join('');

    // 换乘枢纽榜
    const hubs = topHubs(6).map(h => {
      const dots = h.colors.map(c =>
        `<span class="sp-hub-dot" style="background:${c}"></span>`).join('');
      return `<div class="sp-hub" data-name="${h.name}">
        <span class="sp-hub-name">${h.name}</span>
        <span class="sp-hub-dots">${dots}</span>
        <span class="sp-hub-n">${h.lineIds.length} 线</span>
      </div>`;
    }).join('');

    // 重建前记住排行区滚动位置，避免每帧刷新把用户滚动位置弹回顶部
    const prevBars = panel.querySelector('.sp-bars');
    const prevScroll = prevBars ? prevBars.scrollTop : 0;

    panel.innerHTML =
      overview +
      `<div class="sp-sub">各线运行列车数</div>` +
      `<div class="sp-bars">${bars || '<div class="sp-empty">当前无运行列车</div>'}</div>` +
      `<div class="sp-sub">换乘枢纽 Top 6</div>` +
      `<div class="sp-hubs">${hubs}</div>`;

    const newBars = panel.querySelector('.sp-bars');
    if (newBars && prevScroll) newBars.scrollTop = prevScroll;
  }

  function togglePanel() {
    state.panelOpen = !state.panelOpen;
    const panel = document.getElementById('hudPanel');
    const btn = document.getElementById('hudRunning');
    panel.hidden = !state.panelOpen;
    btn.setAttribute('aria-expanded', String(state.panelOpen));
    btn.classList.toggle('is-open', state.panelOpen);
    if (state.panelOpen) renderStatsPanel();
  }

  /** 绑定数据面板交互。 */
  function setupPanel() {
    const btn = document.getElementById('hudRunning');
    if (btn) btn.addEventListener('click', togglePanel);
    const panel = document.getElementById('hudPanel');
    if (panel) {
      // 点击排行条 → 聚焦该线；点击枢纽 → 飞到该站
      panel.addEventListener('click', (e) => {
        const bar = e.target.closest('.sp-bar-row');
        if (bar) { focusLineById(bar.dataset.line); return; }
        const hub = e.target.closest('.sp-hub');
        if (hub) gotoStation(hub.dataset.name);
      });
    }
  }

  /** 聚焦某线（等价点击图例项），供面板排行调用。 */
  function focusLineById(id) {
    const item = els.legend.querySelector(`.legend-item[data-line="${id}"]`);
    toggleFocus(id, item);
  }

  // ============ 站点搜索 ============

  /** 对索引做匹配：中文子串 / 拼音全拼前缀 / 首字母前缀，任一命中。
   * 返回按相关度排序的结果（最多 8 条）。q 已 trim + 小写。 */
  function searchStations(q) {
    if (!q) return [];
    const isCJK = /[一-龥]/.test(q);
    const scored = [];
    for (const s of state.searchIndex) {
      let score = -1;
      if (isCJK) {
        const i = s.name.indexOf(q);
        if (i >= 0) score = i === 0 ? 0 : 1; // 前缀命中优先
      } else {
        // 拉丁输入：优先首字母前缀，其次全拼前缀，再次全拼子串
        if (s.abbr.startsWith(q)) score = 0;
        else if (s.py.startsWith(q)) score = 1;
        else if (s.abbr.indexOf(q) > 0) score = 2;
        else if (s.py.indexOf(q) > 0) score = 3;
      }
      if (score >= 0) scored.push({ s, score });
    }
    scored.sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length
      || a.s.name.localeCompare(b.s.name));
    return scored.slice(0, 8).map(x => x.s);
  }

  /** 渲染搜索结果列表。 */
  function renderSearchResults(items) {
    const ul = els.searchResults;
    if (!items.length) {
      ul.innerHTML = els.searchInput.value.trim()
        ? `<li class="search-empty">没有匹配的站点</li>` : '';
      return;
    }
    ul.innerHTML = items.map((s, i) => {
      const dots = s.colors.map(c =>
        `<span class="si-dot" style="background:${c}"></span>`).join('');
      const lineNames = s.lineIds.map(id => {
        const l = state.indexById[id] && state.indexById[id].line;
        return l ? l.name : id + '号线';
      }).join(' · ');
      return `<li class="search-item${i === 0 ? ' is-active' : ''}" data-name="${s.name}">
        <span class="si-dots">${dots}</span>
        <span class="si-name">${s.name}</span>
        <span class="si-lines">${lineNames}</span>
      </li>`;
    }).join('');
  }

  /** 选中某站：飞到该站并钉住气泡。 */
  function gotoStation(name) {
    const s = state.searchIndex.find(x => x.name === name);
    if (!s || !state.map) return;
    closeSearch();
    state.pinned = name;
    state.map.flyTo({ center: [s.lon, s.lat], zoom: 14, duration: 800 });
    // 飞行结束后按站名从渲染要素定位气泡（用地图上聚合坐标，更准）
    state.map.once('moveend', () => showStationPopupByName(name));
  }

  /** 按站名在当前视图查渲染要素并弹出其气泡（钉住，不随鼠标消失）。 */
  function showStationPopupByName(name) {
    const map = state.map;
    const feats = map.querySourceFeatures('stations', {
      filter: ['==', ['get', 'name'], name],
    });
    if (feats.length) {
      const f = feats[0];
      state.hover = { kind: 'station', id: name, pinned: true };
      placePopup(f.geometry.coordinates, stationPopupHTML(f.properties));
    }
  }

  function openSearch() {
    els.search.classList.add('is-open');
    els.searchBox.hidden = false;
    els.searchInput.focus();
  }
  function closeSearch() {
    els.search.classList.remove('is-open');
    els.searchBox.hidden = true;
    els.searchInput.value = '';
    els.searchResults.innerHTML = '';
  }

  /** 绑定搜索交互（索引加载后调用）。 */
  function setupSearch() {
    if (!els.searchToggle) return;
    els.searchToggle.addEventListener('click', openSearch);
    els.searchClose.addEventListener('click', closeSearch);

    els.searchInput.addEventListener('input', () => {
      renderSearchResults(searchStations(els.searchInput.value.trim().toLowerCase()));
    });

    // 键盘导航：↑↓ 移动高亮，Enter 选中，Esc 关闭
    els.searchInput.addEventListener('keydown', (e) => {
      const items = Array.from(els.searchResults.querySelectorAll('.search-item'));
      if (e.key === 'Escape') { closeSearch(); return; }
      if (!items.length) return;
      let idx = items.findIndex(el => el.classList.contains('is-active'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1) % items.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const active = items[idx >= 0 ? idx : 0];
        if (active) gotoStation(active.dataset.name);
        return;
      } else {
        return;
      }
      items.forEach(el => el.classList.remove('is-active'));
      items[idx].classList.add('is-active');
      items[idx].scrollIntoView({ block: 'nearest' });
    });

    // 点击结果项
    els.searchResults.addEventListener('click', (e) => {
      const li = e.target.closest('.search-item');
      if (li) gotoStation(li.dataset.name);
    });
  }

  /** 把渲染要素匹配回 trainById 里的稳定对象（按同线同向取最近车）。 */
  function matchTrain(props, coord) {
    let best = null, bestD = Infinity;
    for (const id in state.trainById) {
      const t = state.trainById[id];
      if (t.lineId !== props.lineId || t.dir !== props.dir) continue;
      const d = (t.lon - coord[0]) ** 2 + (t.lat - coord[1]) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  init();
})();
