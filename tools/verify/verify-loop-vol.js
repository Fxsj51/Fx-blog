'use strict';
// 本轮验证：循环图标改版（参考图圆环双箭头）+ 音量条开合控件
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl();
const PORT = 9431;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'loopvol-' + Date.now()),
    '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
    // 窗口被遮挡时浏览器会暂停合成/动画，自动化里会导致过渡停在起始帧（截图/焦点断言抖动）
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
    'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 120 && !wsUrl; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await sleep(200);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const m = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && m.has(d.id)) { const { r, j } = m.get(d.id); m.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') {
      const x = d.params.exceptionDetails || {};
      const st = ((x.stackTrace && x.stackTrace.callFrames) || []).slice(0, 3).map((f) => f.functionName + '@' + (f.url || '').replace(BASE, '') + ':' + (f.lineNumber + 1));
      errs.push({ text: ((x.exception && x.exception.description) || x.text || '').split('\n')[0], st });
    }
  });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; m.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result.value; };
  const ready = async () => { for (let i = 0; i < 200; i++) { if (await ev('document.readyState === "complete"')) return; await sleep(100); } };
  const metrics = (w, h, mobile, dpr) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr || 1, mobile: !!mobile });
  await send('Page.enable'); await send('Runtime.enable');
  await metrics(1440, 900, false, 1);

  const results = [];
  const check = (n, ok, d) => { results.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + '  ' + JSON.stringify(d)); };
  const waitFor = async (expr, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };

  // 截图：控件行 + 展开浮层的并集（浮层在控件行上方，clip 要把它包进来）
  const shotUnion = async (name) => {
    const r = await ev(`(() => {
      const parts = [document.querySelector('.music-ctl')];
      const pop = document.querySelector('.music-vol__pop');
      if (pop && getComputedStyle(pop).visibility === 'visible') parts.push(pop);
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      parts.forEach((el) => { const b = el.getBoundingClientRect(); x1 = Math.min(x1, b.left); y1 = Math.min(y1, b.top); x2 = Math.max(x2, b.right); y2 = Math.max(y2, b.bottom); });
      return { x: x1 + scrollX, y: y1 + scrollY, w: x2 - x1, h: y2 - y1 };
    })()`);
    const png = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - 16, y: r.y - 16, width: r.w + 32, height: r.h + 32, scale: 2 } });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(png.data, 'base64'));
    console.log('SHOT ' + name + ' ' + (fs.statSync(path.join(SHOTS, name)).size / 1024).toFixed(0) + 'KB');
  };
  const shotIcon = async (sel, name, scale) => {
    await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`);
    await sleep(250);
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
    const png = await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - 4, y: r.y - 4, width: r.w + 8, height: r.h + 8, scale: scale || 6 } });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(png.data, 'base64'));
    console.log('SHOT ' + name);
  };

  const ST = `(() => {
    const q = (s) => document.querySelector(s);
    const a = q('#music-audio');
    const btn = q('#music-loop');
    const mute = q('#music-mute');
    const wrap = q('#music-vol-wrap');
    const pop = q('#music-vol-pop');
    const vol = q('#music-vol');
    const rect = (s) => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    const volSvg = mute ? mute.querySelector('svg') : null;
    const volPaths = volSvg ? Array.prototype.map.call(volSvg.querySelectorAll('path'), (p) => p.getAttribute('d')) : [];
    const loopSvg = btn ? btn.querySelector('svg') : null;
    const loopPaths = loopSvg ? Array.prototype.map.call(loopSvg.querySelectorAll('path'), (p) => p.getAttribute('d')) : [];
    return {
      path: location.pathname,
      label: btn ? btn.getAttribute('aria-label') : null,
      title: btn ? btn.getAttribute('title') : null,
      mode: btn ? btn.getAttribute('data-mode') : null,
      isOff: btn ? btn.classList.contains('is-off') : null,
      loopPaths: loopPaths,
      loopText: loopSvg && loopSvg.querySelector('text') ? loopSvg.querySelector('text').textContent : null,
      lsLoop: (() => { try { return localStorage.getItem('stellar:v2:player-loop-mode'); } catch (e) { return 'ERR'; } })(),
      audioLoop: a ? a.loop : null,
      volume: a ? Math.round(a.volume * 100) / 100 : null,
      mutedAttr: a ? a.muted : null,
      lsVol: (() => { try { return localStorage.getItem('stellar:v2:player-volume'); } catch (e) { return 'ERR'; } })(),
      volOpen: wrap ? wrap.classList.contains('is-open') : null,
      volExpanded: mute ? mute.getAttribute('aria-expanded') : null,
      volLabel: mute ? mute.getAttribute('aria-label') : null,
      volTitle: mute ? mute.getAttribute('title') : null,
      volPaths: volPaths,
      volSlider: vol ? Number(vol.value) : null,
      volValueText: vol ? vol.getAttribute('aria-valuetext') : null,
      popVis: pop ? getComputedStyle(pop).visibility : null,
      popOpacity: pop ? Number(getComputedStyle(pop).opacity) : null,
      popRect: rect('#music-vol-pop'),
      muteRect: rect('#music-mute'),
      loopRect: rect('#music-loop'),
      seekRect: rect('#music-seek'),
      ctlRect: rect('.music-ctl'),
      focused: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      bsw: document.body ? document.body.scrollWidth : null,
      sx: window.scrollX, sy: window.scrollY,
      audios: document.querySelectorAll('audio').length,
      playing: a ? !a.paused : null
    };
  })()`;

  const setVol = async (pct) => ev(`(() => { const v = document.getElementById('music-vol'); v.value = '${pct}'; v.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const clickMute = async () => { await ev('document.getElementById("music-mute").click()'); await sleep(300); };
  const keySlider = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(200);
  };

  // ---------- 1440：干净起点 ----------
  await send('Page.navigate', { url: BASE + '/music/' });
  await ready(); await sleep(1800);
  await ev('localStorage.removeItem("stellar:v2:player-loop-mode"); localStorage.removeItem("stellar:v2:player-volume")');
  await send('Page.reload'); await ready(); await sleep(1800);
  const s0 = await ev(ST);
  const OLD = 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3';
  const CIRCLE = 'M3.88 5.19A10.6 10.6 0 0 1 22.6 12M20.12 18.81A10.6 10.6 0 0 1 1.4 12M1.45 1.5L1.45 7.5L7.45 7.5M22.55 22.5L22.55 16.5L16.55 16.5';
  check('列表循环图标逐字节保持旧 repeat 路径（未动）', s0.loopPaths.length === 1 && s0.loopPaths[0] === OLD && s0.loopText === null, { paths: s0.loopPaths });
  check('三态仍从列表循环开始（标签/持久化）', s0.label === '列表循环' && s0.mode === 'list' && s0.audioLoop === false && s0.lsLoop === null, { label: s0.label, mode: s0.mode, ls: s0.lsLoop });
  check('音量默认收起：默认满音量→喇叭+三道波（无 ×），滑块隐藏', s0.volOpen === false && s0.volExpanded === 'false' && s0.popVis === 'hidden' && s0.volPaths.length === 4 && !/M15\.2/.test(s0.volPaths.join('')) && s0.volume === 1 && s0.volSlider === 100, { open: s0.volOpen, expanded: s0.volExpanded, vis: s0.popVis, paths: s0.volPaths, vol: s0.volume, slider: s0.volSlider });

  // ---------- 点按展开：不挤动、不产生横向滚动 ----------
  const before = { toggle: await ev('(() => { const b = document.getElementById("music-toggle").getBoundingClientRect(); return {x: Math.round(b.left), y: Math.round(b.top)}; })()'), ctl: s0.ctlRect, sw: s0.sw, cw: s0.cw, sx: s0.sx };
  await clickMute();
  await waitFor('Number(getComputedStyle(document.getElementById("music-vol-pop")).opacity) === 1', 4000);
  const o1 = await ev(ST);
  check('点按展开音量条（aria-expanded=true、浮层可见、滑块获得焦点）', o1.volOpen === true && o1.volExpanded === 'true' && o1.popVis === 'visible' && o1.popOpacity === 1 && o1.focused === 'music-vol', { open: o1.volOpen, expanded: o1.volExpanded, vis: o1.popVis, op: o1.popOpacity, focus: o1.focused });
  const toggleAfter = await ev('(() => { const b = document.getElementById("music-toggle").getBoundingClientRect(); return {x: Math.round(b.left), y: Math.round(b.top)}; })()');
  check('展开不改变控件行布局（播放键位置/行宽高/进度条位置全部不动）', JSON.stringify(toggleAfter) === JSON.stringify(before.toggle) && JSON.stringify(o1.ctlRect) === JSON.stringify(s0.ctlRect) && JSON.stringify(o1.seekRect) === JSON.stringify(s0.seekRect), { ctlBefore: s0.ctlRect, ctlAfter: o1.ctlRect, toggleBefore: before.toggle, toggleAfter });
  check('展开/收起不产生横向滚动（scrollWidth 不变、scrollX=0）', o1.sw === o1.cw && o1.sw === before.sw && o1.sx === 0 && o1.bsw === o1.cw, { sw: o1.sw, cw: o1.cw, before: before.sw, sx: o1.sx });
  const hit = await ev(`(() => { const v = document.getElementById('music-vol'); const b = v.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el ? (el.id || el.tagName) : null; })()`);
  check('浮层没有被裁剪/遮挡（滑块中心命中元素就是滑块）', hit === 'music-vol', { hit });

  // ---------- 滑块真实控制音量：0 / 0.5 / 1 ----------
  await setVol(0);
  const v0 = await ev(ST);
  check('拖到 0 → audio.volume=0、静音图标（叠 ×）、持久化 0', v0.volume === 0 && /M15\.2/.test((v0.volPaths || []).join('')) && /静音/.test(v0.volLabel || '') && v0.lsVol === '0' && v0.volSlider === 0 && v0.mutedAttr === false, { vol: v0.volume, label: v0.volLabel, ls: v0.lsVol, muted: v0.mutedAttr });
  await setVol(50);
  const v50 = await ev(ST);
  check('拖到 50 → audio.volume=0.5、图标恢复喇叭、持久化 0.5', v50.volume === 0.5 && !/M15\.2/.test((v50.volPaths || []).join('')) && v50.volLabel === '音量' && v50.lsVol === '0.5' && v50.volSlider === 50, { vol: v50.volume, label: v50.volLabel, ls: v50.lsVol });
  await setVol(100);
  const v100 = await ev(ST);
  check('拖到满值 → audio.volume=1、持久化 1', v100.volume === 1 && v100.lsVol === '1' && v100.volSlider === 100, { vol: v100.volume, ls: v100.lsVol });

  // ---------- 键盘方向键 ----------
  await ev('document.getElementById("music-vol").focus()');
  await keySlider('ArrowLeft', 'ArrowLeft', 37);
  const k1 = await ev(ST);
  await keySlider('ArrowLeft', 'ArrowLeft', 37);
  const k2 = await ev(ST);
  await keySlider('ArrowRight', 'ArrowRight', 39);
  const k3 = await ev(ST);
  check('滑块键盘可操作（← 降音量、→ 升音量）', k1.volume === 0.99 && k2.volume === 0.98 && k3.volume === 0.99 && k3.volSlider === 99, { after1: k1.volume, after2: k2.volume, after3: k3.volume });

  // ---------- 再点收起 / 悬停展开与收起 ----------
  await clickMute();
  const c1 = await ev(ST);
  check('再点一次收起（浮层隐藏、aria-expanded=false）', c1.volOpen === false && c1.volExpanded === 'false' && c1.popVis === 'hidden' && c1.sw === c1.cw, { open: c1.volOpen, vis: c1.popVis, sw: c1.sw, cw: c1.cw });
  await ev('document.getElementById("music-mute").blur()');
  const bc = await ev('(() => { const b = document.getElementById("music-mute").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bc.x, y: bc.y, buttons: 0 });
  await sleep(350);
  const h1 = await ev(ST);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 6, y: 6, buttons: 0 });
  await sleep(350);
  const h2 = await ev(ST);
  check('悬停展开、移开自动收起（未锁定）', h1.volOpen === true && h1.popVis === 'visible' && h2.volOpen === false && h2.popVis === 'hidden', { hover: h1.volOpen, leave: h2.volOpen });

  // ---------- 持久化：音量 0.4 + 循环 off，刷新与 SPA 往返 ----------
  await setVol(40);
  await ev('document.getElementById("music-loop").click()'); // list -> one
  await sleep(250);
  const oneState = await ev(ST);
  check('单曲循环：仅此态换成参考图圆环双箭头（并保留「1」标记）', oneState.mode === 'one' && oneState.loopPaths.length === 1 && oneState.loopPaths[0] === CIRCLE && oneState.loopText === '1' && oneState.audioLoop === true && oneState.lsLoop === 'one', { paths: oneState.loopPaths, text: oneState.loopText, loop: oneState.audioLoop });
  await ev('document.getElementById("music-loop").click()'); // one -> off
  await sleep(250);
  const pre = await ev(ST);
  check('不循环：图标与旧版逐字节一致（旧 repeat + 斜杠）、置灰', pre.mode === 'off' && pre.isOff === true && pre.lsLoop === 'off' && pre.loopPaths.length === 2 && pre.loopPaths[0] === OLD && pre.loopPaths[1] === 'M4 4l16 16', { mode: pre.mode, isOff: pre.isOff, paths: pre.loopPaths });
  await send('Page.reload'); await ready(); await sleep(1800);
  const rs = await ev(ST);
  check('刷新后音量 0.4 与循环 off 都保持（图标非静音）', rs.volume === 0.4 && rs.volSlider === 40 && rs.lsVol === '0.4' && rs.mode === 'off' && rs.audioLoop === false && !/M15\.2/.test((rs.volPaths || []).join('')), { vol: rs.volume, slider: rs.volSlider, mode: rs.mode });
  await ev('(() => { const a = document.querySelector("a.site-brand") || document.querySelector("a[href=\\"/\\"]"); if (a) a.click(); })()');
  await waitFor('location.pathname === "/"');
  await sleep(900);
  await ev('(() => { const a = document.querySelector("a[href=\\"/music/\\"]"); if (a) a.click(); })()');
  await waitFor('location.pathname === "/music/"');
  await sleep(1200);
  const sp = await ev(ST);
  check('SPA 往返后音量与循环模式保持（单 audio、音量 0.4）', sp.volume === 0.4 && sp.mode === 'off' && sp.audios === 1 && sp.volSlider === 40, { vol: sp.volume, mode: sp.mode, audios: sp.audios });

  // ---------- 0 音量持久化 + 拖回恢复 ----------
  await setVol(0);
  await send('Page.reload'); await ready(); await sleep(1800);
  const z = await ev(ST);
  check('音量 0 刷新后仍是静音态（volume=0、× 图标）', z.volume === 0 && /M15\.2/.test((z.volPaths || []).join('')) && z.lsVol === '0' && z.volSlider === 0, { vol: z.volume, ls: z.lsVol });
  await clickMute();
  await setVol(70);
  const rec = await ev(ST);
  check('从静音拖回 70 → 图标恢复、音量生效', rec.volume === 0.7 && !/M15\.2/.test((rec.volPaths || []).join('')) && rec.volLabel === '音量', { vol: rec.volume, label: rec.volLabel });
  await clickMute(); // 收起，拍收起态截图

  // ---------- 1440 截图（收起 / 展开） ----------
  await shotUnion('loop-vol-1440-closed.png');
  await clickMute();
  await shotUnion('loop-vol-1440-open.png');
  await ev('window.SitePlayer.setLoopMode("list")'); await sleep(250);
  await shotIcon('#music-loop', 'loop-icon-list-zoom.png', 8);
  await ev('window.SitePlayer.setLoopMode("one")'); await sleep(250);
  await shotIcon('#music-loop', 'loop-icon-one-zoom.png', 8);
  await ev('window.SitePlayer.setLoopMode("off")'); await sleep(250);
  await shotIcon('#music-loop', 'loop-icon-off-zoom.png', 8);
  await ev('window.SitePlayer.setLoopMode("list")'); await sleep(250);
  await shotIcon('#music-mute', 'vol-icon-zoom.png', 8);

  // ---------- 375 ----------
  await metrics(375, 812, true, 2);
  await send('Page.navigate', { url: BASE + '/music/' });
  await ready(); await sleep(1800);
  const m0 = await ev(ST);
  check('375 收起态：控件行无横向溢出、音量按钮在（5 号位）', m0.sw === m0.cw && m0.volOpen === false && m0.muteRect && m0.muteRect.x > m0.loopRect.x, { dom: m0.sw + '/' + m0.cw, mute: m0.muteRect, loop: m0.loopRect, ctl: m0.ctlRect });
  await shotUnion('loop-vol-375-closed.png');
  await ev('window.scrollTo(0, 0)');
  await sleep(200);
  await clickMute();
  await waitFor('Number(getComputedStyle(document.getElementById("music-vol-pop")).opacity) === 1', 4000);
  const m1 = await ev(ST);
  check('375 展开态：浮层完整在视口内且不产生横向滚动', m1.volOpen === true && m1.popRect && m1.popRect.x >= 0 && (m1.popRect.x + m1.popRect.w) <= m1.cw && m1.sw === m1.cw && m1.sx === 0, { pop: m1.popRect, cw: m1.cw, sw: m1.sw, sx: m1.sx });
  await shotUnion('loop-vol-375-open.png');
  await ev('window.scrollTo(0, 0)');

  // ---------- 1440 再确认（切回桌面断点） ----------
  await metrics(1440, 900, false, 1);
  await send('Page.navigate', { url: BASE + '/music/' });
  await ready(); await sleep(1500);
  const fin = await ev(ST);
  check('1440/375 均无横向溢出、全页仍只有 1 个 <audio>', fin.sw === fin.cw && fin.audios === 1 && fin.volume === 0.7, { dom: fin.sw + '/' + fin.cw, audios: fin.audios, vol: fin.volume });

  const cleanErrs = errs.filter((e) => !/favicon|net::ERR/.test(e.text));
  check('无 JS 报错', cleanErrs.length === 0, { errs: cleanErrs.slice(0, 3) });

  const failed = results.filter((r) => !r.ok);
  console.log('\n===== ' + (results.length - failed.length) + '/' + results.length + ' PASS =====');
  failed.forEach((f) => console.log('FAILED: ' + f.n));
  fs.writeFileSync(path.join(SHOTS, 'loop-vol-verify.json'), JSON.stringify({ results, errors: cleanErrs }, null, 2));
  ws.close(); proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });
