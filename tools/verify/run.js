'use strict';
/*
 * 回归入口：npm run verify
 * - 需要先 npm run build（脚本直接读 public/）
 * - 自动复用或启动 tools/preview.js（4173，支持 HTTP Range，音频进度条才可拖动）
 * - 两类脚本：
 *   有数值断言 —— 失败即整体非零退出；
 *   观测型     —— 只打印实测值，退出码为 0 时不算失败（用于看几何/文案是否漂移）
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const lib = require('./lib');

const PORT = 4173;
const PUBLIC_INDEX = path.join(lib.ROOT, 'public', 'index.html');

// 有数值断言：退出码非零即失败
const ASSERT = [
  ['verify-collapse18.js', '迷你条收起/展开、8s 自动收回、点外收起、SPA、375/1180/1181'],
  ['verify-loop-vol.js', '循环三态、音量四档与持久化、键盘、375 无溢出'],
  ['verify-disc-toggle.js', '唱片播放/暂停、进度条拖动、断点 900/901/1180/1181'],
  ['verify-quote.js', '首页一言卡、卡片高度稳定、SPA 重建、375 抽屉不重叠']
];

// 观测型：打印实测值，不参与通过/失败判定
const OBSERVE = [
  ['verify-format-time.js', 'formatTime 各入参结果与曲目时长显示值'],
  ['check-dur.js', '无 LRC / 有 LRC 两种状态下的时长文案'],
  ['verify-lyrics-wheel.js', '歌词区无 LRC 锁滚、有 LRC 可滚与自动跟随、SPA 往返'],
  ['verify-flow.js', '右栏整页滚动、左栏吸顶、1440/1180/1181/375 几何'],
  ['verify-gc.js', 'GoatCounter 计数路径与 count.js 被拦截时静默']
];

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  const url = lib.baseUrl() + '/';
  if (await probe(url)) {
    console.log('[verify] 复用已在运行的 ' + url);
    return null;
  }
  const child = spawn(process.execPath, [path.join(lib.ROOT, 'tools', 'preview.js'), '--port', String(PORT)], {
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    if (await probe(url)) {
      console.log('[verify] 已启动 tools/preview.js -> ' + url);
      return child;
    }
    await sleep(150);
  }
  try { child.kill(); } catch (e) {}
  throw new Error('本地预览服务启动失败：' + url + '（端口 ' + PORT + ' 是否被占用？）');
}

function runOne(file, label) {
  const script = path.join(__dirname, file);
  console.log('\n[verify] ▶ ' + file + ' — ' + label);
  const r = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { VERIFY_BASE: lib.baseUrl() })
  });
  return r.status === 0;
}

(async () => {
  if (!fs.existsSync(PUBLIC_INDEX)) {
    console.error('[verify] 未找到 public/index.html，请先运行 npm run build');
    process.exit(1);
  }

  let server = null;
  let interrupted = false;
  const stop = () => { if (server) { try { server.kill(); } catch (e) {} } };
  process.on('SIGINT', () => { interrupted = true; stop(); process.exit(130); });

  try {
    server = await ensureServer();
  } catch (e) {
    console.error('[verify] ' + e.message);
    process.exit(1);
  }

  const failedAssert = [];
  for (const [file, label] of ASSERT) {
    if (!runOne(file, label)) failedAssert.push(file);
  }

  let observeBroken = [];
  for (const [file, label] of OBSERVE) {
    if (!runOne(file, label)) observeBroken.push(file);
  }

  stop();

  console.log('\n================ [verify] 汇总 ================');
  console.log('有断言脚本：' + (ASSERT.length - failedAssert.length) + '/' + ASSERT.length + ' 通过');
  if (failedAssert.length) failedAssert.forEach((f) => console.log('  未通过：' + f));
  console.log('观测型脚本：' + (OBSERVE.length - observeBroken.length) + '/' + OBSERVE.length + ' 无异常退出');
  if (observeBroken.length) observeBroken.forEach((f) => console.log('  异常退出：' + f));
  console.log('截图与报告：' + path.join('tools', 'verify', 'out'));
  console.log('==============================================');

  if (!interrupted && failedAssert.length) process.exit(1);
})().catch((e) => {
  console.error('[verify] FATAL', (e && e.stack) || e);
  process.exit(2);
});
