'use strict';
/*
 * 回归入口：npm run verify
 * - 需要先 npm run build（脚本直接读 public/）
 * - 预览服务由 lib.ensureSite() 统一处理：已有就复用，没有就起 tools/preview.js（实例共享，不会起两次）
 * - 两类脚本：
 *   有数值断言 —— 失败即整体非零退出；
 *   观测型     —— 只打印实测值，退出码为 0 时不算失败（用于看几何/文案是否漂移）
 */
const { spawnSync } = require('child_process');
const path = require('path');
const lib = require('./lib');

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
  ['verify-gc.js', 'GoatCounter 计数路径与 count.js 被拦截时静默'],
  ['verify-spa-hygiene.js', 'SPA 换页监听无泄漏、无 JS 异常、favicon 与相对路径无 404']
];

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
  try {
    await lib.ensureSite();
  } catch (e) {
    console.error('[verify] ' + e.message);
    process.exit(1);
  }

  const failedAssert = [];
  for (const [file, label] of ASSERT) {
    if (!runOne(file, label)) failedAssert.push(file);
  }

  const observeBroken = [];
  for (const [file, label] of OBSERVE) {
    if (!runOne(file, label)) observeBroken.push(file);
  }

  lib.stopServer();

  console.log('\n================ [verify] 汇总 ================');
  console.log('有断言脚本：' + (ASSERT.length - failedAssert.length) + '/' + ASSERT.length + ' 通过');
  if (failedAssert.length) failedAssert.forEach((f) => console.log('  未通过：' + f));
  console.log('观测型脚本：' + (OBSERVE.length - observeBroken.length) + '/' + OBSERVE.length + ' 无异常退出');
  if (observeBroken.length) observeBroken.forEach((f) => console.log('  异常退出：' + f));
  console.log('截图与报告：' + path.join('tools', 'verify', 'out'));
  console.log('==============================================');

  if (failedAssert.length) process.exit(1);
})().catch((e) => {
  console.error('[verify] FATAL', (e && e.stack) || e);
  process.exit(2);
});
