/**
 * app.js — 入口与交互
 *
 * 职责：加载数据 → 渲染列表 → 绑定视图切换、卡片点击、详情开关。
 * 不做任何赔率计算（都在 build_wc_data.py 完成）。
 */
(function () {
  'use strict';

  const state = {
    data: null,
    calView: null,     // strip | grid；init 时按屏宽决定默认（窄屏=strip，宽屏=grid）
    calViewByUser: false,  // 用户是否手动切过——切过则不再被 resize 覆盖
  };

  // 移动端断点（与 CSS @media 一致）：≤768 视为 H5
  const MOBILE_MAX = 768;
  /** 按屏宽返回默认日历视图：宽屏(Web)月历，窄屏(H5)日期条。 */
  function defaultCalView() {
    return window.innerWidth > MOBILE_MAX ? 'grid' : 'strip';
  }

  const $ = sel => document.querySelector(sel);
  const els = {
    skeleton: $('#skeleton'),
    groups: $('#groups'),
    errorState: $('#errorState'),
    errorHint: $('#errorHint'),
    headerMeta: $('#headerMeta'),
    disclaimer: $('#disclaimer'),
    champBanner: $('#champBanner'),
    calendar: $('#calendar'),
    detailOverlay: $('#detailOverlay'),
    detailPanel: $('#detailPanel'),
    detailInner: $('#detailInner'),
  };

  /** 渲染头部元信息。赛事已闭幕则显终态，否则显数据截止时间戳。 */
  function renderHeader(meta) {
    const t = meta.tournament;
    if (t && t.status === 'finished') {
      els.headerMeta.innerHTML = `
        <span class="meta-stamp">🏁 赛事已闭幕 · ${fmtStamp(t.concludedAt)}</span>
        <span class="meta-stamp">🏆 冠军 ${escapeText(t.champion)}</span>`;
    } else {
      els.headerMeta.innerHTML = `
        <span class="meta-stamp">🕐 赔率截止 ${fmtStamp(meta.crawledAt)}</span>
        ${meta.analyzedAt ? `<span class="meta-stamp">🧠 分析于 ${fmtStamp(meta.analyzedAt)}</span>` : ''}`;
    }
    els.disclaimer.textContent = '⚠ ' + (meta.disclaimer || '');
  }

  /** 转义（headerMeta/banner 用，避免队名注入）。 */
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 冠军收官条：赛事闭幕才显示，读 meta.tournament。 */
  function renderChampion(meta) {
    const t = meta.tournament;
    if (!els.champBanner) return;
    if (!t || t.status !== 'finished') { els.champBanner.hidden = true; return; }
    const e = escapeText;
    els.champBanner.hidden = false;
    els.champBanner.innerHTML = `
      <div class="champ-top">
        <span class="champ-trophy">🏆</span>
        <div class="champ-lines">
          <span class="champ-headline">${e(t.headline || '赛事已闭幕')}</span>
          <span class="champ-name"><span class="champ-crown">👑</span> ${e(t.champion)}</span>
        </div>
      </div>
      <div class="champ-podium">
        <span class="champ-rank champ-rank--1"><span class="champ-medal">🥇</span>${e(t.champion)}</span>
        <span class="champ-rank"><span class="champ-medal">🥈</span>${e(t.runnerUp)}</span>
        <span class="champ-rank"><span class="champ-medal">🥉</span>${e(t.third)}</span>
        <span class="champ-rank"><span class="champ-medal">4️⃣</span>${e(t.fourth)}</span>
        <span class="champ-note">${e(t.finalNote)}${t.thirdNote ? ' · ' + e(t.thirdNote) : ''}</span>
      </div>`;
  }

  /** 渲染列表（固定按日期分组，分组头带阶段/轮次标签）。 */
  function renderList() {
    const dayMeta = buildDayMeta(state.data.schedule);
    els.groups.innerHTML = renderGroups(state.data.matches, dayMeta);
  }

  /** 渲染赛程总览日历。 */
  function renderCal() {
    if (!els.calendar) return;
    els.calendar.innerHTML = renderCalendar(
      state.data.schedule, state.data.matches, state.calView);
  }

  /** 切换日历视图（两版）。用户手动切换后，标记为用户选择。 */
  function switchCalView(cv) {
    if (cv === state.calView) return;
    state.calView = cv;
    state.calViewByUser = true;  // 之后 resize 不再覆盖
    renderCal();
  }

  /** 点击的日期无赔率列表时，给该格一个"未开放"抖动反馈。 */
  function flashCalCell(cell) {
    cell.classList.add('cal-nolist-flash');
    setTimeout(() => cell.classList.remove('cal-nolist-flash'), 600);
  }

  /** 打开详情。 */
  function openDetail(mid) {
    const m = state.data.matches.find(x => x.mid === Number(mid));
    if (!m) return;
    els.detailInner.innerHTML = renderDetail(m);
    els.detailPanel.hidden = false;
    els.detailOverlay.hidden = false;
    els.detailPanel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('detail-open');
    // 触发进场动画（下一帧加 class）
    requestAnimationFrame(() => els.detailPanel.classList.add('show'));
    const closeBtn = $('#detailClose');
    if (closeBtn) closeBtn.addEventListener('click', closeDetail);
  }

  /** 关闭详情。 */
  function closeDetail() {
    els.detailPanel.classList.remove('show');
    els.detailOverlay.hidden = true;
    els.detailPanel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('detail-open');
    // 动画结束后隐藏
    setTimeout(() => { els.detailPanel.hidden = true; }, 280);
  }

  /** 绑定事件（事件委托）。 */
  function bindEvents() {
    // 日历：切换两版 + 点击某天滚动到列表
    if (els.calendar) {
      els.calendar.addEventListener('click', e => {
        const vt = e.target.closest('.cal-vt');
        if (vt) { switchCalView(vt.dataset.calview); return; }
        const cell = e.target.closest('[data-date]');
        if (cell) {
          const ok = scrollToDay(cell.dataset.date);
          if (!ok) flashCalCell(cell);  // 该日无赔率列表，反馈
        }
      });
    }
    // 卡片点击/键盘
    els.groups.addEventListener('click', e => {
      const card = e.target.closest('.card');
      if (card) openDetail(card.dataset.mid);
    });
    els.groups.addEventListener('keydown', e => {
      const card = e.target.closest('.card');
      if (card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openDetail(card.dataset.mid);
      }
    });
    els.detailOverlay.addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !els.detailPanel.hidden) closeDetail();
    });
    // 跨断点自动切默认视图（仅当用户没手动切过）。防抖。
    let rzTimer;
    window.addEventListener('resize', () => {
      if (state.calViewByUser) return;
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => {
        const def = defaultCalView();
        if (def !== state.calView) { state.calView = def; renderCal(); }
      }, 200);
    });
  }

  /** 错误态。 */
  function showError(msg) {
    els.skeleton.hidden = true;
    els.groups.hidden = true;
    els.errorState.hidden = false;
    els.errorHint.textContent = msg;
  }

  /** 启动。 */
  async function init() {
    state.calView = defaultCalView();  // 按屏宽定默认：Web月历 / H5日期条
    bindEvents();
    try {
      state.data = await loadWorldCupData();
      renderHeader(state.data.meta);
      renderChampion(state.data.meta);
      renderCal();
      renderList();
      els.skeleton.hidden = true;
    } catch (err) {
      console.error(err);
      showError(err.message || '未知错误');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
