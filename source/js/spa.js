/* 轻量无刷新换页（项目自研，替代主题 partial navigation）。
   只替换页面级区域（#site-cover / #main / #rightbar-region / body 属性 / shell 的 data-regions），
   不重建左栏与常驻组件，因此播放器、抽屉、折叠状态天然保持。
   失败、超时、非 HTML、跨域、脚本结构不一致等情况自动回退为整页跳转。 */
(function () {
  'use strict';

  var historyOk = !!(window.history && history.pushState && window.addEventListener);
  var fetchOk = typeof window.fetch === 'function' && typeof window.DOMParser === 'function';
  if (!historyOk || !fetchOk || !window.URL || !window.CustomEvent) return;

  var TIMEOUT = 12000;
  var BODY_ATTRS = ['data-page-type', 'data-page-layout', 'data-article-style', 'data-text-indent'];

  var siteRoot = (function () {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL(src).pathname.replace(/js\/spa\.js(?:[?#].*)?$/, '');
    } catch (e) {}
    return '/';
  })();

  var controller = null;
  var navToken = 0;
  var currentPath = location.pathname + location.search;
  var bar = null;
  var scrollTick = null;

  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch (e) {}
  }

  function pageKey(url) { return url.pathname + url.search; }

  function remember() {
    try {
      var prev = history.state;
      var next = prev && typeof prev === 'object' ? Object.assign({}, prev) : {};
      next.__spa = { url: location.href, x: window.pageXOffset, y: window.pageYOffset };
      history.replaceState(next, '', location.href);
    } catch (e) {}
  }

  function barEl() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'spa-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', '页面加载中');
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    return bar;
  }

  function barStart() {
    var b = barEl();
    b.style.transition = 'none';
    b.style.width = '8%';
    b.style.opacity = '1';
    void b.offsetWidth;
    b.style.transition = 'width 8s cubic-bezier(.1,.6,.2,1), opacity .25s ease';
    b.style.width = '80%';
  }

  function barDone() {
    if (!bar) return;
    var b = bar;
    b.style.transition = 'width .18s ease, opacity .3s ease .12s';
    b.style.width = '100%';
    b.style.opacity = '0';
    setTimeout(function () {
      if (b !== bar) return;
      b.style.transition = 'none';
      b.style.width = '0';
    }, 520);
  }

  function barFail() {
    if (!bar) return;
    bar.style.transition = 'opacity .2s ease';
    bar.style.opacity = '0';
    setTimeout(function () {
      if (!bar) return;
      bar.style.width = '0';
    }, 220);
  }

  function fallback(url, pop) {
    try {
      if (pop) location.replace(url.href);
      else location.assign(url.href);
    } catch (e) {
      location.href = url.href;
    }
  }

  // 托管脚本集合。注意：不能互相比较是否「完全相等」——运行时才会注入的
  // asset 脚本（lazyload / flying-pages / local-search / shortcut）只存在于当前文档，
  // 用相等比较会永远判为不兼容。这里只要求目标文档的托管脚本是当前文档的子集。
  function managedSet(doc) {
    var nodes = doc.querySelectorAll('script[data-stellar-script]');
    var map = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      map[nodes[i].getAttribute('data-stellar-script') + '|' + (nodes[i].getAttribute('src') || '')] = 1;
    }
    return map;
  }

  function hasSpaScript(doc) {
    var nodes = doc.querySelectorAll('script[src]');
    for (var i = 0; i < nodes.length; i++) {
      var src = nodes[i].getAttribute('src') || '';
      if (/(?:^|\/)js\/spa\.js(?:[?#]|$)/.test(src)) return true;
    }
    return false;
  }

  function hasUnmanagedScript(doc) {
    var nodes = doc.querySelectorAll('script');
    for (var i = 0; i < nodes.length; i++) {
      var s = nodes[i];
      if (s.hasAttribute('data-stellar-script')) continue;
      var type = (s.getAttribute('type') || '').trim().toLowerCase();
      if (type && type !== 'text/javascript' && type !== 'application/ecmascript' && type !== 'text/ecmascript') continue;
      return true;
    }
    return false;
  }

  function isCompatible(nextDoc) {
    if (!nextDoc || nextDoc.querySelectorAll('#main').length !== 1) return false;
    if (!nextDoc.querySelector('.site-shell')) return false;
    if (hasUnmanagedScript(nextDoc)) return false;
    if (!hasSpaScript(nextDoc)) return false;
    var cur = managedSet(document);
    var next = managedSet(nextDoc);
    for (var key in next) {
      if (!cur[key]) return false;
    }
    return true;
  }

  function syncCanonical(nextDoc) {
    if (!window.canonical) return;
    var def = nextDoc.querySelector('script[data-stellar-script="defines"]');
    if (!def) return;
    var m = /permalink:\s*(null|"(?:[^"\\]|\\.)*")/.exec(def.textContent || '');
    if (!m) return;
    try {
      if (!window.canonical.param) window.canonical.param = {};
      window.canonical.param.permalink = m[1] === 'null' ? null : JSON.parse(m[1]);
    } catch (e) {}
  }

  // 侧栏里存在多个 href 相同的链接（品牌头像、品牌标题、首页菜单都是 "/"），
  // 只用 href 建映射会把它们的 class 互相覆盖（头像会丢掉 brand-image--avatar，
  // 圆形裁切与尺寸随之失效）。这里改用「href + 同 href 的第 n 次出现」配对，
  // 只同步 class / aria-current，节点本身（身份、src、事件）保持不动。
  function linkKeyMap(root) {
    var nodes = root.querySelectorAll('#leftbar-region a[href]');
    var seen = Object.create(null);
    var map = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var href = nodes[i].getAttribute('href');
      var n = seen[href] = (seen[href] || 0) + 1;
      map[href + ' #' + n] = nodes[i];
    }
    return map;
  }

  function syncSelectedLinks(nextDoc) {
    var nextMap = linkKeyMap(nextDoc);
    var curNodes = document.querySelectorAll('#leftbar-region a[href]');
    var seen = Object.create(null);
    for (var i = 0; i < curNodes.length; i++) {
      var el = curNodes[i];
      var href = el.getAttribute('href');
      var n = seen[href] = (seen[href] || 0) + 1;
      var next = nextMap[href + ' #' + n];
      if (!next || next.tagName !== el.tagName) continue;
      var nextClass = next.getAttribute('class') || '';
      if ((el.getAttribute('class') || '') !== nextClass) {
        if (nextClass) el.setAttribute('class', nextClass);
        else el.removeAttribute('class');
      }
      if (next.hasAttribute('aria-current')) el.setAttribute('aria-current', next.getAttribute('aria-current'));
      else el.removeAttribute('aria-current');
    }
  }

  function replayManagedScripts(root) {
    if (!root) return;
    var scripts = Array.prototype.slice.call(root.querySelectorAll('script[data-stellar-script]'));
    scripts.forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      s.textContent = old.textContent;
      old.parentNode.replaceChild(s, old);
    });
  }

  function restoreScroll(position, hash) {
    var apply = function () {
      if (hash) {
        var target = null;
        try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) {}
        if (target) { target.scrollIntoView(); return; }
      }
      if (position && typeof position.y === 'number') window.scrollTo(position.x || 0, position.y);
      else window.scrollTo(0, 0);
    };
    apply();
    window.requestAnimationFrame(function () {
      apply();
      window.requestAnimationFrame(apply);
    });
  }

  function commit(nextDoc, url, pop, position) {
    var nextMain = nextDoc.getElementById('main');
    var nextShell = nextDoc.querySelector('.site-shell');
    var nextRightbar = nextDoc.getElementById('rightbar-region');
    var nextCover = nextDoc.getElementById('site-cover');
    var currentMain = document.getElementById('main');
    if (!nextMain || !currentMain) throw new Error('no main');

    // 音频节点先移出 #main，避免随区域替换被移除（播放不中断）
    if (window.SitePlayer && window.SitePlayer.unmount) window.SitePlayer.unmount();

    // 目标文档里的 <audio id="music-audio"> 是占位：移除，改挂全站唯一实例
    var strays = nextMain.querySelectorAll('#music-audio');
    for (var i = 0; i < strays.length; i++) strays[i].parentNode.removeChild(strays[i]);

    currentMain.parentNode.replaceChild(document.importNode(nextMain, true), currentMain);

    var currentRightbar = document.getElementById('rightbar-region');
    if (nextRightbar) {
      var rb = document.importNode(nextRightbar, true);
      if (currentRightbar) currentRightbar.parentNode.replaceChild(rb, currentRightbar);
      else document.getElementById('main').parentNode.insertBefore(rb, document.getElementById('main').nextSibling);
    } else if (currentRightbar) {
      currentRightbar.parentNode.removeChild(currentRightbar);
    }

    var currentCover = document.getElementById('site-cover');
    if (nextCover) {
      var cover = document.importNode(nextCover, true);
      if (currentCover) currentCover.parentNode.replaceChild(cover, currentCover);
      else document.body.insertBefore(cover, document.body.firstChild);
    } else if (currentCover) {
      currentCover.parentNode.removeChild(currentCover);
    }

    BODY_ATTRS.forEach(function (name) {
      if (nextDoc.body.hasAttribute(name)) document.body.setAttribute(name, nextDoc.body.getAttribute(name));
      else document.body.removeAttribute(name);
    });

    var shell = document.querySelector('.site-shell');
    if (shell) shell.setAttribute('data-regions', nextShell.getAttribute('data-regions') || '');

    document.title = nextDoc.title || document.title;
    syncCanonical(nextDoc);
    syncSelectedLinks(nextDoc);
    replayManagedScripts(document.getElementById('main'));

    if (!pop) {
      history.pushState({ __spa: { url: url.href, x: 0, y: 0 } }, '', url.href);
    }
    currentPath = pageKey(url);

    document.dispatchEvent(new CustomEvent('stellar:navigation-complete', { detail: { url: url.href } }));

    // 主题运行时只在 pageshow(persisted) 时才把 region 扩展重新挂载到当前 region 上，
    // 而这些扩展（code-copy / lightbox / 目录点击 / tabs / reveal 等）只认挂载时的 DOM。
    // #main 与 #rightbar-region 已被替换成新节点，这里补一次派发让它们重新挂载；
    // 运行时以 root 元素身份做幂等判断，重复派发不会叠加，document 级扩展也会被跳过。
    try {
      if (typeof window.PageTransitionEvent === 'function') {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      }
    } catch (err) {
      // 重挂失败不影响换页本身
      if (window.console && console.warn) console.warn('[spa] pageshow 重挂失败:', err && err.message);
    }

    // 音乐页：把常驻音频挂回卡片
    if (window.SitePlayer && window.SitePlayer.mount) {
      var info = document.querySelector('.music-page .music-now__info');
      if (info) window.SitePlayer.mount(info);
    }

    restoreScroll(pop ? position : null, url.hash);
    remember();
    barDone();
  }

  function navigate(url, options) {
    options = options || {};
    var pop = !!options.pop;
    var token = ++navToken;

    if (controller) { try { controller.abort(); } catch (e) {} }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    controller = ctrl;

    if (!pop) remember();
    barStart();

    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }, TIMEOUT);

    var init = { credentials: 'same-origin', headers: { Accept: 'text/html,application/xhtml+xml' } };
    if (ctrl) init.signal = ctrl.signal;

    fetch(url.href, init).then(function (res) {
      if (token !== navToken) return null;
      if (!res.ok || res.redirected) throw new Error('HTTP ' + res.status);
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('text/html') < 0) throw new Error('not html');
      return res.text();
    }).then(function (html) {
      if (html == null || token !== navToken) return;
      var nextDoc = new DOMParser().parseFromString(html, 'text/html');
      if (!isCompatible(nextDoc)) throw new Error('incompatible page');
      commit(nextDoc, url, pop, options.position);
    }).catch(function (err) {
      if (token !== navToken) return;
      if (err && err.name === 'AbortError' && !timedOut) return;
      console.warn('[spa] 回退整页跳转：', url.href, err && err.message);
      barFail();
      fallback(url, pop);
    }).then(function () {
      clearTimeout(timer);
      if (controller === ctrl) controller = null;
    });
  }

  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if (link.hasAttribute('download')) return;
    if (link.hasAttribute('data-spa-skip') || link.closest('[data-spa-skip]')) return;
    if (link.target && link.target !== '_self') return;
    if (link.relList && link.relList.contains && link.relList.contains('external')) return;
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    if (/^(?:mailto:|tel:|javascript:|data:)/i.test(href)) return;

    var url;
    try { url = new URL(link.href); } catch (err) { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname.indexOf(siteRoot) !== 0) return;
    if (pageKey(url) === currentPath) return; // 同页仅锚点/查询串变化，交给浏览器

    e.preventDefault();
    navigate(url, { pop: false });
  }

  window.addEventListener('popstate', function (e) {
    var url = new URL(location.href);
    if (pageKey(url) === currentPath) return; // 仅锚点变化
    var state = e.state && e.state.__spa;
    if (!state) { location.reload(); return; }
    remember();
    navigate(url, { pop: true, position: { x: state.x, y: state.y } });
  });

  window.addEventListener('scroll', function () {
    if (scrollTick) return;
    scrollTick = window.requestAnimationFrame(function () {
      scrollTick = null;
      remember();
    });
  }, { passive: true });

  window.addEventListener('pagehide', remember);

  document.addEventListener('click', onClick);
  remember();
})();
