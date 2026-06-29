/**
 * v2.js — 世界杯赔率 V2（H5 Tab + ViewPager）入口
 *
 * 仿 Android Tab+ViewPager：日期条是 Tab，每个 Tab 一天；下方 ViewPager
 * 每页展示当天比赛卡片，左右滑动切天，Tab 联动高亮。
 *
 * 复用经典版：data.js(parseMatchTime/fmtStamp)、render.js(renderCard/renderDetail)、
 * calendar.js(dayColorClass/dayShortLabel/dayPhaseName/buildDayMeta/todayStr)。
 * 本文件只做 V2 的分天组织 + 滑动联动 + 详情开关。
 */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const els = {
    headerMeta: $('#headerMeta'),
    tabs: $('#v2Tabs'),
    pager: $('#v2Pager'),
    errorState: $('#errorState'),
    errorHint: $('#errorHint'),
    disclaimer: $('#disclaimer'),
    detailOverlay: $('#detailOverlay'),
    detailPanel: $('#detailPanel'),
    detailInner: $('#detailInner'),
  };

  const state = {
    data: null,
    days: [],        // [{date, md, weekday, dayMeta, matches:[...]}]
    current: 0,      // 当前页索引
    isSyncing: false // 区分"用户滑"与"代码滚"，防联动回环
  };

  /** 按 datetime 前10位分天，只保留有比赛的天，按日期升序。 */
  function groupByDay(matches, schedule) {
    const dayMeta = buildDayMeta(schedule);  // calendar.js：date -> {label,colorClass}
    const map = new Map();
    for (const m of matches) {
      const date = (m.datetime || '').slice(0, 10);
      if (!date) continue;
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(m);
    }
    return [...map.keys()].sort().map(date => {
      const t = parseMatchTime(map.get(date)[0].datetime);  // data.js
      const ms = map.get(date).sort((a, b) =>
        (a.datetime || '') < (b.datetime || '') ? -1 : 1);
      return {
        date, md: t.date, weekday: t.weekday,
        meta: dayMeta[date] || { label: '', colorClass: '' },
        matches: ms,
      };
    });
  }

  /** 渲染头部元信息（数据截止/分析时间）。 */
  function renderHeader(meta) {
    els.headerMeta.innerHTML = `
      <span class="meta-stamp">🕐 赔率截止 ${fmtStamp(meta.crawledAt)}</span>
      ${meta.analyzedAt ? `<span class="meta-stamp">🧠 分析于 ${fmtStamp(meta.analyzedAt)}</span>` : ''}`;
    els.disclaimer.textContent = '⚠ ' + (meta.disclaimer || '');
  }

  /** 渲染 Tab 日期条。 */
  function renderTabs() {
    const today = todayStr();  // calendar.js
    els.tabs.innerHTML = state.days.map((d, i) => {
      const isToday = d.date === today;
      return `
        <button class="v2-tab ${d.meta.colorClass}" data-idx="${i}">
          ${isToday ? '<span class="v2-tab-today">今天</span>' : ''}
          <span class="v2-tab-md">${esc(d.md)}</span>
          <span class="v2-tab-wd">${esc(d.weekday)}</span>
          <span class="v2-tab-ph">${esc(d.meta.label || '')}</span>
        </button>`;
    }).join('');
  }

  /** 渲染 ViewPager：每页一天。 */
  function renderPager() {
    els.pager.innerHTML = state.days.map(d => `
      <section class="v2-page" data-date="${d.date}">
        <div class="v2-page-head">
          <span class="v2-page-date">${esc(d.md)} ${esc(d.weekday)}</span>
          <span class="v2-page-tag">${esc(d.meta.label || '')}</span>
          <span class="v2-page-cnt">${d.matches.length} 场</span>
        </div>
        ${d.matches.map(renderCard).join('')}
      </section>`).join('');
  }

  /** 跳到第 idx 页（点 Tab 触发）。代码滚动，置 isSyncing 防回环。 */
  function goToPage(idx, smooth) {
    idx = Math.max(0, Math.min(state.days.length - 1, idx));
    state.isSyncing = true;
    els.pager.scrollTo({
      left: idx * els.pager.clientWidth,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setCurrent(idx);
    // smooth 滚动需等动画结束再解锁；auto 下一帧即可
    setTimeout(() => { state.isSyncing = false; }, smooth ? 400 : 50);
  }

  /** 设置当前页：更新 Tab 高亮 + 把该 Tab 滚到可视居中 + 触发当前页入场动画。 */
  function setCurrent(idx) {
    if (idx === state.current) return;
    state.current = idx;
    const tabs = els.tabs.querySelectorAll('.v2-tab');
    tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
    const tab = tabs[idx];
    if (tab) {
      const left = tab.offsetLeft - (els.tabs.clientWidth - tab.clientWidth) / 2;
      els.tabs.scrollTo({ left, behavior: 'smooth' });
    }
    markCurrentPage(idx);
  }

  /** 给当前页打 .is-current 触发卡片入场动画；移除其余页的标记。
   *  重挂 class 前强制 reflow，确保横滑回看同一页也能重播动画。 */
  function markCurrentPage(idx) {
    const pages = els.pager.querySelectorAll('.v2-page');
    pages.forEach((p, i) => {
      if (i === idx) {
        p.classList.remove('is-current');
        void p.offsetWidth;            // 强制 reflow，重启 animation
        p.classList.add('is-current');
      } else {
        p.classList.remove('is-current');
      }
    });
  }

  /** 用户横滑 ViewPager → 算当前页 → 联动 Tab（非代码滚动时）。 */
  function onPagerScroll() {
    if (state.isSyncing) return;
    const idx = Math.round(els.pager.scrollLeft / els.pager.clientWidth);
    setCurrent(idx);
  }

  /** 打开详情（复用 render.js 的 renderDetail）。 */
  function openDetail(mid) {
    const m = state.data.matches.find(x => x.mid === Number(mid));
    if (!m) return;
    els.detailInner.innerHTML = renderDetail(m);
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    els.detailPanel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('detail-open');
    requestAnimationFrame(() => els.detailPanel.classList.add('show'));
    const closeBtn = $('#detailClose');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
  }

  function closeDetail() {
    els.detailPanel.classList.remove('show');
    els.detailOverlay.hidden = true;
    els.detailPanel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('detail-open');
    setTimeout(() => { els.detailPanel.hidden = true; }, 280);
  }

  /** 默认定位：今天那页；今天无数据则取最近未来一天，再不行取最后一天。 */
  function defaultIndex() {
    const today = todayStr();
    let idx = state.days.findIndex(d => d.date === today);
    if (idx >= 0) return idx;
    idx = state.days.findIndex(d => d.date > today);
    return idx >= 0 ? idx : state.days.length - 1;
  }

  function bindEvents() {
    els.tabs.addEventListener('click', e => {
      const tab = e.target.closest('.v2-tab');
      if (tab) goToPage(Number(tab.dataset.idx), true);
    });
    let ticking = false;
    els.pager.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => { onPagerScroll(); ticking = false; });
        ticking = true;
      }
    }, { passive: true });
    els.pager.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (card) openDetail(card.dataset.mid);
    });
    els.detailOverlay.addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !els.detailPanel.hidden) closeDetail();
    });
    let rzTimer;
    window.addEventListener('resize', () => {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => goToPage(state.current, false), 200);
    });
  }

  function showError(msg) {
    els.errorState.hidden = false;
    els.errorHint.textContent = msg;
  }

  async function init() {
    bindEvents();
    try {
      state.data = await loadWorldCupData();
      state.days = groupByDay(state.data.matches, state.data.schedule);
      if (!state.days.length) { showError('暂无比赛数据'); return; }
      renderHeader(state.data.meta);
      renderTabs();
      renderPager();
      const idx = defaultIndex();
      state.current = -1;       // 强制 setCurrent 生效
      goToPage(idx, false);
    } catch (err) {
      console.error(err);
      showError(err.message || '未知错误');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
