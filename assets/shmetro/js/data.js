/**
 * data.js — 数据加载层
 *
 * 唯一数据源：data/shmetro.json（由 tools/build_metro_geo.py 生成几何、
 * tools/build_metro_time.py 填充时刻表）。页面不联网、不抓 API，只读这份
 * 静态 JSON。数据契约见 docs/shmetro.md。
 */
const METRO_DATA_URL = 'data/shmetro.json';
const METRO_SEARCH_URL = 'data/shmetro_search.json';

/** 加载地铁数据。失败抛错，由 app.js 兜错误态。 */
async function loadMetroData() {
  const resp = await fetch(METRO_DATA_URL, { cache: 'no-cache' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} — 找不到 ${METRO_DATA_URL}`);
  }
  return resp.json();
}

/** 加载搜索索引（站名/拼音/首字母/坐标）。失败返回空索引（搜索降级为不可用，不阻塞主图）。 */
async function loadSearchIndex() {
  try {
    const resp = await fetch(METRO_SEARCH_URL, { cache: 'no-cache' });
    if (!resp.ok) return { stations: [] };
    return await resp.json();
  } catch (e) {
    return { stations: [] };
  }
}
