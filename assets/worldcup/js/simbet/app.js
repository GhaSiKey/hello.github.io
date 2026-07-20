/**
 * app.js — 数据分析页入口
 *
 * 读 data/worldcup.json（含预计算 meta.analytics），渲染核心指标卡 +
 * 一句话结论 + 8 图（Chart.js，见 charts.js）。纯展示，不计算。
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  async function init() {
    const summary = $('#summary');
    const errorState = $('#errorState');
    const disclaimer = $('#disclaimer');

    try {
      const data = await loadWorldCupData();
      summary.innerHTML = renderSummary(data.meta);
      // 图表卡骨架插到错误态之前
      $('#errorState').insertAdjacentHTML('beforebegin', renderChartGrid());
      renderCharts(data.meta);
      // 底部：完整赛程战绩时间线（保留原始逐场数据）
      $('#timeline').innerHTML = renderTimeline(data.matches);
      disclaimer.textContent = '⚠ ' + (data.meta.disclaimer || '') +
        '　本页为 AI 方案的事后模拟复盘，非真实投注；模拟按单关口径，与真实串关规则有别。';
    } catch (err) {
      console.error(err);
      errorState.hidden = false;
      $('#errorHint').textContent = err.message || '未知错误';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
