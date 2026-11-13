'use strict';
// 第十八批（续）验证：音乐组件收起态圆形封面 + 展开/8s 自动收回 + 点外部/Escape 立即收回。
// 用法: node verify-collapse18.js（无头，真实 pointer/key 事件）
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl();
const PORT = 9481;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const ok = (name, cond, detail) => {
  results.push({ name, pass: !!cond, detail });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + JSON.stringify(detail) : ''));
};

const S = `(() => {
  const d = document.getElementById('music-drawer');
  if (!d) return { missing: true, path: location.pathname };
  const m = document.querySelector('.site-mini');
  const disc = document.querySelector('.site-mini__disc');
  const info = document.querySelector('.site-mini__info');
  const cover = document.querySelector('.site-mini__cover');
  const dr = d.getBoundingClientRect(), rr = disc.getBoundingClientRect();
  const cs = getComputedStyle(d), ds = getComputedStyle(disc);
  return { path: location.pathname, vw: innerWidth,
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    collapsed: d.classList.contains('is-collapsed'), display: cs.display,
    w: +dr.width.toFixed(1), h: +dr.height.toFixed(1), left: +dr.left.toFixed(1),
    right: +dr.right.toFixed(1),
    distRight: +(document.documentElement.clientWidth - dr.right).toFixed(1),
    bottomGap: +(innerHeight - dr.bottom).toFixed(1),
    discW: +rr.width.toFixed(1), discH: +rr.height.toFixed(1), discX: +rr.x.toFixed(1), discY: +rr.y.toFixed(1),
    discDistRight: +(document.documentElement.clientWidth - rr.right).toFixed(1),
    pos: cs.position, z: cs.zIndex, infoDisplay: getComputedStyle(info).display,
    ariaExpanded: disc.getAttribute('aria-expanded'), ariaLabel: disc.getAttribute('aria-label'),
    title: disc.getAttribute('title'),
    anim: ds.animationName, playState: ds.animationPlayState, dur: ds.animationDuration, transform: ds.transform,
    cover: cover ? cover.getAttribute('src') : null,
    playing: m ? m.classList.contains('is-playing') : null,
    audio: document.querySelectorAll('audio').length,
    t: (window.SitePlayer && SitePlayer.state) ? SitePlayer.state().currentTime : null,
    bg: ds.backgroundImage.slice(0, 80), radius: ds.borderRadius
  };
})()`;

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'c18-' + Date.now()),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find((t) => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const m = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (d.params.exceptionDetails.text || '').split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      errs.push('ERR ' + (d.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 120));
    }
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async (name, opts = {}) => {
    const png = await send('Page.captureScreenshot', Object.assign({ format: 'png' }, opts));
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(png.data, 'base64'));
    return f;
  };
  const mouse = (type, x, y, extra) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));
  const moveTo = async (x, y) => { await mouse('mouseMoved', x, y, { button: 'none' }); await sleep(80); };
  const clickAt = async (x, y) => {
    await moveTo(x, y);
    await mouse('mousePressed', x, y);
    await sleep(60);
    await mouse('mouseReleased', x, y);
    await sleep(450);
  };
  const clickDisc = async () => { const s = await ev(S); await clickAt(s.discX + s.discW / 2, s.discY + s.discH / 2); return s; };
  const key = async (k, code, vk, text) => {
    const base = { key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    if (text) { base.text = text; base.unmodifiedText = text; }
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
    await sleep(350);
  };
  const nav = async (url) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
    await sleep(1500);
  };

  await send('Page.enable'); await send('Runtime.enable');
  // 这台机器系统级开了「减少动画」，验证旋转前先显式关掉
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ---------- A. 1440 文章页：组件隐藏 → 圆形封面 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await nav(BASE + '/2026/11/04/hello-world/');
  const a = await ev(S);
  ok('隐藏态：抽屉收起为圆形封面', a.collapsed && a.w === 76 && a.h === 76, { w: a.w, h: a.h, collapsed: a.collapsed });
  ok('封面 76×76 正圆', a.discW === 76 && a.discH === 76 && a.radius === '50%', { w: a.discW, h: a.discH, radius: a.radius });
  ok('贴右缘：距视口右 8px、底 20px', a.discDistRight === 8 && a.bottomGap === 20, { right: a.discDistRight, bottom: a.bottomGap });
  ok('固定定位 + 层级 99', a.pos === 'fixed' && a.z === '99', { pos: a.pos, z: a.z });
  ok('封面是当前曲目圆图（label 53%）', /CP-disc-cropped\.webp/.test(a.bg) && !!a.cover, { bg: a.bg, cover: a.cover });
  ok('是否显示由当前曲目决定（非空）', a.audio === 1, { audio: a.audio });
  ok('无横向溢出', a.sw === a.cw, { sw: a.sw, cw: a.cw });
  ok('收起态 aria-expanded=false / label=展开播放器', a.ariaExpanded === 'false' && a.ariaLabel === '展开播放器' && a.title === '展开播放器',
     { ariaExpanded: a.ariaExpanded, ariaLabel: a.ariaLabel, title: a.title });
  ok('暂停时不转', a.playState === 'paused', { playState: a.playState, anim: a.anim });
  // 整页
  const lm = await send('Page.getLayoutMetrics');
  const ch = Math.ceil(lm.cssContentSize.height);
  const fullShot = await shot('feature18-1440-hidden-full', { captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: ch, scale: 1 } });
  // 收起态局部放大：播放中（转）/ 暂停（停）
  await ev('SitePlayer.toggle()');
  await sleep(900);
  let rz = await ev(S);
  const zoomPlaying = await shot('feature18-disc-zoom-playing', { captureBeyondViewport: true, clip: { x: rz.discX - 16, y: rz.discY - 16, width: rz.discW + 32, height: rz.discH + 32, scale: 4 } });
  await ev('SitePlayer.toggle()');
  await sleep(500);
  rz = await ev(S);
  const zoomPaused = await shot('feature18-disc-zoom-paused', { captureBeyondViewport: true, clip: { x: rz.discX - 16, y: rz.discY - 16, width: rz.discW + 32, height: rz.discH + 32, scale: 4 } });

  // ---------- B. 播放时旋转 / 暂停停住 ----------
  await moveTo(200, 200);
  await clickDisc(); // 展开
  let b = await ev(S);
  ok('点击封面原地展开（宽 360、信息可见）', !b.collapsed && b.w === 360 && b.infoDisplay !== 'none',
     { collapsed: b.collapsed, w: b.w, info: b.infoDisplay });
  ok('展开后 aria-expanded=true / label=收起播放器', b.ariaExpanded === 'true' && b.ariaLabel === '收起播放器',
     { ariaExpanded: b.ariaExpanded, ariaLabel: b.ariaLabel });
  ok('展开态贴右下（right 30 / bottom 20）', b.distRight === 30 && b.bottomGap === 20, { right: b.distRight, bottom: b.bottomGap });
  const expShot = await shot('feature18-1440-expanded');
  // 播放
  await ev(`document.querySelector('.site-mini__toggle').click()`);
  await sleep(900);
  b = await ev(S);
  ok('播放中：动画 running', b.playing && b.playState === 'running', { playing: b.playing, playState: b.playState });
  // 暂停：角度停住
  await ev(`document.querySelector('.site-mini__toggle').click()`);
  await sleep(400);
  const p1 = await ev(S); await sleep(500); const p2 = await ev(S);
  ok('暂停：动画 paused 且角度不再变化', p1.playState === 'paused' && p1.transform === p2.transform,
     { state: p1.playState, t1: p1.transform, t2: p2.transform });
  await ev(`document.querySelector('.site-mini__toggle').click()`); // 继续播放，供后面验证进度不中断
  await sleep(600);

  // ---------- C. 8s 无操作自动收回（含悬停不误收） ----------
  const beforeT = (await ev(S)).t;
  await moveTo(150, 150); // 移出组件，避免悬停暂停计时
  await sleep(9000);
  let c = await ev(S);
  ok('展开后 8s 无操作自动收回', c.collapsed, { collapsed: c.collapsed });
  const afterT = c.t;
  ok('收回后播放不中断（进度继续前进）', afterT > beforeT, { before: beforeT, after: afterT });
  // 悬停不误收
  await clickDisc();
  await moveTo(1200, 800); // 悬停在展开后的迷你条内部
  await sleep(9500);
  c = await ev(S);
  ok('鼠标悬停组件内 9.5s 不收回', !c.collapsed, { collapsed: c.collapsed });
  await moveTo(150, 150); // 离开
  await sleep(9000);
  c = await ev(S);
  ok('移出后 8s 收回', c.collapsed, { collapsed: c.collapsed });

  // ---------- D. 连续点击切换 ----------
  await clickDisc();
  await clickDisc();
  let d = await ev(S);
  ok('连续点封面两次 → 收起', d.collapsed, { collapsed: d.collapsed });
  await sleep(9500);
  d = await ev(S);
  ok('收起后等待无残留计时器（保持收起）', d.collapsed, { collapsed: d.collapsed });

  // ---------- E. 点组件外立即收回（含 stopPropagation 元素） ----------
  await clickDisc();
  await moveTo(760, 500);
  await ev(`document.querySelector('.md-text').addEventListener('pointerdown', function (e) { e.stopPropagation(); }, { once: true })`);
  await clickAt(760, 500);
  let e1 = await ev(S);
  ok('点正文（该元素 stopPropagation）立即收回', e1.collapsed, { collapsed: e1.collapsed });
  // 程序化 pointerdown 不应收起
  await clickDisc();
  await ev(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await sleep(300);
  e1 = await ev(S);
  ok('程序化 pointerdown（isTrusted=false）不收回', !e1.collapsed, { collapsed: e1.collapsed });
  // Escape
  await key('Escape', 'Escape', 27);
  e1 = await ev(S);
  ok('Escape 收回', e1.collapsed, { collapsed: e1.collapsed });

  // ---------- F. 切歌换封面 ----------
  const cover1 = (await ev(S)).cover;
  await ev('SitePlayer.next()');
  await sleep(1200);
  const f = await ev(S);
  ok('切歌后封面更新', f.cover && f.cover !== cover1, { before: cover1, after: f.cover });

  // ---------- G. 无障碍：键盘展开 ----------
  await ev(`document.querySelector('.site-mini__disc').focus()`);
  await key('Enter', 'Enter', 13, '\r');
  let g = await ev(S);
  ok('键盘 Enter 展开 / aria-expanded 同步', !g.collapsed && g.ariaExpanded === 'true', { collapsed: g.collapsed, ariaExpanded: g.ariaExpanded });
  await key('Escape', 'Escape', 27);

  // ---------- H. reduced motion ----------
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(300);
  const rm = await ev(S);
  // 设计约定：唱片不因系统「减少动画」而停转，样式中不设 reduced-motion 停转规则
  ok('prefers-reduced-motion 下封面照常旋转（无停转规则）', rm.anim === 'site-mini-spin', { anim: rm.anim });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(200);
  const rm2 = await ev(S);
  ok('恢复 no-preference 后动画回来', rm2.anim === 'site-mini-spin', { anim: rm2.anim });

  // ---------- I. SPA 往返 ----------
  await ev(`(() => { const a = [...document.querySelectorAll('a[href]')].find((x) => new URL(x.href).pathname === '/'); if (a) a.click(); return true; })()`);
  await sleep(2000);
  const home = await ev(S);
  ok('SPA 回首页（有右栏）→ 整条展开', !home.collapsed && home.w === 360, { collapsed: home.collapsed, w: home.w });
  await ev(`(() => { const a = [...document.querySelectorAll('a[href]')].find((x) => new URL(x.href).pathname === '/2026/11/04/hello-world/'); if (a) a.click(); return true; })()`);
  await sleep(2200);
  const art = await ev(S);
  ok('SPA 回文章页 → 恢复圆形封面', art.collapsed && art.w === 76 && art.audio === 1, { collapsed: art.collapsed, w: art.w, audio: art.audio });

  // ---------- J. 音乐页不重复 ----------
  await nav(BASE + '/music/');
  const music = await ev(`(() => { const d = document.getElementById('music-drawer');
    return { display: getComputedStyle(d).display, audio: document.querySelectorAll('audio').length }; })()`);
  ok('音乐页抽屉整体隐藏（有大播放器）', music.display === 'none' && music.audio === 1, music);

  // ---------- K. 375 ----------
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: false });
  await nav(BASE + '/2026/11/04/hello-world/');
  await moveTo(10, 10);
  const k = await ev(S);
  ok('375 收起态 76px、距右 8 / 底 20', k.collapsed && k.discW === 76 && k.discDistRight === 8 && k.bottomGap === 20,
     { w: k.discW, right: k.discDistRight, bottom: k.bottomGap });
  ok('375 无横向溢出', k.sw === k.cw, { sw: k.sw, cw: k.cw });
  const kShot = await shot('feature18-375');
  // 375 点开
  await clickDisc();
  const k2 = await ev(S);
  ok('375 点开可用（宽度收在视口内）', !k2.collapsed && k2.w <= 315 && k2.sw === k2.cw, { w: k2.w, sw: k2.sw, cw: k2.cw });
  await shot('feature18-375-expanded');

  // ---------- L. 1180/1181 ----------
  const bp = {};
  for (const w of [1180, 1181]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await nav(BASE + '/');
    await moveTo(10, 10);
    bp[w] = await ev(S);
  }
  ok('1180 首页（抽屉断点）→ 圆形封面', bp[1180].collapsed && bp[1180].w === 76, { w: bp[1180].w, collapsed: bp[1180].collapsed });
  ok('1181 首页（右栏常驻）→ 整条展开', !bp[1181].collapsed && bp[1181].w === 360, { w: bp[1181].w, collapsed: bp[1181].collapsed });
  ok('1180/1181 均无横向溢出', bp[1180].sw === bp[1180].cw && bp[1181].sw === bp[1181].cw, bp);

  ok('全程无 JS 报错', errs.length === 0, errs.slice(0, 5));

  const pass = results.filter((r) => r.pass).length;
  console.log('\n== ' + pass + '/' + results.length + ' 通过 ==');
  fs.writeFileSync(path.join(SHOTS, 'collapse18.json'), JSON.stringify({ results, fullShot, expShot, zoomPlaying, zoomPaused, kShot }, null, 2));
  ws.close(); proc.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
