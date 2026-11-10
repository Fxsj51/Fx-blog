---
title: 音乐
layout: page
rightbar:
  enabled: false
---

<div class="music-page">
  <div class="music-now">
    <div class="music-now__disc" id="music-disc">
      <img src="../images/CP-disc.webp" alt="唱片" id="music-disc-img" width="120" height="120">
    </div>
    <div class="music-now__info">
      <p class="music-now__label">当前曲目</p>
      <h2 class="music-now__title" id="music-now-title">未选择曲目</h2>
      <p class="music-now__artist" id="music-now-artist">点击下方任意曲目开始播放</p>
      <audio id="music-audio" preload="none"></audio>
      <div class="music-ctl">
        <button type="button" class="music-ctl__icon" id="music-toggle" aria-label="播放">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 5l12 7-12 7z"/></svg>
        </button>
        <span class="music-ctl__time" id="music-cur">0:00</span>
        <div class="music-seek" id="music-seek" role="slider" tabindex="0" aria-label="播放进度"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0:00 / 0:00">
          <div class="music-seek__track"><div class="music-seek__played" id="music-played"></div></div>
          <span class="music-seek__thumb" id="music-thumb"></span>
        </div>
        <span class="music-ctl__time" id="music-dur">0:00</span>
        <button type="button" class="music-ctl__icon" id="music-mute" aria-label="静音">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 9h3.5L12 5.5v13L7.5 15H4z"/><path fill="currentColor" d="M15.2 8.8l1.3-1.3 2.2 2.2 2.2-2.2 1.3 1.3-2.2 2.2 2.2 2.2-1.3 1.3-2.2-2.2-2.2 2.2-1.3-1.3 2.2-2.2z"/></svg>
        </button>
        <input type="range" class="music-ctl__vol" id="music-vol" min="0" max="100" step="1" value="100" aria-label="音量">
      </div>
    </div>
  </div>

  <div class="music-body">
    <div class="music-body__main">
      {% playlist %}
      <p class="music-hint">本页不预加载音频，点击曲目后才开始缓冲；首次播放时显示实际时长。</p>
    </div>
  </div>
  <div class="music-lyrics-dock">
    <aside class="music-lyrics" id="music-lyrics" aria-label="歌词">
      <div class="music-lyrics__head">
        <span>歌词</span>
        <span class="music-lyrics__meta" id="music-lyrics-meta">—</span>
      </div>
      <div class="music-lyrics__scroll" id="music-lyrics-scroll">
        <p class="music-lyrics__empty">点击曲目开始播放，歌词会跟随高亮。</p>
      </div>
    </aside>
  </div>
</div>

