'use strict';
// >1180 右栏整页滚动验证
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const URL_ = process.argv[2] || lib.baseUrl() + '/';
const PORT = 9451;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'flow-' + Date.now()),
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
  let id = 0; const m = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.text || '').split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) { if (await ev('document.getElementById("my-custom-card")')) break; await sleep(100); }
  for (let i = 0; i < 200; i++) {
    if (await ev('document.querySelectorAll("#custom-lunar-calendar .custom-cal-cell").length > 0')) break;
    await sleep(150);
  }
  await sleep(500);

  const probe = `(() => {
    const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
    const cs = (el) => el ? getComputedStyle(el) : null;
    const region = document.getElementById('rightbar-region');
    const stack = document.querySelector('.widget-stack--rightbar');
    const card = document.getElementById('my-custom-card');
    const mini = document.getElementById('music-drawer');
    const lb = document.getElementById('leftbar-region');
    const main = document.querySelector('#main');
    return {
      vh: innerHeight, scrollY: Math.round(scrollY), maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
      docH: document.documentElement.scrollHeight,
      region: region ? { ...R(region), pos: cs(region).position, height: cs(region).height, padB: cs(region).paddingBottom } : null,
      stack: stack ? { ...R(stack), maxH: cs(stack).maxHeight, ov: cs(stack).overflowY, clientH: stack.clientHeight, scrollH: stack.scrollHeight } : null,
      card: card ? { ...R(card), maxH: cs(card).maxHeight, ov: cs(card).overflowY, radius: cs(card).borderRadius, clientH: card.clientHeight, scrollH: card.scrollHeight } : null,
      mini: R(mini),
      gap: card && mini ? Math.round(mini.getBoundingClientRect().top - card.getBoundingClientRect().bottom) : null,
      cardFullyVisible: card ? (card.getBoundingClientRect().bottom <= innerHeight && card.getBoundingClientRect().top >= 0) : null,
      leftbar: lb ? R(lb) : null, main: main ? { left: Math.round(main.getBoundingClientRect().left), width: Math.round(main.getBoundingClientRect().width) } : null,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth
    };
  })()`;

  for (const [w, h] of [[1440, 900], [1440, 800], [1440, 720], [1440, 640]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await ev('window.scrollTo(0, 0)');
    await sleep(600);
    console.log('TOP ' + w + 'x' + h + ' ' + JSON.stringify(await ev(probe)));
    if (h === 900) {
      const png = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(lib.outDir(), 'flow-1440x900-top.png'), Buffer.from(png.data, 'base64'));
    }
    await ev('window.scrollTo(0, document.documentElement.scrollHeight)');
    await sleep(500);
    console.log('BOT ' + w + 'x' + h + ' ' + JSON.stringify(await ev(probe)));
    if (h === 720) {
      const png = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(lib.outDir(), 'flow-1440x720-bottom.png'), Buffer.from(png.data, 'base64'));
    }
  }

  // 1181 / 1180 行为
  await send('Emulation.setDeviceMetricsOverride', { width: 1181, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev('window.scrollTo(0, 0)');
  await sleep(700);
  console.log('1181 ' + JSON.stringify(await ev(probe)));
  await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  console.log('1180 ' + JSON.stringify(await ev(probe)));

  // 375 抽屉仍内滚
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  await ev(`(() => { const b = document.getElementById('custom-rightbar-toggle'); if (b) b.click(); return !!b; })()`);
  await sleep(900);
  await ev(`(() => { const c = document.getElementById('my-custom-card'); c.scrollTop = c.scrollHeight; return true; })()`);
  await sleep(300);
  console.log('375 ' + JSON.stringify(await ev(probe)));
  console.log('ERRS ' + JSON.stringify(errs));
  ws.close(); proc.kill();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
