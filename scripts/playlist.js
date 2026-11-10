'use strict';

// 歌单唯一数据源：source/_data/playlist.yml。
// - 音乐页用 {% playlist %} 渲染卡片列表（授权/来源字段仍保留在数据里，不再展示）；
// - 全站单例播放器（source/js/site-player.js）通过构建期注入的 <script id="site-playlist"> 读取同一份数据；
// 不要再在模板或 JS 里另写一份曲目数组。

const { normalizeRoot } = require('./site-root');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 远程地址原样使用；本地相对路径统一补上站点根，兼容 GitHub Pages 子路径
function resolveUrl(value, root) {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : normalizeRoot(root) + String(value).replace(/^\/+/, '');
}

function getPlaylist() {
  const data = (hexo.locals.get('data') || {}).playlist;
  return Array.isArray(data) ? data : [];
}

function renderItem(track, index, root) {
  const audio = resolveUrl(track.audio, root);
  const cover = resolveUrl(track.cover || 'images/CP-disc.webp', root);
  // 可选：同目录歌词文件（.lrc），缺省时音乐页显示「纯音乐」占位
  const lrc = track.lrc ? resolveUrl(track.lrc, root) : '';
  const meta = [track.artist, track.source, track.year].filter(Boolean).join(' · ');
  const duration = track.duration || '—';
  return [
    `<li class="music-item" role="button" tabindex="0" data-src="${escapeAttr(audio)}" data-title="${escapeAttr(track.title)}" data-artist="${escapeAttr(track.artist || '')}" data-cover="${escapeAttr(cover)}" data-lrc="${escapeAttr(lrc)}">`,
    `  <img class="music-item__cover" src="${escapeAttr(cover)}" alt="" width="40" height="40" loading="lazy">`,
    `  <span class="music-item__no">${String(index + 1).padStart(2, '0')}</span>`,
    '  <span class="music-item__text">',
    `    <span class="music-item__title">${escapeHtml(track.title)}</span>`,
    `    <span class="music-item__artist">${escapeHtml(meta)}</span>`,
    '  </span>',
    `  <span class="music-item__dur">${escapeHtml(duration)}</span>`,
    '</li>'
  ].join('\n');
}

hexo.extend.tag.register('playlist', function() {
  const root = hexo.config.root;
  const items = getPlaylist();
  const rows = items.map((track, index) => renderItem(track, index, root)).join('\n');
  const list = items.length
    ? `<ul class="music-list" id="music-list">\n${rows}\n</ul>`
    : '<p class="music-empty">歌单暂未收录曲目。在 <code>source/_data/playlist.yml</code> 中登记即可。</p>';

  return [
    '<div class="music-list-card">',
    `  <div class="music-list__head"><span class="music-list__title">歌单</span><span class="music-list__count">${items.length} 首</span></div>`,
    list,
    '</div>'
  ].join('\n');
});

// 全站单例播放器需要同一份数据：构建期注入为 JSON，避免运行时再发一次请求。
// 所有页面（含音乐页）都注入，SPA 换页时 <head> 不重建，数据自然沿用。
hexo.extend.filter.register('after_render:html', function(str, data) {
  if (str.includes('id="site-playlist"')) return str;
  if (!str.includes('</head>')) return str;

  const root = hexo.config.root;
  const payload = getPlaylist().map((track) => ({
    title: track.title,
    artist: track.artist || '',
    url: resolveUrl(track.audio, root),
    cover: resolveUrl(track.cover || 'images/CP-disc.webp', root),
    lrc: track.lrc ? resolveUrl(track.lrc, root) : '',
    duration: track.duration || ''
  }));
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');

  return str.replace('</head>', `<script id="site-playlist" type="application/json">${json}</script></head>`);
});
