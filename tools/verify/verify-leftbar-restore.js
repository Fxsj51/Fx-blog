'use strict';
/* 左栏可见性回归（梯次方案）：
 * 断点口径：≥668 左栏内联常驻（可收 64px 窄条）；≤667 左栏滑出抽屉、默认隐藏。
 * 可见性不读不写 localStorage；收起不落盘，刷新不弹回；跨断点自动回当前宽度的默认值。
 * 场景：
 *   A  1000px 无偏好访客：内联显示 + 窄条折叠/展开（rail 形态切换、64px、aria 同步）
 *   B   600px 无偏好访客：默认隐藏 → 菜单开 → 点外收（不落盘）→ 刷新仍隐藏
 *   C   600px 用户复现链：隐藏→展开→再隐藏 → 回宽窗 → 左栏仍在
 *   D   ≥1181 兜底：1000px 手动隐藏态跨入 1441 自动出现；遗留 hidden 存储以 1441 打开启动即出现
 *   E  七档宽度（667/668/768/1000/1180/1181/1440）可见性、移动顶栏、横向溢出
 *   F  shown 下 1181→1180→1181 往返：左栏始终显示（≥668 均为内联）
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/';
const PORT = 9455;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'lbv4-' + Date.now()),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list', { signal: ctrl.signal })).json();
      clearTimeout(t);
      const p = l.find((t) => t.type === 'page');
      if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await sleep(300);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const m = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await send('Page.enable'); await send('Runtime.enable');

  const stateProbe = `(() => {
    const lb = document.getElementById('leftbar-region');
    const r = lb ? lb.getBoundingClientRect() : null;
    // ≤667 抽屉隐藏态是 translateX(-100%-32px) 平移出屏——按位置判定是否在屏
    const onScreen = !!r && r.width > 100 && r.left > -10 && r.right <= window.innerWidth + 10;
    return {
      attr: document.documentElement.getAttribute('data-leftbar-visible'),
      form: document.documentElement.getAttribute('data-leftbar-state'),
      stored: localStorage.getItem('stellar:v2:leftbar-visible'),
      lbVisible: onScreen,
      lbHidden: !lb || getComputedStyle(lb).display === 'none' || !onScreen,
      lbWidth: r ? Math.round(r.width) : null,
      mobileBar: (() => { const b = document.getElementById('mobile-brand-bar'); return b ? getComputedStyle(b).display !== 'none' : false; })(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`;
  const clearState = `try { localStorage.removeItem('stellar:v2:leftbar-visible'); localStorage.removeItem('stellar:v2:leftbar-state'); } catch (e) {}`;
  const setWidth = async (w, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: !!mobile });
    await sleep(500);
  };
  const reload = async () => {
    await ev('location.reload()');
    for (let i = 0; i < 100; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
    await sleep(1000);
  };
  const openDrawer = async () => {
    await ev(`(() => { const b = document.getElementById('mbb-menu-btn'); if (b) b.click(); return !!b; })()`);
    await sleep(600);
  };

  /* ---------- A. 1000px 无偏好访客：内联显示 + 窄条折叠 ---------- */
  await setWidth(1000);
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 100; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
  await ev(clearState); await reload();
  let s = await ev(stateProbe);
  record('A1: 1000px 无偏好内联显示', s.attr === 'shown' && s.lbVisible === true && s.lbWidth > 200 && s.mobileBar === false, s);
  await ev(`(() => { const b = document.querySelector('.leftbar-state-toggle'); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  s = await ev(stateProbe);
  record('A2: 收起为 64px 窄条（data-leftbar-state=collapsed）', s.form === 'collapsed' && s.lbWidth !== null && s.lbWidth <= 80, s);
  await ev(`(() => { const b = document.querySelector('.leftbar-state-toggle'); if (b) b.click(); return !!b; })()`);
  await sleep(600);
  s = await ev(stateProbe);
  record('A3: 展开回内联（aria/形态同步）', s.form === 'expanded' && s.lbWidth > 200, s);

  /* ---------- B. 600px 无偏好访客：抽屉 ---------- */
  await setWidth(600, true);
  await ev(clearState); await reload();
  s = await ev(stateProbe);
  record('B1: 600px 无偏好默认隐藏（抽屉）且移动顶栏在', s.attr === 'hidden' && s.lbHidden === true && s.mobileBar === true, s);
  await openDrawer();
  s = await ev(stateProbe);
  record('B2: 菜单按钮打开抽屉（滑出在屏）', s.attr === 'shown' && s.lbVisible === true, s);
  await ev(`(() => { const main = document.getElementById('main'); main.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(600);
  s = await ev(stateProbe);
  record('B3: 点击左栏外收起且不落盘', s.attr === 'hidden' && s.stored === null, s);
  await reload();
  s = await ev(stateProbe);
  record('B4: 刷新后仍隐藏（收起不弹回）', s.attr === 'hidden' && s.lbHidden === true, s);

  /* ---------- C. 600px 用户复现链：隐藏→展开→再隐藏 → 回宽窗 ---------- */
  await ev(clearState);
  await openDrawer();
  const seq = [];
  for (let step = 0; step < 3; step++) {
    await ev(`(() => { const b = document.getElementById('mbb-menu-btn'); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    seq.push(await ev(`document.documentElement.getAttribute('data-leftbar-visible')`));
  }
  record('C1: 隐藏→展开→再隐藏 循环正常', JSON.stringify(seq) === JSON.stringify(['hidden', 'shown', 'hidden']), { seq: seq });
  await setWidth(1440);
  await sleep(800);
  s = await ev(stateProbe);
  record('C2: 回到宽窗口左栏自动出现', s.lbVisible === true && s.attr === 'shown', s);

  /* ---------- D. ≥1181 兜底 ---------- */
  await setWidth(1000);
  await ev(clearState);
  await ev(`(() => { document.documentElement.setAttribute('data-leftbar-visible', 'hidden'); return true; })()`);
  await setWidth(1441);
  await sleep(800);
  s = await ev(stateProbe);
  record('D1: 1000px 手动隐藏态跨入 1441 → 自动出现', s.lbVisible === true && s.attr === 'shown', s);
  await setWidth(1000);
  await ev(`try { localStorage.setItem('stellar:v2:leftbar-visible', 'hidden'); } catch (e) {}`);
  await setWidth(1441); await reload();
  s = await ev(stateProbe);
  record('D2: 遗留 hidden 存储以 1441 打开 → 启动即出现', s.lbVisible === true && s.attr === 'shown', s);
  await ev(clearState);

  /* ---------- E. 七档宽度扫描 ---------- */
  await setWidth(1441); await reload();
  const sweep = [];
  const widths = [667, 668, 768, 1000, 1180, 1181, 1440];
  for (const w of widths) {
    await setWidth(w, w <= 667);
    s = await ev(stateProbe);
    sweep.push({ w: w, attr: s.attr, overflow: s.overflow, lbShown: s.lbVisible, mobileBar: s.mobileBar });
    await shot('lbv6-' + w + '.png');
  }
  const expect = (w) => w <= 667 ? 'hidden' : 'shown';
  const bad = sweep.filter((x) => x.attr !== expect(x.w) || x.overflow > 0);
  record('E1: 七档宽度可见性符合梯次口径且无横向溢出', bad.length === 0, { sweep: sweep, bad: bad });
  const at667 = sweep.find((x) => x.w === 667);
  const at668 = sweep.find((x) => x.w === 668);
  record('E2: 移动顶栏 ≤667 在、≥668 不在（左栏常驻即导航在）', at667.mobileBar === true && at668.mobileBar === false, { at667: at667.mobileBar, at668: at668.mobileBar });

  /* ---------- F. shown 下 1181→1180→1181 往返 ---------- */
  await setWidth(1441); await sleep(600);
  const e3 = [];
  for (const w of [1181, 1180, 1181]) {
    await setWidth(w); await sleep(500);
    e3.push(await ev(`document.documentElement.getAttribute('data-leftbar-visible')`));
  }
  record('F: shown 下 1181→1180→1181 往返左栏始终显示', JSON.stringify(e3) === JSON.stringify(['shown', 'shown', 'shown']), { e3: e3 });

  record('全程无 JS 异常', errs.length === 0, { errs: errs.slice(0, 3) });

  const failed = results.filter((r) => !r.ok);
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);

  async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
