'use strict';
/* 左栏形态回归（按宽度分段 + 段内可切换）：
 *   ≤667  抽屉，默认隐藏，移动顶栏菜单开合（不变）
 *   668–919  收起态固定 64 窄条常驻（主栏只让出 64、窄条不可滚动）；展开走抽屉浮层（340 + 遮罩，点外收起）
 *   920 及以上 完整 340 / 64 窄条可切换，形态按 stellar:v2:leftbar-state 记忆
 *   （含 ≥1181 三栏：左栏 340 ⇄ 64，右栏 380 占位不变）
 * 断点依据：完整 340 + 主栏 ≥560（含 17px 滚动条）→ 视口 ≥917，取整 920；
 * 668/667 与 nightfall7 的抽屉边界一致；1025/1181/1440 为宽屏抽样（≥920 同规则）。
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

  // 用真实滚轮 + 触摸拖动去滚窄条，返回窄条视口的 scrollTop（不可滚动时应恒为 0）
  const railUserScrollTop = async () => {
    const p = await ev(probe);
    if (!p.vpRect) return null;
    const x = Math.round(p.vpRect.x + p.vpRect.w / 2);
    const y = Math.round(p.vpRect.y + Math.min(40, p.vpRect.h / 2));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x, y: y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: x, y: y, deltaX: 0, deltaY: 320 });
    await sleep(250);
    try {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x, y: y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x, y: y - 120 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x, y: y - 240 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } catch (error) {}
    await sleep(350);
    return (await ev(probe)).vpScrollTop;
  };

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
    const br = bar ? bar.getBoundingClientRect() : null;
    const mbb = document.getElementById('mbb-menu-btn');
    const shell = document.querySelector('.site-shell');
    const rb = document.getElementById('rightbar-region');
    const rbr = rb ? rb.getBoundingClientRect() : null;
    return {
      vw: window.innerWidth,
      attr: root.getAttribute('data-leftbar-visible'),
      form: root.getAttribute('data-leftbar-state') === 'collapsed' ? 'rail' : 'full',
      drawer: shell ? (shell.getAttribute('data-drawer') || '') : null,
      storedForm: localStorage.getItem('stellar:v2:leftbar-state'),
      storedVisible: localStorage.getItem('stellar:v2:leftbar-visible'),
      lbDisplay: lb ? getComputedStyle(lb).display : null,
      lbW: lr ? Math.round(lr.width) : null,
      lbX: lr ? Math.round(lr.left) : null,
      mainW: mr ? Math.round(mr.width) : null,
      mainX: mr ? Math.round(mr.left) : null,
      mainY: mr ? Math.round(mr.top) : null,
      rbW: rbr ? Math.round(rbr.width) : null,
      barH: br ? Math.round(br.height) : null,
      mbbExpanded: mbb ? mbb.getAttribute('aria-expanded') : null,
      dock: shown(dock) && shown(dockBtn),
      toggle: shown(toggle),
      toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
      toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
      vpOverflow: (() => { const v = document.querySelector('#leftbar-region .site-region__viewport'); return v ? getComputedStyle(v).overflowY : null; })(),
      vpScrollTop: (() => { const v = document.querySelector('#leftbar-region .site-region__viewport'); return v ? Math.round(v.scrollTop) : null; })(),
      vpScrollH: (() => { const v = document.querySelector('#leftbar-region .site-region__viewport'); return v ? v.scrollHeight : null; })(),
      vpClientH: (() => { const v = document.querySelector('#leftbar-region .site-region__viewport'); return v ? v.clientHeight : null; })(),
      vpRect: (() => { const v = document.querySelector('#leftbar-region .site-region__viewport'); if (!v) return null; const b = v.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; })(),
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

  /* ---------- B. 668–919：64 窄条常驻，展开走抽屉浮层（顶栏菜单 / 窄条按钮 / 点外关闭） ---------- */
  for (const w of [668, 900, 919]) {
    await setWidth(w);
    await ev(clearState); await reload();
    let t = await ev(probe);
    record('B' + w + 'a: 默认 64 窄条常驻、顶栏在、无浮层入口、主栏 ≥560',
      t.form === 'rail' && t.lbW === 64 && t.lbX >= 0 && t.mobileBar === true && t.dock === false &&
      t.drawer === '' && t.mbbExpanded === 'false' && t.mainW >= 560 && t.mainY >= t.barH && t.overflow === 0,
      { form: t.form, lbW: t.lbW, lbX: t.lbX, drawer: t.drawer, bar: t.mobileBar, dock: t.dock, mbb: t.mbbExpanded, mainW: t.mainW, mainY: t.mainY, barH: t.barH, overflow: t.overflow });
    const baseMainW = t.mainW;
    const railScrollTop = await railUserScrollTop();
    record('B' + w + 'f: 64 窄条不可滚动（滚轮/触摸后 scrollTop=0、overflow hidden）',
      t.vpOverflow === 'hidden' && railScrollTop === 0,
      { overflowY: t.vpOverflow, scrollTop: railScrollTop, scrollH: t.vpScrollH, clientH: t.vpClientH });
    await click('#mbb-menu-btn');
    t = await ev(probe);
    record('B' + w + 'b: 顶栏菜单打开抽屉浮层 340 + 遮罩，主栏不被挤窄、存储未被改写',
      t.drawer === 'leftbar' && t.lbW === 340 && t.lbX >= 0 && t.scrim === '1' && t.mbbExpanded === 'true' &&
      t.storedForm === null && t.mainW === baseMainW && t.overflow === 0,
      { drawer: t.drawer, lbW: t.lbW, lbX: t.lbX, scrim: t.scrim, mbb: t.mbbExpanded, stored: t.storedForm, mainW: t.mainW, baseMainW: baseMainW, overflow: t.overflow });
    await ev(`(() => { document.getElementById('main').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    await sleep(650);
    t = await ev(probe);
    record('B' + w + 'c: 点外面关闭抽屉，回到 64 窄条（不回到整条隐藏）、存储仍为空',
      t.drawer === '' && t.form === 'rail' && t.lbW === 64 && t.lbX >= 0 && t.mbbExpanded === 'false' &&
      t.storedForm === null && t.scrim === '0' && t.mainW === baseMainW,
      { drawer: t.drawer, form: t.form, lbW: t.lbW, lbX: t.lbX, mbb: t.mbbExpanded, stored: t.storedForm, scrim: t.scrim, mainW: t.mainW });
    await click('.leftbar-state-toggle');
    t = await ev(probe);
    record('B' + w + 'd: 窄条上的展开按钮同样打开 340 抽屉浮层',
      t.drawer === 'leftbar' && t.lbW === 340 && t.lbX >= 0 && t.scrim === '1' && t.mainW === baseMainW,
      { drawer: t.drawer, lbW: t.lbW, lbX: t.lbX, scrim: t.scrim, mainW: t.mainW });
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(650);
    t = await ev(probe);
    record('B' + w + 'e: Escape 关闭抽屉并回到 64 窄条',
      t.drawer === '' && t.form === 'rail' && t.lbW === 64 && t.storedForm === null,
      { drawer: t.drawer, form: t.form, lbW: t.lbW, stored: t.storedForm });
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

  /* ---------- D. ≥1025 恢复完整/窄条切换并记忆（1025 单列） ---------- */
  await setWidth(1025);
  await ev(clearState); await reload();
  let d = await ev(probe);
  record('D1: 1025 默认完整 340、收纳按钮在、主栏 ≥560',
    d.form === 'full' && d.lbW === 340 && d.toggleDisplay !== 'none' && d.dock === false && d.mainW >= 560 && d.overflow === 0,
    { form: d.form, lbW: d.lbW, toggle: d.toggleDisplay, mainW: d.mainW, overflow: d.overflow });
  await click('.leftbar-state-toggle');
  d = await ev(probe);
  record('D2: 1025 收纳为 64 并落盘、主栏变宽',
    d.form === 'rail' && d.lbW === 64 && d.storedForm === 'collapsed' && d.mainW > 560,
    { form: d.form, lbW: d.lbW, stored: d.storedForm, mainW: d.mainW });
  await reload();
  d = await ev(probe);
  record('D3: 1025 刷新后仍是 64（形态记忆）', d.form === 'rail' && d.lbW === 64, { form: d.form, lbW: d.lbW });
  await click('.leftbar-state-toggle');
  d = await ev(probe);
  record('D4: 1025 再展开回 340 且存储为 expanded',
    d.form === 'full' && d.lbW === 340 && d.storedForm === 'expanded', { form: d.form, lbW: d.lbW, stored: d.storedForm });
  await ev(clearState);

  /* ---------- E. 1181 / 1440：三栏下也可切窄条，右栏占位不变 ---------- */
  await setWidth(1440);
  await ev(clearState); await reload();
  let e = await ev(probe);
  record('E1: 1440 完整 340、收纳按钮在、无横向溢出',
    e.form === 'full' && e.lbW === 340 && e.toggleDisplay !== 'none' && e.overflow === 0,
    { form: e.form, lbW: e.lbW, toggle: e.toggleDisplay, overflow: e.overflow });
  await setWidth(1181);
  e = await ev(probe);
  record('E2: 1181 三栏默认 340、收纳按钮在、无横向溢出',
    e.lbW === 340 && e.toggleDisplay !== 'none' && e.rbW === 380 && e.overflow === 0,
    { lbW: e.lbW, rbW: e.rbW, toggle: e.toggleDisplay, overflow: e.overflow, grid: e.grid });
  await click('.leftbar-state-toggle');
  e = await ev(probe);
  record('E3: 1181 收纳为 64：右栏仍 380、主栏变宽、存储 collapsed',
    e.form === 'rail' && e.lbW === 64 && e.rbW === 380 && e.mainW > 453 && e.storedForm === 'collapsed',
    { form: e.form, lbW: e.lbW, rbW: e.rbW, mainW: e.mainW, stored: e.storedForm, grid: e.grid });
  await reload();
  e = await ev(probe);
  record('E4: 1181 刷新后仍是 64（形态记忆）', e.form === 'rail' && e.lbW === 64 && e.rbW === 380, { form: e.form, lbW: e.lbW, rbW: e.rbW });
  await click('.leftbar-state-toggle');
  e = await ev(probe);
  record('E5: 1181 再展开回 340', e.form === 'full' && e.lbW === 340 && e.rbW === 380, { form: e.form, lbW: e.lbW, rbW: e.rbW });
  await ev(clearState);

  /* ---------- E6–E8. ≥1181 自动显示兜底 ---------- */
  await setWidth(1000);
  await ev(`document.documentElement.setAttribute('data-leftbar-visible','hidden')`);
  await setWidth(1441);
  await sleep(600);
  e = await ev(probe);
  record('E6: 1000 手动隐藏态跨入 1441 自动出现', e.attr === 'shown' && e.lbW === 340, { attr: e.attr, lbW: e.lbW });
  await setWidth(1441);
  await ev(`try { localStorage.setItem('stellar:v2:leftbar-visible','hidden'); } catch (e) {}`);
  await reload();
  e = await ev(probe);
  record('E7: 遗留 hidden 存储以 1441 打开即出现且存储不变',
    e.attr === 'shown' && e.lbW === 340 && e.storedVisible === 'hidden', { attr: e.attr, lbW: e.lbW, stored: e.storedVisible });
  await ev(clearState);

  /* ---------- G. 各档 64 窄条都不可滚动，完整形态不受影响 ---------- */
  for (const w of [920, 1024, 1025, 1181, 1440]) {
    await setWidth(w);
    await ev(clearState); await reload();
    await click('.leftbar-state-toggle');
    await sleep(600);
    let g = await ev(probe);
    const st = await railUserScrollTop();
    record('G' + w + 'a: 窄条不可滚动（滚轮/触摸后 scrollTop=0、overflow hidden）',
      g.form === 'rail' && g.lbW === 64 && g.vpOverflow === 'hidden' && st === 0,
      { form: g.form, lbW: g.lbW, overflowY: g.vpOverflow, scrollTop: st, scrollH: g.vpScrollH, clientH: g.vpClientH });
    await click('.leftbar-state-toggle');
    await sleep(600);
    g = await ev(probe);
    record('G' + w + 'b: 完整形态仍可滚动（overflow 未隐藏）',
      g.form === 'full' && g.lbW === 340 && g.vpOverflow !== 'hidden',
      { form: g.form, lbW: g.lbW, overflowY: g.vpOverflow, scrollH: g.vpScrollH, clientH: g.vpClientH });
  }
  await ev(clearState);

  /* ---------- F. 九档扫描：形态/主栏/溢出 ---------- */
  await setWidth(1440); await reload();
  const sweep = [];
  const widths = [667, 668, 900, 919, 920, 1024, 1025, 1181, 1440];
  for (const w of widths) {
    await setWidth(w, w <= 667);
    await ev(clearState); await reload();
    const t = await ev(probe);
    sweep.push({ w: w, attr: t.attr, form: t.form, drawer: t.drawer, shown: t.lbDisplay !== 'none' && (t.lbW || 0) > 0, lbW: t.lbW, lbX: t.lbX, lbDisplay: t.lbDisplay, mainW: t.mainW, mainY: t.mainY, barH: t.barH, dock: t.dock, mobileBar: t.mobileBar, overflow: t.overflow, toggle: t.toggleDisplay });
  }
  const bad = sweep.filter((x) => {
    if (x.w === 667) return x.attr !== 'hidden' || x.lbX >= 0 || x.mobileBar !== true;
    if (x.w <= 919) return x.form !== 'rail' || x.lbW !== 64 || x.lbX < 0 || x.drawer !== '' ||
      x.mobileBar !== true || x.dock === true || x.mainW < 560 || x.mainY < x.barH;
    if (x.w <= 1024) return x.lbW !== 340 || x.mainW < 560 || x.mobileBar === true || x.toggle === 'none';
    return x.lbW !== 340 || x.mobileBar === true || x.toggle === 'none';
  });
  record('F1: 九档形态符合分段（668–919 常驻 64 窄条；≥920 默认完整且可收纳）、668–1024 主栏 ≥560、顶栏只在 ≤919', bad.length === 0, { sweep: sweep, bad: bad });
  const at1181 = sweep.find((x) => x.w === 1181);
  record('F4: 1181 三栏主栏 <560（右栏 1180/1181 固定断点导致的已知例外，未改右栏）',
    at1181.mainW < 560 && at1181.lbW === 340, { mainW: at1181.mainW });
  record('F2: 九档无横向溢出', sweep.every((x) => x.overflow <= 0), { overflow: sweep.map((x) => x.w + ':' + x.overflow) });
  const toggleAll = sweep.filter((x) => x.w >= 920).every((x) => x.toggle !== 'none');
  const toggleRailOnly = sweep.filter((x) => x.w <= 919).every((x) => x.toggle !== 'none');
  record('F3: ≥920 收纳按钮全部可见（含 ≥1025 / 1181）、668–919 窄条按钮在', toggleAll && toggleRailOnly,
    { toggle: sweep.map((x) => x.w + ':' + x.toggle) });

  record('全程无 JS 异常', errs.length === 0, { errs: errs.slice(0, 3) });

  const failed = results.filter((r) => !r.ok);
  console.log((failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks)');
  ws.close(); proc.kill();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
