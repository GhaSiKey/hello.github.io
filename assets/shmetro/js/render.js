/**
 * render.js — MapLibre 图层渲染
 *
 * 职责：把线路几何、站点、列车画到地图上。三类图层：
 *   1. 线路 LineString（按 color 着色）
 *   2. 站点 circle（换乘站描边加粗）
 *   3. 列车 circle（GeoJSON 点，每帧更新坐标）
 *
 * CARTO 浅灰底图（开源、无需 key），保留 CARTO + OSM 版权标注（合规必须）。
 */
(function (global) {
  'use strict';

  // 浅灰底图 raster 样式（无需 key）。
  // 底图源必须是 WGS-84（与线路投影一致），且国内直连可达——CARTO/OSM/Wikimedia
  // 在部分网络超时，实测 ESRI ArcGIS 可达；高德/腾讯是 GCJ-02 偏移，换上会与线路错位。
  // ESRI Light Gray：Base（浅灰底）+ Reference（街道/地名标注）两层叠加，接近 Positron。
  // 注意 ESRI 瓦片路径是 /tile/{z}/{y}/{x}（y 在前）。
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const BASE_STYLE = {
    version: 8,
    sources: {
      esriBase: {
        type: 'raster',
        tiles: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
        attribution:
          '© <a href="https://www.esri.com/">Esri</a> · ' +
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      esriRef: {
        type: 'raster',
        tiles: [`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
        tileSize: 256,
        maxzoom: 16,
      },
    },
    // glyphs：拉丁字符字形来源（本工程站名用 DOM 弹窗，不走 symbol 层，实际几乎不请求）。
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    layers: [
      { id: 'esri-base', type: 'raster', source: 'esriBase' },
      { id: 'esri-ref', type: 'raster', source: 'esriRef', paint: { 'raster-opacity': 0.9 } },
    ],
  };

  // 上海全域边界（含崇明/长兴、市域机场线、金山方向），限制平移不跑出上海。
  // [西南角, 东北角] = [[minLon, minLat], [maxLon, maxLat]]
  const SHANGHAI_BOUNDS = [[120.75, 30.55], [122.15, 31.95]];

  /** 创建地图，中心落在上海。缩放/平移限制在上海范围内。 */
  function createMap(container) {
    return new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [121.47, 31.23],  // 人民广场附近
      zoom: 10.5,
      minZoom: 9,               // 最小缩放：约“整个上海”大小，再往外无意义
      maxZoom: 16,
      maxBounds: SHANGHAI_BOUNDS,  // 平移不出上海
      attributionControl: true,
      // CJK 站名用系统字体本地渲染，避免 glyph pbf 不含中文导致豆腐块
      localIdeographFontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
    });
  }

  /** 线路几何 → GeoJSON FeatureCollection。
   * 分支线每支各出一个 LineString（同色、共享主干重叠绘制，视觉无碍）；
   * 非分支线一条。feature id 仍用 line.id（feature-state 高亮按线生效）。
   */
  function linesGeoJSON(lines) {
    const feats = [];
    for (const l of lines) {
      const geoms = (l.branches && l.branches.length)
        ? l.branches.map(b => b.geometry)
        : [l.geometry];
      geoms.forEach((g, i) => {
        feats.push({
          type: 'Feature',
          id: l.id,   // 同线各支共用同一 feature id → 高亮/淡化整条线一起生效
          properties: { id: l.id, color: l.color, name: l.name, branchIdx: i },
          geometry: { type: 'LineString', coordinates: g },
        });
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  /** 站点 → GeoJSON。
   * 关键：站点坐标用 mileage_m 投影回轨道折线（geoIndex），
   * 而非高德原始经纬度——否则站点会因 GCJ→WGS 与 OSM 的系统偏差飘离线路。
   * indexById: { 线路id → { geoIndex } }
   */
  /** 站点 → GeoJSON。按站名聚合：每个唯一站名只出一个 feature（换乘站不再
   * 每线一个点堆叠）。坐标取各线投影坐标均值，属性汇总所有经过线路。
   */
  function stationsGeoJSON(lines, indexById) {
    const agg = {}; // 站名 → { coords:[], lineIds:[], colors:[] }
    for (const l of lines) {
      const routes = (indexById && indexById[l.id] && indexById[l.id].routes) || [];
      for (const s of l.stations) {
        // 找到包含该站的 route，用其 mileage 投影到该支几何上（精确落在线上）
        let coord = [s.lon, s.lat]; // 兜底：原始坐标
        for (const { route, geoIndex } of routes) {
          const rs = route.stations.find(x => x.name === s.name);
          if (rs && typeof rs.mileage_m === 'number') {
            const p = MetroGeo.locate(geoIndex, rs.mileage_m);
            coord = [p.lon, p.lat];
            break;
          }
        }
        const a = agg[s.name] || (agg[s.name] = { coords: [], lineIds: [], colors: [] });
        a.coords.push(coord);
        if (!a.lineIds.includes(l.id)) { a.lineIds.push(l.id); a.colors.push(l.color); }
      }
    }
    const feats = [];
    for (const name in agg) {
      const a = agg[name];
      const cx = a.coords.reduce((s, c) => s + c[0], 0) / a.coords.length;
      const cy = a.coords.reduce((s, c) => s + c[1], 0) / a.coords.length;
      const isTransfer = a.lineIds.length >= 2;
      feats.push({
        type: 'Feature',
        properties: {
          name,
          isTransfer: isTransfer ? 1 : 0,
          transferCount: a.lineIds.length,
          lineIds: JSON.stringify(a.lineIds),   // MapLibre 属性须为标量 → JSON 串
          color: a.colors[0],                    // 单线站用本线色
        },
        geometry: { type: 'Point', coordinates: [cx, cy] },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  /** 加线路 + 站点静态图层（地图 load 后调用一次）。
   * hoveredLine: 用 feature-state 高亮某条线；这里用 setFilter 之外的 paint 表达式实现。
   */
  function addStaticLayers(map, lines, indexById) {
    map.addSource('lines', { type: 'geojson', data: linesGeoJSON(lines), promoteId: 'id' });

    // 底层白描边（casing）：让彩线在浅底图上更立体、更清晰
    map.addLayer({
      id: 'lines-casing',
      type: 'line',
      source: 'lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 9],
        'line-opacity': 0.9,
      },
    });
    // 主彩线：hover 时该线加粗、其余线变淡
    map.addLayer({
      id: 'lines',
      type: 'line',
      source: 'lines',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          9, ['case', ['boolean', ['feature-state', 'hover'], false], 4, 2.5],
          14, ['case', ['boolean', ['feature-state', 'hover'], false], 8, 5.5],
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'dim'], false], 0.25,
          0.9,
        ],
      },
    });

    map.addSource('stations', { type: 'geojson', data: stationsGeoJSON(lines, indexById) });
    // 普通站：白心 + 本线色细环，半径随缩放变。换乘站单独一层（更大、深环）。
    // 小屏（手机 H5）站点缩小系数：窄屏上换乘站密集，圆圈按比例缩小防重叠。
    const s = (typeof window !== 'undefined' && window.innerWidth <= 600) ? 0.55 : 1;
    map.addLayer({
      id: 'stations',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'isTransfer'], 0],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2 * s, 13, 4 * s, 16, 6 * s],
        'circle-color': '#ffffff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2 * s, 14, 2 * s],
      },
    });
    // 换乘站：合并后的单一大标记（白心 + 深色粗环），画在普通站之上。
    // 半径随「线数」轻微增大（2 线稍大，4 线更大），强化"枢纽"观感。
    map.addLayer({
      id: 'stations-transfer',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'isTransfer'], 1],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          9, ['*', s, ['+', 3, ['*', 0.5, ['get', 'transferCount']]]],
          14, ['*', s, ['+', 5, ['*', 1.1, ['get', 'transferCount']]]],
        ],
        'circle-color': '#ffffff',
        'circle-stroke-color': '#2b2f3a',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6 * s, 14, 2.6 * s],
      },
    });
    // 站名（放大后显示）
    map.addLayer({
      id: 'station-labels',
      type: 'symbol',
      source: 'stations',
      minzoom: 12,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 15, 13],
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#fff',
        'text-halo-width': 1.4,
      },
    });
  }

  /** 用 canvas 画一个箭头图标（尖端朝上=北，供 icon-rotate 旋转到行进方向）。
   * 彩色填充 + 白描边，pixelRatio 2 保证清晰。返回 addImage 可用的对象。
   */
  function makeArrowIcon(color, size) {
    const s = size || 44;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    ctx.translate(s / 2, s / 2);
    const w = s * 0.30, h = s * 0.38;
    ctx.beginPath();
    ctx.moveTo(0, -h);          // 尖端（前进方向）
    ctx.lineTo(w, h);           // 右后
    ctx.quadraticCurveTo(0, h * 0.45, -w, h); // 尾部内凹弧线
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = s * 0.07;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    return { width: s, height: s, data: new Uint8Array(ctx.getImageData(0, 0, s, s).data.buffer) };
  }

  /** 加列车图层：为每条线注册一个箭头图标，再加 glow(圆) + 箭头(symbol)。 */
  function addTrainLayer(map, lines) {
    // 每条线一个彩色箭头图标：arrow-<lineId>
    for (const l of lines) {
      const name = 'arrow-' + l.id;
      if (!map.hasImage(name)) {
        map.addImage(name, makeArrowIcon(l.color), { pixelRatio: 2 });
      }
    }

    map.addSource('trains', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    // 柔光晕层：低缩放时它是列车的主要表征（小圆点，无方向、不挤），
    // 放大后作为箭头下的光晕。低缩放半径收小、透明度略降，避免开屏一片糊。
    map.addLayer({
      id: 'trains-glow',
      type: 'circle',
      source: 'trains',
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          9, 2.6, 11, 3.6, 12.5, 6, 14, 11,
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': [
          'interpolate', ['linear'], ['zoom'],
          9, 0.55, 11, 0.5, 13, 0.28,   // 低缩放当实心点用（不透明些），高缩放退为柔光
        ],
        'circle-blur': [
          'interpolate', ['linear'], ['zoom'],
          9, 0.25, 11, 0.4, 13, 0.9,    // 低缩放锐利像点，高缩放虚化成光晕
        ],
      },
    });
    // 主体箭头：随缩放渐进式展示——
    // ① icon-opacity 在 zoom 11→12.5 从 0 淡入到 1，开屏(≤11)完全不显示箭头，只看点；
    // ② 关闭 allow-overlap/ignore-placement 并留 padding，开启碰撞检测，
    //    即便中等缩放箭头也会自动避让、不叠成一坨。
    map.addLayer({
      id: 'trains',
      type: 'symbol',
      source: 'trains',
      layout: {
        'icon-image': ['concat', 'arrow-', ['get', 'lineId']],
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 3,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 14, 0.82],
      },
      paint: {
        'icon-opacity': [
          'interpolate', ['linear'], ['zoom'],
          11, 0, 12.5, 1,
        ],
      },
    });
  }

  /** 用当前帧的列车数据更新 trains 源。
   * trains: [{lon,lat,color,line,lineId,dir,toward,heading}]
   */
  function updateTrains(map, trains) {
    const src = map.getSource('trains');
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: trains.map(t => ({
        type: 'Feature',
        properties: {
          color: t.color, line: t.line, lineId: t.lineId,
          dir: t.dir, toward: t.toward || '', heading: t.heading || 0,
        },
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
      })),
    });
  }

  /** 高亮某条线（其余变淡）；lineId 为 null 时清除高亮。 */
  function highlightLine(map, lines, lineId) {
    for (const l of lines) {
      const hover = l.id === lineId;
      const dim = lineId != null && l.id !== lineId;
      map.setFeatureState({ source: 'lines', id: l.id }, { hover, dim });
    }
  }

  /** 取一条线的所有几何坐标（分支线合并各支）。 */
  function _lineCoords(line) {
    if (line.branches && line.branches.length) {
      return line.branches.reduce((acc, b) => acc.concat(b.geometry), []);
    }
    return line.geometry || [];
  }

  /** 缩放到某条线，使其居中且完整可见。lineId 为 null 时回到上海全景。 */
  function focusView(map, lines, lineId) {
    if (lineId == null) {
      map.easeTo({ center: [121.47, 31.23], zoom: 10.5, duration: 600 });
      return;
    }
    const line = lines.find(l => l.id === lineId);
    const coords = line && _lineCoords(line);
    if (!coords || !coords.length) return;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      // 图例在右下角，右/下侧多留白避免线路被遮挡
      padding: { top: 50, bottom: 90, left: 50, right: 170 },
      duration: 700,
      maxZoom: 14,
    });
  }

  global.MetroRender = {
    createMap, addStaticLayers, addTrainLayer, updateTrains, highlightLine, focusView,
  };
})(window);
