/**
 * render.js — 渲染层（纯展示，不计算）
 *
 * 所有数值已由 build_wc_data.py 算好，这里只负责把数据画成 DOM。
 */

/** 价值标签 -> emoji 图标。 */
const TAG_ICON = {
  '大热盘': '🔥',
  '均势盘': '⚖️',
  '关注平局': '💎',
  '小球倾向': '🧊',
};

/** HTML 转义，防止队名/点评里的特殊字符破坏结构。 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 队徽 img，加载失败时由 wcLogoFail 降级为占位（避免内联 HTML 的引号冲突）。 */
function logoImg(team) {
  if (!team.logo) return '<span class="team-logo team-logo--ph">⚽</span>';
  return `<img class="team-logo" src="${esc(team.logo)}" alt="${esc(team.name)}"
    loading="lazy" onerror="wcLogoFail(this)">`;
}

/** img 加载失败时替换为占位（全局，供 onerror 调用）。 */
function wcLogoFail(img) {
  const span = document.createElement('span');
  span.className = 'team-logo team-logo--ph';
  span.textContent = '⚽';
  img.replaceWith(span);
}

/** 价值标签组 HTML。 */
function tagsHtml(tags) {
  if (!tags || !tags.length) return '';
  return `<div class="tags">` + tags.map(t =>
    `<span class="tag tag--${t}">${TAG_ICON[t] || ''} ${esc(t)}</span>`
  ).join('') + `</div>`;
}

/** 列表卡片。展示对阵 + 胜平负 + 让球核心盘 + 标签。 */
function renderCard(m) {
  const t = parseMatchTime(m.datetime);
  const had = m.odds.had;
  const hhad = (m.odds.hhad && m.odds.hhad[0]) || null;

  // 胜平负区：open 显示三栏；hhad_only 显示提示
  let oddsBlock;
  if (had) {
    oddsBlock = `
      <div class="card-odds">
        <div class="odd"><span class="odd-k">主胜</span><span class="odd-v">${esc(had.h)}</span></div>
        <div class="odd"><span class="odd-k">平</span><span class="odd-v">${esc(had.d)}</span></div>
        <div class="odd"><span class="odd-k">客胜</span><span class="odd-v">${esc(had.a)}</span></div>
      </div>`;
  } else {
    oddsBlock = `<div class="card-odds card-odds--none">未开胜平负</div>`;
  }

  // 让球核心盘（第5条决策：卡片也露让球）
  const hhadBlock = hhad ? `
    <div class="card-hhad">
      <span class="hhad-label">让${esc(hhad.goalLine)}</span>
      <span class="hhad-v">${esc(hhad.h)}</span>
      <span class="hhad-v">${esc(hhad.d)}</span>
      <span class="hhad-v">${esc(hhad.a)}</span>
    </div>` : '';

  const hasPlan = m.commentary && m.commentary.plan;
  const planBadge = hasPlan ? `<span class="card-plan-badge">📝 有方案</span>` : '';

  return `
  <article class="card" data-mid="${m.mid}" tabindex="0" role="button">
    <div class="card-head">
      <span class="card-num">${esc(m.matchNum)}</span>
      <span class="card-group">${esc(m.group)}</span>
      <span class="card-time">${esc(t.time)}</span>
    </div>
    <div class="card-teams">
      <div class="team">
        ${logoImg(m.home)}
        <span class="team-name">${esc(m.home.name)}</span>
      </div>
      <span class="vs">VS</span>
      <div class="team">
        ${logoImg(m.away)}
        <span class="team-name">${esc(m.away.name)}</span>
      </div>
    </div>
    ${oddsBlock}
    ${hhadBlock}
    <div class="card-foot">
      ${tagsHtml(m.tags)}
      ${planBadge}
    </div>
  </article>`;
}

/** 按日期分组（列表固定按日期，每个分组带锚点供日历滚动定位）。 */
function groupMatches(matches) {
  const buckets = new Map();
  for (const m of matches) {
    const t = parseMatchTime(m.datetime);
    const key = `${t.date} ${t.weekday}`;
    const order = m.datetime || '';
    const anchor = (m.datetime || '').slice(0, 10);  // YYYY-MM-DD 锚点
    if (!buckets.has(key)) buckets.set(key, { key, order, anchor, items: [] });
    buckets.get(key).items.push(m);
  }
  return [...buckets.values()].sort((a, b) => a.order < b.order ? -1 : 1);
}

/** 渲染整个列表（按日期分组 + 卡片网格）。日期分组带锚点 id 供日历滚动定位。
 *  dayMeta: { 'YYYY-MM-DD': {label, colorClass} }，给分组头加阶段/轮次标签徽章。 */
