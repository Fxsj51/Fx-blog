/* 文章页评论（giscus）：只挂在文章正文底部，独立页面不渲染。
   - 容器是 #main 的一部分，SPA 换页时会随旧页面一起被替换；换页后按新 pathname 重建，
     保证从文章 A 跳到 B 显示的是 B 的 Discussion，且同页只有一个 iframe。
   - 配置来自 giscus.app 生成的原样参数，不要在别处再写一份。 */
(function () {
  'use strict';

  var CONTAINER_ID = 'giscus-comments';
  var ATTRS = {
    'data-repo': 'Fxsj51/Fx-blog',
    'data-repo-id': 'R_kgDOViq_KA',
    'data-category': 'Announcements',
    'data-category-id': 'DIC_kwDOViq_KM4DKz79',
    'data-mapping': 'pathname',
    'data-strict': '1',
    'data-reactions-enabled': '1',
    'data-emit-metadata': '0',
    'data-input-position': 'bottom',
    'data-theme': 'preferred_color_scheme',
    'data-lang': 'zh-CN'
  };

  function removeContainer() {
    var old = document.getElementById(CONTAINER_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function mount() {
    // 首页/归档/标签/分类/关于等页面不注入，也不留空容器
    if (document.body.getAttribute('data-page-layout') !== 'post') return;
    var article = document.querySelector('article.md-text');
    if (!article || !article.parentNode) return;
    if (document.getElementById(CONTAINER_ID)) return;

    var box = document.createElement('section');
    box.id = CONTAINER_ID;
    box.className = 'giscus-wrap';

    var script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    Object.keys(ATTRS).forEach(function (key) { script.setAttribute(key, ATTRS[key]); });
    box.appendChild(script);

    article.parentNode.appendChild(box);
  }

  function sync() {
    removeContainer();
    mount();
  }

  document.addEventListener('stellar:navigation-complete', sync);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})();
