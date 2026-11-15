'use strict';
// 纯音乐歌词区滚轮锁滚验证
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/music/';
const PORT = 9454;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'wh-' + Date.now()),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,720', 'about:blank'], { stdio: 'ignore' });
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 150; i++) { if (await ev('document.querySelectorAll(".music-item").length > 0')) break; await sleep(100); }
  await sleep(800);

  const state = `(() => {
    const box = document.getElementById('music-lyrics-scroll');
    const empty = box.querySelector('.music-lyrics__empty');
    const br = box.getBoundingClientRect();
    return {
      track: (document.querySelector('.music-item.is-active') || {}).textContent || null,
      cls: box.className, ov: getComputedStyle(box).overflowY, ob: getComputedStyle(box).overscrollBehaviorY,
      scrollTop: Math.round(box.scrollTop), scrollH: box.scrollHeight, clientH: box.clientHeight,
      emptyTopRel: empty ? Math.round(empty.getBoundingClientRect().top - br.top) : null,
      winScrollY: Math.round(scrollY), maxScroll: Math.round(document.documentElement.scrollHeight - innerHeight),
      lyricsCenter: { x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) }
    };
  })()`;

  async function wheel(times) {
    const c = (await ev(state)).lyricsCenter;
    for (let i = 0; i < times; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: 320, modifiers: 0 });
      await sleep(250);
    }
    await sleep(300);
  }

  console.log('A start ' + JSON.stringify(await ev(state)));
  await wheel(5);
  console.log('A wheel5 ' + JSON.stringify(await ev(state)));
  const png = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(lib.outDir(), 'lyrics-wheel-pure.png'), Buffer.from(png.data, 'base64'));

  // Billie Jean：有歌词，滚轮应可滚
  await ev(`(() => { const it = [...document.querySelectorAll('.music-item')].find((x) => /Billie Jean/.test(x.textContent)); it.click(); return true; })()`);
  for (let i = 0; i < 120; i++) { if (await ev('document.querySelectorAll("#music-lyrics-scroll .lyric-line").length > 0')) break; await sleep(100); }
  await sleep(500);
  const b0 = await ev(state);
  await wheel(3);
  const b1 = await ev(state);
  console.log('B before ' + JSON.stringify(b0));
  console.log('B wheel3 ' + JSON.stringify(b1));

  // 自动跟随：seek 到 42s
  await ev(`(() => { const a = document.getElementById('music-audio'); a.currentTime = 42; return true; })()`);
  await sleep(900);
  console.log('B seek42 ' + JSON.stringify(await ev(state)));

  // 切回第一首：scrollTop 归零、滚轮锁住
  await ev(`(() => { const it = document.querySelectorAll('.music-item')[0]; it.click(); return true; })()`);
  await sleep(900);
  console.log('C back ' + JSON.stringify(await ev(state)));
  await wheel(4);
  console.log('C wheel4 ' + JSON.stringify(await ev(state)));

  // SPA 往返（root 感知：首页 = 左栏品牌链接；音乐页 = pathname 后缀匹配）
  await ev(`(() => { const a = document.querySelector('#leftbar-region a'); if (a) a.click(); return !!a; })()`);
  await sleep(1500);
  const home = await ev('({ path: location.pathname, audio: document.querySelectorAll("audio").length })');
  await ev(`(() => { const a = [...document.querySelectorAll('a')].find((x) => new URL(x.href, location.href).pathname.endsWith('/music/')); if (a) a.click(); return !!a; })()`);
  await sleep(1800);
  const back = await ev(`(() => { const box = document.getElementById('music-lyrics-scroll'); return { path: location.pathname, audio: document.querySelectorAll('audio').length, cls: box ? box.className : null, scrollTop: box ? Math.round(box.scrollTop) : null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; })()`);
  console.log('SPA ' + JSON.stringify({ home, back }));
  console.log('ERRS ' + JSON.stringify(errs));
  ws.close(); proc.kill();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