function renderGroups(matches, dayMeta) {
  dayMeta = dayMeta || {};
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return groupMatches(matches).map(g => {
    const meta = dayMeta[g.anchor];
    const isToday = g.anchor === today;
    const todayTag = isToday ? `<span class="group-today">今天</span>` : '';
    const badge = meta
      ? `<span class="group-phase ${meta.colorClass}">${esc(meta.label)}</span>`
      : '';
    const cnt = `<span class="group-count">${g.items.length}场</span>`;
    return `
    <section class="group${isToday ? ' group--today' : ''}" id="day-${g.anchor}">
      <h2 class="group-title">${esc(g.key)} ${todayTag} ${badge} ${cnt}</h2>
      <div class="cards">${g.items.map(renderCard).join('')}</div>
    </section>`;
  }).join('');
}

// ── 详情面板 ───────────────────────────────────────────

/** 去水概率三色条。 */
function probBar(prob) {
  if (!prob) return '';
  const pct = v => (v * 100).toFixed(0);
  return `
    <div class="prob-bar">
      <div class="prob-seg prob-h" style="width:${prob.h * 100}%">主 ${pct(prob.h)}%</div>
      <div class="prob-seg prob-d" style="width:${prob.d * 100}%">平 ${pct(prob.d)}%</div>
      <div class="prob-seg prob-a" style="width:${prob.a * 100}%">客 ${pct(prob.a)}%</div>
    </div>`;
}

/** 返还率徽章。 */
function returnBadge(r, label) {
  if (r == null) return '';
  const lv = returnLevel(r);
  return `<span class="ret-badge ret-${lv}">${esc(label)} 返还 ${(r * 100).toFixed(1)}%</span>`;
}

/** 赔率值 -> 色温档位 class（越低越热）。用于让热门项"浮"出来。 */
function oddsHeatClass(odds) {
  const v = parseFloat(odds);
  if (isNaN(v)) return '';
  if (v < 2) return 'heat-5';      // 很热
  if (v < 3.5) return 'heat-4';    // 热
  if (v < 7) return 'heat-3';      // 中
  if (v < 20) return 'heat-2';     // 冷
  return 'heat-1';                 // 很冷
}

/** 玩法表格行：键值对列表。最低赔率项高亮，各项按赔率上色温。 */
function oddsRow(label, pairs) {
  // 找出本行最低赔率（最被看好），其下标用于高亮
  let minIdx = -1, minVal = Infinity;
  pairs.forEach(([, v], i) => {
    const n = parseFloat(v);
    if (!isNaN(n) && n < minVal) { minVal = n; minIdx = i; }
  });
  const cells = pairs.map(([k, v], i) => {
    const heat = oddsHeatClass(v);
    const hot = i === minIdx ? ' orow-cell--hot' : '';
    return `<span class="orow-cell ${heat}${hot}"><i>${esc(k)}</i><b>${esc(v)}</b></span>`;
  }).join('');
  return `<div class="orow"><span class="orow-label">${esc(label)}</span>
    <div class="orow-cells">${cells}</div></div>`;
}

/** 半全场字段 -> 中文（与后端一致）。 */
const HAFU_LABEL = {
  hh: '胜/胜', hd: '胜/平', ha: '胜/负', dh: '平/胜', dd: '平/平',
  da: '平/负', ah: '负/胜', ad: '负/平', aa: '负/负',
};

