/**
 * render.js — 数据分析页渲染（纯展示）
 *
 * 全届 104 场结算完毕，本页把 AI 模拟买盘战绩做成数据分析。
 * 数据全部预计算在 data/worldcup.json 的 meta.betSummary + meta.analytics，
 * 前端不计算，只读并交给 Chart.js 画（图表配置见 charts.js）。
 */

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(n) {
  if (n == null) return '—';
  const v = Math.round(n * 100) / 100;
  return (v < 0 ? '-¥' : '¥') + Math.abs(v);
}

/** 核心指标卡：总支出 / 总回款 / 最终盈亏 / 命中率。 */
function renderSummary(meta) {
  const s = meta.betSummary || {};
  const profit = s.profitSettled;
  const profitCls = profit > 0 ? 'pos' : (profit < 0 ? 'neg' : '');
  const arrow = profit > 0 ? '▲' : (profit < 0 ? '▼' : '');
  const roi = s.roiSettled != null ? (s.roiSettled * 100).toFixed(1) + '%' : '—';
  return `
    <div class="sum-card">
      <span class="sum-label">总支出</span>
      <span class="sum-value">${money(s.totalBudget)}</span>
      <span class="sum-sub">${s.totalMatches || 0} 场 · ${s.totalBets || 0} 注</span>
    </div>
    <div class="sum-card">
      <span class="sum-label">总回款</span>
      <span class="sum-value">${money(s.settledPayout)}</span>
      <span class="sum-sub">投入 ${money(s.settledStake)}</span>
    </div>
    <div class="sum-card sum-card--profit ${profitCls}">
      <span class="sum-label">最终盈亏</span>
      <span class="sum-value">${money(profit)} ${arrow}</span>
      <span class="sum-sub">ROI ${roi}</span>
    </div>
    <div class="sum-card">
      <span class="sum-label">命中率</span>
      <span class="sum-value">${s.hitBets || 0}/${s.settleableBets || 0}</span>
      <span class="sum-sub">${((s.hitBets / s.settleableBets) * 100 || 0).toFixed(1)}% · 已结算 ${s.finishedMatches || 0} 场</span>
    </div>`;
}

/** 一句话结论。 */
function renderLead(meta) {
  const s = meta.betSummary || {};
  const roi = s.roiSettled != null ? (s.roiSettled * 100).toFixed(1) + '%' : '—';
  return `全届 ${s.totalMatches || 0} 场、${s.totalBets || 0} 注、投入 ${money(s.totalBudget)}，`
    + `最终 ROI <b>${roi}</b>、净亏 <b>${money(s.profitSettled)}</b>。`
    + `竞彩返还率 71%~89% 决定长期期望为负——下方数据是这一结论的完整佐证，也是这份 AI 模拟的价值所在。`;
}

/** 单个图表卡骨架（标题 + canvas）。cls 控制跨列宽度。 */
function chartCard(id, title, cls) {
  return `
    <div class="an-card ${cls || ''}">
      <div class="an-card-head">
        <h3 class="an-card-title">${escHtml(title)}</h3>
      </div>
      <div class="an-canvas-wrap"><canvas id="${id}"></canvas></div>
    </div>`;
}

/** 图表网格骨架（8 图，两列布局，每行两卡）。canvas 由 charts.js 填充。 */
function renderChartGrid() {
  return [
    chartCard('chartCum', '累计盈亏曲线', ''),           // 第1行
    chartCard('chartTop', '单场盈利 Top 10', ''),
    chartCard('chartHit', '各玩法命中率', ''),           // 第2行
    chartCard('chartDist', '单场盈亏分布', ''),
    chartCard('chartMarket', '各玩法 ROI', ''),          // 第3行
    chartCard('chartPhase', '各阶段 ROI', ''),
    chartCard('chartHandicap', '让球新旧对比', ''),      // 第4行
    chartCard('chartStake', '各玩法投入 vs 命中率', ''),
  ].join('');
}

/* ── 底部：完整赛程战绩时间线（保留原数据，104 场逐场明细）── */

/** 单注明细行：赛后显示命中。 */
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
