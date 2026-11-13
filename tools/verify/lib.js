'use strict';
/*
 * 回归脚本共用配置与服务生命周期：
 *   VERIFY_BASE=http://127.0.0.1:4173   站点地址（默认 4173）
 *   VERIFY_BROWSER=/path/to/chrome      Chromium 内核浏览器可执行文件
 *
 * 任何一个脚本单独运行时都会调用 ensureSite()：
 *   - 端口上已有 tools/preview.js 在跑 → 直接复用，绝不重复启动，也不会去关它；
 *   - 端口空闲 → 自己 spawn tools/preview.js，跑完在退出路径统一关闭；
 *   - 端口被别的程序占用 → 明确报错退出，不静默连上去跑出一堆 undefined。
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const PUBLIC_INDEX = path.join(ROOT, 'public', 'index.html');

let child = null;      // 本进程启动的预览服务；复用别人起的服务时保持 null
let ensured = null;    // ensureSite() 的结果缓存

function baseUrl() {
  return (process.env.VERIFY_BASE || 'http://127.0.0.1:4173').replace(/\/+$/, '');
}

function outDir() {
  fs.mkdirSync(OUT, { recursive: true });
  return OUT;
}

function browserPath() {
  const env = process.env.VERIFY_BROWSER;
  if (env) {
    if (fs.existsSync(env)) return env;
    throw new Error('VERIFY_BROWSER 指向的文件不存在：' + env);
  }
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  throw new Error('未找到 Chromium 内核浏览器，请设置 VERIFY_BROWSER 指向 msedge/chrome 可执行文件');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, timeout) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 512) body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout || 1500, () => { req.destroy(); resolve(null); });
  });
}

// 识别端口上跑的是不是 tools/preview.js：
// 它对任意路径都带 Accept-Ranges: bytes，且 404 响应体固定为 "404 Not Found"
async function classify(origin) {
  const root = await get(origin + '/', 1500);
  if (!root) return 'none';
  const miss = await get(origin + '/__verify_probe__', 1500);
  const isPreview = root.status === 200 &&
    /bytes/i.test(String(root.headers['accept-ranges'] || '')) &&
    miss && miss.status === 404 && miss.body.trim() === '404 Not Found';
  return isPreview ? 'preview' : 'foreign';
}

function stopServer() {
  if (!child) return;
  const c = child;
  child = null;
  try { c.kill(); } catch (e) {}
}

// 不论正常结束、异常退出还是 Ctrl+C，都释放自己起的服务（复用的服务不动）
process.on('exit', stopServer);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => { stopServer(); process.exit(sig === 'SIGINT' ? 130 : 143); });
});
process.on('uncaughtException', (e) => {
  stopServer();
  console.error('FATAL ' + ((e && e.message) || e));
  process.exit(2);
});

async function ensureSite() {
  if (ensured) return ensured;
  if (!fs.existsSync(PUBLIC_INDEX)) {
    throw new Error('未找到 public/index.html，请先运行 npm run build');
  }
  const u = new URL(baseUrl());
  const origin = u.origin;
  const host = u.hostname;
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));

  const kind = await classify(origin);
  if (kind === 'preview') {
    console.log('[verify] 复用已在运行的预览服务 ' + origin + '（跑完不会关闭它）');
    ensured = { reused: true, origin: origin };
    return ensured;
  }
  if (kind === 'foreign') {
    throw new Error(origin + ' 已被其他程序占用（响应不像 tools/preview.js）。请关闭该进程，' +
      '或换端口：VERIFY_BASE=http://127.0.0.1:<其他端口>');
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('无法自动为远程地址启动预览服务：' + origin + '（请自行启动后重试）');
  }

  child = spawn(process.execPath, [path.join(ROOT, 'tools', 'preview.js'), '--port', String(port)], {
    stdio: 'ignore'
  });
  // 不能让它把父进程的事件循环挂住：脚本跑完自然结束时，退出钩子里再 kill
  child.unref();
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });

  for (let i = 0; i < 60; i++) {
    if (exited) break;
    if (await classify(origin) === 'preview') {
      console.log('[verify] 已启动 tools/preview.js -> ' + origin + '（结束时自动关闭）');
      ensured = { reused: false, origin: origin };
      return ensured;
    }
    await sleep(150);
  }
  stopServer();
  throw new Error('预览服务启动失败：' + origin + '（端口是否被占用？可换 VERIFY_BASE 指定端口）');
}

module.exports = {
  ROOT,
  baseUrl,
  outDir,
  browserPath,
  ensureSite,
  stopServer
};
