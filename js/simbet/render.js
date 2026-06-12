/**
 * render.js — 战绩页渲染（纯展示）
 *
 * 复用 data.js 的 esc 不可用（那是 render 里的），这里自带 esc。
 * 数据来自 data/worldcup.json：meta.betSummary + 各场 result + bets。
 */

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 金额格式：¥123 / -¥45 */
function money(n) {
  if (n == null) return '—';
  const v = Math.round(n * 100) / 100;
  return (v < 0 ? '-¥' : '¥') + Math.abs(v);
}

/** 汇总卡：总支出/已结算收入/已结算盈亏/命中率。
 *  盈亏用「已结算」口径（只算已开赛场次），不把未结算场的预算当亏损。 */
function renderSummary(meta) {
  const s = meta.betSummary || {};
  const none = (s.finishedMatches || 0) === 0;   // 还没有任何场结算
  const profit = s.profitSettled;
  const profitCls = profit > 0 ? 'pos' : (profit < 0 ? 'neg' : '');
  const arrow = profit > 0 ? '▲' : (profit < 0 ? '▼' : '');
  const roi = s.roiSettled != null ? (s.roiSettled * 100).toFixed(1) + '%' : '—';
  return `
    <div class="sum-card">
      <span class="sum-label">总支出</span>
      <span class="sum-value">${money(s.totalBudget)}</span>
      <span class="sum-sub">预算 ${s.totalMatches || 0} 场</span>
    </div>
    <div class="sum-card">
      <span class="sum-label">已结算收入</span>
      <span class="sum-value">${none ? '待开赛' : money(s.settledPayout)}</span>
      <span class="sum-sub">${none ? '' : '投入 ' + money(s.settledStake)}</span>
    </div>
    <div class="sum-card sum-card--profit ${profitCls}">
      <span class="sum-label">已结算盈亏</span>
      <span class="sum-value">${none ? '—' : money(profit) + ' ' + arrow}</span>
      <span class="sum-sub">${none ? '' : 'ROI ' + roi}</span>
    </div>
    <div class="sum-card">
      <span class="sum-label">命中率</span>
      <span class="sum-value">${s.hitBets || 0}/${s.settleableBets || 0}</span>
      <span class="sum-sub">已结算 ${s.finishedMatches || 0}/${s.totalMatches || 0} 场</span>
    </div>`;
}

/** 单注明细行：赛前只显示押注，赛后显示命中。 */
function betLine(b, result) {
  let mark = '', payout = '';
  if (result && result.status === 'finished') {
    const r = betPayout(b, result);
    if (r.hit === null) { mark = '<span class="bet-mark na">—</span>'; }
    else if (r.hit) { mark = '<span class="bet-mark hit">✓</span>'; payout = `<span class="bet-pay pos">+${b.potential}</span>`; }
    else { mark = '<span class="bet-mark miss">✗</span>'; }
  }
  return `
    <li class="sb-bet">
      ${mark}
      <span class="sb-bet-market">${escHtml(b.market)}</span>
      <span class="sb-bet-odds">@${escHtml(b.odds)}</span>
      <span class="sb-bet-stake">投${escHtml(b.stake)}</span>
      ${payout}
    </li>`;
}

/** 单场时间线节点。 */
function renderMatchNode(m) {
  const t = parseMatchTime(m.datetime);
  const plan = m.commentary && m.commentary.plan;
  const bets = plan ? plan.bets : [];
  const result = m.result || { status: 'pending' };
  const finished = result.status === 'finished';

  // 本场盈亏 + 状态
  let statusBadge, scoreText, profitText, nodeCls;
  if (finished && result.full) {
    let payout = 0;
    bets.forEach(b => { const r = betPayout(b, result); if (r.payout) payout += r.payout; });
    const stake = bets.reduce((s, b) => s + b.stake, 0);
    const profit = payout - stake;
    nodeCls = profit > 0 ? 'win' : (profit < 0 ? 'lose' : 'even');
    statusBadge = '<span class="sb-status done">✓ 已结算</span>';
    scoreText = `<span class="sb-score">${result.full.h}:${result.full.a}</span>`;
    profitText = `<span class="sb-profit ${profit >= 0 ? 'pos' : 'neg'}">本场 ${profit >= 0 ? '+' : ''}${Math.round(profit * 100) / 100}</span>`;
  } else {
    nodeCls = 'pending';
    statusBadge = '<span class="sb-status wait">待开赛</span>';
    scoreText = '<span class="sb-score muted">—</span>';
    profitText = '<span class="sb-profit muted">—</span>';
  }

  const stake = bets.reduce((s, b) => s + b.stake, 0);
  return `
    <div class="sb-node ${nodeCls}">
      <div class="sb-dot"></div>
      <div class="sb-card">
        <div class="sb-head">
          <span class="sb-time">${escHtml(t.date)} ${escHtml(t.weekday)} ${escHtml(t.time)}</span>
          <span class="sb-teams">${escHtml(m.home.name)} vs ${escHtml(m.away.name)}</span>
          ${statusBadge}
        </div>
        <ul class="sb-bets">${bets.map(b => betLine(b, result)).join('')}</ul>
        <div class="sb-foot">
          <span class="sb-stake">支出 ¥${stake}</span>
          ${scoreText}
          ${profitText}
        </div>
      </div>
    </div>`;
}

/** 整条时间线（按开赛时间排序）。 */
function renderTimeline(matches) {
  const sorted = [...matches].sort((a, b) => (a.datetime || '') < (b.datetime || '') ? -1 : 1);
  return sorted.map(renderMatchNode).join('');
}
