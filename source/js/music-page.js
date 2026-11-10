(function () {
  'use strict';

  // 音乐页视图脚本：托管为常驻脚本，SPA 换页后 #main 被替换时按新 DOM 重新初始化。
  // 播放能力全部来自 SitePlayer（全站唯一 <audio>），本文件只负责音乐页视图与歌词。
  var boundList = null;
  var cleanup = null;

  function initMusicPage() {
    var list = document.getElementById('music-list');
    var player = window.SitePlayer;
    var disc = document.getElementById('music-disc');
    var discImg = document.getElementById('music-disc-img');
    var nowTitle = document.getElementById('music-now-title');
    var nowArtist = document.getElementById('music-now-artist');
    var lyricsMeta = document.getElementById('music-lyrics-meta');
    var lyricsScroll = document.getElementById('music-lyrics-scroll');

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
      if (type === 'time') { updateLyric(st.currentTime); return; }
      if (type === 'meta') {
        if (st.duration > 0) setActiveDuration(formatTime(st.duration));
        return;
      }
      render(st);
    });

    cleanup = function () {
      unsubscribe();
      lyricToken++;
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
