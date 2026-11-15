'use strict';
// 验证音乐页唱片点击暂停/继续（无头 CDP，不弹窗）
// 覆盖：点击切换、连点 20 次、角度保持/续转、键盘 Enter/Space、切歌后仍可点、
//       拖动进度条与循环按钮不受影响、SPA 往返、1 个 audio、断点无溢出、截图
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const lib = require('./lib');
const BASE = lib.baseUrl();
const PORT = 9561;
const EDGE = lib.browserPath();
const SHOTS = lib.outDir();
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (n, c, d) => { results.push({ name: n, pass: !!c }); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + JSON.stringify(d) : '')); };

const S = `(() => {
  const a = document.querySelector('audio');
  const d = document.getElementById('music-disc');
  const t = document.getElementById('music-toggle');
  const cs = d ? getComputedStyle(d) : null;
  return {
    playing: a ? (!a.paused && !a.ended) : null,
    label: t ? t.getAttribute('aria-label') : null,
    pressed: t ? t.getAttribute('aria-pressed') : null,
    dLabel: d ? d.getAttribute('aria-label') : null,
    dPressed: d ? d.getAttribute('aria-pressed') : null,
    isPlaying: d ? d.classList.contains('is-playing') : null,
    playState: cs ? cs.animationPlayState : null,
    transform: cs ? cs.transform : null,
    role: d ? d.getAttribute('role') : null,
    tabindex: d ? d.getAttribute('tabindex') : null,
    dw: d ? d.offsetWidth : null, // 布局宽度（不受旋转 transform 影响）
    audioCount: document.querySelectorAll('audio').length,
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    focus: document.activeElement ? document.activeElement.id : '',
    cur: a ? +(a.currentTime || 0).toFixed(2) : null,
    dur: a && isFinite(a.duration) ? +a.duration.toFixed(2) : null,
    src: a ? (a.getAttribute('src') || '').split('/').pop() : null
  };
})()`;

