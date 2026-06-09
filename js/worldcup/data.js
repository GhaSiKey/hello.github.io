/**
 * data.js — 数据加载层
 *
 * 唯一数据源：data/worldcup.json（由 tools/build_wc_data.py 生成）。
 * 页面不联网、不计算，只读这份静态 JSON。
 */
const WC_DATA_URL = 'data/worldcup.json';

/** 加载赔率数据。失败抛错，由 app.js 兜错误态。 */
async function loadWorldCupData() {
  const resp = await fetch(WC_DATA_URL, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} — 找不到 ${WC_DATA_URL}`);
  }
  return resp.json();
}

/** ISO 时间串 -> "06-08 10:02"（仅展示，不做时区换算）。 */
function fmtStamp(iso) {
  if (!iso) return '—';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

/** "2026-06-12 10:00" -> { date:"6/12", weekday:"周四", time:"10:00" } */
function parseMatchTime(dt) {
  const m = (dt || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return { date: dt || '', weekday: '', time: '' };
  const [, , mo, da, hh, mm] = m;
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = new Date(+m[1], +mo - 1, +da);
  return {
    date: `${+mo}/${+da}`,
    weekday: wd[d.getDay()],
    time: `${hh}:${mm}`,
  };
}

/** 返还率 -> 等级（用于徽章配色）。 */
function returnLevel(r) {
  if (r == null) return 'na';
  if (r >= 0.85) return 'high';
  if (r >= 0.78) return 'mid';
  return 'low';
}
