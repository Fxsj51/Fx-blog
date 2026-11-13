'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const lib = require('./lib');
const PORT = 9457;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'ft-' + Date.now()),
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
  await send('Page.navigate', { url: lib.baseUrl() + '/music/' });
  for (let i = 0; i < 150; i++) { if (await ev('document.querySelectorAll(".music-item").length > 0 && !!window.SitePlayer')) break; await sleep(100); }
  await sleep(1500);

  const snap = `(() => {
    const a = document.getElementById('music-audio');
    return {
      title: (document.querySelector('.music-item.is-active .music-item__title') || {}).textContent || null,
      dur: document.getElementById('music-dur').textContent,
      cur: document.getElementById('music-cur').textContent,
      audioDur: a ? Math.round(a.duration * 10) / 10 : null,
      paused: a ? a.paused : null
    };
  })()`;
  console.log('FORMAT ' + JSON.stringify(await ev(`({
    zero_default: SitePlayer.formatTime(0),
    zero_custom: SitePlayer.formatTime(0, '—'),
    nan_custom: SitePlayer.formatTime(NaN, '—'),
    none_custom: SitePlayer.formatTime(undefined, '—'),
    s65: SitePlayer.formatTime(65),
    s320: SitePlayer.formatTime(320.4),
    s599: SitePlayer.formatTime(599.9)
  })`)));
  console.log('TRACK1 ' + JSON.stringify(await ev(snap)));

  await ev(`(() => { const it = [...document.querySelectorAll('.music-item')].find((x) => /Billie Jean/.test(x.textContent)); it.click(); return true; })()`);
  for (let i = 0; i < 120; i++) { if (await ev('document.querySelectorAll("#music-lyrics-scroll .lyric-line").length > 0')) break; await sleep(100); }
  await sleep(600);
  console.log('TRACK2 ' + JSON.stringify(await ev(snap)));

  await ev(`(() => { document.querySelectorAll('.music-item')[0].click(); return true; })()`);
  await sleep(800);
  console.log('TRACK1B ' + JSON.stringify(await ev(snap)));
  console.log('MISC ' + JSON.stringify(await ev(`({ audio: document.querySelectorAll('audio').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`)));
  console.log('ERRS ' + JSON.stringify(errs));
  ws.close(); proc.kill();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