function angle(tr) {
  if (!tr || tr === 'none') return 0;
  const m = /matrix\(([-\d.e]+),\s*([-\d.e]+)/.exec(tr);
  if (!m) return 0;
  const a = Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI;
  return (a + 360) % 360;
}
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const syncOk = (s) => s.playing === (s.label === '暂停') && s.dLabel === s.label && s.pressed === (s.playing ? 'true' : 'false') && s.dPressed === s.pressed && s.isPlaying === s.playing;

(async () => {
  await lib.ensureSite();
  const proc = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(os.tmpdir(), 'disc-' + Date.now()),
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 150 && !wsUrl; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error('CDP 未就绪');
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const mp = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const d = JSON.parse(e.data);
    if (d.id && mp.has(d.id)) { const { r, j } = mp.get(d.id); mp.delete(d.id); d.error ? j(new Error(d.error.message)) : r(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (d.params.exceptionDetails.text || '').split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('ERR ' + (d.params.args || []).map((a) => a.value || '').join(' ').slice(0, 100));
  });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; mp.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async (n) => { const png = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(SHOTS, n + '.png'); fs.writeFileSync(f, Buffer.from(png.data, 'base64')); return f; };
  const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })()`);
  const clickAt = async (x, y, wait) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(25);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(wait == null ? 280 : wait);
  };
  const clickSel = async (sel, wait) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); })()`); await sleep(150); const r = await rectOf(sel); if (!r) throw new Error('no rect ' + sel); await clickAt(r.x + r.w / 2, r.y + r.h / 2, wait); };
  const key = async (k, code, vk, text) => {
    const b = { key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    if (text) b.text = text;
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, b));
    if (text) await send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: text }, { key: k, windowsVirtualKeyCode: vk }));
    await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, b));
    await sleep(350);
  };
  const nav = async (u) => {
    await send('Page.navigate', { url: u });
    for (let i = 0; i < 150; i++) { if (await ev('document.readyState === "complete"')) break; await sleep(100); }
    await sleep(2200);
  };
  const size = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const spaTo = async (p) => {
  const done = await ev(`(() => { const a = [...document.querySelectorAll('a[href]')].find((x) => { try { return new URL(x.href).pathname.endsWith(${JSON.stringify(p)}); } catch (e) { return false; } }); if (a) { a.click(); return true; } return false; })()`);
    await sleep(2400);
    return done;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await size(1440, 900);
  await nav(BASE + '/music/');

  // ---------- 初始 ----------
  let s = await ev(S);
  ok('初始：暂停态，按钮/唱片语义与状态一致', !s.playing && syncOk(s) && s.role === 'button' && s.tabindex === '0',
    { playing: s.playing, label: s.label, pressed: s.pressed, role: s.role, tabindex: s.tabindex });
  ok('初始：全页 1 个 audio', s.audioCount === 1, { audioCount: s.audioCount });
  ok('初始：1440 无横向溢出', s.sw === s.cw, { sw: s.sw, cw: s.cw });
  ok('初始：唱片 120px 未变', s.dw === 120, { dw: s.dw });

  // ---------- 点唱片：播放 / 暂停 ----------
  await clickSel('#music-disc', 500);
  s = await ev(S);
  ok('点唱片 → 开始播放且两边同步', s.playing && syncOk(s) && s.playState === 'running',
    { playing: s.playing, label: s.label, pressed: s.pressed, playState: s.playState });

  const a1 = angle((await ev(S)).transform);
  await sleep(700);
  const a2 = angle((await ev(S)).transform);
  ok('播放中唱片在转', ((a2 - a1 + 360) % 360) > 0.5, { a1: +a1.toFixed(1), a2: +a2.toFixed(1) });
  const shotPlaying = await shot('disc-toggle-1440-playing');

  await clickSel('#music-disc', 500);
  s = await ev(S);
  ok('再点唱片 → 暂停且两边同步', !s.playing && syncOk(s) && s.playState === 'paused',
    { playing: s.playing, label: s.label, pressed: s.pressed, playState: s.playState });
  const p1 = angle(s.transform);
  await sleep(800);
  const p2 = angle((await ev(S)).transform);
  ok('暂停后角度原地停住', near(p1, p2, 0.6), { p1: +p1.toFixed(1), p2: +p2.toFixed(1) });
  const shotPaused = await shot('disc-toggle-1440-paused');

  await clickSel('#music-disc', 450);
  s = await ev(S);
  const r1 = angle(s.transform);
  const delta = (r1 - p1 + 360) % 360;
  ok('继续播放从暂停角度接着转（不归 0）', s.playing && delta > 0 && delta < 30, { pausedAngle: +p1.toFixed(1), resumeAngle: +r1.toFixed(1), delta: +delta.toFixed(1) });

  // ---------- 连点 20 次 ----------
  if (!(await ev(S)).playing) { await clickSel('#music-disc', 400); }
  if (!(await ev(S)).playing) { await clickSel('#music-disc', 400); }
  let expect = false; // 当前真实状态：先记录，再点
  let before = (await ev(S)).playing;
  const mismatches = [];
  for (let i = 1; i <= 20; i++) {
    await clickSel('#music-disc', 90);
    expect = !before;
    const st = await ev(S);
    if (st.playing !== expect) mismatches.push({ click: i, expect, got: st.playing });
    before = st.playing;
  }
  s = await ev(S);
  ok('连点 20 次逐次翻转，无一次被吞', mismatches.length === 0, { mismatches });
  ok('连点 20 次后 UI 与真实状态一致', syncOk(s), { playing: s.playing, label: s.label, pressed: s.pressed, isPlaying: s.isPlaying });

  // ---------- 键盘 ----------
  await ev('document.getElementById("music-disc").focus()');
  ok('唱片可聚焦', (await ev(S)).focus === 'music-disc', { focus: (await ev(S)).focus });
  const kb0 = (await ev(S)).playing;
  await key('Enter', 'Enter', 13);
  ok('Enter 切换', (await ev(S)).playing === !kb0 && syncOk(await ev(S)), { before: kb0, after: (await ev(S)).playing });
  await key('Enter', 'Enter', 13);
  ok('Enter 再切换', (await ev(S)).playing === kb0, { after: (await ev(S)).playing });
  await key(' ', 'Space', 32, ' ');
  ok('Space 切换', (await ev(S)).playing === !kb0, { after: (await ev(S)).playing });
  await key(' ', 'Space', 32, ' ');
  ok('Space 再切换', (await ev(S)).playing === kb0, { after: (await ev(S)).playing });
  await ev('document.getElementById("music-disc").blur()');

  // ---------- 拖动进度条后，唱片点击不受影响 ----------
  if (!(await ev(S)).playing) { await clickSel('#music-disc', 400); }
  let sk = await rectOf('#music-seek');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sk.x + sk.w * 0.2, y: sk.y + sk.h / 2, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sk.x + sk.w * 0.2, y: sk.y + sk.h / 2, button: 'left', clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sk.x + sk.w * 0.6, y: sk.y + sk.h / 2, button: 'left', buttons: 1 });
  await sleep(120);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sk.x + sk.w * 0.6, y: sk.y + sk.h / 2, button: 'left', clickCount: 1 });
  await sleep(600);
  s = await ev(S);
  const ratio = s.dur > 0 ? s.cur / s.dur : 0;
  ok('拖动进度条仍可 seek 到 60% 附近', ratio > 0.45 && ratio < 0.75, { cur: s.cur, dur: s.dur, ratio: +ratio.toFixed(2) });
  const b4 = s.playing;
  await clickSel('#music-disc', 400);
  ok('拖动后立刻点唱片仍然生效（不被补发 click 吃掉）', (await ev(S)).playing === !b4, { before: b4, after: (await ev(S)).playing });

  // ---------- 循环按钮 ----------
  const loopSeq = [];
  for (let i = 0; i < 3; i++) { await clickSel('#music-loop', 200); loopSeq.push(await ev('document.getElementById("music-loop").getAttribute("aria-label")')); }
  ok('循环按钮三态仍正常', loopSeq.join('>') === '单曲循环>不循环>列表循环', { loopSeq });

  // ---------- 切歌后 ----------
  const item = await rectOf('.music-item:nth-child(2)');
  await clickAt(item.x + 80, item.y + item.h / 2, 900);
  s = await ev(S);
  ok('切歌后正常播放', s.playing && syncOk(s), { src: s.src, playing: s.playing });
  await clickSel('#music-disc', 450);
  ok('切歌后点唱片可暂停', !(await ev(S)).playing, { playing: (await ev(S)).playing });
  await clickSel('#music-disc', 450);
  ok('切歌后再点可继续', (await ev(S)).playing, { playing: (await ev(S)).playing });
  await clickSel('#music-disc', 450); // 收尾为暂停

  // ---------- SPA 往返 ----------
  const went = await spaTo('/');
  await sleep(600);
  const homeAudio = await ev('document.querySelectorAll("audio").length');
  const back = await spaTo('/music/');
  s = await ev(S);
  ok('SPA 往返回到音乐页：唱片可点、状态同步、1 个 audio',
    went && back && s.role === 'button' && s.audioCount === 1 && homeAudio === 1 && syncOk(s),
    { went, back, audioCount: s.audioCount, homeAudio, playing: s.playing });
  const beforeSpa = s.playing;
  await clickSel('#music-disc', 500);
  ok('SPA 回来后点唱片仍能切换', (await ev(S)).playing === !beforeSpa, { before: beforeSpa, after: (await ev(S)).playing });
  await clickSel('#music-disc', 400);

  // ---------- 断点 ----------
  for (const [w, h] of [[1181, 900], [1180, 900], [901, 800], [900, 800]]) {
    await size(w, h); await sleep(700);
    const st = await ev(S);
    ok(w + ' 音乐页无横向溢出', st.sw === st.cw, { sw: st.sw, cw: st.cw });
    ok(w + ' 唱片尺寸/可点性正常', st.dw === 120 && st.role === 'button', { dw: st.dw });
    const b = st.playing;
    await clickSel('#music-disc', 350);
    ok(w + ' 唱片点击切换正常', (await ev(S)).playing === !b, {});
    await clickSel('#music-disc', 300);
  }

  // ---------- 375 ----------
  await size(375, 800); await sleep(700);
  s = await ev(S);
  ok('375 无横向溢出', s.sw === s.cw, { sw: s.sw, cw: s.cw });
  ok('375 唱片 88px 未变', s.dw === 88, { dw: s.dw });
  const b375 = s.playing;
  await clickSel('#music-disc', 400);
  ok('375 唱片点击切换正常', (await ev(S)).playing === !b375, {});
  if ((await ev(S)).playing) await clickSel('#music-disc', 300);
  const shot375 = await shot('disc-toggle-375-paused');

  ok('无 JS 异常/错误日志', errs.length === 0, { errs });

  const fails = results.filter((r) => !r.pass);
  console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + ' ' + (results.length - fails.length) + '/' + results.length);
  console.log('SHOT 1440 playing: ' + shotPlaying);
  console.log('SHOT 1440 paused : ' + shotPaused);
  console.log('SHOT 375         : ' + shot375);

  const report = path.join(SHOTS, 'disc-toggle-report.json');
  fs.writeFileSync(report, JSON.stringify({ results, errs, shots: [shotPlaying, shotPaused, shot375] }, null, 2));
  ws.close(); proc.kill();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(2); });


