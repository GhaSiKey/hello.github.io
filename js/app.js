/**
 * OtakuMap - 番剧日历主逻辑
 */

(function() {
  'use strict';

  // ============ 配置 ============
  const CONFIG = {
    API_BASE: 'https://api.bgm.tv',
    CACHE_KEY: 'otakumap_calendar',
    CACHE_EXPIRY: 30 * 60 * 1000, // 30分钟
    ANIMATION_DURATION: 300,
    CARD_STAGGER_DELAY: 40
  };

  // ============ 状态 ============
  const state = {
    calendarData: [],
    currentWeekday: new Date().getDay(),
    isLoading: true,
    error: null,
    isAnimating: false
  };

  // 转换星期天(0)到星期天(7)
  function getWeekdayId(day) {
    return day === 0 ? 6 : day - 1;
  }

  // ============ DOM 元素 ============
  const elements = {
    dateDisplay: document.getElementById('dateDisplay'),
    weekTabs: document.getElementById('weekTabs'),
    cardsContainer: document.getElementById('cardsContainer'),
    skeletonGrid: document.getElementById('skeletonGrid'),
    emptyState: document.getElementById('emptyState'),
    errorState: document.getElementById('errorState'),
    retryBtn: document.getElementById('retryBtn'),
    modalOverlay: document.getElementById('modalOverlay'),
    modal: document.getElementById('modal'),
    modalClose: document.getElementById('modalClose'),
    modalCover: document.getElementById('modalCover'),
    modalTitle: document.getElementById('modalTitle'),
    modalSubtitle: document.getElementById('modalSubtitle'),
    modalAirDate: document.getElementById('modalAirDate').querySelector('.meta-text'),
    modalDuration: document.getElementById('modalDuration').querySelector('.meta-text'),
    modalEps: document.getElementById('modalEps').querySelector('.meta-text'),
    modalLink: document.getElementById('modalLink'),
    modalSummary: document.getElementById('modalSummary'),
    // 增强区域
    modalEnhance: document.getElementById('modalEnhance'),
    enhanceScore: document.getElementById('enhanceScore'),
    enhanceRank: document.getElementById('enhanceRank'),
    heatDoing: document.getElementById('heatDoing'),
    heatCollect: document.getElementById('heatCollect'),
    heatWish: document.getElementById('heatWish'),
    ratingChart: document.getElementById('ratingChart'),
    modalTags: document.getElementById('modalTags'),
    modalStaff: document.getElementById('modalStaff'),
    modalCast: document.getElementById('modalCast'),
    enhanceSkeleton: document.getElementById('enhanceSkeleton')
  };

  // ============ 工具函数 ============
  function formatDate(date, showWeekday = true) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[date.getDay()];
    if (showWeekday) {
      return `${year}年${month}月${day}日 ${weekday}`;
    }
    return `${year}年${month}月${day}日`;
  }

  // 根据星期获取显示日期（保持月份和日期，只更新星期）
  function formatDateForWeekday(weekdayId) {
    const today = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const todayWeekday = today.getDay();
    let diff = weekdayId + 1 - todayWeekday;
    if (todayWeekday === 0) diff = weekdayId - 6;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + diff);
    return `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日 ${weekdays[targetDate.getDay()]}`;
  }

  function getCache() {
    try {
      const cached = localStorage.getItem(CONFIG.CACHE_KEY);
      if (!cached) return null;
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp > CONFIG.CACHE_EXPIRY) {
        localStorage.removeItem(CONFIG.CACHE_KEY);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function setCache(data) {
    try {
      localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    } catch {}
  }

  // 格式化数字（1000 -> 1k, 1000000 -> 1M）
  function formatCount(n) {
    if (!n && n !== 0) return '--';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function showSkeleton() {
    elements.skeletonGrid.classList.remove('hidden');
    elements.cardsContainer.innerHTML = '';
    elements.emptyState.classList.remove('show');
    elements.errorState.classList.remove('show');
  }

  function hideSkeleton() {
    elements.skeletonGrid.classList.add('hidden');
  }

  function showError() {
    hideSkeleton();
    elements.cardsContainer.innerHTML = '';
    elements.emptyState.classList.remove('show');
    elements.errorState.classList.add('show');
  }

  function showEmpty() {
    hideSkeleton();
    elements.cardsContainer.innerHTML = '';
    elements.errorState.classList.remove('show');
    elements.emptyState.classList.add('show');
  }

  // ============ API 请求 ============
  async function fetchCalendar() {
    const cached = getCache();
    if (cached) {
      state.calendarData = cached;
      return;
    }

    const response = await fetch(`${CONFIG.API_BASE}/calendar`, {
      headers: {
        'User-Agent': 'OtakuMap/1.0 (https://github.com/otakumap)'
      }
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    const data = await response.json();
    state.calendarData = data;
    setCache(data);
  }

  // 获取条目详情（/v0/subjects/{id}）
  async function fetchSubjectDetail(id) {
    const response = await fetch(`${CONFIG.API_BASE}/v0/subjects/${id}`, {
      headers: {
        'User-Agent': 'OtakuMap/1.0 (https://github.com/otakumap)'
      }
    });
    if (!response.ok) throw new Error(`Subject API Error: ${response.status}`);
    return response.json();
  }

  // 获取角色/声优（/v0/subjects/{id}/characters）
  async function fetchSubjectCharacters(id) {
    const response = await fetch(`${CONFIG.API_BASE}/v0/subjects/${id}/characters`, {
      headers: {
        'User-Agent': 'OtakuMap/1.0 (https://github.com/otakumap)'
      }
    });
    if (!response.ok) throw new Error(`Characters API Error: ${response.status}`);
    return response.json();
  }

  // 获取STAFF信息（/v0/subjects/{id}/persons）
  async function fetchSubjectPersons(id) {
    const response = await fetch(`${CONFIG.API_BASE}/v0/subjects/${id}/persons`, {
      headers: {
        'User-Agent': 'OtakuMap/1.0 (https://github.com/otakumap)'
      }
    });
    if (!response.ok) throw new Error(`Persons API Error: ${response.status}`);
    return response.json();
  }

  // ============ 渲染星期标签 ============
  function renderWeekTabs() {
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

    elements.weekTabs.innerHTML = weekdays.map((day, index) => `
      <button class="tab-btn${index === state.currentWeekday ? ' active' : ''}" data-weekday="${index}">
        ${day}
      </button>
    `).join('');

    // 绑定点击事件
    elements.weekTabs.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const weekday = parseInt(btn.dataset.weekday);
        if (weekday !== state.currentWeekday && !state.isAnimating) {
          switchWeekday(weekday);
        }
      });
    });
  }

  // ============ 渲染番剧卡片 ============
  function renderAnimeCard(item) {
    const statusClass = item.eps && item.currentEp ? 'airing' :
                        item.eps ? 'finished' : 'unknown';
    const statusText = item.eps && item.currentEp ? `第${item.currentEp}话` :
                       item.eps ? '已完结' : '未知';

    const title = item.name_cn || item.name;
    const airTime = item.air_date ? item.air_date.split('-')[1] + '-' + item.air_date.split('-')[2] : '--';

    // 安全获取图片（images 可能为 null）
    const coverImg = (item.images && item.images.large) || (item.images && item.images.common) || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 3 4%22><rect fill=%22%231a1a2e%22 width=%223%22 height=%224%22/><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23606070%22 font-size=%2210%22>?</text></svg>';

    return `
      <article class="anime-card" data-id="${item.id}">
        <div class="card-cover">
          <img src="${coverImg}"
               alt="${title}"
               loading="lazy"
               onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 3 4%22><rect fill=%22%231a1a2e%22 width=%223%22 height=%224%22/><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23606070%22 font-size=%2210%22>?</text></svg>'">
          <span class="card-status ${statusClass}">${statusText}</span>
        </div>
        <div class="card-info">
          <h3 class="card-title">${title}</h3>
          <div class="card-meta">
            <span>${airTime}</span>
            <span class="dot"></span>
            <span>${item.name}</span>
          </div>
        </div>
      </article>
    `;
  }

  // ============ 切换星期动画 ============
  function switchWeekday(newWeekday) {
    if (state.isAnimating) return;
    state.isAnimating = true;

    try {
      state.currentWeekday = newWeekday;
      elements.dateDisplay.textContent = formatDateForWeekday(newWeekday);
      renderWeekTabs();

      const dayData = state.calendarData[newWeekday];
      const items = dayData ? dayData.items : [];

      if (items.length === 0) {
        elements.cardsContainer.innerHTML = '';
        showEmpty();
        return;
      }

      hideSkeleton();
      elements.emptyState.classList.remove('show');
      elements.errorState.classList.remove('show');

      elements.cardsContainer.innerHTML = items.map(renderAnimeCard).join('');
      bindCardEvents();

      // 入场动画
      const cards = elements.cardsContainer.querySelectorAll('.anime-card');
      cards.forEach((card, index) => {
        setTimeout(() => {
          card.classList.add('visible');
        }, index * CONFIG.CARD_STAGGER_DELAY);
      });
    } catch (error) {
      console.error('[DEBUG] switchWeekday error:', error);
      showError();
    } finally {
      state.isAnimating = false;
    }
  }

  // ============ 绑定卡片事件 ============
  function bindCardEvents() {
    elements.cardsContainer.querySelectorAll('.anime-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.dataset.id);
        const dayData = state.calendarData[state.currentWeekday];
        const item = dayData.items.find(i => i.id === id);
        if (item) {
          openModal(item);
        }
      });
    });
  }

  // ============ 增强区域渲染 ============

  // 显示加载骨架
  function showEnhanceLoading() {
    elements.enhanceSkeleton.style.display = 'flex';
    elements.enhanceScore.textContent = '--';
    elements.enhanceRank.textContent = '';
    elements.heatDoing.textContent = '';
    elements.heatCollect.textContent = '';
    elements.heatWish.textContent = '';
    elements.ratingChart.innerHTML = '';
    elements.modalTags.innerHTML = '';
    elements.modalStaff.innerHTML = '';
    elements.modalCast.innerHTML = '';
  }

  // 渲染评分柱状图
  function renderRatingChart(count) {
    if (!count) return;
    const total = Object.values(count).reduce((s, n) => s + n, 0);
    if (!total) return;

    // 10分位从高到低展示
    const bars = [];
    for (let i = 10; i >= 1; i--) {
      const n = count[i] || 0;
      const pct = (n / total) * 100;
      bars.push(`
        <div class="rating-bar-wrap">
          <div class="rating-bar" style="height: ${Math.max(pct, 2)}%"></div>
          <span class="rating-bar-label">${i}</span>
        </div>
      `);
    }
    elements.ratingChart.innerHTML = bars.join('');
  }

  // 渲染标签云
  function renderTags(tags) {
    if (!tags || !tags.length) return;
    const topTags = tags.slice(0, 6);
    elements.modalTags.innerHTML = `
      <div class="section-title" style="margin-bottom:8px">标签</div>
      ${topTags.map(t => `<span class="tag-item">${t.name}</span>`).join('')}
    `;
  }

  // 渲染制作信息（从 infobox 提取关键字段）
  function renderStaff(infobox) {
    if (!infobox || !infobox.length) return;
    // 提取关键信息
    const keyMap = {
      '导演': '导演',
      '音乐': '音乐',
      '制作公司': '制作',
      '动画制作': '动画',
      '脚本': '脚本',
      '分镜': '分镜',
      '演出': '演出',
      '人物设定': '人设'
    };
    const staff = [];
    for (const item of infobox) {
      const key = item.key;
      if (keyMap[key]) {
        const val = typeof item.value === 'string' ? item.value :
                     Array.isArray(item.value) ? item.value.map(v => v.v || v).join(' / ') : '';
        if (val) staff.push({ role: keyMap[key], val });
      }
    }
    if (!staff.length) return;
    elements.modalStaff.innerHTML = `
      <div class="section-title" style="margin-bottom:8px">制作</div>
      <div class="staff-grid">
        ${staff.map(s => `<span class="staff-item"><strong>${s.role}</strong>：${s.val}</span>`).join('')}
      </div>
    `;
  }

  // 渲染 Cast 阵容
  function renderCast(characters) {
    if (!characters || !characters.length) return;
    // 取前 6 个角色
    const top = characters.slice(0, 6);
    const castItems = top.map(c => {
      const actorName = (c.actors && c.actors[0] && c.actors[0].name) || '未知';
      const avatar = (c.actors && c.actors[0] && c.actors[0].images && c.actors[0].images.grid) || '';
      const actorAvatar = avatar ? `<img class="cast-avatar" src="${avatar}" alt="${actorName}" onerror="this.style.display='none'">` : '';
      return `
        <div class="cast-item">
          ${actorAvatar}
          <div class="cast-info">
            <div class="cast-name">${c.name}</div>
            <div class="cast-actor">${actorName}</div>
          </div>
        </div>
      `;
    }).join('');
    elements.modalCast.innerHTML = `
      <div class="section-title" style="margin-bottom:8px">角色 · 声优</div>
      <div class="cast-grid">${castItems}</div>
    `;
  }

  // 填充增强数据
  function fillEnhanceData(detail, characters, persons) {
    // 隐藏骨架
    elements.enhanceSkeleton.style.display = 'none';

    // 评分
    if (detail.rating) {
      elements.enhanceScore.textContent = detail.rating.score ? detail.rating.score.toFixed(1) : '--';
      if (detail.rating.rank) {
        elements.enhanceRank.textContent = `第 ${detail.rating.rank} 位`;
      }
      // 热度
      if (detail.collection) {
        elements.heatDoing.className = 'heat-item doing';
        elements.heatDoing.textContent = `在看 ${formatCount(detail.collection.doing)}`;
        elements.heatCollect.className = 'heat-item collect';
        elements.heatCollect.textContent = `看过 ${formatCount(detail.collection.collect)}`;
        elements.heatWish.className = 'heat-item wish';
        elements.heatWish.textContent = `想看 ${formatCount(detail.collection.wish)}`;
      }
      // 柱状图
      renderRatingChart(detail.rating.count);
    }

    // 标签
    if (detail.tags && detail.tags.length) {
      renderTags(detail.tags);
    }

    // 制作信息
    if (detail.infobox && detail.infobox.length) {
      renderStaff(detail.infobox);
    }

    // Cast
    if (characters && characters.length) {
      renderCast(characters);
    }
  }

  // ============ 弹窗 ============
  function openModal(item) {
    const title = item.name_cn || item.name;

    // 基础信息秒开
    elements.modalCover.src = (item.images && item.images.large) || (item.images && item.images.common) || '';
    elements.modalCover.alt = title;
    elements.modalTitle.textContent = title;
    elements.modalSubtitle.textContent = item.name;
    elements.modalAirDate.textContent = item.air_date || '未知';
    elements.modalDuration.textContent = item.duration || '未知';
    elements.modalEps.textContent = item.eps ? `${item.currentEp || 0} / ${item.eps}` : '未知';
    elements.modalLink.href = item.url || `https://bgm.tv/subject/${item.id}`;
    elements.modalSummary.textContent = item.summary || '暂无简介';

    // 显示弹窗
    elements.modalOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    // 重置增强区域 + 显示骨架
    showEnhanceLoading();

    // 异步获取增强数据
    const id = item.id;
    Promise.all([
      fetchSubjectDetail(id).catch(() => null),
      fetchSubjectCharacters(id).catch(() => []),
      fetchSubjectPersons(id).catch(() => [])
    ]).then(([detail, characters, persons]) => {
      if (detail) {
        fillEnhanceData(detail, characters, persons);
      } else {
        // API 失败，隐藏骨架但不显示增强内容
        elements.enhanceSkeleton.style.display = 'none';
      }
    });
  }

  function closeModal() {
    elements.modalOverlay.classList.remove('show');
    document.body.style.overflow = '';
    // 重置增强区域
    showEnhanceLoading();
  }

  // ============ 初始化 ============
  async function init() {
    // 显示日期
    elements.dateDisplay.textContent = formatDate(new Date());

    // 显示骨架屏
    showSkeleton();

    // 渲染星期标签
    renderWeekTabs();

    // 绑定弹窗事件
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalOverlay.addEventListener('click', (e) => {
      if (e.target === elements.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // 绑定重试按钮
    elements.retryBtn.addEventListener('click', init);

    // 加载数据
    try {
      await fetchCalendar();
      state.isLoading = false;
      hideSkeleton();

      // 默认显示今天
      const todayId = getWeekdayId(new Date().getDay());
      state.currentWeekday = todayId;
      elements.dateDisplay.textContent = formatDateForWeekday(todayId);
      renderWeekTabs();
      const dayData = state.calendarData[todayId];
      const items = dayData ? dayData.items : [];

      if (items.length === 0) {
        showEmpty();
      } else {
        elements.cardsContainer.innerHTML = items.map(renderAnimeCard).join('');

        // 入场动画
        const cards = elements.cardsContainer.querySelectorAll('.anime-card');
        cards.forEach((card, index) => {
          setTimeout(() => {
            card.classList.add('visible');
          }, index * CONFIG.CARD_STAGGER_DELAY);
        });

        bindCardEvents();
      }
    } catch (error) {
      console.error('Failed to load calendar:', error);
      state.error = error.message;
      state.isLoading = false;
      showError();
    }
  }

  // 启动
  init();
})();
