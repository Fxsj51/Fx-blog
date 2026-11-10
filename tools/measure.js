'use strict';

// 首屏体积测量：固定口径，避免再出现互相矛盾的数字。
//
// 统计对象：public/index.html 及其同源静态引用（第三方 CDN 不计）。
// 两个必须区分开的指标：
//   1. 首屏传输 —— 浏览器首屏真正会下的文件，按宽度档位分流后取 gzip 字节：
//      HTML + 全部 CSS + 全部 <script src> + 按 media 命中的预加载背景图 + 非懒加载 <img>。
//      桌面档取 media="(min-width: 901px)" 的图，移动档取 media="(max-width: 900px)" 的图。
//   2. 整页原始字节 —— HTML + 所有同源静态引用（含 loading="lazy" 图片与两个背景图变体）的未压缩字节。
//
// gzip 用 zlib.gzipSync 默认参数对整文件压缩，是"可复现的下限估算"，
// 不等于服务器 brotli 后的真实传输量；webp 已压缩，gzip 基本无效，故图片只报原始字节。
//
// 用法：npm run measure  （需要先 npm run build 产出 public/）

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PAGE = 'index.html';
const DESKTOP_MEDIA = '(min-width: 901px)';
const MOBILE_MEDIA = '(max-width: 900px)';

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function gzip(bytes) {
  return zlib.gzipSync(bytes).length;
}

function tags(html, name) {
  return html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];
}

function attr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag);
  return m ? m[1] : null;
}

// 把 HTML 里的路径映射到本地文件；返回 { file, bytes } 或 null（外链/不存在）
function resolve(url) {
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || /^(data:|mailto:|javascript:|#)/i.test(url)) return null;
  const clean = url.split('?')[0].split('#')[0].replace(/^\/+/, '');
  const candidates = [clean];
  const rootMatch = /^([^/]+)\//.exec(clean);
  if (rootMatch) candidates.push(clean.slice(rootMatch[0].length));
  for (const rel of candidates) {
    const file = path.join(PUB, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return { rel, file, bytes: fs.statSync(file).size };
    }
  }
  return null;
}

function profileOf(media) {
  if (!media) return 'both';
  const hasDesktop = media.includes(DESKTOP_MEDIA);
  const hasMobile = media.includes(MOBILE_MEDIA);
  if (hasDesktop && !hasMobile) return 'desktop';
  if (hasMobile && !hasDesktop) return 'mobile';
  return 'both';
}

function collect(html) {
  const css = [];
  const js = [];
  const firstPaintImages = [];
  const lazyImages = [];
  const others = [];

  for (const tag of tags(html, 'link')) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const file = resolve(attr(tag, 'href'));
    if (rel.includes('stylesheet')) {
      if (file) css.push(file);
    } else if (rel === 'preload' && (attr(tag, 'as') || '') === 'image') {
      if (file) firstPaintImages.push({ ...file, profile: profileOf(attr(tag, 'media')) });
    } else if (file) {
      others.push(file);
    }
  }

  for (const tag of tags(html, 'script')) {
    const f = resolve(attr(tag, 'src'));
    if (f) js.push(f);
  }

  for (const tag of tags(html, 'img')) {
    const f = resolve(attr(tag, 'src'));
    if (!f) continue;
    if ((attr(tag, 'loading') || '').toLowerCase() === 'lazy') lazyImages.push(f);
    else firstPaintImages.push({ ...f, profile: 'both' });
  }

  return { css, js, firstPaintImages, lazyImages, others };
}

function uniq(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.rel)) return false;
    seen.add(item.rel);
    return true;
  });
}

function rows(label, list) {
  const uniqList = uniq(list);
  const raw = uniqList.reduce((sum, f) => sum + f.bytes, 0);
  const gz = uniqList.reduce((sum, f) => sum + gzip(fs.readFileSync(f.file)), 0);
  console.log('  ' + label + '：' + uniqList.length + ' 个，' + kb(raw) + ' 原始 / ' + kb(gz) + ' gzip');
  return { raw, gz };
}

