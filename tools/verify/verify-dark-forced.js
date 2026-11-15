'use strict';
/* 验证：模拟 prefers-color-scheme: light（微信等 App 内置浏览器场景），
 * 断言站点仍按深色渲染：data-theme=dark、color-scheme、body/正文/分享栏文字为浅色，截图存档。 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/';
const PORT = 9445;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

const colorProbe = `(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    let c = cs.color;
    let node = el;
    while ((c === 'rgba(0, 0, 0, 0)' || !c || c === 'transparent') && node.parentElement) {
      node = node.parentElement;
      c = getComputedStyle(node).color;
    }
    return c;
  };
  const lum = (str) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(str || '');
    if (!m) return null;
    const [r, g, b] = [+m[1], +m[2], +m[3]].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    bodyColor: getComputedStyle(document.body).color,
    bodyLum: lum(getComputedStyle(document.body).color),
    articleColor: pick('.md-text .article-title') || pick('.md-text p'),
    shareColor: pick('.article-share .social-wrap a.share-item'),
    shareLabelColor: pick('.article-share .body'),
    textPrimaryVar: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    themeColorMetas: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(function (m) { return m.getAttribute('content'); })
  };
})()`;

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'dark-' + Date.now()),
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
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const m = new Map();
  const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await send('Page.enable'); await send('Runtime.enable');
  // 关键：模拟「不报深色偏好」的浅色系统（微信内置浏览器场景）
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await sleep(2500);
  const home = await ev(colorProbe);
  record('首页：data-theme=dark', home.dataTheme === 'dark', home.dataTheme);
  record('首页：color-scheme=dark', home.colorScheme === 'dark', home.colorScheme);
  record('首页：body 基色为浅色（亮度>0.5）', home.bodyLum != null && home.bodyLum > 0.5, { bodyColor: home.bodyColor, lum: home.bodyLum });
  record('首页：--text-primary 已并入主题 token', home.textPrimaryVar.indexOf('#ffffff') !== 0, home.textPrimaryVar);
  record('首页：html 深色底', /hsla?\(|rgba?\(/.test(home.htmlBg) && !/0%,\s*9[78]/.test(home.htmlBg), home.htmlBg);
  record('首页：theme-color 收敛为唯一深色值', home.themeColorMetas.length === 1 && home.themeColorMetas[0] === '#1c1613', home.themeColorMetas);
  let png = await send('Page.captureScreenshot', { format: 'png' });
  const shotHome = path.join(SHOTS, 'dark-home-lightpref.png');
  fs.writeFileSync(shotHome, Buffer.from(png.data, 'base64'));

  await ev(`(() => { const a = document.querySelector('a[href*="hello-world"]'); if (a) a.click(); return !!a; })()`);
  for (let i = 0; i < 100; i++) { if (await ev('location.pathname.indexOf("hello-world") >= 0')) break; await sleep(100); }
  await sleep(2000);
  const post = await ev(colorProbe);
  record('文章页：data-theme 保持 dark', post.dataTheme === 'dark', post.dataTheme);
  const lumOk = (v) => v != null && v > 0.5;
  const lumi = (s) => { const m2 = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); if (!m2) return null; const ch = [+m2[1], +m2[2], +m2[3]].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
  record('文章页：正文文字为浅色', lumOk(lumi(post.articleColor)), { color: post.articleColor });
  record('文章页：分享栏文字为浅色（原 1.27:1 黑字问题）', lumOk(lumi(post.shareColor)) && lumOk(lumi(post.shareLabelColor)), { shareColor: post.shareColor, shareLabelColor: post.shareLabelColor });
  png = await send('Page.captureScreenshot', { format: 'png' });
  const shotPost = path.join(SHOTS, 'dark-post-lightpref.png');
  fs.writeFileSync(shotPost, Buffer.from(png.data, 'base64'));

  // SPA 往返一次，确认属性保持且无异常（首页入口 = 左栏品牌链接，root 感知）
  await ev(`(() => { const a = document.querySelector('#leftbar-region a'); if (a) a.click(); return !!a; })()`);
  for (let i = 0; i < 100; i++) { if (await ev('location.pathname.indexOf("hello-world") < 0')) break; await sleep(100); }
  await sleep(1500);
  const back = await ev(`document.documentElement.getAttribute('data-theme')`);
  record('SPA 往返后 data-theme 保持 dark', back === 'dark', back);
  record('全程无 JS 异常', errs.length === 0, { errs: errs.slice(0, 3) });

  console.log('SHOT ' + shotHome + ' ' + (fs.statSync(shotHome).size / 1024).toFixed(0) + 'KB');
  console.log('SHOT ' + shotPost + ' ' + (fs.statSync(shotPost).size / 1024).toFixed(0) + 'KB');
  const failed = results.filter((r) => !r.ok);
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
