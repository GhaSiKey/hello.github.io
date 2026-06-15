/**
 * calendar.js — 赛程总览日历（两版可切换）
 *
 * 读 data/worldcup.json 的 schedule.days（由 build_schedule.py 生成），
 * 渲染整届世界杯赛程总览。点击某天 → 平滑滚动到列表对应日期分组。
 *
 * 两版视觉形态，由 state.calView 切换：
 *   'strip'  方案A：横向日期条（占高小，移动端友好）
 *   'grid'   方案B：月历网格（直观像日历）
 *
 * 纯展示，不联网、不计算。哪些天有赔率列表由 availableDates 决定。
 */

/** 阶段 -> 配色 class（淘汰赛按阶段；小组赛改按轮次另算）。 */
const PHASE_CLASS = {
  '小组赛': 'ph-1', '32强': 'ph-2', '16强': 'ph-3',
  '8强': 'ph-4', '4强': 'ph-5', '季军赛': 'ph-6', '决赛': 'ph-7',
};

/** 阶段 -> 短标（日历格子里显示）。 */
const PHASE_SHORT = {
  '小组赛': '组', '32强': '32', '16强': '16',
  '8强': '8', '4强': '4', '季军赛': '季', '决赛': '决',
};

/** 小组赛轮次 -> 配色 class（R1/R2/R3 三色）。 */
const ROUND_CLASS = { 1: 'gr-1', 2: 'gr-2', 3: 'gr-3' };

/** 浏览器本地"今天"的 YYYY-MM-DD（前端实时算，不依赖冻结数据）。
 *  无论哪天打开页面，都高亮当天那一格；今天不在赛程内则不高亮。 */
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 取某天的配色 class：小组赛按轮次(gr-1~3)，淘汰赛按阶段(ph-2~7)。
 */
function dayColorClass(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) {
    return ROUND_CLASS[d.groupRound] || 'ph-1';
  }
  return PHASE_CLASS[d.mainPhase] || '';
}

/**
 * 取某天的短标：小组赛显示"R1/R2/R3"，淘汰赛显示阶段短标。
 */
function dayShortLabel(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) {
    return 'R' + d.groupRound;
  }
  return PHASE_SHORT[d.mainPhase] || '';
}

/**
 * 取某天的完整阶段名（tooltip 用）：小组赛带轮次。
 */
function dayPhaseName(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) {
    return `小组赛第${d.groupRound}轮`;
  }
  return d.mainPhase;
}

/**
 * 构建 {date: {label, colorClass}} 映射，供列表分组头展示阶段标签。
 */
function buildDayMeta(schedule) {
  const meta = {};
  if (!schedule || !schedule.days) return meta;
  for (const d of schedule.days) {
    meta[d.date] = { label: dayPhaseName(d), colorClass: dayColorClass(d) };
  }
  return meta;
}

/**
 * 渲染方案A：横向日期条。
 * @param days schedule.days
 * @param available Set<YYYY-MM-DD> 有赔率列表的日期
 */
function renderCalStrip(days, available) {
  const today = todayStr();
  const cells = days.map(d => {
    const has = available.has(d.date);
    const isToday = d.date === today;
    return `
      <button class="cal-cell ${dayColorClass(d)} ${has ? '' : 'cal-cell--nolist'} ${isToday ? 'cal-today' : ''}"
              data-date="${d.date}" title="${d.md} ${d.weekday} · ${d.total}场 · ${dayPhaseName(d)}${isToday ? ' · 今天' : ''}${has ? '' : '（赔率未开放）'}">
        ${isToday ? '<span class="cal-today-tag">今天</span>' : ''}
        <span class="cal-md">${d.md}</span>
        <span class="cal-wd">${d.weekday}</span>
        <span class="cal-ph">${dayShortLabel(d)}</span>
        <span class="cal-cnt">${d.total}场</span>
      </button>`;
  }).join('');
  return `<div class="cal-strip" id="calStrip">${cells}</div>`;
}

/**
 * 渲染方案B：月历网格。按自然月分块，周一为每周首列。
 */