function main() {
  const pageFile = path.join(PUB, PAGE);
  if (!fs.existsSync(pageFile)) {
    console.error('public/index.html 不存在，请先运行 npm run build');
    process.exit(1);
  }

  const htmlBuf = fs.readFileSync(pageFile);
  const html = htmlBuf.toString('utf8');
  const htmlBytes = { raw: htmlBuf.length, gz: gzip(htmlBuf) };
  const { css, js, firstPaintImages, lazyImages, others } = collect(html);

  // preload 的 css/js 会与 stylesheet/script 重复出现，统一按 rel 去重，避免整页统计重复计
  const counted = new Set([...css, ...js, ...firstPaintImages, ...lazyImages].map((f) => f.rel));
  const extra = others.filter((f) => !counted.has(f.rel));

  console.log('测量对象: public/' + PAGE + '（' + kb(htmlBytes.raw) + ' 原始 / ' + kb(htmlBytes.gz) + ' gzip）');
  console.log('口径: 仅同源静态文件，不含第三方 CDN；gzip = zlib.gzipSync 整文件压缩');
  console.log('      分类明细里图片只报原始字节；首屏合计的 gzip 按实际传输计入图片（webp 不可压缩，两者几乎相同）\n');

  console.log('分类明细');
  console.log('  HTML：1 个，' + kb(htmlBytes.raw) + ' 原始 / ' + kb(htmlBytes.gz) + ' gzip');
  const cssSum = rows('CSS', css);
  const jsSum = rows('JS', js);

  const profiles = ['desktop', 'mobile'];
  const labels = { desktop: '桌面(>900px)', mobile: '移动(≤900px)' };

  // 首屏图片按档位分流（"both" 两档都算）
  const perProfile = {};
  for (const p of profiles) {
    const imgs = uniq(firstPaintImages.filter((f) => f.profile === 'both' || f.profile === p));
    perProfile[p] = {
      images: imgs,
      imageRaw: imgs.reduce((sum, f) => sum + f.bytes, 0),
      firstRaw: htmlBytes.raw + cssSum.raw + jsSum.raw + imgs.reduce((sum, f) => sum + f.bytes, 0),
      firstGz: htmlBytes.gz + cssSum.gz + jsSum.gz + imgs.reduce((sum, f) => sum + gzip(fs.readFileSync(f.file)), 0)
    };
  }

  console.log('  首屏图片：桌面 ' + perProfile.desktop.images.length + ' 个 / ' + kb(perProfile.desktop.imageRaw) +
    '，移动 ' + perProfile.mobile.images.length + ' 个 / ' + kb(perProfile.mobile.imageRaw));
  for (const f of uniq(firstPaintImages)) {
    console.log('    · ' + f.rel + '  ' + kb(f.bytes) + '  [' + f.profile + ']');
  }
  if (lazyImages.length) {
    console.log('  懒加载图片：' + uniq(lazyImages).length + ' 个 / ' + kb(uniq(lazyImages).reduce((s, f) => s + f.bytes, 0)) + '（不计入首屏）');
  }
  if (extra.length) {
    console.log('  其它引用：' + uniq(extra).length + ' 个 / ' + kb(uniq(extra).reduce((s, f) => s + f.bytes, 0)) + '（进整页统计，不进首屏）');
    for (const f of uniq(extra)) console.log('    · ' + f.rel + '  ' + kb(f.bytes));
  }

  const wholeRaw = htmlBytes.raw + uniq(css).reduce((s, f) => s + f.bytes, 0) +
    uniq(js).reduce((s, f) => s + f.bytes, 0) +
    uniq([...firstPaintImages, ...lazyImages, ...extra]).reduce((s, f) => s + f.bytes, 0);

  console.log('\n按档位');
  for (const p of profiles) {
    console.log('  ' + labels[p] + '：首屏 gzip ' + kb(perProfile[p].firstGz) + '，首屏原始 ' + kb(perProfile[p].firstRaw));
  }
  console.log('\n整页原始字节（含两个背景图变体与懒加载图片，与档位无关）: ' + kb(wholeRaw));
}

main();
