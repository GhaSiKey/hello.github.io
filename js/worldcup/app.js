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
    view: 'date',      // date | group
  };

  const $ = sel => document.querySelector(sel);
  const els = {
    skeleton: $('#skeleton'),
    groups: $('#groups'),
    errorState: $('#errorState'),
    errorHint: $('#errorHint'),
    headerMeta: $('#headerMeta'),
    disclaimer: $('#disclaimer'),
    viewTabs: $('#viewTabs'),
    detailOverlay: $('#detailOverlay'),
    detailPanel: $('#detailPanel'),
    detailInner: $('#detailInner'),
  };

  /** 渲染头部元信息（数据截止时间 —— 冻结快照必须显著标注）。 */
  function renderHeader(meta) {
    els.headerMeta.innerHTML = `
      <span class="meta-stamp">🕐 赔率截止 ${fmtStamp(meta.crawledAt)}</span>
      ${meta.analyzedAt ? `<span class="meta-stamp">🧠 分析于 ${fmtStamp(meta.analyzedAt)}</span>` : ''}`;
    els.disclaimer.textContent = '⚠ ' + (meta.disclaimer || '');
  }

  /** 渲染列表。 */
  function renderList() {
    els.groups.innerHTML = renderGroups(state.data.matches, state.view);
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

  /** 切换视图。 */
  function switchView(view) {
    if (view === state.view) return;
    state.view = view;
    els.viewTabs.querySelectorAll('.view-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    renderList();
  }

  /** 绑定事件（事件委托）。 */
  function bindEvents() {
    els.viewTabs.addEventListener('click', e => {
      const tab = e.target.closest('.view-tab');
      if (tab) switchView(tab.dataset.view);
    });
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
    bindEvents();
    try {
      state.data = await loadWorldCupData();
      renderHeader(state.data.meta);
      renderList();
      els.skeleton.hidden = true;
    } catch (err) {
      console.error(err);
      showError(err.message || '未知错误');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