/** 比分 6×6 热力矩阵：行=主队进球，列=客队进球；"其它"另列。 */
function crsMatrix(crs) {
  const MAX = 5;  // 0-5 球
  const grid = {};     // "主-客" -> odds
  const others = [];   // 胜其它/平其它/负其它
  let minV = Infinity, minKey = '';
  for (const c of crs) {
    const m = c.name.match(/^(\d):(\d)$/);
    if (m) {
      const h = +m[1], a = +m[2];
      if (h <= MAX && a <= MAX) {
        grid[`${h}-${a}`] = c.odds;
        if (c.odds < minV) { minV = c.odds; minKey = `${h}-${a}`; }
      }
    } else {
      others.push(c);   // 胜其它等
    }
  }
  let html = '<div class="matrix matrix-crs"><table><thead><tr><th class="corner">主\\客</th>';
  for (let a = 0; a <= MAX; a++) html += `<th>${a}</th>`;
  html += '</tr></thead><tbody>';
  for (let h = 0; h <= MAX; h++) {
    html += `<tr><th>${h}</th>`;
    for (let a = 0; a <= MAX; a++) {
      const v = grid[`${h}-${a}`];
      if (v == null) { html += '<td class="cell--empty">·</td>'; continue; }
      const hot = `${h}-${a}` === minKey ? ' cell--hot' : '';
      html += `<td class="${oddsHeatClass(v)}${hot}">${esc(v)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  if (others.length) {
    html += '<div class="crs-others">' + others.map(c =>
      `<span class="crs-other ${oddsHeatClass(c.odds)}"><i>${esc(c.name)}</i><b>${esc(c.odds)}</b></span>`
    ).join('') + '</div>';
  }
  return html + '</div>';
}

/** 5 种玩法赔率区。胜平负/让球/总进球用行式，半全场/比分用矩阵。 */
function oddsSection(odds) {
  const rows = [];
  if (odds.had) {
    rows.push(oddsRow('胜平负', [['主胜', odds.had.h], ['平', odds.had.d], ['客胜', odds.had.a]]));
  }
  (odds.hhad || []).forEach(x => {
    rows.push(oddsRow(`让球${x.goalLine}`, [['让胜', x.h], ['让平', x.d], ['让负', x.a]]));
  });
  if (odds.ttg) {
    const pairs = Object.entries(odds.ttg).map(([k, v]) => [k === '7' ? '7+' : k, v]);
    rows.push(oddsRow('总进球', pairs));
  }
  let html = rows.join('');
  // 半全场：一行平铺，按赔率升序（最热在前），自解释中文标签
  if (odds.hafu) {
    const pairs = Object.entries(odds.hafu)
      .map(([k, v]) => [HAFU_LABEL[k] || k, v])
      .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));
    html += oddsRow('半全场', pairs);
  }
  // 比分：6×6 热力矩阵
  if (odds.crs && odds.crs.length) {
    html += `<div class="odds-block"><div class="odds-block-title">比分 <span class="block-hint">暖=热门 · 冷=冷门</span></div>${crsMatrix(odds.crs)}</div>`;
  }
  return html;
}

/** 购买方案区（B类，AI 写）。 */
function planSection(plan) {
  if (!plan) return '';
  const bets = plan.bets.map(b => `
    <li class="bet">
      <span class="bet-market">${esc(b.market)}</span>
      <span class="bet-odds">@${esc(b.odds)}</span>
      <span class="bet-stake">投 ${esc(b.stake)}元</span>
      <span class="bet-potential">中回 ${esc(b.potential)}元</span>
    </li>`).join('');
  return `
    <div class="plan">
      <div class="plan-head">📝 娱乐方案 · 预算 ${esc(plan.budget)}元</div>
      <ul class="bet-list">${bets}</ul>
      ${plan.note ? `<p class="plan-note">${esc(plan.note)}</p>` : ''}
      <p class="plan-warn">⚠ 仅为娱乐示意，非投注建议。竞彩为负和游戏，长期期望为负。</p>
    </div>`;
}

/** 点评区（B类，AI 写）。 */
function commentarySection(c) {
  if (!c || (!c.summary && !c.value && !c.plan)) {
    return `<div class="comment comment--empty">暂无 AI 点评</div>`;
  }
  return `
    <div class="comment">
      ${c.summary ? `<p class="comment-summary">${esc(c.summary)}</p>` : ''}
      ${c.value ? `<p class="comment-value">💡 ${esc(c.value)}</p>` : ''}
      ${planSection(c.plan)}
    </div>`;
}

/** 详情面板完整内容（居中弹窗：对阵头横跨顶部，下方左右两栏）。 */
function renderDetail(m) {
  const t = parseMatchTime(m.datetime);
  const had = m.metrics && m.metrics.had;
  const mt = m.metrics || {};
  return `
    <button class="detail-close" id="detailClose" aria-label="关闭">✕</button>
    <div class="detail-head">
      <span class="detail-meta">${esc(m.matchNum)} · ${esc(m.group)} · ${esc(t.date)} ${esc(t.weekday)} ${esc(t.time)}</span>
      <div class="detail-teams">
        <div class="dteam">${logoImg(m.home)}<span>${esc(m.home.name)}</span></div>
        <span class="dvs">VS</span>
        <div class="dteam">${logoImg(m.away)}<span>${esc(m.away.name)}</span></div>
      </div>
    </div>

    <div class="detail-body">
      <div class="detail-col detail-col-main">
        <section class="detail-analysis">
          <h3 class="sec-title">价值分析 <span class="sec-note">客观 · 由赔率计算</span></h3>
          ${tagsHtml(m.tags)}
          ${had ? probBar(had.prob) : '<p class="na-hint">该场未开胜平负，无去水概率</p>'}
          <div class="ret-badges">
            ${had ? returnBadge(had.return, '胜平负') : ''}
            ${mt.ttg ? returnBadge(mt.ttg.return, '总进球') : ''}
            ${mt.hafu ? returnBadge(mt.hafu.return, '半全场') : ''}
            ${mt.crs ? returnBadge(mt.crs.return, '比分') : ''}
          </div>
        </section>

        <section class="detail-comment">
          <h3 class="sec-title">AI 点评 <span class="sec-note">主观 · 仅供参考</span></h3>
          ${commentarySection(m.commentary)}
        </section>
      </div>

      <div class="detail-col detail-col-odds">
        <section class="detail-odds">
          <h3 class="sec-title">完整赔率</h3>
          ${oddsSection(m.odds)}
        </section>
      </div>
    </div>`;
}
