/**
 * app.js — 一周年纪念贺卡交互（暖粉桃色 · 漂浮照片墙版）
 *
 * 四段：① 口令门帘 → ② 顶部标题 → ③ 一屏漂浮照片墙(自动轮转) → ④ 底部的话。
 * 照片墙：屏上常驻若干张缓慢浮动的拍立得，定时把最老的淡出、补入下一张，
 * 不滚动也能循环看完 20 张；点任意一张放大查看。
 * 纯静态零依赖，照片方向运行时由 naturalWidth/Height 判断，不硬编码。
 */
(function () {
  'use strict';

  const CONFIG = {
    startDate: '2025-06-30',   // 正确月日由此推导，不另写口令，避免两处不一致
    photoCount: 20,
    photoDir: 'assets/anniversary/',
    letter: '我想看的世界，在你眼里。你需要的话，我随时有空。',
    rotateMs: 2600,        // 每隔多久换一张
  };

  const $ = s => document.querySelector(s);
  const els = {
    gate: $('#gate'), gateForm: $('#gateForm'), gateHint: $('#gateHint'),
    gateMonth: $('#gateMonth'), gateDay: $('#gateDay'),
    stage: $('#stage'), dayCount: $('#dayCount'),
    wall: $('#wall'), letterText: $('#letterText'), petals: $('#petals'),
    viewer: $('#viewer'), viewerImg: $('#viewerImg'), viewerClose: $('#viewerClose'),
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 在一起第 N 天（实时）── */
  function daysTogether() {
    const start = new Date(CONFIG.startDate + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = Math.floor((today - start) / 86400000) + 1;
    return d > 0 ? d : 1;
  }

  /* ── 飘落花瓣 ── */
  function buildPetals() {
    if (reduceMotion) return;
    const chars = ['🌸', '🌷', '✿', '❀', '♡'];
    let html = '';
    for (let i = 0; i < 14; i++) {
      const left = Math.random() * 100;
      const dur = 8 + Math.random() * 8;
      const delay = Math.random() * 8;
      const size = 0.9 + Math.random() * 1.1;
      const c = chars[i % chars.length];
      html += `<span class="petal" style="left:${left}vw;animation-duration:${dur}s;animation-delay:${delay}s;font-size:${size}rem">${c}</span>`;
    }
    els.petals.innerHTML = html;
  }

  /* ── 漂浮照片墙 ── */
  const Wall = (function () {
    let order = [];          // 照片出场顺序队列(打乱)
    let cursor = 0;          // 下一张要放的索引
    let liveSlots = [];      // 当前屏上的拍立得 {el,x,y}，顺序即新旧(队首最老)
    let maxOnScreen = 6;
    let zTop = 0;            // 递增层级，保证新照片压在旧照片之上

    function shuffle(n) {
      const a = Array.from({ length: n }, (_, i) => i + 1);
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function computeMax() {
      const w = els.wall.clientWidth, h = els.wall.clientHeight;
      // 按面积估算同屏张数：分母越小越密。夹在 8~12 之间，
      // 让手机也能到 10+ 张，与桌面一致。
      const area = w * h;
      return Math.max(8, Math.min(12, Math.round(area / 22000)));
    }

    // 照片宽度区间(占墙宽%)：窄屏(手机)放大，宽屏(桌面)缩小。
    // 手机张数已与桌面看齐(10~12)，尺寸相应收一点避免糊成一团。
    function sizeRange() {
      const w = els.wall.clientWidth;
      if (w < 520) return [30, 40];   // 手机竖屏
      if (w < 900) return [26, 34];   // 平板
      return [20, 28];                // 桌面宽屏
    }

    // 随机撒点铺满整墙：网格抖动选位，允许适度重叠(要的就是散落叠压感)，
    // 但通过"远离已有照片"的打分避免完全同位造成的透叠。
    function pickPos() {
      const cols = 4, rows = 3;
      let best = null, bestDist = -1;
      for (let t = 0; t < 10; t++) {
        const gx = Math.floor(Math.random() * cols), gy = Math.floor(Math.random() * rows);
        const x = (gx + 0.5) / cols * 100 + (Math.random() * 16 - 8);
        const y = (gy + 0.5) / rows * 100 + (Math.random() * 16 - 8);
        let minD = Infinity;
        for (const s of liveSlots) {
          const d = (s.x - x) ** 2 + (s.y - y) ** 2;
          if (d < minD) minD = d;
        }
        if (minD > bestDist) { bestDist = minD; best = { x, y }; }
      }
      return {
        x: Math.max(14, Math.min(86, best.x)),
        y: Math.max(16, Math.min(84, best.y)),
      };
    }

    function addOne() {
      const idx = order[cursor % order.length];
      cursor++;
      const n = String(idx).padStart(2, '0');
      const src = `${CONFIG.photoDir}${n}.jpg`;
      const pos = pickPos();
      const tilt = (Math.random() * 10 - 5).toFixed(1);
      const [wMin, wMax] = sizeRange();
      const w = wMin + Math.random() * (wMax - wMin);   // 占墙宽%，按屏宽自适应
      const floatDur = (6 + Math.random() * 4).toFixed(1);
      const z = ++zTop;

      // 预加载拿到真实尺寸 → 方向 class 在插入时就定死，避免 aspect-ratio
      // 后置生效导致高度突变、照片向上跳。
      const pre = new Image();
      const mount = (orientation) => {
        const fig = document.createElement('figure');
        fig.className = 'pw ' + orientation;
        fig.style.cssText =
          `--x:${pos.x}%;--y:${pos.y}%;--tilt:${tilt}deg;--w:${w}%;--float:${floatDur}s`;
        fig.style.zIndex = String(z);
        fig.dataset.x = pos.x; fig.dataset.y = pos.y;
        fig.innerHTML = `<div class="pw-card"><div class="pw-img"><img src="${src}" alt="我们的瞬间 ${idx}" draggable="false"></div></div>`;
        els.wall.appendChild(fig);
        const slot = { el: fig, x: pos.x, y: pos.y };
        liveSlots.push(slot);
        // 拖动移动 + 轻点放大(靠移动距离区分)
        makeDraggable(fig, slot, () => openViewer(src, '我们的瞬间 ' + idx));
      };
      pre.addEventListener('load', () =>
        mount(pre.naturalWidth >= pre.naturalHeight ? 'pw--landscape' : 'pw--portrait'));
      pre.addEventListener('error', () => mount('pw--landscape'));
      pre.src = src;
    }

    // 让一张拍立得可拖动；移动距离很小则视为「点击」触发放大。
    // 拖动中提到最高层、暂停浮动动画(否则与 translateY 浮动打架)；
    // 松手后带惯性继续滑行并摩擦衰减，碰墙边夹停。照片仍照常参与轮转。
    function makeDraggable(fig, slot, onTap) {
      const TAP = 6;            // 像素阈值：移动小于此视作点击
      const FRICTION = 0.85;    // 每帧速度衰减(越小越快停)
      const MIN_V = 0.05;       // 速度低于此(%/帧)即停止惯性
      let startX, startY, baseX, baseY, wRect, moved, dragging;
      let lastX, lastY, lastT, vx = 0, vy = 0, raf = 0;

      const clampX = v => Math.max(6, Math.min(94, v));
      const clampY = v => Math.max(6, Math.min(94, v));

      fig.addEventListener('pointerdown', e => {
        e.preventDefault();                          // 阻止原生图片拖拽(web 上会抢事件)
        if (raf) { cancelAnimationFrame(raf); raf = 0; }  // 打断上一次惯性
        dragging = true; moved = false; vx = vy = 0;
        startX = e.clientX; startY = e.clientY;
        baseX = slot.x; baseY = slot.y;
        lastX = slot.x; lastY = slot.y; lastT = performance.now();
        wRect = els.wall.getBoundingClientRect();
        fig.style.zIndex = String(++zTop);
        fig.classList.add('pw--dragging');
        fig.setPointerCapture(e.pointerId);
      });

      fig.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > TAP || Math.abs(dy) > TAP) moved = true;
        const nx = clampX(baseX + dx / wRect.width * 100);
        const ny = clampY(baseY + dy / wRect.height * 100);
        // 记录瞬时速度(%/帧，按 16ms 归一)，供松手后惯性使用
        const now = performance.now(), dt = Math.max(1, now - lastT);
        vx = (nx - lastX) / dt * 16;
        vy = (ny - lastY) / dt * 16;
        lastX = nx; lastY = ny; lastT = now;
        fig.style.setProperty('--x', nx + '%');
        fig.style.setProperty('--y', ny + '%');
        slot.x = nx; slot.y = ny;
      });

      // 惯性滑行：按松手速度继续移动并摩擦衰减，碰边夹停该轴
      function glide() {
        if (!fig.isConnected) { raf = 0; return; }   // 已被轮转移除则停止
        vx *= FRICTION; vy *= FRICTION;
        let nx = slot.x + vx, ny = slot.y + vy;
        if (nx < 6 || nx > 94) { nx = clampX(nx); vx = 0; }
        if (ny < 6 || ny > 94) { ny = clampY(ny); vy = 0; }
        slot.x = nx; slot.y = ny;
        fig.style.setProperty('--x', nx + '%');
        fig.style.setProperty('--y', ny + '%');
        if (Math.abs(vx) > MIN_V || Math.abs(vy) > MIN_V) {
          raf = requestAnimationFrame(glide);
        } else { raf = 0; }
      }

      const end = e => {
        if (!dragging) return;
        dragging = false;
        fig.classList.remove('pw--dragging');
        try { fig.releasePointerCapture(e.pointerId); } catch (_) {}
        if (!moved) { onTap(); return; }             // 几乎没动 → 点击放大
        if (Math.abs(vx) > MIN_V || Math.abs(vy) > MIN_V) raf = requestAnimationFrame(glide);
      };
      fig.addEventListener('pointerup', end);
      fig.addEventListener('pointercancel', end);
    }

    function removeEl(slot) {
      slot.el.classList.add('out');
      slot.el.addEventListener('animationend', () => slot.el.remove(), { once: true });
      setTimeout(() => slot.el.remove(), 1400);  // 兜底
    }

    // 轮转一次：补入一张新的，若超出同屏上限则淡出最老的一张
    let timer = null;
    function tick() {
      addOne();
      while (liveSlots.length > maxOnScreen) {
        const slot = liveSlots.shift();
        removeEl(slot);
      }
    }

    function start() {
      order = shuffle(CONFIG.photoCount);
      maxOnScreen = computeMax();
      // 初始铺满
      for (let i = 0; i < maxOnScreen; i++) setTimeout(addOne, i * 180);
      // 之后定时轮转
      timer = setInterval(tick, CONFIG.rotateMs);
      window.addEventListener('resize', onResize);
    }
    let rzTimer;
    function onResize() {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => { maxOnScreen = computeMax(); }, 250);
    }
    return { start };
  })();

  /* ── 放大查看 ── */
  function openViewer(src, alt) {
    els.viewerImg.src = src; els.viewerImg.alt = alt || '';
    els.viewer.hidden = false;
    requestAnimationFrame(() => els.viewer.classList.add('show'));
  }
  function closeViewer() {
    els.viewer.classList.remove('show');
    setTimeout(() => { els.viewer.hidden = true; els.viewerImg.src = ''; }, 300);
  }

  /* ── 结尾的话逐字显影 ──
   * 按句末标点(。！？)切成「行」，每行 block 独占一行；
   * 行内按需自然断行，但句子之间一定换行 → 文案天然分两行。 */
  function buildLetter() {
    const lines = CONFIG.letter.split(/(?<=[。！？])/).filter(Boolean);
    let gi = 0;  // 全局字序，控制逐字显影延迟
    els.letterText.innerHTML = lines.map(line => {
      const inner = [...line].map(c =>
        `<span class="ch" style="transition-delay:${gi++ * 0.1}s">${c}</span>`).join('');
      return `<span class="letter-line">${inner}</span>`;
    }).join('');
  }

  /* ── 口令：选对「在一起那天」的月日 ── */
  function correctMD() {
    const d = new Date(CONFIG.startDate + 'T00:00:00');
    return { m: d.getMonth() + 1, day: d.getDate() };
  }

  function unlock() {
    els.gate.classList.add('open');
    els.stage.hidden = false;
    els.dayCount.textContent = daysTogether();
    buildLetter();
    setTimeout(() => {
      els.stage.classList.add('reveal');
      Wall.start();
      // 话在照片墙起来后再显影
      setTimeout(() => els.letterText.classList.add('show'), 900);
      els.gate.style.display = 'none';
    }, 700);
  }

  function onSubmit(e) {
    e.preventDefault();
    try {
      const want = correctMD();
      const m = Number(els.gateMonth.value), day = Number(els.gateDay.value);
      if (m === want.m && day === want.day) {
        unlock();
      } else {
        els.gateHint.textContent = '再想想呀，是我们在一起的那天 🤍';
        els.gate.classList.remove('shake'); void els.gate.offsetWidth; els.gate.classList.add('shake');
      }
    } catch (err) {
      // 任何异常直接显示到页面，避免"点了没反应"的静默失败
      els.gateHint.textContent = '出错了：' + (err && err.message ? err.message : err);
      console.error(err);
    }
  }

  /* 填充月(1-12)、日(1-31)下拉，默认不预选正确答案(给个中性默认) */
  function fillPickers() {
    const opt = (v, label) => `<option value="${v}">${label}</option>`;
    let mh = opt('', '月份');
    for (let m = 1; m <= 12; m++) mh += opt(m, m);
    els.gateMonth.innerHTML = mh;
    let dh = opt('', '日期');
    for (let d = 1; d <= 31; d++) dh += opt(d, d);
    els.gateDay.innerHTML = dh;
  }

  function init() {
    // 先绑定按钮事件（最关键，确保按钮一定有反应），其余装饰失败不影响
    els.gateForm.addEventListener('submit', onSubmit);
    els.viewerClose.addEventListener('click', closeViewer);
    els.viewer.addEventListener('click', e => { if (e.target === els.viewer) closeViewer(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !els.viewer.hidden) closeViewer(); });
    try { fillPickers(); buildPetals(); } catch (err) { console.error(err); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
