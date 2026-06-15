/**
 * app.js — 战绩页入口
 *
 * 读 data/worldcup.json，渲染汇总卡 + 战绩时间线。纯展示，不计算赔率。
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);

  async function init() {
    const summary = $('#summary');
    const timeline = $('#timeline');
    const errorState = $('#errorState');
    const disclaimer = $('#disclaimer');

    try {
      const data = await loadWorldCupData();
      summary.innerHTML = renderSummary(data.meta);
      // 时间线渲染到错误态之前
      const html = renderTimeline(data.matches);
      timeline.insertAdjacentHTML('afterbegin', html);
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
