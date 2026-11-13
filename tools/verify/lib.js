'use strict';
/*
 * 回归脚本共用配置：仓库根、站点地址、输出目录、浏览器路径。
 * 所有脚本只依赖仓库内相对路径；需要改地址/浏览器时用环境变量覆盖：
 *   VERIFY_BASE=http://127.0.0.1:4173   站点地址（默认 4173）
 *   VERIFY_BROWSER=/path/to/chrome      Chromium 内核浏览器可执行文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

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

module.exports = { ROOT, baseUrl, outDir, browserPath };
