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
    modalSummary: document.getElementById('modalSummary')
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
    // weekdayId: 0=周一, 6=周日
    // getDay(): 0=周日, 1=周一, ..., 6=周六
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

    return `
      <article class="anime-card" data-id="${item.id}">
        <div class="card-cover">
          <img src="${item.images.large || item.images.common}" 
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
  async function switchWeekday(newWeekday) {
    if (state.isAnimating) return;
    state.isAnimating = true;

    const currentCards = elements.cardsContainer.querySelectorAll('.anime-card');
    
    // 离开动画：卡片向上滑出
    currentCards.forEach((card, index) => {
      card.style.transition = `opacity 250ms ease-out, transform 250ms ease-out`;
      card.style.transitionDelay = `${index * CONFIG.CARD_STAGGER_DELAY}ms`;
      card.classList.add('leaving');
    });

    // 等待离开动画完成
    await new Promise(resolve => setTimeout(resolve, 280));

    // 更新状态
    state.currentWeekday = newWeekday;
    // 更新顶部日期显示
    elements.dateDisplay.textContent = formatDateForWeekday(newWeekday);
    renderWeekTabs();

    // 获取新数据并渲染
    const dayData = state.calendarData[newWeekday];
    const items = dayData ? dayData.items : [];

    if (items.length === 0) {
      elements.cardsContainer.innerHTML = '';
      showEmpty();
    } else {
      hideSkeleton();
      elements.emptyState.classList.remove('show');
      elements.errorState.classList.remove('show');
      elements.cardsContainer.innerHTML = items.map(renderAnimeCard).join('');

      // 进入动画：卡片从下方滑入
      const newCards = elements.cardsContainer.querySelectorAll('.anime-card');
      newCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
          card.style.transition = `opacity 300ms ease-out, transform 300ms ease-out`;
          card.style.transitionDelay = `${index * CONFIG.CARD_STAGGER_DELAY}ms`;
          card.classList.add('visible');
          card.style.opacity = '';
          card.style.transform = '';
        }, 20);
      });

      // 绑定卡片点击事件
      bindCardEvents();
    }

    state.isAnimating = false;
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

  // ============ 弹窗 ============
  function openModal(item) {
    const title = item.name_cn || item.name;
    
    elements.modalCover.src = item.images.large || item.images.common;
    elements.modalCover.alt = title;
    elements.modalTitle.textContent = title;
    elements.modalSubtitle.textContent = item.name;
    elements.modalAirDate.textContent = item.air_date || '未知';
    elements.modalDuration.textContent = item.duration || '未知';
    elements.modalEps.textContent = item.eps ? `${item.currentEp || 0} / ${item.eps}` : '未知';
    elements.modalLink.href = item.url || `https://bgm.tv/subject/${item.id}`;
    elements.modalSummary.textContent = item.summary || '暂无简介';

    elements.modalOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    elements.modalOverlay.classList.remove('show');
    document.body.style.overflow = '';
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
