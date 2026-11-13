'use strict';
/* SPA 换页卫生检查：监听泄漏、JS 异常、favicon、内联样式相对路径 404（无头 Edge）
 *
 * 背景（曾经出现过的两类回归）：
 *  1. 主题 runtime 在 pageshow 重挂时从不卸载已脱离文档的旧 root，signal 绑定的
 *     window 监听与 retain 的 DOM 每次换页都在泄漏（patches 里已在 pageshow 前补卸载）；
 *     本脚本用 CDP 枚举 window/document 上的真实监听数断言不再单调增长。
 *  2. 内联 <style> 的相对 url(../images/..) 会被浏览器按当前 baseURI 懒解析，
 *     SPA pushState 换页后基路径已变，图片请求落到 /20xx/xx/xx/images/ 下 404。
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/';
const PORT = 9439;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

const ROUNDS = 3;
const ROUTES = ['2026/11/04/hello-world/', 'music/', 'about/', 'archives/', 'categories/', ''];

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'spa-hygiene-' + Date.now()),
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
  let id = 0; const m = new Map();
  const exceptions = [];
  const badRequests = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') {
      const p = d.params.exceptionDetails;
      exceptions.push((p.exception && p.exception.description || p.text || '').split('\n')[0]);
    }
    if (d.method === 'Network.responseReceived') {
      const u = d.params.response.url;
      const status = d.params.response.status;
      if (status >= 400 && /^[^/]+\/\/[^/]+\//.test(u)) {
        // 站内 4xx/5xx：favicon 与按错误 baseURI 解析的相对路径资源
        if (/\/favicon\.ico/.test(u) || /\/20\d\d\/\d\d\/\d\d\/images\//.test(u)) {
          badRequests.push(status + ' ' + u);
        }
      }
    }
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  async function countListeners(targetExpr) {
    const r = await send('Runtime.evaluate', { expression: targetExpr });
    const l = await send('DOMDebugger.getEventListeners', { objectId: r.result.objectId });
    return l.listeners.length;
  }

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await sleep(4000);

  // 基线：窗口/文档监听数。首次进入音乐页会有一次性常驻绑定（拖动全局监听），
  // 所以文档监听按「第 1 轮结束值 vs 最后一轮结束值」对比，断言此后不再增长。
  let baseWin = await countListeners('window');
  const roundDoc = [];
  let maxWin = baseWin;
  let lastWin = baseWin;
  let lastDoc = await countListeners('document');

  for (let round = 0; round < ROUNDS; round++) {
    for (const r of ROUTES) {
      await ev(`(() => {
        const href = '${r}';
        const a = document.querySelector('#leftbar-region a[href="/' + (href ? href : '') + '"]') ||
                  document.querySelector('a[href="' + (href ? '/' + href : '/') + '"]');
        if (a) a.click();
        return !!a;
      })()`);
      for (let i = 0; i < 100; i++) { if (await ev(`location.pathname === '/${r}'`)) break; await sleep(100); }
      await sleep(1800);
      lastWin = await countListeners('window');
      lastDoc = await countListeners('document');
      if (lastWin > maxWin) maxWin = lastWin;
    }
    roundDoc.push(lastDoc);
  }

  const firstRoundDoc = roundDoc[0];
  const finalRoundDoc = roundDoc[roundDoc.length - 1];
  const growthWin = maxWin - baseWin;
  record('window 监听无单调增长', growthWin <= 6, { baseWin: baseWin, maxWin: maxWin, growth: growthWin, last: lastWin });
  record('document 监听首轮后不再增长', finalRoundDoc <= firstRoundDoc + 2, { roundDoc: roundDoc, growth: finalRoundDoc - firstRoundDoc });

  // 归档页的吸顶导航在离开后应释放（window 监听回到基线 + 少量常驻余量）
  record('离开归档/首页后监听回落', lastWin <= baseWin + 6, { baseWin: baseWin, lastWin: lastWin });

  record('SPA 全程无 JS 异常', exceptions.length === 0, { exceptions: exceptions.slice(0, 5) });
  record('favicon.ico 与相对路径资源无 404', badRequests.length === 0, { badRequests: badRequests.slice(0, 5) });

  // favicon 可直接访问
  const http = require('http');
  const favStatus = await new Promise((resolve) => {
    const req = http.get(new URL('favicon.ico', BASE), (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.setTimeout(3000, () => { req.destroy(); resolve(0); });
  });
  record('favicon.ico 返回 200', favStatus === 200, { status: favStatus });

  const failed = results.filter((r) => !r.ok);
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
