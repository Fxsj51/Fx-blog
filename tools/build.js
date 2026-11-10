'use strict';

// 唯一构建入口：hexo clean → hexo generate → tools/minify.js。
// 本地 `npm run build` 与 CI `npm run build:pages` 走的是同一段流程，
// 唯一差别是 --pages 时多传一份 _config.pages.yml（CI 构建前生成，用于子路径 root）。
// 不要再在 workflow 或文档里各写一套 generate + minify。

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HEXO_CLI = path.join(ROOT, 'node_modules', 'hexo-cli', 'bin', 'hexo');
const PAGES_CONFIG = '_config.pages.yml';
const usePages = process.argv.includes('--pages');

function fail(label, code) {
  console.error(`[build] ${label} 失败（退出码 ${code}），构建中止`);
  process.exit(code || 1);
}

function run(args, label) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) fail(`${label}（${res.error.message}）`, 1);
  if (res.status !== 0) fail(label, res.status);
}

function main() {
  if (!fs.existsSync(HEXO_CLI)) {
    fail('找不到 hexo CLI，请先运行 npm ci', 1);
  }

  const configs = ['_config.yml'];
  if (usePages) {
    if (!fs.existsSync(path.join(ROOT, PAGES_CONFIG))) {
      fail(`--pages 需要 ${PAGES_CONFIG}，该文件由 CI 在构建前生成`, 1);
    }
    configs.push(PAGES_CONFIG);
  }

  // clean 是流程的一部分：不清理会把上一次的 public/ 旧文件一起压缩，
  // 导致文件数与体积统计叠加上一轮结果。
  run([HEXO_CLI, 'clean'], 'hexo clean');
  run([HEXO_CLI, 'generate', '--config', configs.join(',')], 'hexo generate');
  run([path.join(ROOT, 'tools', 'minify.js')], 'tools/minify.js');
  console.log('[build] 完成');
}

main();
