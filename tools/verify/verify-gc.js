'use strict';
// GoatCounter 接入验证：拦截 count.js，stub 记录 count() 调用；再测被拦截时静默
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const URL_ = process.argv[2] || lib.baseUrl() + '/';
const PORT = 9445;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STUB = `window.goatcounter=window.goatcounter||{};window.goatcounter.no_onload=true;window.goatcounter.count=function(o){(window.__gcCalls=window.__gcCalls||[]).push(o&&o.path);};`;

async function run(mode) {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'gc-' + mode + '-' + Date.now()),
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
  ws.addEventListener('message', async (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails.text || '').split('\n')[0]);
    if (d.method === 'Fetch.requestPaused') {
      const rid = d.params.requestId;
      if (mode === 'block') {
        send('Fetch.failRequest', { requestId: rid, errorReason: 'BlockedByClient' }).catch(() => {});
      } else {
        send('Fetch.fulfillRequest', {
          requestId: rid, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
          body: Buffer.from(STUB).toString('base64')
        }).catch(() => {});
      }
    }
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*gc.zgo.at/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await sleep(1200);

  const click = async (href, label) => {
    const ok = await ev(`(() => {
      const a = [...document.querySelectorAll('a')].find((x) => x.offsetParent !== null && new URL(x.href, location.href).pathname === ${JSON.stringify(href)});
      if (!a) return false; a.click(); return true;
    })()`);
    await sleep(1400);
    const cur = await ev('location.pathname');
    console.log(mode + ' CLICK ' + label + ' target=' + href + ' clicked=' + ok + ' now=' + cur);
  };

  const initial = await ev('({ calls: window.__gcCalls ? window.__gcCalls.slice() : null, hasGc: !!(window.goatcounter && window.goatcounter.count), noOnload: window.goatcounter && window.goatcounter.no_onload })');
  console.log(mode + ' INITIAL ' + JSON.stringify(initial));
  await ev('window.__marker = 42');
  let navEvents = 0;
  await ev(`window.__navCount = 0; document.addEventListener('stellar:navigation-complete', function(){ window.__navCount++; }); true`);
  await click('/2026/11/04/hello-world/', 'article');
  await click('/music/', 'music');
  await click('/', 'home');
  await click('/', 'home-again');
  await ev('location.hash = "#test"');
  await sleep(600);
  const calls = await ev('({ calls: window.__gcCalls ? window.__gcCalls.slice() : null, marker: window.__marker || null, navCount: window.__navCount, audio: document.querySelectorAll("audio").length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, pathname: location.pathname, hash: location.hash })');
  // 375 检查
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(700);
  const small = await ev('({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, audio: document.querySelectorAll("audio").length })');
  console.log(mode + ' RESULT ' + JSON.stringify({ calls, small, errs }));
  ws.close(); proc.kill();
}

(async () => {
  await run('allow');
  await run('block');
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
