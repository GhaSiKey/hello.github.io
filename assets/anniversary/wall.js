/**
 * wall.js — 全屏漂浮拍立得墙（相框版）
 *
 * 从 anniversary 的 app.js 抽取照片墙核心：自动轮转 + 拖动惯性 + 轻点放大。
 * 相框场景特化：进页面直接铺满、默认静音、屏幕常亮(Wake Lock)、
 * 空闲隐藏鼠标与控制条。不依赖门帘/标题/结尾/BGM。
 */
(function () {
  'use strict';

  const CONFIG = {
    photoCount: 20,
    photoDir: 'assets/anniversary/',
    rotateMs: 2600,
  };

  const $ = s => document.querySelector(s);
  const els = {
    wall: $('#wall'), petals: $('#petals'),
    viewer: $('#viewer'), viewerImg: $('#viewerImg'), viewerClose: $('#viewerClose'),
    controls: $('#controls'), slideToggle: $('#slideToggle'),
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 飘落花瓣 ── */
  function buildPetals() {
    if (reduceMotion || !els.petals) return;
    const chars = ['🌸', '🌷', '✿', '❀', '♡'];
    let html = '';
    for (let i = 0; i < 14; i++) {
      const left = Math.random() * 100;
      const dur = 8 + Math.random() * 8;
      const delay = Math.random() * 8;
      const size = 0.9 + Math.random() * 1.1;
      html += `<span class="petal" style="left:${left}vw;animation-duration:${dur}s;animation-delay:${delay}s;font-size:${size}rem">${chars[i % chars.length]}</span>`;
    }
    els.petals.innerHTML = html;
  }

  /* ── 漂浮照片墙 ── */
  const Wall = (function () {
    let order = [], cursor = 0, liveSlots = [], maxOnScreen = 6, zTop = 0;

    function shuffle(n) {
      const a = Array.from({ length: n }, (_, i) => i + 1);
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }
    function computeMax() {
      const area = els.wall.clientWidth * els.wall.clientHeight;
      return Math.max(8, Math.min(14, Math.round(area / 22000)));
    }
    function sizeRange() {
      const w = els.wall.clientWidth;
      if (w < 520) return [30, 40];
      if (w < 900) return [24, 32];
      return [16, 24];                 // 大屏(电视)照片更小更多，铺满整墙
    }
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
      return { x: Math.max(12, Math.min(88, best.x)), y: Math.max(14, Math.min(86, best.y)) };
    }

    function addOne() {
      const idx = order[cursor % order.length];
      cursor++;
      const n = String(idx).padStart(2, '0');
      const src = `${CONFIG.photoDir}${n}.webp`;
      const pos = pickPos();
      const tilt = (Math.random() * 10 - 5).toFixed(1);
      const [wMin, wMax] = sizeRange();
      const w = wMin + Math.random() * (wMax - wMin);
      const floatDur = (6 + Math.random() * 4).toFixed(1);
      const z = ++zTop;
      const pre = new Image();
      const mount = (orientation) => {
        const fig = document.createElement('figure');
        fig.className = 'pw ' + orientation;
        fig.style.cssText = `--x:${pos.x}%;--y:${pos.y}%;--tilt:${tilt}deg;--w:${w}%;--float:${floatDur}s`;
        fig.style.zIndex = String(z);
        fig.dataset.x = pos.x; fig.dataset.y = pos.y;
        fig.innerHTML = `<div class="pw-card"><div class="pw-img"><img src="${src}" alt="我们的瞬间 ${idx}" draggable="false"></div></div>`;
        els.wall.appendChild(fig);
        const slot = { el: fig, x: pos.x, y: pos.y };
        liveSlots.push(slot);
        makeDraggable(fig, slot, () => openViewer(src, '我们的瞬间 ' + idx));
      };
      pre.addEventListener('load', () =>
        mount(pre.naturalWidth >= pre.naturalHeight ? 'pw--landscape' : 'pw--portrait'));
      pre.addEventListener('error', () => mount('pw--landscape'));
      pre.src = src;
    }
    // 拖动 + 惯性：移动小于阈值视作点击放大
    function makeDraggable(fig, slot, onTap) {
      const TAP = 6, FRICTION = 0.85, MIN_V = 0.05;
      let startX, startY, baseX, baseY, wRect, moved, dragging;
      let lastX, lastY, lastT, vx = 0, vy = 0, raf = 0;
      const clampX = v => Math.max(6, Math.min(94, v));
      const clampY = v => Math.max(6, Math.min(94, v));

      fig.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
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
        const now = performance.now(), dt = Math.max(1, now - lastT);
        vx = (nx - lastX) / dt * 16; vy = (ny - lastY) / dt * 16;
        lastX = nx; lastY = ny; lastT = now;
        fig.style.setProperty('--x', nx + '%');
        fig.style.setProperty('--y', ny + '%');
        slot.x = nx; slot.y = ny;
      });
      function glide() {
        if (!fig.isConnected) { raf = 0; return; }
        vx *= FRICTION; vy *= FRICTION;
        let nx = slot.x + vx, ny = slot.y + vy;
        if (nx < 6 || nx > 94) { nx = clampX(nx); vx = 0; }
        if (ny < 6 || ny > 94) { ny = clampY(ny); vy = 0; }
        slot.x = nx; slot.y = ny;
        fig.style.setProperty('--x', nx + '%');
        fig.style.setProperty('--y', ny + '%');
        if (Math.abs(vx) > MIN_V || Math.abs(vy) > MIN_V) raf = requestAnimationFrame(glide);
        else raf = 0;
      }
      const end = e => {
        if (!dragging) return;
        dragging = false;
        fig.classList.remove('pw--dragging');
        try { fig.releasePointerCapture(e.pointerId); } catch (_) {}
        if (!moved) { onTap(); return; }
        if (Math.abs(vx) > MIN_V || Math.abs(vy) > MIN_V) raf = requestAnimationFrame(glide);
      };
      fig.addEventListener('pointerup', end);
      fig.addEventListener('pointercancel', end);
    }

    function removeEl(slot) {
      slot.el.classList.add('out');
      slot.el.addEventListener('animationend', () => slot.el.remove(), { once: true });
      setTimeout(() => slot.el.remove(), 1400);
    }

    let timer = null;
    function tick() {
      addOne();
      while (liveSlots.length > maxOnScreen) removeEl(liveSlots.shift());
    }
    function start() {
      order = shuffle(CONFIG.photoCount);
      maxOnScreen = computeMax();
      for (let i = 0; i < maxOnScreen; i++) setTimeout(addOne, i * 160);
      timer = setInterval(tick, CONFIG.rotateMs);
      window.addEventListener('resize', onResize);
    }
    let rzTimer;
    function onResize() {
      clearTimeout(rzTimer);
      rzTimer = setTimeout(() => { maxOnScreen = computeMax(); }, 250);
    }
    function pause() { if (timer) { clearInterval(timer); timer = null; } }
    function resume() { if (!timer) timer = setInterval(tick, CONFIG.rotateMs); }
    function isPlaying() { return !!timer; }
    return { start, pause, resume, isPlaying };
  })();
  /* ── 放大查看 ── */
  let viewerOpenedAt = 0;
  function openViewer(src, alt) {
    els.viewerImg.src = src; els.viewerImg.alt = alt || '';
    els.viewer.hidden = false;
    viewerOpenedAt = performance.now();
    requestAnimationFrame(() => els.viewer.classList.add('show'));
  }
  function closeViewer() {
    els.viewer.classList.remove('show');
    setTimeout(() => { els.viewer.hidden = true; els.viewerImg.src = ''; }, 300);
  }

  /* ── 轮播开关 ── */
  const Slideshow = (() => {
    function reflect() {
      if (!els.slideToggle) return;
      const playing = Wall.isPlaying();
      els.slideToggle.classList.toggle('paused', !playing);
      els.slideToggle.setAttribute('aria-label', playing ? '暂停照片轮播' : '继续照片轮播');
    }
    function toggle() {
      if (Wall.isPlaying()) Wall.pause(); else Wall.resume();
      reflect();
    }
    function enable() {
      if (!els.slideToggle) return;
      els.slideToggle.addEventListener('click', toggle);
      reflect();
    }
    return { enable };
  })();

  /* ── 相框特化 ──────────────────────────────────────────── */

  // 屏幕常亮(Wake Lock)：相框不该自动息屏。失败静默(浏览器不支持/无权限)。
  // 注意：kiosk 浏览器通常另有防息屏设置，这里是锦上添花。
  let wakeLock = null;
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        document.addEventListener('visibilitychange', async () => {
          if (wakeLock === null && document.visibilityState === 'visible') {
            try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
          }
        });
      }
    } catch (_) {}
  }

  // 空闲管理：有交互时显示鼠标+控制条，空闲若干秒后隐藏(纯净画面)。
  const IDLE_MS = 3000;
  let idleTimer = null;
  function wake() {
    document.body.classList.remove('idle');
    if (els.controls) els.controls.classList.add('show');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      document.body.classList.add('idle');
      if (els.controls) els.controls.classList.remove('show');
    }, IDLE_MS);
  }

  function init() {
    if (els.viewerClose) els.viewerClose.addEventListener('click', closeViewer);
    if (els.viewer) els.viewer.addEventListener('click', e => {
      if (performance.now() - viewerOpenedAt < 350) return;
      if (e.target === els.viewer) closeViewer();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && els.viewer && !els.viewer.hidden) closeViewer(); });

    try { buildPetals(); } catch (err) { console.error(err); }
    Wall.start();
    Slideshow.enable();
    keepAwake();

    // 鼠标移动/触摸唤出控制条，空闲自动隐藏
    ['pointermove', 'pointerdown', 'keydown'].forEach(ev =>
      window.addEventListener(ev, wake, { passive: true }));
    wake();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
