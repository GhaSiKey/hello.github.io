/**
 * charts.js — 数据分析页 8 图（Chart.js）
 *
 * 读 meta.analytics（预计算）+ meta.betSummary，用 Chart.js 画。
 * 主题：沿用页面深色 + 金色调。Chart.js 走 CDN，断网时 window.Chart 缺失，
 * renderCharts 会降级为文字提示，不白屏。
 */
(function () {
  'use strict';

  // 页面调色板（与 worldcup.css 变量对应）
  const C = {
    gold: '#e8c477', goldBright: '#ffd98a', goldDeep: '#b8932f',
    green: '#38d39f', red: '#ff6b5b', yellow: '#f2c14e',
    accent: '#4f8cff', draw: '#b890ff', cold: '#5bb8ff',
    text: '#e8ecf4', dim: '#9aa3b5', faint: '#6b7488',
    grid: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.10)',
  };
  const posNeg = v => (v >= 0 ? C.green : C.red);

  // Chart.js 全局默认（深色主题）
  function applyDefaults() {
    const D = Chart.defaults;
    D.color = C.dim;
    D.borderColor = C.grid;
    D.font.family = "Inter, system-ui, sans-serif";
    D.plugins.legend.labels.color = C.dim;
    D.plugins.tooltip.backgroundColor = 'rgba(14,18,30,0.95)';
    D.plugins.tooltip.borderColor = C.border;
    D.plugins.tooltip.borderWidth = 1;
    D.plugins.tooltip.titleColor = C.goldBright;
    D.plugins.tooltip.bodyColor = C.text;
    D.plugins.tooltip.padding = 10;
  }

  const axis = (extra) => Object.assign({
    grid: { color: C.grid }, ticks: { color: C.faint, font: { size: 11 } },
  }, extra || {});

  // 阶段分带插件：按 phaseBands 画交替背景 + 分界竖线 + 阶段名（零额外依赖）
  function phaseBandsPlugin(bands) {
    return {
      id: 'phaseBands',
      beforeDatasetsDraw(chart) {
        if (!bands || !bands.length) return;
        const { ctx, chartArea: ca, scales: { x } } = chart;
        ctx.save();
        bands.forEach((b, i) => {
          const x0 = x.getPixelForValue(b.start - 1);   // 段左沿(含起点前半格)
          const x1 = x.getPixelForValue(b.end);          // 段右沿
          const left = Math.max(x0, ca.left), right = Math.min(x1, ca.right);
          if (i % 2 === 1) {                              // 隔段填浅底
            ctx.fillStyle = 'rgba(255,255,255,0.035)';
            ctx.fillRect(left, ca.top, right - left, ca.bottom - ca.top);
          }
          if (i > 0) {                                   // 段间分界竖线
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(left, ca.top); ctx.lineTo(left, ca.bottom); ctx.stroke();
            ctx.setLineDash([]);
          }
          if (right - left > 26) {                        // 段够宽才标名
            ctx.fillStyle = C.faint; ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(b.name, (left + right) / 2, ca.top + 4);
          }
        });
        ctx.restore();
      },
    };
  }

  function line(ctx, a) {
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: a.cumulative.labels,
        datasets: [{
          label: '累计盈亏 ¥', data: a.cumulative.values,
          borderColor: C.gold, borderWidth: 2,
          fill: true, backgroundColor: 'rgba(232,196,119,0.08)',
          pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: axis({ title: { display: true, text: '已结算场次序', color: C.faint } }),
          y: axis({ title: { display: true, text: '累计盈亏 ¥', color: C.faint } }),
        },
      },
      plugins: [phaseBandsPlugin(a.phaseBands)],
    });
  }

  function barROI(ctx, rows, labelKey) {
    const labels = rows.map(r => r[labelKey]);
    const vals = rows.map(r => r.roi);
    new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'ROI %', data: vals, backgroundColor: vals.map(posNeg), borderRadius: 5 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => 'ROI ' + c.raw + '%' } } },
        scales: { x: axis(), y: axis({ ticks: { color: C.faint, callback: v => v + '%' } }) },
      },
    });
  }

  function barHit(ctx, rows) {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => `${r.name}（${r.settle}注）`),   // 轴标签直出玩法次数
        datasets: [{ label: '命中率 %', data: rows.map(r => r.hitRate),
          backgroundColor: C.accent, borderRadius: 5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => `命中 ${rows[c.dataIndex].hit}/${rows[c.dataIndex].settle} · ${c.raw}%` } } },
        scales: { x: axis({ ticks: { color: C.faint, callback: v => v + '%' } }), y: axis() },
      },
    });
  }

  function barDist(ctx, rows) {
    const palette = [C.red, '#e8875b', C.yellow, C.green, C.goldBright];
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{ label: '场次', data: rows.map(r => r.count),
          backgroundColor: rows.map((_, i) => palette[i] || C.accent), borderRadius: 5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => c.raw + ' 场' } } },
        scales: { x: axis(), y: axis({ ticks: { color: C.faint, precision: 0 } }) },
      },
    });
  }

  function barHandicap(ctx, rows) {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => `${r.name}（${r.bets}注）`),
        datasets: [{ label: 'ROI %', data: rows.map(r => r.roi),
          backgroundColor: rows.map(r => posNeg(r.roi)), borderRadius: 5 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => 'ROI ' + c.raw + '%' } } },
        scales: { x: axis({ ticks: { color: C.faint, callback: v => v + '%' } }), y: axis() },
        indexAxis: 'y',
      },
    });
  }

  function barTop(ctx, win) {
    // win 已降序(+最高在首)；Chart.js 横向条形 index0 渲染在顶部 → 最赚的自然排最上
    const rows = win;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.match),
        datasets: [{ label: '本场盈利 ¥', data: rows.map(r => r.pnl),
          backgroundColor: C.green, borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => '+' + c.raw } } },
        scales: { x: axis(), y: axis({ ticks: { color: C.faint, font: { size: 10 } } }) },
      },
    });
  }

  function bubbleStake(ctx, rows) {
    new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: rows.map((r, i) => ({
          label: r.name,
          data: [{ x: r.stake, y: r.hitRate, r: 6 + Math.sqrt(r.bets) }],
          backgroundColor: [C.accent, C.gold, C.cold, C.red, C.draw][i] + 'cc',
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => {
            const r = rows[c.datasetIndex];
            return `${r.name}：投入¥${r.stake} · 命中${r.hitRate}% · ${r.bets}注`;
          } } },
        },
        scales: {
          x: axis({ title: { display: true, text: '投入 ¥', color: C.faint } }),
          y: axis({ title: { display: true, text: '命中率 %', color: C.faint }, ticks: { color: C.faint, callback: v => v + '%' } }),
        },
      },
    });
  }

  /** 入口：渲染全部 8 图。Chart.js 缺失（断网）则降级提示。 */
  function renderCharts(meta) {
    const grid = document.querySelector('#anGrid');
    if (typeof Chart === 'undefined') {
      const tip = document.createElement('p');
      tip.className = 'an-fallback';
      tip.textContent = '⚠ 图表库（Chart.js）加载失败，可能是网络问题。核心数据见上方指标卡；刷新页面可重试。';
      if (grid) grid.prepend(tip);
      return;
    }
    const a = meta.analytics;
    if (!a) return;
    applyDefaults();
    const $ = id => document.getElementById(id);
    line($('chartCum'), a);
    barROI($('chartMarket'), a.byMarket, 'name');
    barROI($('chartPhase'), a.byPhase, 'name');
    barHit($('chartHit'), a.byMarket);
    barDist($('chartDist'), a.distribution);
    barHandicap($('chartHandicap'), a.handicap);
    barTop($('chartTop'), a.topWin);
    bubbleStake($('chartStake'), a.byMarket);
  }

  window.renderCharts = renderCharts;
})();
