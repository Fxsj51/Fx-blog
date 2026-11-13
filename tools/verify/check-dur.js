'use strict';
// 歌词区两种状态下的时长文案：无 LRC（14.3 Billion Years）与有 LRC（Billie Jean）
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const lib = require('./lib');
const PORT = 9571;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'dur-' + Date.now()),
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
  for (let i = 0; i < 150; i++) { if (await ev('!!document.getElementById("music-list")')) break; await sleep(100); }
  await sleep(1500);

  const all = await ev(`Array.from(document.querySelectorAll('#music-list .music-item')).map(function(it){return {title:(it.querySelector('.music-item__title')||{}).textContent, dur:(it.querySelector('.music-item__dur')||{}).textContent};})`);
  console.log('LIST ' + JSON.stringify(all));

  async function pick(name) {
    await ev(`(function(){var its=document.querySelectorAll('#music-list .music-item');for(var i=0;i<its.length;i++){if((its[i].querySelector('.music-item__title')||{}).textContent===${JSON.stringify(name)}){its[i].click();return true;}}return false;})()`);
    await sleep(1200);
    return await ev(`({title:(document.getElementById('music-now-title')||{}).textContent,meta:(document.getElementById('music-lyrics-meta')||{}).textContent,dur:(document.querySelector('.music-item.is-active .music-item__dur')||{}).textContent,cur:(document.getElementById('music-cur')||{}).textContent,audioDur:document.querySelector('audio')?document.querySelector('audio').duration:null})`);
  }

  console.log('NO_LRC ' + JSON.stringify(await pick('14.3 Billion Years')));
  console.log('LRC ' + JSON.stringify(await pick('Billie Jean')));
  console.log('ERRS ' + JSON.stringify(errs) + ' audio=' + await ev('document.querySelectorAll("audio").length'));
  ws.close(); proc.kill();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
