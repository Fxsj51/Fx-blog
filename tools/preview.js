'use strict';
/*
 * 本地预览静态服务器（支持 HTTP Range，供 <audio> seek 使用）
 * 用法：npm run preview [-- --port 4173]
 * 背景：hexo server 不返回 Accept-Ranges，音频 seekable 为零宽，拖动进度条会归 0。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const DEFAULT_PORT = 4173;

// 站点部署根（GitHub Pages 项目页为 /<repo>/）。产物里的绝对路径都带这个前缀，
// 本地预览按 public/ 直出，所以请求进来先剥掉它。前缀从 _config.yml 的 url 路径
// 部分推导，与 Hexo 自动派生 config.root 的口径一致；根路径部署时为 ''。
const SITE_ROOT = (() => {
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', '_config.yml'), 'utf8');
    const m = cfg.match(/^url:\s*['"]?https?:\/\/[^/'"\s]+(\/[^'"\s]*)?['"]?\s*$/m);
    if (m && m[1] && m[1] !== '/') return m[1].replace(/\/?$/, '/');
  } catch (e) {}
  return '';
})();

function argPort() {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') return Number(argv[i + 1]);
    const m = /^--port=(\d+)$/.exec(argv[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

const PORT = Number(argPort() || process.env.PORT || DEFAULT_PORT);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.map': 'application/json; charset=utf-8'
};

function typeOf(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// 只接受单段 bytes 范围；非法返回 null（调用方回 416）
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=([0-9]*)-([0-9]*)$/.exec(header.trim());
  if (!m) return false;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return false;
  let start;
  let end;
  if (!hasStart) {
    // 后缀写法 bytes=-N：取最后 N 字节
    const suffix = Number(m[2]);
    if (!suffix) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : size - 1;
  }
  if (!isFinite(start) || !isFinite(end)) return false;
  if (start > end || start >= size) return false;
  if (end >= size) end = size - 1;
  return { start, end };
}

function notFound(res) {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end('404 Not Found');
}

function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    return null; // 非法百分号编码
  }
  // 剥掉部署根前缀（/Fx-blog/... → /...）；裸站点根 /Fx-blog 与 / 都回首页
  if (SITE_ROOT) {
    if (rel === SITE_ROOT || rel === SITE_ROOT.slice(0, -1)) rel = '/';
    else if (rel.startsWith(SITE_ROOT)) rel = rel.slice(SITE_ROOT.length - 1);
  }
  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT)) return null; // 阻止目录穿越
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD' });
    res.end();
    return;
  }
  let file = resolveFile(req.url);
  if (!file) return notFound(res);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (e) {
    return notFound(res);
  }
  if (stat.isDirectory()) {
    file = path.join(file, 'index.html');
    try {
      stat = fs.statSync(file);
    } catch (e) {
      return notFound(res); // 目录没有 index.html 就是 404，不回退首页
    }
  }
  if (!stat.isFile()) return notFound(res);

  const size = stat.size;
  const mime = typeOf(file);
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  };

  const range = parseRange(req.headers.range, size);
  if (range === false) {
    res.writeHead(416, Object.assign(headers, { 'Content-Range': 'bytes */' + size }));
    res.end();
    return;
  }
  if (range) {
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + size;
    headers['Content-Length'] = range.end - range.start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  headers['Content-Length'] = size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address();
  console.log('[preview] serving ' + ROOT);
  console.log('[preview] http://' + addr.address + ':' + addr.port + '/');
});

server.on('error', (err) => {
  console.error('[preview] 启动失败：', err.message);
  process.exit(1);
});
