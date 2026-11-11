/* 全站单例播放器：文档里只有一个 <audio> 实例，
   音乐页卡片与右下角侧栏迷你播放器都只是它的视图。
   - 音频节点常驻在 body 的隐藏宿主里，换页（SPA）时被移动到新页面的卡片，
     移动同一个媒体元素不会中断播放、不会重新发起请求。
   - 打开页面即预选歌单第一首（只拉元数据、不播放）；刷新回到第一首，SPA 换页保持当前曲目。 */
(function () {
  'use strict';

  var HOST_ID = 'site-audio-host';
  // 与左栏折叠状态的存储命名保持一致
  var LOOP_KEY = 'stellar:v2:player-loop-mode';
  var VOLUME_KEY = 'stellar:v2:player-volume';
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>';
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 5h2v14h-2zM4 5l11 7-11 7z"/></svg>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 5l12 7-12 7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  var ICON_LIST = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>';

  var audio = null;
  var index = -1;
  var subscribers = [];
  var playlistCache = null;
  var mini = null;
  // 循环模式：list 列表循环（默认）｜one 单曲循环｜off 不循环
  var loopMode = readLoopMode();
  // 音量 0～1（默认满音量），与循环模式一样跨页面持久化
  var volume = readVolume();
  // 迷你条拖动状态：pointerdown 时快照一次 rect，整段拖动复用（与音乐页同一套逻辑）
  var miniDrag = null;
  var miniDragBound = false;
  // 迷你条展开状态：收起时只剩圆形封面（贴视口右缘），点封面切换；
  // 用户展开后按「最后一次交互 + 8s 无操作」自动收回，播放不中断
  var expanded = false;
  var autoHide = false;
  var hoverInside = false;
  var collapseTimer = null;
  var COLLAPSE_DELAY = 8000;

  function siteRoot() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL(src).pathname.replace(/js\/site-player\.js(?:[?#].*)?$/, '');
    } catch (e) {}
    return '/';
  }
  var ROOT = siteRoot();

  function readPlaylist() {
    if (playlistCache) return playlistCache;
    var list = [];
    var el = document.getElementById('site-playlist');
    if (el) {
      try {
        var data = JSON.parse(el.textContent || '[]');
        if (Array.isArray(data)) list = data;
      } catch (e) { list = []; }
    }
    playlistCache = list;
    return list;
  }

  function host() {
    var el = document.getElementById(HOST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = HOST_ID;
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
      document.body.appendChild(el);
    }
    return el;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec <= 0) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function snapshot() {
    var list = readPlaylist();
    var track = index >= 0 && list[index] ? list[index] : null;
    return {
      index: index,
      track: track,
      loopMode: loopMode,
      volume: volume,
      playing: !!(audio && !audio.paused && !audio.ended),
      currentTime: audio ? (audio.currentTime || 0) : 0,
      duration: audio && isFinite(audio.duration) ? audio.duration : 0,
      src: audio ? (audio.getAttribute('src') || '') : ''
    };
  }

  function emit(type) {
    var detail = snapshot();
    subscribers.slice().forEach(function (fn) {
      try { fn(detail, type || 'change'); } catch (e) {}
    });
    try {
      document.dispatchEvent(new CustomEvent('siteplayer:' + (type || 'change'), { detail: detail }));
    } catch (e) {}
  }

  function readLoopMode() {
    try {
      var v = localStorage.getItem(LOOP_KEY);
      if (v === 'list' || v === 'one' || v === 'off') return v;
    } catch (e) {}
    return 'list';
  }

  function applyLoopMode() {
    if (audio) audio.loop = loopMode === 'one';
  }

  function readVolume() {
    try {
      var v = parseFloat(localStorage.getItem(VOLUME_KEY));
      if (isFinite(v) && v >= 0 && v <= 1) return v;
    } catch (e) {}
    return 1;
  }

  function setVolume(v) {
    v = Number(v);
    if (!isFinite(v)) return;
    volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (e) {}
    if (audio) {
      audio.volume = volume;
      audio.muted = false;
    }
    emit('change');
  }

  function setLoopMode(mode) {
    if (mode !== 'list' && mode !== 'one' && mode !== 'off') return;
    loopMode = mode;
    try { localStorage.setItem(LOOP_KEY, mode); } catch (e) {}
    applyLoopMode();
    renderMini();
    emit('change');
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = document.getElementById('music-audio');
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = 'music-audio';
      // 不挂原生 controls：播放界面由音乐页的自绘控件承载（SPA 下由这里新建节点时同样保持无 controls）
      host().appendChild(audio);
    }
    // 预选曲目也要能读出总时长：只拉元数据，不缓冲整段音频
    audio.preload = 'metadata';
    audio.addEventListener('play', function () { renderMini(); emit('change'); });
    audio.addEventListener('pause', function () { renderMini(); emit('change'); });
    audio.addEventListener('timeupdate', function () { renderMini(); emit('time'); });
    audio.addEventListener('seeked', function () { renderMini(); emit('time'); });
    audio.addEventListener('loadedmetadata', function () { renderMini(); emit('meta'); });
    audio.addEventListener('ended', function () {
      // 单曲循环由 audio.loop 处理（不重载、不触发 ended）；这里只管列表循环与不循环
      if (loopMode === 'list') { play(index + 1); return; }
      // 不循环：停在结尾，保持当前曲目，按钮回到可播状态
      renderMini();
      emit('change');
    });
    applyLoopMode();
    // 持久化音量在音频节点创建/复用后立刻应用（刷新与 SPA 换页都生效）；
    // 静音一律通过 volume=0 表达，不再借用 audio.muted
    audio.volume = volume;
    audio.muted = false;
    return audio;
  }

  // 仅选中并准备好曲目：写入 src 触发元数据加载（供总时长/歌词渲染），不调用 play()
  function select(i) {
    var list = readPlaylist();
    if (!list.length) return false;
    if (typeof i !== 'number' || isNaN(i)) i = index >= 0 ? index : 0;
    i = ((i % list.length) + list.length) % list.length;
    var track = list[i];
    if (!track || !track.url) return false;
    var a = ensureAudio();
    if (index !== i || !a.getAttribute('src')) {
      index = i;
      a.setAttribute('src', new URL(track.url, document.baseURI).href);
      try { a.load(); } catch (e) {}
      renderMini();
      emit('change');
    }
    return true;
  }

  function play(i) {
    if (!select(i)) return;
    var a = ensureAudio();
    var p = a.play();
    if (p && typeof p.catch === 'function') p.catch(function () {});
    renderMini();
    emit('change');
  }

  function toggle() {
    var a = ensureAudio();
    if (!a.getAttribute('src')) { play(index >= 0 ? index : 0); return; }
    if (a.paused) {
      var p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } else {
      a.pause();
    }
    renderMini();
    emit('change');
  }

  // 媒体可 seek 判定：服务端不支持 Range 时 audio.seekable 是零宽区间，
  // 给 currentTime 赋值会被吞掉并回到 0。音乐页进度条与侧栏迷你条共用这一判定。
  function mediaSeekable(a) {
    if (!a) return false;
    var ranges = a.seekable;
    if (!ranges || !ranges.length) return false;
    for (var i = 0; i < ranges.length; i++) {
      if (isFinite(ranges.start(i)) && isFinite(ranges.end(i)) && ranges.end(i) > ranges.start(i)) return true;
    }
    return false;
  }

  function canSeek() {
    return !!audio && isFinite(audio.duration) && audio.duration > 0 && mediaSeekable(audio);
  }

  // 按比例 seek；比例非法、duration 非法、媒体不可 seek 时一律放弃（绝不落到 0）
  function seekToRatio(ratio) {
    if (ratio == null || !isFinite(ratio) || !canSeek()) return false;
    ratio = Math.min(1, Math.max(0, ratio));
    var target = ratio * audio.duration;
    if (!isFinite(target) || target < 0) return false;
    seek(target);
    return true;
  }

  function seek(seconds) {
    if (!audio) return;
    var dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    audio.currentTime = Math.max(0, Math.min(dur, seconds));
    emit('time');
  }

  function mount(el) {
    if (!el) return;
    var a = ensureAudio();
    if (a.parentNode !== el) el.appendChild(a);
    renderMini();
  }

  function unmount() {
    if (!audio) return;
    if (audio.parentNode !== host()) host().appendChild(audio);
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () {
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  // ---------------- 侧栏迷你视图 ----------------
  // 迷你条同样支持拖动：按下即跳、移动跟随、松手定稿；坐标只用按下时快照的 rect
  function miniRatio(clientX) {
    if (!miniDrag) return null;
    var rect = miniDrag.rect;
    if (!rect || !isFinite(rect.left) || !isFinite(rect.width) || rect.width <= 0) return null;
    if (!isFinite(clientX)) return null;
    var ratio = (clientX - rect.left) / rect.width;
    if (!isFinite(ratio)) return null;
    return Math.min(1, Math.max(0, ratio));
  }

  function bindMiniDrag() {
    if (miniDragBound) return;
    miniDragBound = true;
    document.addEventListener('pointermove', function (e) {
      if (!miniDrag || e.pointerId !== miniDrag.id) return;
      if (e.buttons === 0) return; // hover 移动不参与 seek（避免 pointerup 丢失后把进度打到边缘）
      if (e.cancelable) e.preventDefault();
      seekToRatio(miniRatio(e.clientX));
    }, true);
    document.addEventListener('pointerup', function (e) {
      if (!miniDrag || e.pointerId !== miniDrag.id) return;
      seekToRatio(miniRatio(e.clientX));
      if (mini && mini.bar) {
        try { if (mini.bar.hasPointerCapture && mini.bar.hasPointerCapture(e.pointerId)) mini.bar.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      miniDrag = null;
    }, true);
    document.addEventListener('pointercancel', function (e) {
      if (!miniDrag || e.pointerId !== miniDrag.id) return;
      miniDrag = null;
    }, true);
    // 窗口失焦兜底，避免拖动状态卡住
    window.addEventListener('blur', function () { miniDrag = null; });
  }

  function buildMini() {
    var content = document.getElementById('music-drawer__content');
    if (!content) return null;
    if (mini && mini.root.parentNode === content) return mini;
    if (mini && mini.root.parentNode) mini.root.parentNode.removeChild(mini.root);

    var root = document.createElement('div');
    root.className = 'site-mini';
    root.innerHTML =
      '<button type="button" class="site-mini__disc" data-act="toggle" aria-label="播放或暂停">' +
        '<img class="site-mini__cover" alt="" width="76" height="76">' +
      '</button>' +
      '<div class="site-mini__info">' +
        '<a class="site-mini__title" href="' + ROOT + 'music/">未选择曲目</a>' +
        '<div class="site-mini__artist">点击进入音乐页</div>' +
        '<div class="site-mini__bar" data-act="seek" role="slider" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
          '<div class="site-mini__played"></div>' +
        '</div>' +
        '<div class="site-mini__foot">' +
          '<span class="site-mini__time" data-role="cur">0:00</span>' +
          '<span class="site-mini__btns">' +
            '<button type="button" data-act="prev" aria-label="上一首">' + ICON_PREV + '</button>' +
            '<button type="button" class="site-mini__toggle" data-act="toggle" aria-label="播放">' + ICON_PLAY + '</button>' +
            '<button type="button" data-act="next" aria-label="下一首">' + ICON_NEXT + '</button>' +
            '<a class="site-mini__list" href="' + ROOT + 'music/" aria-label="打开音乐页">' + ICON_LIST + '</a>' +
          '</span>' +
          '<span class="site-mini__time" data-role="dur">0:00</span>' +
        '</div>' +
      '</div>';

    content.appendChild(root);
    mini = {
      root: root,
      disc: root.querySelector('.site-mini__disc'),
      cover: root.querySelector('.site-mini__cover'),
      title: root.querySelector('.site-mini__title'),
      artist: root.querySelector('.site-mini__artist'),
      bar: root.querySelector('.site-mini__bar'),
      played: root.querySelector('.site-mini__played'),
      cur: root.querySelector('[data-role="cur"]'),
      dur: root.querySelector('[data-role="dur"]'),
      toggle: root.querySelector('.site-mini__toggle')
    };

    root.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!target) return;
      var act = target.getAttribute('data-act');
      // 圆形封面是展开/收起开关（收起态点它原地展开，展开态再点收回）
      if (act === 'toggle' && target.classList.contains('site-mini__disc')) {
        e.preventDefault();
        setExpanded(!expanded, true);
        return;
      }
      if (act === 'toggle') { e.preventDefault(); toggle(); return; }
      if (act === 'prev') { e.preventDefault(); play(index - 1); return; }
      if (act === 'next') { e.preventDefault(); play(index + 1); return; }
      // seek 分支已删除：迷你条改为 pointerdown/move/up 驱动（click 由拖动补发，不能再按坐标 seek，
      // 否则键盘/辅助技术触发的 click（clientX=0）会把进度打到 0）
    });

    // 悬停/键盘焦点在组件内时不自动收起；离开后重新按 8s 计时
    root.addEventListener('pointerenter', function () { hoverInside = true; clearCollapseTimer(); });
    root.addEventListener('pointerleave', function () { hoverInside = false; armCollapseTimer(); });
    // 点内部控件、或用 Tab 把焦点移进组件，都算一次交互：重置计时（触屏无悬停时同样有效）
    root.addEventListener('pointerdown', function () { if (expanded && autoHide) armCollapseTimer(); });
    root.addEventListener('focusin', function () { if (expanded && autoHide) armCollapseTimer(); });

    bindMiniDrag();
    mini.bar.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var rect = mini.bar.getBoundingClientRect();
      // 布局未就绪（宽 0 / NaN）时不接这次按下，避免 ratio 落成 0
      if (!rect || !isFinite(rect.left) || !isFinite(rect.width) || rect.width <= 0) return;
      miniDrag = { id: e.pointerId, rect: rect };
      try { mini.bar.setPointerCapture(e.pointerId); } catch (err) {}
      if (e.cancelable) e.preventDefault();
      seekToRatio(miniRatio(e.clientX));
    });

    renderMini();
    return mini;
  }

  function renderMini() {
    if (!mini) return;
    var st = snapshot();
    var track = st.track;
    mini.root.classList.toggle('is-empty', !track);
    mini.root.classList.toggle('is-playing', st.playing);
    mini.title.textContent = track ? track.title : '未选择曲目';
    mini.artist.textContent = track ? (track.artist || '未知歌手') : '点击进入音乐页';
    if (track && track.cover) {
      if (mini.cover.getAttribute('src') !== track.cover) mini.cover.setAttribute('src', track.cover);
      mini.cover.style.display = '';
    } else {
      mini.cover.removeAttribute('src');
      mini.cover.style.display = 'none';
    }
    var dur = st.duration || (track && track.duration) || 0;
    var pct = dur > 0 ? Math.min(100, (st.currentTime / dur) * 100) : 0;
    mini.played.style.width = pct + '%';
    mini.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    mini.cur.textContent = formatTime(st.currentTime);
    mini.dur.textContent = formatTime(dur);
    // timeupdate 每 ~250ms 调一次 renderMini：图标只在播放状态真正变化时重建，
    // 否则按下瞬间的 SVG 节点会被替换掉，浏览器不再派发 click（表现为偶尔要点两下）
    var playingAttr = st.playing ? '1' : '0';
    if (mini.toggle.getAttribute('data-playing') !== playingAttr) {
      mini.toggle.setAttribute('data-playing', playingAttr);
      mini.toggle.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
      mini.toggle.setAttribute('aria-label', st.playing ? '暂停' : '播放');
    }
  }

  // 音乐页有自己的大播放器，抽屉不重复；其余页面只看视口断点：≤1180 收起为贴右缘的圆形封面
  function clearCollapseTimer() {
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
  }

  // 只在「用户主动展开」后计时；悬停暂停，离开后重新计时
  function armCollapseTimer() {
    clearCollapseTimer();
    if (!expanded || !autoHide || hoverInside) return;
    collapseTimer = setTimeout(function () {
      collapseTimer = null;
      setExpanded(false, false);
    }, COLLAPSE_DELAY);
  }

  function setExpanded(next, auto) {
    expanded = !!next;
    autoHide = expanded && !!auto;
    var drawer = document.getElementById('music-drawer');
    if (drawer) drawer.classList.toggle('is-collapsed', !expanded);
    if (mini) {
      mini.root.classList.toggle('is-expanded', expanded);
      mini.disc.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      mini.disc.setAttribute('aria-label', expanded ? '收起播放器' : '展开播放器');
      mini.disc.setAttribute('title', expanded ? '收起播放器' : '展开播放器');
      // 收起时焦点若在面板内部，移回封面，避免焦点丢到 body
      if (!expanded && document.activeElement && mini.root.contains(document.activeElement) &&
          document.activeElement !== mini.disc) {
        mini.disc.focus({ preventScroll: true });
      }
    }
    armCollapseTimer();
  }

  function syncDrawer() {
    var drawer = document.getElementById('music-drawer');
    if (!drawer) return;
    if (document.querySelector('.music-page')) {
      clearCollapseTimer();
      drawer.style.setProperty('display', 'none', 'important');
      return;
    }
    drawer.style.removeProperty('display');
    buildMini();
    renderMini();
    // 没有当前曲目（空歌单）时整体不出现，也避免不可见的封面区域挡住点击
    if (!snapshot().track) {
      clearCollapseTimer();
      drawer.style.setProperty('display', 'none', 'important');
      return;
    }
    // 只看视口断点：>1180 始终保持整条展开；≤1180 才收起为贴右缘的圆形封面
    setExpanded(window.innerWidth > 1180, false);
  }

  window.SitePlayer = {
    ensure: ensureAudio,
    select: select,
    play: play,
    toggle: toggle,
    next: function () { play(index + 1); },
    prev: function () { play(index - 1); },
    setLoopMode: setLoopMode,
    setVolume: setVolume,
    get volume() { return volume; },
    cycleLoop: function () {
      setLoopMode(loopMode === 'list' ? 'one' : (loopMode === 'one' ? 'off' : 'list'));
    },
    get loopMode() { return loopMode; },
    seek: seek,
    seekToRatio: seekToRatio,
    canSeek: canSeek,
    mount: mount,
    unmount: unmount,
    subscribe: subscribe,
    state: snapshot,
    get playlist() { return readPlaylist(); },
    get index() { return index; }
  };

  function boot() {
    if (document.getElementById('music-audio')) ensureAudio();
    // 默认预选歌单第一首（顺序同 source/_data/playlist.yml）：只选中并准备好，不自动出声；
    // 刷新回到第一首，SPA 换页由模块内 index 保持当前曲目
    if (index < 0) select(0);
    syncDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  document.addEventListener('stellar:navigation-complete', syncDrawer);
  // 跨过 1180 断点时在「整条 / 圆形封面」之间切换
  window.addEventListener('resize', syncDrawer);

  // 展开态点组件以外的任意位置立即收回（捕获阶段，元素 stopPropagation 也拦不住）；
  // 只看真实指针事件，程序化派发的 click（isTrusted=false）不算用户操作
  function onDocPointerDown(e) {
    if (!expanded || e.isTrusted === false) return;
    var drawer = document.getElementById('music-drawer');
    if (!drawer) return;
    var path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    var inside = path && path.length ? path.indexOf(drawer) !== -1 : drawer.contains(e.target);
    if (!inside) setExpanded(false, false);
  }
  document.addEventListener('pointerdown', onDocPointerDown, true);

  // Escape 收起
  document.addEventListener('keydown', function (e) {
    if (!expanded) return;
    if (e.key === 'Escape' || e.key === 'Esc') setExpanded(false, false);
  }, true);
})();
