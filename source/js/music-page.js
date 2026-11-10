(function () {
  'use strict';

  // 音乐页视图脚本：托管为常驻脚本，SPA 换页后 #main 被替换时按新 DOM 重新初始化。
  // 播放能力全部来自 SitePlayer（全站唯一 <audio>），本文件只负责音乐页视图与歌词。
  var boundList = null;
  var cleanup = null;
  // 拖动状态挂在模块级：document 上的监听只注册一次（SPA 怎么换节点都不用重绑）
  var dragHandlers = null;
  var globalDragBound = false;

  function bindGlobalDrag() {
    if (globalDragBound) return;
    globalDragBound = true;
    document.addEventListener('pointermove', function (e) { if (dragHandlers) dragHandlers.move(e); }, true);
    document.addEventListener('pointerup', function (e) { if (dragHandlers) dragHandlers.up(e); }, true);
    document.addEventListener('pointercancel', function (e) { if (dragHandlers) dragHandlers.cancel(e); }, true);
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
    var lyricsMeta = document.getElementById('music-lyrics-meta');
    var lyricsScroll = document.getElementById('music-lyrics-scroll');
    var seekEl = document.getElementById('music-seek');
    var playedEl = document.getElementById('music-played');
    var thumbEl = document.getElementById('music-thumb');
    var curEl = document.getElementById('music-cur');
    var durEl = document.getElementById('music-dur');
    var toggleBtn = document.getElementById('music-toggle');
    var muteBtn = document.getElementById('music-mute');
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

    // 拖动期间由指针位置驱动，不被 timeupdate 回写覆盖（否则会出现「松手弹回」）
    function syncProgress(st) {
      if (dragging) return;
      var dur = st.duration || 0;
      paintProgress(dur > 0 ? st.currentTime / dur : 0);
      paintTimes(st);
    }

    function syncToggle(st) {
      if (!toggleBtn) return;
      toggleBtn.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
      toggleBtn.setAttribute('aria-label', st.playing ? '暂停' : '播放');
    }

    function syncMute() {
      if (!muteBtn || !audioEl) return;
      var muted = audioEl.muted || audioEl.volume === 0;
      muteBtn.classList.toggle('is-muted', muted);
      muteBtn.setAttribute('aria-label', muted ? '取消静音' : '静音');
      if (volEl && document.activeElement !== volEl) {
        volEl.value = String(Math.round(audioEl.volume * 100));
      }
    }

    // 比例一律按「按下时快照的轨道 rect」算：不用 e.offsetX / e.layerX（指针被捕获后它们相对
    // 的是 thumb 而不是轨道，会永远接近 0），也不用 e.target 的 rect（target 往往是 thumb 子节点）
    function ratioOf(clientX) {
      if (!dragRect || !dragRect.width) return 0;
      return Math.min(1, Math.max(0, (clientX - dragRect.left) / dragRect.width));
    }

    function applyRatio(ratio) {
      var st = player.state();
      var dur = st.duration || 0;
      paintProgress(ratio);
      if (dur > 0) {
        pendingRatio = null;
        if (curEl) curEl.textContent = clock(ratio * dur);
        if (seekEl) seekEl.setAttribute('aria-valuetext', clock(ratio * dur) + ' / ' + clock(dur));
        player.seek(ratio * dur); // seek 会派发 time 事件，歌词随之高亮
        return;
      }
      // preload="none" 时首帧没有 duration：不能静默吞掉这次拖动（表现为「一拖就回 0」）。
      // 先记住目标比例并触发加载，loadedmetadata 到达后再落点。
      pendingRatio = ratio;
      if (audioEl && audioEl.readyState === 0) {
        try { audioEl.load(); } catch (err) {}
      }
    }

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
      syncProgress(player.state());
    }

    if (seekEl) {
      seekEl.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (dragging) endDrag(null, false); // 上一次抬手丢了，也不能让新的一次拖不动
        dragging = true;
        dragPointerId = e.pointerId;
        dragRect = seekEl.getBoundingClientRect(); // 快照轨道容器（不是 thumb）
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

    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        audioEl.muted = !audioEl.muted;
        syncMute();
      });
    }

    if (volEl) {
      volEl.addEventListener('input', function () {
        var v = Number(volEl.value) / 100;
        audioEl.volume = isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
        if (audioEl.volume > 0 && audioEl.muted) audioEl.muted = false;
        syncMute();
      });
    }

    // ---------------- 歌词（可选本地 .lrc） ----------------
    var lyricLines = [];
    var lyricIndex = -1;
    var lyricToken = 0;
    var lrcCache = Object.create(null);

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

    function renderLyrics(lines) {
      lyricLines = lines;
      lyricIndex = -1;
      lyricsScroll.innerHTML = '';
      if (!lines.length) {
        showLyricsMessage('纯音乐，请欣赏', '无歌词');
        return;
      }
      var frag = document.createDocumentFragment();
      lines.forEach(function (line) {
        var p = document.createElement('p');
        p.className = 'lyric-line';
        p.textContent = line.text;
        frag.appendChild(p);
      });
      lyricsScroll.appendChild(frag);
      lyricsScroll.scrollTop = 0;
      lyricsMeta.textContent = 'LRC · ' + lines.length + ' 行';
    }

    function loadLyrics(url) {
      var token = ++lyricToken;
      if (!url) {
        showLyricsMessage('纯音乐，请欣赏', '无 LRC');
        return;
      }
      if (lrcCache[url]) {
        renderLyrics(lrcCache[url]);
        return;
      }
      showLyricsMessage('歌词加载中…', '加载中');
      fetch(url, { credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.text();
        })
        .then(function (text) {
          if (token !== lyricToken) return;
          var lines = parseLrc(text);
          lrcCache[url] = lines;
          renderLyrics(lines);
        })
        .catch(function (err) {
          if (token !== lyricToken) return;
          console.warn('[music] 歌词加载失败', url, err);
          showLyricsMessage('歌词加载失败', '加载失败');
        });
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
      if (disc) disc.classList.toggle('is-playing', st.playing);
      if (idx !== currentIndex) {
        currentIndex = idx;
        var lrc = (track && track.lrc) || (items[idx] && items[idx].getAttribute('data-lrc')) || '';
        if (idx >= 0) loadLyrics(lrc);
        else showLyricsMessage('点击曲目开始播放，歌词会跟随高亮。', '—');
      }
      if (st.duration > 0) setActiveDuration(formatTime(st.duration));
      updateLyric(st.currentTime);
      syncToggle(st);
      syncProgress(st);
      syncMute();
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
