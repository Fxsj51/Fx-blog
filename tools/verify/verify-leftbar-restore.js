'use strict';
/* 左栏形态回归（按宽度分段 + 段内可切换）：
 *   ≤667  抽屉，默认隐藏，移动顶栏菜单开合（不变）
 *   668–919  只有 64 窄条；form=expanded 视为隐藏、不占位，左上角 dock 按钮恢复窄条
 *   920–1024 完整 340 / 64 窄条可切换，形态按 stellar:v2:leftbar-state 记忆
 *   ≥1025 永远完整 340，收纳按钮隐藏；忽略存储的 collapsed、不写存储
 * 断点依据：完整 340 + 主栏 ≥560（含 17px 滚动条）→ 视口 ≥917，取整 920；
 * 668/667 与 nightfall7 的抽屉边界一致；1025 为常见 1024/1025 桌面分界（full 下主栏 ≥668）。
 * 覆盖：667/668/900/919/920/1024/1025/1181/1440。
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const lib = require('./lib');
const BASE = lib.baseUrl() + '/';
const PORT = 9455;
const EDGE = lib.browserPath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'lbv7-' + Date.now()),
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

  const probe = `(() => {
    const root = document.documentElement;
    const lb = document.getElementById('leftbar-region');
    const lr = lb ? lb.getBoundingClientRect() : null;
    const main = document.querySelector('main.site-main');
    const mr = main ? main.getBoundingClientRect() : null;
    const dock = document.querySelector('.site-dock');
    const dockBtn = document.querySelector('.site-dock__button--leftbar');
    const toggle = document.querySelector('.leftbar-state-toggle');
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    const bar = document.getElementById('mobile-brand-bar');
    const scrim = document.querySelector('.site-scrim');
    return {
      vw: window.innerWidth,
      attr: root.getAttribute('data-leftbar-visible'),
      form: root.getAttribute('data-leftbar-state') === 'collapsed' ? 'rail' : 'full',
      storedForm: localStorage.getItem('stellar:v2:leftbar-state'),
      storedVisible: localStorage.getItem('stellar:v2:leftbar-visible'),
      lbDisplay: lb ? getComputedStyle(lb).display : null,
      lbW: lr ? Math.round(lr.width) : null,
      lbX: lr ? Math.round(lr.left) : null,
      mainW: mr ? Math.round(mr.width) : null,
      mainX: mr ? Math.round(mr.left) : null,
      dock: shown(dock) && shown(dockBtn),
      toggle: shown(toggle),
      toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
      toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
      mobileBar: bar ? getComputedStyle(bar).display !== 'none' : false,
      scrim: scrim ? getComputedStyle(scrim).opacity : null,
      grid: (() => { const g = document.querySelector('.site-workspace'); return g ? getComputedStyle(g).gridTemplateColumns : null; })(),
      overflow: root.scrollWidth - root.clientWidth
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
    await sleep(1100);
  };
  const click = async (sel) => {
    await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (b) b.click(); return !!b; })()`);
    await sleep(650);
  };

  await setWidth(1440);
  await send('Page.navigate', { url: BASE });
  for (let i = 0; i < 100; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }

  /* ---------- A. ≤667 抽屉（保持不变） ---------- */
  await setWidth(667, true);
  await ev(clearState); await reload();
  let s = await ev(probe);
  record('A1: 667 默认隐藏 + 移动顶栏在', s.attr === 'hidden' && s.lbX < 0 && s.mobileBar === true, s);
  await click('#mbb-menu-btn');
  s = await ev(probe);
  record('A2: 667 打开完整抽屉 340 + 遮罩', s.attr === 'shown' && s.lbW === 340 && s.lbX >= 0 && s.scrim === '1', s);
  await ev(`(() => { document.getElementById('main').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(650);
  s = await ev(probe);
  record('A3: 667 点正文收起且不落可见性存储', s.attr === 'hidden' && s.storedVisible === null, s);
  await reload();
  s = await ev(probe);
  record('A4: 667 刷新后仍隐藏（不弹回）', s.attr === 'hidden' && s.lbX < 0, s);
  await ev(`try { localStorage.setItem('stellar:v2:leftbar-state','collapsed'); } catch (e) {}`);
  await reload(); await click('#mbb-menu-btn');
  s = await ev(probe);
  record('A5: 667 rail 形态打开为 64 窄条且无遮罩', s.form === 'rail' && s.lbW === 64 && s.scrim === '0', s);
  await ev(clearState);

  /* ---------- B. 668–919 仅窄条；expanded=隐藏，dock 恢复 ---------- */
  for (const w of [668, 900, 919]) {
    await setWidth(w);
    await ev(clearState); await reload();
    let t = await ev(probe);
    record('B' + w + 'a: expanded 即整条隐藏、不占位、dock 出现、主栏 ≥560',
      t.form === 'full' && t.lbDisplay === 'none' && t.dock === true && t.mainW >= 560 && t.overflow === 0,
      { form: t.form, display: t.lbDisplay, dock: t.dock, mainW: t.mainW, overflow: t.overflow });
    await click('.site-dock__button--leftbar');
    t = await ev(probe);
    record('B' + w + 'b: dock 点一下回到 64 窄条（dock 隐去、主栏 ≥560）',
      t.form === 'rail' && t.lbW === 64 && t.lbDisplay !== 'none' && t.dock === false && t.toggleLabel === 'Hide leftbar' && t.mainW >= 560 && t.overflow === 0,
      { form: t.form, lbW: t.lbW, dock: t.dock, label: t.toggleLabel, mainW: t.mainW, overflow: t.overflow });
    await click('.leftbar-state-toggle');
    t = await ev(probe);
    record('B' + w + 'c: 栏内按钮隐藏窄条（expanded）', t.form === 'full' && t.lbDisplay === 'none' && t.dock === true, { form: t.form, display: t.lbDisplay, dock: t.dock });
  }

  /* ---------- C. 920–1024 完整/窄条可切换且记忆 ---------- */
  for (const w of [920, 1024]) {
    await setWidth(w);
    await ev(clearState); await reload();
    let t = await ev(probe);
    record('C' + w + 'a: 默认完整 340、主栏 ≥560、收纳按钮在',
      t.form === 'full' && t.lbW === 340 && t.toggle === true && t.dock === false && t.mainW >= 560 && t.overflow === 0,
      { form: t.form, lbW: t.lbW, toggle: t.toggle, mainW: t.mainW, overflow: t.overflow });
    await click('.leftbar-state-toggle');
    t = await ev(probe);
    record('C' + w + 'b: 收纳为 64 并落盘', t.form === 'rail' && t.lbW === 64 && t.storedForm === 'collapsed', { form: t.form, lbW: t.lbW, stored: t.storedForm });
    await reload();
    t = await ev(probe);
    record('C' + w + 'c: 刷新后仍是 64（形态记忆）', t.form === 'rail' && t.lbW === 64, { form: t.form, lbW: t.lbW });
    await click('.leftbar-state-toggle');
  }

  /* ---------- D. ≥1025 永远完整：忽略存储 collapsed、不写存储 ---------- */
  await setWidth(1025);
  await ev(clearState);
  await ev(`try { localStorage.setItem('stellar:v2:leftbar-state','collapsed'); } catch (e) {}`);
  await reload();
  let d = await ev(probe);
  record('D1: 1025 存储 collapsed 仍完整 340、按钮隐藏、存储未被改写',
    d.form === 'full' && d.lbW === 340 && d.toggleDisplay === 'none' && d.storedForm === 'collapsed',
    { form: d.form, lbW: d.lbW, toggle: d.toggleDisplay, stored: d.storedForm });
  await setWidth(1024);
  d = await ev(probe);
  record('D2: 1025→1024 回到存储的窄条 64', d.form === 'rail' && d.lbW === 64 && d.storedForm === 'collapsed', { form: d.form, lbW: d.lbW, stored: d.storedForm });
  await setWidth(1025);
  d = await ev(probe);
  record('D3: 1024→1025 再次强制完整、存储仍 collapsed', d.form === 'full' && d.lbW === 340 && d.storedForm === 'collapsed', { form: d.form, lbW: d.lbW, stored: d.storedForm });
  await ev(clearState);

  /* ---------- E. 1181 / 1440 与 ≥1181 自动显示 ---------- */
  await setWidth(1440);
  await ev(clearState); await reload();
  let e = await ev(probe);
  record('E1: 1440 完整 340、收纳按钮隐藏、无横向溢出',
    e.form === 'full' && e.lbW === 340 && e.toggleDisplay === 'none' && e.overflow === 0,
    { form: e.form, lbW: e.lbW, toggle: e.toggleDisplay, overflow: e.overflow });
  await setWidth(1181);
  e = await ev(probe);
  record('E2: 1181 三栏下左栏仍 340、无横向溢出', e.lbW === 340 && e.overflow === 0, { lbW: e.lbW, overflow: e.overflow, grid: e.grid });
  await setWidth(1000);
  await ev(`document.documentElement.setAttribute('data-leftbar-visible','hidden')`);
  await setWidth(1441);
  await sleep(600);
  e = await ev(probe);
  record('E3: 1000 手动隐藏态跨入 1441 自动出现', e.attr === 'shown' && e.lbW === 340, { attr: e.attr, lbW: e.lbW });
  await setWidth(1441);
  await ev(`try { localStorage.setItem('stellar:v2:leftbar-visible','hidden'); } catch (e) {}`);
  await reload();
  e = await ev(probe);
  record('E4: 遗留 hidden 存储以 1441 打开即出现且存储不变',
    e.attr === 'shown' && e.lbW === 340 && e.storedVisible === 'hidden', { attr: e.attr, stored: e.storedVisible });
  await ev(clearState);

  /* ---------- F. 九档扫描：形态/主栏/溢出 ---------- */
  await setWidth(1440); await reload();
  const sweep = [];
  const widths = [667, 668, 900, 919, 920, 1024, 1025, 1181, 1440];
  for (const w of widths) {
    await setWidth(w, w <= 667);
    await ev(clearState); await reload();
    const t = await ev(probe);
    sweep.push({ w: w, attr: t.attr, form: t.form, shown: t.lbDisplay !== 'none' && (t.lbW || 0) > 0, lbW: t.lbW, lbX: t.lbX, lbDisplay: t.lbDisplay, mainW: t.mainW, dock: t.dock, mobileBar: t.mobileBar, overflow: t.overflow, toggle: t.toggleDisplay });
  }
  const bad = sweep.filter((x) => {
    if (x.w === 667) return x.attr !== 'hidden' || x.lbX >= 0 || x.mobileBar !== true;
    if (x.w <= 919) return x.lbDisplay !== 'none' || x.dock !== true || x.mainW < 560;
    if (x.w <= 1024) return x.lbW !== 340 || x.mainW < 560;
    return x.lbW !== 340;
  });
  record('F1: 九档形态符合分段且 668–1024 主栏 ≥560', bad.length === 0, { sweep: sweep, bad: bad });
  const at1181 = sweep.find((x) => x.w === 1181);
  record('F4: 1181 三栏主栏 <560（右栏 1180/1181 固定断点导致的已知例外，未改右栏）',
    at1181.mainW < 560 && at1181.lbW === 340, { mainW: at1181.mainW });
  record('F2: 九档无横向溢出', sweep.every((x) => x.overflow <= 0), { overflow: sweep.map((x) => x.w + ':' + x.overflow) });
  const toggleHidden = sweep.filter((x) => x.w >= 1025).every((x) => x.toggle === 'none');
  const toggleShown = sweep.filter((x) => x.w >= 920 && x.w <= 1024).every((x) => x.toggle !== 'none');
  record('F3: ≥1025 收纳按钮隐藏、920–1024 可见', toggleHidden && toggleShown,
    { hidden: sweep.filter((x) => x.w >= 1025).map((x) => x.w + ':' + x.toggle), shown: sweep.filter((x) => x.w >= 920 && x.w <= 1024).map((x) => x.w + ':' + x.toggle) });

  record('全程无 JS 异常', errs.length === 0, { errs: errs.slice(0, 3) });

  const failed = results.filter((r) => !r.ok);
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
