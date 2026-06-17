/**
 * backtotop.js — 回到顶部按钮（worldcup / simbet 共享）
 *
 * 自包含：自己创建按钮 DOM、监听滚动、平滑回顶。页面只需引入本文件 + css。
 * 列表下滑超过阈值时按钮在右下角淡入，点击平滑滚回顶部。
 */
(function () {
  'use strict';

  var SHOW_AFTER = 320;   // 滚动超过此像素显示按钮
  var ticking = false;

  function init() {
    var btn = document.createElement('button');
    btn.className = 'back-to-top';
    btn.setAttribute('aria-label', '回到顶部');
    btn.setAttribute('title', '回到顶部');
    btn.textContent = '↑';
    document.body.appendChild(btn);

    function update() {
      var y = window.pageYOffset || document.documentElement.scrollTop;
      btn.classList.toggle('visible', y > SHOW_AFTER);
      ticking = false;
    }

    // 用 rAF 节流滚动回调，避免高频触发
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    update();  // 初始判定（刷新时可能已在中部）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
