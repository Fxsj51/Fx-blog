(function () {
  'use strict';

  // 音乐页视图脚本：托管为常驻脚本，SPA 换页后 #main 被替换时按新 DOM 重新初始化。
  // 播放能力全部来自 SitePlayer（全站唯一 <audio>），本文件只负责音乐页视图与歌词。
  var boundList = null;
  var cleanup = null;
  // 拖动状态挂在模块级：document 上的监听只注册一次（SPA 怎么换节点都不用重绑）
  var dragHandlers = null;
  var globalDragBound = false;
  // 抬手时释放指针捕获后，浏览器还会补一个 click，落点可能是拖动终点下方的别的元素
  // （比如曲目列表）——那会让拖动看起来「一松手就跳回 0 并换了首歌」。拖完这一下必须吃掉。
  var suppressClick = false;

  function bindGlobalDrag() {
    if (globalDragBound) return;
    globalDragBound = true;
    document.addEventListener('pointermove', function (e) { if (dragHandlers) dragHandlers.move(e); }, true);
    document.addEventListener('pointerup', function (e) { if (dragHandlers) dragHandlers.up(e); }, true);
    document.addEventListener('pointercancel', function (e) { if (dragHandlers) dragHandlers.cancel(e); }, true);
    document.addEventListener('pointerdown', function () { suppressClick = false; }, true);
    document.addEventListener('click', function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    // 窗口失焦 / 页面隐藏时 pointerup 可能永远不来，兜底复位，避免 dragging 卡死
    window.addEventListener('blur', function () { if (dragHandlers) dragHandlers.abort(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && dragHandlers) dragHandlers.abort(); });
  }

  function initMusicPage() {
    var list = document.getElementById('music-list');
    var player = window.SitePlayer;
    var disc = document.getElementById('music-disc');
    var discImg = document.getElementById('music-disc-img');
    var nowTitle = document.getElementById('music-now-title');
    var nowArtist = document.getElementById('music-now-artist');
    var creditsEl = document.getElementById('music-now-credits');
    var lyricsMeta = document.getElementById('music-lyrics-meta');
    var lyricsScroll = document.getElementById('music-lyrics-scroll');
    var seekEl = document.getElementById('music-seek');
    var playedEl = document.getElementById('music-played');
    var thumbEl = document.getElementById('music-thumb');
    var curEl = document.getElementById('music-cur');
    var durEl = document.getElementById('music-dur');
    var toggleBtn = document.getElementById('music-toggle');
    var loopBtn = document.getElementById('music-loop');
    var muteBtn = document.getElementById('music-mute');
    var volWrap = document.getElementById('music-vol-wrap');
    var volPop = document.getElementById('music-vol-pop');
    var volEl = document.getElementById('music-vol');

    if (!list || !player || !lyricsScroll) {
      if (cleanup) { cleanup(); cleanup = null; }
      boundList = null;
      return;
    }
    // 同一份 DOM 只绑定一次；SPA 换页会生成新节点，因此按节点身份判断
    if (boundList === list) return;
    if (cleanup) { cleanup(); cleanup = null; }
    boundList = list;

    var items = Array.prototype.slice.call(list.querySelectorAll('.music-item'));
    var currentIndex = -1;

    // 把全站唯一的音频节点挂进「当前曲目」卡片（移动节点不会中断播放）
    player.mount(document.querySelector('.music-page .music-now__info'));

    function formatTime(sec) {
      if (!isFinite(sec) || sec <= 0) return '—';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ---------------- 播放控件（自绘进度条：按下即跳、拖动跟随、松手不回弹） ----------------
    var ICON_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 5l12 7-12 7z"/></svg>';
    var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
    // 音量图标沿用原有喇叭形状（不重绘），按参考图做分级声波：
    // 0 档静音（喇叭 + 原「×」）、低档 1 道波、中档 2 道波、高档 3 道波，三档声波同心（圆心 10,12）
    var VOL_BASE = '<path fill="currentColor" d="M4 9h3.5L12 5.5v13L7.5 15H4z"/>';
    var VOL_MUTE_X = '<path fill="currentColor" d="M15.2 8.8l1.3-1.3 2.2 2.2 2.2-2.2 1.3 1.3-2.2 2.2 2.2 2.2-1.3 1.3-2.2-2.2-2.2 2.2-1.3-1.3 2.2-2.2z"/>';
    var VOL_WAVES = ['',
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M13.3 8.8A4.6 4.6 0 0 1 13.3 15.2"/>',
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15 7.1A7 7 0 0 1 15 17"/>',
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16.5 5.5A9.2 9.2 0 0 1 16.5 18.5"/>'];
    var VOL_SVG = function (inner) {
      return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' + inner + '</svg>';
    };
    // 0 → 静音；0～1/3 → 1 道；1/3～2/3 → 2 道；2/3～1 → 3 道
    function volumeTier(v) {
      if (!(v > 0)) return 0;
      if (v <= 1 / 3) return 1;
      if (v <= 2 / 3) return 2;
      return 3;
    }
    function volumeIcon(tier) {
      if (tier === 0) return VOL_SVG(VOL_BASE + VOL_MUTE_X);
      var inner = VOL_BASE;
      for (var i = 1; i <= tier; i++) inner += VOL_WAVES[i];
      return VOL_SVG(inner);
    }
    // 三态图标：列表循环 / 不循环保持原 repeat 图标不动；
    // 仅单曲循环换成参考图的圆环双弧 + V 形箭头，并保留「1」作为该态标记
    var LOOP_PATHS = '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3"/>';
    var LOOP_ONE_PATHS = '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.1A7.6 7.6 0 1 0 5.1 8.8M7.9 7.8L5.1 8.8L4.1 6M5.1 15.2A7.6 7.6 0 0 0 18.9 15.2M19.9 18L18.9 15.2L16.1 16.2"/>';
    var LOOP_SVG = function (inner) {
      return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' + inner + '</svg>';
    };
    var LOOP_META = {
      list: { icon: LOOP_SVG(LOOP_PATHS), label: '列表循环' },
      one: { icon: LOOP_SVG(LOOP_ONE_PATHS + '<text x="12" y="15.4" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">1</text>'), label: '单曲循环' },
      off: { icon: LOOP_SVG(LOOP_PATHS + '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l16 16"/>'), label: '不循环' }
    };
    var audioEl = player.ensure();
    var dragging = false;
    var dragPointerId = -1;
    var dragRect = null;      // pointerdown 时快照一次，整段拖动都用它，避免布局变化导致 rect 漂移
    var pendingRatio = null;  // duration 还没就绪时暂存的目标比例，元数据到了再落点

    function clock(sec) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function paintProgress(ratio) {
      if (!seekEl) return;
      var pct = Math.max(0, Math.min(1, ratio)) * 100;
      if (playedEl) playedEl.style.width = pct + '%';
      if (thumbEl) thumbEl.style.left = pct + '%';
      seekEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    }

    function paintTimes(st) {
      var dur = st.duration || 0;
      if (curEl) curEl.textContent = clock(st.currentTime);
      if (durEl) durEl.textContent = clock(dur);
      if (seekEl) seekEl.setAttribute('aria-valuetext', clock(st.currentTime) + ' / ' + clock(dur));
    }

    // 拖动期间由指针位置驱动，不被 timeupdate 回写覆盖（否则会出现「松手弹回」）；
    // 松手后也留一小段窗口，等 seeked/timeupdate 把真实位置同步上来
    function syncProgress(st) {
      if (dragging || Date.now() < holdUntil) return;
      var dur = st.duration || 0;
      paintProgress(dur > 0 ? st.currentTime / dur : 0);
      paintTimes(st);
    }

    function syncToggle(st) {
      if (!toggleBtn) return;
      toggleBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
      toggleBtn.setAttribute('aria-label', st.playing ? '暂停' : '播放');
    }

    function syncLoop(st) {
      if (!loopBtn) return;
      var mode = st.loopMode || 'list';
      var meta = LOOP_META[mode] || LOOP_META.list;
      if (loopBtn.getAttribute('data-mode') !== mode) {
        loopBtn.setAttribute('data-mode', mode);
        loopBtn.innerHTML = meta.icon;
      }
      loopBtn.setAttribute('aria-label', meta.label);
      loopBtn.title = meta.label + '，点击切换';
      loopBtn.classList.toggle('is-off', mode === 'off');
    }

    // 音量状态只在 SitePlayer 里存一份（0～1），图标/滑块都按它渲染：
    // 图标按四档（静音/1 道波/2 道波/3 道波）跟随音量；滑块值与音量条开合互不影响
    var volTier = -1;
    function syncVolume(st) {
      if (!muteBtn) return;
      var v = st && typeof st.volume === 'number' ? st.volume : (audioEl ? audioEl.volume : 1);
      if (!(v >= 0)) v = 1;
      var tier = volumeTier(v);
      // 只在档位变化时换 SVG，拖动的每一帧 input 都会走到这里（逐帧跟随）
      if (tier !== volTier) {
        volTier = tier;
        muteBtn.innerHTML = volumeIcon(tier);
        muteBtn.setAttribute('data-tier', String(tier));
      }
      var muted = tier === 0;
      muteBtn.classList.toggle('is-muted', muted);
      muteBtn.setAttribute('aria-label', muted ? '音量（静音）' : '音量');
      muteBtn.title = (muted ? '音量（静音）' : '音量') + '，点击展开或收起音量条';
      if (volEl) {
        var pct = Math.round(v * 100);
        if (document.activeElement !== volEl) volEl.value = String(pct);
        volEl.setAttribute('aria-valuetext', pct + '%');
      }
    }

    // 比例一律按「按下时快照的轨道 rect」算：不用 e.offsetX / e.layerX（指针被捕获后它们相对
    // 的是 thumb 而不是轨道，会永远接近 0），也不用 e.target 的 rect（target 往往是 thumb 子节点）。
    // 矩形不合法时返回 null（而不是 0）：调用方必须放弃本次 seek，绝不能把非法坐标落成 0。
    function ratioOf(clientX) {
      if (!dragRect || !isFinite(dragRect.left) || !isFinite(dragRect.width) || dragRect.width <= 0) return null;
      if (!isFinite(clientX)) return null;
      var ratio = (clientX - dragRect.left) / dragRect.width;
      if (!isFinite(ratio)) return null;
      return Math.min(1, Math.max(0, ratio));
    }

    // 媒体是否可 seek 统一由 SitePlayer.canSeek() 判定（与侧栏迷你条共用一套逻辑）：
    // 服务端不支持 Range（如 hexo server）时 audio.seekable 是零宽区间，给 currentTime
    // 赋值会被浏览器吞掉并回到 0，界面就会显示「拖到哪都归 0」。
    var seekWarned = false;

    function applyRatio(ratio) {
      if (ratio == null || !isFinite(ratio)) return; // 坐标非法：放弃这次 seek
      ratio = Math.min(1, Math.max(0, ratio));
      var st = player.state();
      var dur = st.duration;
      if (!isFinite(dur) || dur <= 0) {
        // preload="none" 时首帧没有 duration：不能静默吞掉这次拖动（表现为「一拖就回 0」）。
        // 先记住目标比例并触发加载，loadedmetadata 到达后再落点。
        pendingRatio = ratio;
        if (audioEl && audioEl.readyState === 0) {
          try { audioEl.load(); } catch (err) {}
        }
        return;
      }
      var target = ratio * dur;
      if (!isFinite(target) || target < 0) return;
      if (!player.canSeek || !player.canSeek()) {
        // 不可 seek 时不画目标位置：画了就是「拖到 50% 又归 0」的假象
        pendingRatio = null;
        if (!seekWarned) {
          seekWarned = true;
          console.warn('[music] 音频当前不可 seek（服务端缺少 Range/Accept-Ranges 支持），本次拖动已忽略');
        }
        paintProgress(st.currentTime / dur);
        paintTimes(st);
        return;
      }
      pendingRatio = null;
      paintProgress(ratio);
      if (curEl) curEl.textContent = clock(target);
      if (seekEl) seekEl.setAttribute('aria-valuetext', clock(target) + ' / ' + clock(dur));
      if (player.seekToRatio) player.seekToRatio(ratio); else player.seek(target); // seek 会派发 time 事件，歌词随之高亮
      // 赋值被媒体吞掉或被别处写回时，把进度条回滚到真实位置，绝不停在一个没落地的比例上
      var landed = audioEl ? Math.abs((audioEl.currentTime || 0) - target) <= 0.5 : false;
      if (!landed) {
        paintProgress(audioEl ? (audioEl.currentTime || 0) / dur : 0);
        paintTimes(player.state());
      }
    }

    // 松手后短暂保留 dragging 的「不回写」状态：seeked/timeupdate 往往晚一两帧到达，
    // 期间若按 timeupdate 回写，会把刚落地的位置画回旧值（表现成回弹）。
    var holdUntil = 0;
    function endDrag(clientX, apply) {
      if (!dragging) return;
      if (apply && clientX != null) applyRatio(ratioOf(clientX)); // pointercancel 的坐标不可信
      var pid = dragPointerId;
      dragging = false;
      dragPointerId = -1;
      dragRect = null;
      if (seekEl) {
        seekEl.classList.remove('is-dragging');
        try { if (pid >= 0 && seekEl.hasPointerCapture && seekEl.hasPointerCapture(pid)) seekEl.releasePointerCapture(pid); } catch (err) {}
      }
      // 拖动结束后浏览器补发的 click 要吃掉。这里不能用定时器复位——click 是 pointerup 之后
      // 单独的 task，0ms 定时器可能先跑，标志就白设了；改由下一次 pointerdown 复位。
      suppressClick = true;
      holdUntil = Date.now() + 250;
      setTimeout(function () {
        if (dragging) return;
        holdUntil = 0;
        syncProgress(player.state());
      }, 260);
    }

    if (seekEl) {
      seekEl.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (dragging) endDrag(null, false); // 上一次抬手丢了，也不能让新的一次拖不动
        var rect = seekEl.getBoundingClientRect();
        // 布局未就绪（宽 0 / NaN / 隐藏）时不接这次按下：此前会因此算出 ratio 0 而 seek(0)
        if (!rect || !isFinite(rect.left) || !isFinite(rect.width) || rect.width <= 0) return;
        dragging = true;
        dragPointerId = e.pointerId;
        dragRect = rect; // 快照轨道容器（不是 thumb），整段拖动复用，不在 move 里重取
        seekEl.classList.add('is-dragging');
        try { seekEl.setPointerCapture(e.pointerId); } catch (err) {}
        if (e.cancelable) e.preventDefault();
        applyRatio(ratioOf(e.clientX));
      });
      seekEl.addEventListener('keydown', function (e) {
        var st = player.state();
        if (!(st.duration > 0)) return;
        var step = e.shiftKey ? 15 : 5;
        if (e.key === 'ArrowRight') { player.seek(st.currentTime + step); e.preventDefault(); }
        else if (e.key === 'ArrowLeft') { player.seek(st.currentTime - step); e.preventDefault(); }
        else if (e.key === 'Home') { player.seek(0); e.preventDefault(); }
        else if (e.key === 'End') { player.seek(st.duration); e.preventDefault(); }
      });
    }

    // 拖动跟随与抬手统一走 document 级监听（捕获阶段）：指针捕获丢失、拖到条外、
    // 甚至在别的元素上松手，都能收到 pointerup，不会让 dragging 卡在 true
    bindGlobalDrag();
    dragHandlers = {
      move: function (e) {
        if (!dragging || e.pointerId !== dragPointerId) return;
        // 真实拖动必然按着键：hover 移动（buttons=0）不参与 seek。
        // 否则 pointerup 丢失后残留的 hover 会把进度打到轨道边缘（ratio 1 或 0）。
        if (e.buttons === 0) return;
        if (e.cancelable) e.preventDefault();
        applyRatio(ratioOf(e.clientX));
      },
      up: function (e) {
        if (!dragging || e.pointerId !== dragPointerId) return;
        endDrag(e.clientX, true);
      },
      cancel: function (e) {
        if (!dragging || e.pointerId !== dragPointerId) return;
        endDrag(null, false);
      },
      abort: function () { endDrag(null, false); }
    };

    // duration 到达后补上拖动期间暂存的目标位置
    function onLoadedMeta() {
      if (dragging || pendingRatio == null) return;
      applyRatio(pendingRatio);
    }
    if (audioEl) audioEl.addEventListener('loadedmetadata', onLoadedMeta);

    if (toggleBtn) toggleBtn.addEventListener('click', function () { player.toggle(); });

    // ---------------- 音量条：默认收起，点按或悬停展开，再点收起 ----------------
    // 浮层是绝对定位的，展开/收起不参与控件行布局（不挤动其它控件、不产生横向滚动）
    var volPinned = false;

    function setVolOpen(open) {
      if (!volWrap) return;
      volWrap.classList.toggle('is-open', !!open);
      if (muteBtn) muteBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function closeVol(restoreFocus) {
      volPinned = false;
      setVolOpen(false);
      if (restoreFocus && muteBtn) muteBtn.focus();
    }

    if (muteBtn && volWrap) {
      muteBtn.addEventListener('click', function () {
        // 点按 = 在「显示/不显示音量条」之间切换（悬停展开不算锁定）
        if (volPinned) { closeVol(false); return; }
        volPinned = true;
        setVolOpen(true);
        // 先强制样式生效（visibility 不参与过渡），再把焦点交给滑块，
        // 键盘用户展开后可直接用方向键调音量
        if (volEl && volWrap) {
          void volWrap.offsetHeight;
          volEl.focus();
        }
      });
      volWrap.addEventListener('mouseenter', function () { if (!volPinned) setVolOpen(true); });
      volWrap.addEventListener('mouseleave', function () { if (!volPinned) setVolOpen(false); });
      // 在浮层上按下（拖滑块）时锁定，避免拖动途中指针移出浮层就收起
      volWrap.addEventListener('pointerdown', function (e) {
        if (volPop && volPop.contains(e.target)) volPinned = true;
      });
    }

    function onVolOutside(e) {
      if (!volPinned) return;
      if (volWrap && volWrap.contains(e.target)) return;
      closeVol(false);
    }
    function onVolKey(e) {
      if (e.key !== 'Escape' || !volWrap) return;
      if (!volWrap.classList.contains('is-open')) return;
      closeVol(true);
    }
    document.addEventListener('pointerdown', onVolOutside, true);
    document.addEventListener('keydown', onVolKey);

    if (volEl) {
      // 原生 range：左右方向键、Home/End 天然可用；值即音量（0～100 → 0～1）
      volEl.addEventListener('input', function () {
        var pct = Number(volEl.value);
        if (!isFinite(pct)) pct = 100;
        player.setVolume(pct / 100);
        syncVolume(player.state());
      });
    }

    // ---------------- 歌词（可选本地 .lrc） ----------------
    var lyricLines = [];
    var lyricIndex = -1;
    var lyricToken = 0;
    var lrcCache = Object.create(null);
    var zhCache = Object.create(null);

    function showLyricsMessage(text, meta) {
      lyricLines = [];
      lyricIndex = -1;
      lyricsScroll.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'music-lyrics__empty';
      p.textContent = text;
      lyricsScroll.appendChild(p);
      lyricsMeta.textContent = meta || '';
    }

    function parseLrc(text) {
      var lines = [];
      var offset = 0;
      String(text || '').split(/\r?\n/).forEach(function (raw) {
        var trimmed = raw.trim();
        if (!trimmed) return;
        var meta = /^\[([a-z]+):(.*)\]$/i.exec(trimmed);
        if (meta) {
          if (meta[1].toLowerCase() === 'offset') {
            var v = parseInt(meta[2], 10);
            if (isFinite(v)) offset = v;
          }
          return;
        }
        var times = [];
        var re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
        var m;
        while ((m = re.exec(trimmed))) {
          var frac = m[3] ? parseFloat('0.' + m[3]) : 0;
          times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
        }
        if (!times.length) return;
        var content = trimmed.replace(/\[[^\]]*\]/g, '').trim();
        if (!content) return;
        times.forEach(function (t) { lines.push({ time: t, text: content }); });
      });
      lines.sort(function (a, b) { return a.time - b.time; });
      // LRC 的 offset 为正表示歌词提前出现
      if (offset) {
        lines.forEach(function (line) { line.time = Math.max(0, line.time - offset / 1000); });
      }
      return lines;
    }

    function scrollLyricIntoView(el) {
      var boxRect = lyricsScroll.getBoundingClientRect();
      var elRect = el.getBoundingClientRect();
      var top = elRect.top - boxRect.top + lyricsScroll.scrollTop -
        lyricsScroll.clientHeight / 2 + elRect.height / 2;
      lyricsScroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }

    function updateLyric(current, force) {
      if (!lyricLines.length) return;
      var idx = -1;
      for (var i = 0; i < lyricLines.length; i++) {
        if (lyricLines[i].time <= current + 0.12) idx = i;
        else break;
      }
      if (!force && idx === lyricIndex) return;
      lyricIndex = idx;
      var nodes = lyricsScroll.querySelectorAll('.lyric-line');
      for (var k = 0; k < nodes.length; k++) {
        nodes[k].classList.toggle('is-current', k === idx);
        nodes[k].classList.toggle('is-past', k < idx);
      }
      if (idx >= 0 && nodes[idx]) scrollLyricIntoView(nodes[idx]);
    }

    // 译文按时间戳对齐到原词行：译文文件由 npm run lyrics:zh 生成，
    // 每行时间戳改写为原词同一句的时间，因此这里只需按时间精确匹配，不单独计时。
    function renderLyrics(lines, zhLines) {
      lyricLines = lines;
      lyricIndex = -1;
      lyricsScroll.innerHTML = '';
      if (!lines.length) {
        showLyricsMessage('纯音乐，请欣赏', '无歌词');
        return;
      }
      var zhMap = Object.create(null);
      (zhLines || []).forEach(function (line) {
        var key = line.time.toFixed(2);
        if (zhMap[key] == null) zhMap[key] = line.text;
      });
      var frag = document.createDocumentFragment();
      var zhCount = 0;
      lines.forEach(function (line) {
        var p = document.createElement('p');
        p.className = 'lyric-line';
        var src = document.createElement('span');
        src.className = 'lyric-line__src';
        src.textContent = line.text;
        p.appendChild(src);
        var zh = zhMap[line.time.toFixed(2)];
        if (zh) {
          var sub = document.createElement('span');
          sub.className = 'lyric-line__zh';
          sub.textContent = zh;
          p.appendChild(sub);
          zhCount++;
        }
        frag.appendChild(p);
      });
      lyricsScroll.appendChild(frag);
      lyricsScroll.scrollTop = 0;
      lyricsMeta.textContent = 'LRC · ' + lines.length + ' 行' + (zhCount ? ' · 双语' : '');
    }

    function fetchLrc(url) {
      return fetch(url, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(parseLrc);
    }

    function loadLyrics(url, zhUrl) {
      var token = ++lyricToken;
      if (!url) {
        showLyricsMessage('纯音乐，请欣赏', '无 LRC');
        return;
      }
      if (lrcCache[url]) {
        renderLyrics(lrcCache[url], (zhUrl && zhCache[zhUrl]) || null);
        return;
      }
      showLyricsMessage('歌词加载中…', '加载中');
      var zhTask = (!zhUrl || zhCache[zhUrl])
        ? Promise.resolve((zhUrl && zhCache[zhUrl]) || null)
        : fetchLrc(zhUrl).catch(function (err) {
          // 译文缺失不是错误：降级为只显示原文
          console.warn('[music] 译文加载失败，仅显示原文', zhUrl, err);
          return null;
        });
      Promise.all([fetchLrc(url), zhTask])
        .then(function (pair) {
          if (token !== lyricToken) return;
          var lines = pair[0];
          var zh = pair[1];
          lrcCache[url] = lines;
          if (zhUrl && zh) zhCache[zhUrl] = zh;
          renderLyrics(lines, zh);
        })
        .catch(function (err) {
          if (token !== lyricToken) return;
          console.warn('[music] 歌词加载失败', url, err);
          showLyricsMessage('歌词加载失败', '加载失败');
        });
    }

    // ---------------- 曲目信息（作词/作曲/编曲/专辑，有则显示） ----------------
    var CREDIT_LABELS = [
      ['lyricist', '作词'],
      ['composer', '作曲'],
      ['arranger', '编曲'],
      ['album', '专辑']
    ];

    function renderCredits(track) {
      if (!creditsEl) return;
      var source = (track && track.credits) || null;
      var parts = [];
      if (source) {
        CREDIT_LABELS.forEach(function (pair) {
          var value = String(source[pair[0]] || '').trim();
          if (value) parts.push(pair[1] + '：' + value);
        });
      }
      creditsEl.textContent = parts.join(' · ');
      creditsEl.hidden = parts.length === 0;
    }

    function setActiveDuration(text) {
      var active = list.querySelector('.music-item.is-active .music-item__dur');
      if (active) active.textContent = text;
    }

    function render(st) {
      var idx = st.index;
      var track = st.track;
      items.forEach(function (it, i) { it.classList.toggle('is-active', i === idx); });
      if (track) {
        nowTitle.textContent = track.title || '未选择曲目';
        nowArtist.textContent = track.artist || '';
        if (discImg && track.cover) discImg.setAttribute('src', track.cover);
      } else {
        nowTitle.textContent = '未选择曲目';
        nowArtist.textContent = '点击下方任意曲目开始播放';
      }
      renderCredits(track);
      if (disc) disc.classList.toggle('is-playing', st.playing);
      if (idx !== currentIndex) {
        currentIndex = idx;
        var lrc = (track && track.lrc) || (items[idx] && items[idx].getAttribute('data-lrc')) || '';
        var zhlrc = (track && track.zhlrc) || (items[idx] && items[idx].getAttribute('data-zhlrc')) || '';
        if (idx >= 0) loadLyrics(lrc, zhlrc);
        else showLyricsMessage('点击曲目开始播放，歌词会跟随高亮。', '—');
      }
      if (st.duration > 0) setActiveDuration(formatTime(st.duration));
      updateLyric(st.currentTime);
      syncToggle(st);
      syncLoop(st);
      syncProgress(st);
      syncVolume(st);
    }

    if (loopBtn) {
      loopBtn.addEventListener('click', function () { player.cycleLoop(); });
    }

    items.forEach(function (item, i) {
      item.addEventListener('click', function () { player.play(i); });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          player.play(i);
        }
      });
    });

    var unsubscribe = player.subscribe(function (st, type) {
      if (type === 'time') { updateLyric(st.currentTime); syncProgress(st); return; }
      if (type === 'meta') {
        if (st.duration > 0) setActiveDuration(formatTime(st.duration));
        syncProgress(st);
        return;
      }
      render(st);
    });

    cleanup = function () {
      unsubscribe();
      lyricToken++;
      dragHandlers = null;
      document.removeEventListener('pointerdown', onVolOutside, true);
      document.removeEventListener('keydown', onVolKey);
      if (audioEl) audioEl.removeEventListener('loadedmetadata', onLoadedMeta);
    };

    render(player.state());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMusicPage, { once: true });
  } else {
    initMusicPage();
  }
  // SPA 换页完成后重新绑定（离开音乐页时旧节点被移除，需要清理订阅）
  document.addEventListener('stellar:navigation-complete', initMusicPage);
})();