<style>
.music-page {
  display: flex; flex-direction: column; gap: 16px;
  /* 卡片表面：沿用主题按明暗主题生成的半透明底色（暗色主题为黑 50%），叠在高亮壁纸上仍能看清字 */
  --music-card-bg: var(--bg-a50, rgba(20, 20, 20, .5));
  --music-card-border: rgba(127, 127, 127, .22);
  --music-card-blur: blur(18px) saturate(1.05);
}
.music-now {
  display: flex; align-items: center; gap: 20px;
  padding: 20px; border-radius: 16px;
  background: var(--music-card-bg);
  border: 1px solid var(--music-card-border);
  -webkit-backdrop-filter: var(--music-card-blur);
  backdrop-filter: var(--music-card-blur);
}
.music-now__disc { flex: 0 0 auto; width: 120px; height: 120px; border-radius: 50%; overflow: hidden; animation: music-rotate 20s linear infinite; animation-play-state: paused; }
.music-now__disc.is-playing { animation-play-state: running; }
.music-now__disc img { width: 100%; height: 100%; object-fit: cover; display: block; }
.music-now__info { flex: 1 1 auto; min-width: 0; }
.music-now__label { margin: 0 0 4px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
.music-now__title { margin: 0; font-size: 20px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-now__artist { margin: 4px 0 12px; font-size: 13px; opacity: .7; }
/* 音频节点只作为播放引擎，界面由下方自绘控件承载（原生控件时间轴过细、无法拖动） */
#music-audio { display: none; }
.music-ctl { display: flex; align-items: center; gap: 10px; max-width: 460px; }
.music-ctl__icon {
  flex: 0 0 auto; width: 34px; height: 34px; padding: 0;
  display: grid; place-items: center;
  border: 1px solid var(--music-card-border); border-radius: 50%;
  background: rgba(127, 127, 127, .12); color: inherit; cursor: pointer;
}
.music-ctl__icon:hover { background: rgba(127, 127, 127, .22); }
.music-ctl__icon:focus-visible, .music-seek:focus-visible { outline: 2px solid #1DB954; outline-offset: 2px; }
.music-ctl__icon.is-muted { opacity: .45; }
.music-ctl__time { flex: 0 0 auto; font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; }
.music-seek {
  position: relative; flex: 1 1 auto; min-width: 80px; height: 22px;
  display: flex; align-items: center; cursor: pointer; touch-action: none;
}
.music-seek__track { width: 100%; height: 4px; border-radius: 2px; background: rgba(127, 127, 127, .34); }
.music-seek__played { width: 0; height: 100%; border-radius: 2px; background: #1DB954; }
.music-seek__thumb {
  position: absolute; top: 50%; left: 0; width: 12px; height: 12px; margin: -6px 0 0 -6px;
  border-radius: 50%; background: #1DB954; box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
  pointer-events: none; transition: transform .12s ease;
}
.music-seek.is-dragging .music-seek__thumb { transform: scale(1.2); }
.music-ctl__vol { flex: 0 0 72px; width: 72px; accent-color: #1DB954; }
.music-list-card { border-radius: 16px; background: var(--music-card-bg); border: 1px solid var(--music-card-border); overflow: hidden; -webkit-backdrop-filter: var(--music-card-blur); backdrop-filter: var(--music-card-blur); }
.music-list__head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid rgba(127, 127, 127, 0.16); font-weight: 600; }
.music-list__count { font-size: 12px; font-weight: 400; opacity: .6; }
.music-list { list-style: none; margin: 0; padding: 6px; }
.music-empty { margin: 0; padding: 18px 20px; font-size: 13px; opacity: .7; }
.music-item {
  display: grid; grid-template-columns: 40px 28px 1fr auto; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 10px; cursor: pointer;
  transition: background .2s, color .2s;
}
.music-item:hover, .music-item:focus-visible { background: rgba(127, 127, 127, 0.14); outline: none; }
.music-item.is-active { background: rgba(29, 185, 84, 0.14); box-shadow: inset 2px 0 0 #1DB954; }
.music-item__cover { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; display: block; background: rgba(127, 127, 127, 0.12); }
.music-item__no { font-size: 12px; opacity: .55; font-variant-numeric: tabular-nums; }
.music-item__text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.music-item__title { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-item__artist { font-size: 12px; opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-item__dur { font-size: 12px; opacity: .6; font-variant-numeric: tabular-nums; }
/* 提示文字直接压在背景图上，比卡片内的正文更需要对比度：提亮并加一层极淡的暗色投影。
   选择器加 .music-page 前缀，压过主题 `.md-text p` 的段落上边距，避免与 flex gap 叠成 32px */
.music-page .music-hint { margin: 0; font-size: 12px; opacity: .9; text-shadow: 0 1px 3px rgba(0, 0, 0, .55); }
.music-body { display: block; min-width: 0; }
.music-body__main { min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.music-lyrics-dock { min-width: 0; }
.music-lyrics {
  display: flex; flex-direction: column;
  height: 452px;
  position: sticky; top: 16px;
  border-radius: 16px;
  background: var(--music-card-bg);
  border: 1px solid var(--music-card-border);
  -webkit-backdrop-filter: var(--music-card-blur);
  backdrop-filter: var(--music-card-blur);
  overflow: hidden;
}
.music-lyrics__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(127, 127, 127, 0.16); font-size: 13px; font-weight: 600; }
.music-lyrics__meta { font-size: 11px; font-weight: 400; opacity: .55; }
.music-lyrics__scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 16px;
  scrollbar-width: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
  mask-image: linear-gradient(to bottom, transparent 0, #000 26px, #000 calc(100% - 26px), transparent 100%);
}
.music-lyrics__scroll::-webkit-scrollbar { display: none; }
.music-lyrics__empty { margin: 0; min-height: 100%; display: grid; place-items: center; padding: 0 8px; text-align: center; font-size: 13px; line-height: 1.7; opacity: .6; }
.lyric-line { margin: 0; padding: 7px 0 7px 12px; border-left: 2px solid transparent; border-radius: 0 8px 8px 0; font-size: 14px; line-height: 1.55; opacity: .42; transition: opacity .25s, background .25s, border-color .25s; }
.lyric-line.is-past { opacity: .26; }
.lyric-line.is-current { opacity: 1; font-weight: 600; border-left-color: #1DB954; background: rgba(29, 185, 84, 0.1); }
@keyframes music-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
/*
 * 断点同源：本文件的 1180/1181 与 _config.stellar.yml 注入 CSS 的抽屉断点一致，
 * 改动需同步；scripts/breakpoints.js 在构建期校验，不一致会构建失败。
 *
 * 三段式布局（断点均在视口宽度上判定）：
 * ≤1180      堆叠：当前曲卡片 / 歌单 / 歌词（.music-page 基础 flex 列）。
 * 1181–1599  当前曲卡片通栏，下方「歌单 + 300px 歌词栏」两列。
 * ≥1600      并排：左列「当前曲卡片 + 歌单」（888px），右列歌词（300px），
 *            歌词顶部与当前曲卡片顶部齐平，右缘与首页右栏右缘重合。
 *
 * 右缘对齐依据（无头 Edge，滚动条 8px）：
 *   首页右栏右缘 = 视口内容宽 - nd-off；本页内容左缘 = nd-off + 340 + 56，宽 888。
 *   故需从主栏右缘继续右移 100vw - sbw - 2*nd-off - 1284，由 --nd-off / --sbw 纯 CSS 得出。
 * 实测：1920 窗口首页右栏 1421–1801，歌词 1501–1801；2560 窗口 1741–2121 / 1821–2121。
 */
@media (min-width: 1181px) {
  /* 这些父级原本 overflow:hidden/auto，会把视口滚动容器换成它们自己，导致 sticky 不跟随页面；
     本页放开为 visible（横向由 html 的 overflow-x:hidden 兜底），仅音乐页生效。 */
  .site-workspace:has(.music-page),
  main.site-main:has(.music-page),
  .md-text:has(.music-page),
  body:has(.music-page) { overflow: visible !important; }
  .music-page { display: grid; grid-template-rows: auto auto; column-gap: 0; }
  .music-body__main { width: 100%; }
}
/* 1181–1599：当前曲卡片通栏，歌单与歌词在下一行分两列 */
@media (min-width: 1181px) and (max-width: 1599px) {
  .music-page { grid-template-columns: minmax(0, 1fr) 16px 300px; }
  .music-now { grid-column: 1 / -1; grid-row: 1; }
  .music-body { grid-column: 1; grid-row: 2; }
  .music-lyrics-dock { grid-column: 3; grid-row: 2; }
  .music-lyrics { position: static; height: 452px; }
}
/* ≥1600：左列卡片 + 右列歌词并排，歌词顶部与当前曲卡片齐平、右缘对齐首页右栏 */
@media (min-width: 1600px) {
  /* 选择器需压过主题 .md-text>div { margin: var(--gap-p) 0 }（特异度 0,1,1），否则负边距被清 0 */
  .md-text > .music-page {
    grid-template-columns: minmax(0, 888px) minmax(0, 1fr) 300px;
    margin-right: calc(1284px + 2 * var(--nd-off, 0px) + var(--sbw, 8px) - 100vw);
  }
  .music-now { grid-column: 1; grid-row: 1; }
  .music-body { grid-column: 1; grid-row: 2; }
  .music-lyrics-dock { grid-column: 3; grid-row: 1 / span 2; width: 300px; }
  .music-lyrics { position: sticky; top: 16px; height: 452px; }
}
@media (max-width: 1180px) {
  .music-lyrics { position: static; height: 300px; }
}
@media (max-width: 600px) {
  .music-now { flex-direction: column; align-items: flex-start; }
  .music-now__disc { width: 88px; height: 88px; }
  .music-now__title { font-size: 17px; }
  .music-ctl { flex-wrap: wrap; gap: 8px; }
  /* 窄屏一行放不下：按钮/时间排第一行，进度条独占第二行，保证可拖面积 */
  #music-toggle { order: 1; }
  #music-cur { order: 2; }
  #music-dur { order: 3; }
  #music-mute { order: 4; }
  #music-seek { order: 5; flex: 1 0 100%; }
  .music-ctl__vol { display: none; }
  .music-item { grid-template-columns: 34px 24px 1fr auto; padding: 10px 8px; }
  .music-item__cover { width: 34px; height: 34px; }
}
@media (prefers-reduced-motion: reduce) {
  /* 未播放时停住唱片；播放中的旋转是用户主动触发的反馈，保留 */
  .music-now__disc:not(.is-playing) { animation-play-state: paused; }
}
</style>