function renderCalGrid(days, available) {
  const today = todayStr();
  // 建 date -> day 映射，方便按日历格查
  const map = new Map(days.map(d => [d.date, d]));
  // 起止日期
  const first = new Date(days[0].date + 'T00:00:00');
  const last = new Date(days[days.length - 1].date + 'T00:00:00');
  // 按月分组渲染
  let html = '<div class="cal-grid-wrap" id="calGrid">';
  const cur = new Date(first.getFullYear(), first.getMonth(), 1);
  const end = new Date(last.getFullYear(), last.getMonth(), 1);
  while (cur <= end) {
    const y = cur.getFullYear(), mo = cur.getMonth();
    html += `<div class="cal-month"><div class="cal-month-title">${y}年${mo + 1}月</div>`;
    html += '<div class="cal-week-head">' +
      ['一', '二', '三', '四', '五', '六', '日'].map(w => `<span>${w}</span>`).join('') + '</div>';
    html += '<div class="cal-days">';
    // 当月1号是周几（周一=0）
    const firstDow = (new Date(y, mo, 1).getDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) html += '<span class="cal-day cal-day--empty"></span>';
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const key = `${y}-${String(mo + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const d = map.get(key);
      if (!d) {
        html += `<span class="cal-day cal-day--off">${dd}</span>`;
        continue;
      }
      const has = available.has(key);
      const isToday = key === today;
      html += `
        <button class="cal-day ${dayColorClass(d)} ${has ? '' : 'cal-day--nolist'} ${isToday ? 'cal-today' : ''}"
                data-date="${key}" title="${d.md} ${d.weekday} · ${d.total}场 · ${dayPhaseName(d)}${isToday ? ' · 今天' : ''}${has ? '' : '（赔率未开放）'}">
          <span class="cal-day-num">${dd}</span>
          <span class="cal-day-cnt">${d.total}场</span>
          <span class="cal-day-ph">${dayShortLabel(d)}</span>
        </button>`;
    }
    html += '</div></div>';
    cur.setMonth(cur.getMonth() + 1);
  }
  return html + '</div>';
}

/** 阶段图例：小组赛按3轮分色 + 淘汰赛各阶段。 */
function renderCalLegend() {
  const items = [
    ['gr-1', '小组赛R1'], ['gr-2', '小组赛R2'], ['gr-3', '小组赛R3'],
    ['ph-2', '32强'], ['ph-3', '16强'], ['ph-4', '8强'],
    ['ph-5', '4强'], ['ph-6', '季军'], ['ph-7', '决赛'],
  ];
  return '<div class="cal-legend">' +
    items.map(([c, label]) => `<span class="cal-leg ${c}">${label}</span>`).join('') +
    '</div>';
}

/**
 * 渲染整个赛程总览区（含两版切换 + 当前视图）。
 * @param schedule data.schedule
 * @param matches  data.matches（用于算哪些日期有赔率列表）
 * @param view     'strip' | 'grid'
 */
function renderCalendar(schedule, matches, view) {
  if (!schedule || !schedule.days || !schedule.days.length) return '';
  const available = new Set(matches.map(m => (m.datetime || '').slice(0, 10)));
  const body = view === 'grid'
    ? renderCalGrid(schedule.days, available)
    : renderCalStrip(schedule.days, available);
  return `
    <div class="cal-head">
      <span class="cal-title">📅 赛程总览
        <span class="cal-sub">${schedule.totalMatches}场 · ${schedule.days[0].md}–${schedule.days[schedule.days.length - 1].md}</span>
      </span>
      <div class="cal-view-toggle" id="calViewToggle">
        <button class="cal-vt ${view === 'strip' ? 'active' : ''}" data-calview="strip">日期条</button>
        <button class="cal-vt ${view === 'grid' ? 'active' : ''}" data-calview="grid">月历</button>
      </div>
    </div>
    ${renderCalLegend()}
    ${body}`;
}

/**
 * 滚动到列表中某日期分组。无对应分组（赔率未开）则提示。
 * @param date YYYY-MM-DD
 */
function scrollToDay(date) {
  const target = document.getElementById('day-' + date);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 高亮闪烁，给视觉反馈
    target.classList.add('day-flash');
    setTimeout(() => target.classList.remove('day-flash'), 1500);
    return true;
  }
  return false;  // 该日无赔率列表
}
