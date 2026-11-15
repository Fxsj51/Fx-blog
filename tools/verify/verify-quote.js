'use strict';
// 验证「一言」卡片：渲染、兜底、SPA、无横向溢出、截图（无头 Edge，不弹窗）
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/';
const PORT = 9436;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'quote-' + Date.now()),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find((t) => t.type === 'page');
      if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const m = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.text || '').split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await sleep(4200); // 等卡片空闲初始化 + 一言请求（3s 超时）

  const home = await ev(`(() => {
    const card = document.getElementById('my-custom-card');
    const box = document.getElementById('custom-quote');
    const item = box && box.querySelector('.quote-item');
    const text = item ? item.querySelector('.quote-text') : null;
    return {
      cardCount: document.querySelectorAll('#my-custom-card').length,
      quoteCount: box ? box.querySelectorAll('.quote-item').length : 0,
      text: text ? text.textContent.trim() : '',
      author: (box && box.querySelector('.quote-author') ? box.querySelector('.quote-author').textContent.trim() : ''),
      title: (card && card.querySelector('.history-title') ? card.querySelector('.history-title').textContent.trim() : ''),
      cardText: card ? card.textContent.replace(/\\s+/g, ' ').trim() : '',
      ariaLabel: box ? (box.getAttribute('aria-label') || '') : '',
      historyItems: document.querySelectorAll('.history-item, .history-year').length,
      placeholder: box ? box.textContent.trim() : '(no box)',
      audio: document.querySelectorAll('audio').length,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth
    };
  })()`);
  record('首页一言渲染', home.quoteCount === 1 && home.text.length > 0 && home.placeholder.indexOf('正在加载') < 0 && home.historyItems === 0, home);
  record('卡片唯一且只有一言（无标题文字）', home.cardCount === 1 && home.title === '' && home.cardText.indexOf('每日一言') < 0 && home.quoteCount === 1 && home.ariaLabel === '每日一言', home);
  record('无横向溢出(1440)', home.sw === home.cw, { sw: home.sw, cw: home.cw });
  record('全页 1 个 audio', home.audio === 1, { audio: home.audio });

  // 高度稳定性：短句/长句下卡片高度一致（min-height + 3 行截断）
  const heights = await ev(`(() => {
    const box = document.getElementById('custom-quote');
    if (!box) return null;
    const keep = box.innerHTML;
    const paint = (t, from) => '<div class="quote-item"><div class="quote-text"><span class="quote-mark">「</span>' + t + '<span class="quote-mark">」</span></div>' + (from ? '<div class="quote-author">—— ' + from + '</div>' : '') + '</div>';
    box.innerHTML = paint('短句。', '甲');
    const t1 = box.querySelector('.quote-text').getBoundingClientRect().height;
    const h1 = box.getBoundingClientRect().height;
    box.innerHTML = paint('这是一句很长很长的一言。'.repeat(20), '乙');
    const qt = box.querySelector('.quote-text');
    const t2 = qt.getBoundingClientRect().height;
    const cs = getComputedStyle(qt);
    const h2 = box.getBoundingClientRect().height;
    box.innerHTML = keep;
    return { h1: Math.round(h1), h2: Math.round(h2), t1: Math.round(t1), t2: Math.round(t2), lh: cs.lineHeight, fs: cs.fontSize, clamp: cs.webkitLineClamp, disp: cs.display, ov: cs.overflow };
  })()`);
  record('卡片高度稳定（长短句一致）', !!heights && Math.abs(heights.h1 - heights.h2) <= 1, heights);

  let png = await send('Page.captureScreenshot', { format: 'png' });
  const shot1440 = path.join(SHOTS, 'quote-1440.png');
  fs.writeFileSync(shot1440, Buffer.from(png.data, 'base64'));

  // SPA：首页 → 文章 → 首页
  await ev(`(() => { const a = document.querySelector('a[href*="hello-world"]'); if (a) a.click(); return !!a; })()`);
  for (let i = 0; i < 100; i++) { if (await ev('location.pathname.indexOf("hello-world") >= 0')) break; await sleep(100); }
  await sleep(800);
  const onPost = await ev(`({ path: location.pathname, audio: document.querySelectorAll('audio').length })`);
  const qroot = await ev(`window.__qroot = (() => { const a = document.querySelector('#leftbar-region a'); try { return new URL(a.href).pathname; } catch (e) { return '/'; } })()`);
  await ev(`(() => { const a = document.querySelector('#leftbar-region a'); if (a) a.click(); return !!a; })()`);
  for (let i = 0; i < 100; i++) { if (await ev('location.pathname === window.__qroot')) break; await sleep(100); }
  await sleep(4200);
  const back = await ev(`(() => {
    const box = document.getElementById('custom-quote');
    return {
      path: location.pathname,
      cardCount: document.querySelectorAll('#my-custom-card').length,
      quoteCount: box ? box.querySelectorAll('.quote-item').length : 0,
      text: box ? box.textContent.trim().slice(0, 60) : '',
      audio: document.querySelectorAll('audio').length
    };
  })()`);
  record('SPA 往返后卡片重建且不重复', back.path === qroot && back.cardCount === 1 && back.quoteCount === 1 && back.text.length > 0, { onPost, back });
  record('SPA 往返后 1 个 audio', back.audio === 1, { audio: back.audio });

  // 接口失败兜底：拦截 hitokoto 后重新加载
  await send('Network.setBlockedURLs', { urls: ['*://v1.hitokoto.cn/*'] });
  await send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await sleep(4500);
  const fb = await ev(`(() => {
    const box = document.getElementById('custom-quote');
    return { text: box ? box.textContent.trim() : '', items: box ? box.querySelectorAll('.quote-item').length : 0 };
  })()`);
  record('接口失败走内置兜底且不空', fb.items === 1 && fb.text.length > 0 && fb.text.indexOf('正在加载') < 0, fb);

  // 375 截图与溢出检查
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  const opened = await ev(`(() => { const b = document.getElementById('custom-rightbar-toggle'); if (!b) return 'no-toggle'; b.click(); return 'clicked'; })()`);
  await sleep(900);
  const small = await ev(`(() => {
    const R = (el) => el ? el.getBoundingClientRect() : null;
    const card = R(document.getElementById('my-custom-card'));
    const dr = R(document.getElementById('music-drawer'));
    const stack = R(document.querySelector('.widget-stack--rightbar'));
    // 卡片在右栏滚动容器内会被裁剪，可视底边取二者较小值
    const visibleBottom = card && stack ? Math.min(card.bottom, stack.bottom) : (card ? card.bottom : null);
    const ox = card && dr ? Math.max(0, Math.min(card.right, dr.right) - Math.max(card.left, dr.left)) : 0;
    const oy = visibleBottom != null && dr ? Math.max(0, Math.min(visibleBottom, dr.bottom) - Math.max(card.top, dr.top)) : 0;
    return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, card: !!card, cardBottom: card ? Math.round(card.bottom) : null, stackBottom: stack ? Math.round(stack.bottom) : null, drawerTop: dr ? Math.round(dr.top) : null, overlapArea: Math.round(ox * oy), stackClientH: stack ? Math.round(stack.height) : null, stackScrollH: (() => { const s = document.querySelector('.widget-stack--rightbar'); return s ? s.scrollHeight : null; })() };
  })()`);
  record('375 无横向溢出且不压音乐组件', small.sw === small.cw && small.card && small.overlapArea === 0, small);
  await ev('document.getElementById("custom-quote") && document.getElementById("custom-quote").scrollIntoView({block:"center"})');
  await sleep(400);
  png = await send('Page.captureScreenshot', { format: 'png' });
  const shot375 = path.join(SHOTS, 'quote-375.png');
  fs.writeFileSync(shot375, Buffer.from(png.data, 'base64'));

  record('无 JS 异常', errs.length === 0, { errs });

  const failed = results.filter((r) => !r.ok);
  console.log('SHOT ' + shot1440 + ' ' + (fs.statSync(shot1440).size / 1024).toFixed(0) + 'KB');
  console.log('SHOT ' + shot375 + ' ' + (fs.statSync(shot375).size / 1024).toFixed(0) + 'KB');
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
