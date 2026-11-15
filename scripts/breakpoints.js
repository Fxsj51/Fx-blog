'use strict';

// 断点一致性自检：CSS 媒体查询只能写字面量，跨语言无法真正共享常量，
// 所以这里在构建期做校验，改了一处而漏改另一处时直接构建失败。
//
// 同源三处：
//   1. source/css/site-custom.css 媒体查询字面量
//      （1180/1181：右栏抽屉；667/668、919/920、1024/1025：左栏梯次；900：窄屏背景图）
//   2. _config.stellar.yml 背景图 preload 的 media 属性（901/900）、body_end 注入脚本里的
//      RIGHTBAR_DRAWER_MAX，以及 head_end 注入脚本里的 LEFTBAR_DRAWER_MAX（=667，抽屉上限）
//      与 LEFTBAR_FULL_MIN（=1025，无条件完整形态下限）
//   3. patches/hexo-theme-stellar+2.0.0.patch 里主题的 rightbarDrawerQuery / leftbar*Query
// 另外 source/music/index.md 自带 <style> 也用了 1180/1181，一并校验。
const fs = require('fs');
const path = require('path');

const RIGHTBAR_DRAWER_MAX = 1180;
const LEFTBAR_DRAWER_MAX = 667;
// 668–919 只有 64 窄条；920 起允许完整 340（主栏 ≥560 的算值：340 + 560 + 17 滚动条 = 917，取整 920）
const LEFTBAR_RAIL_MAX = 919;
const LEFTBAR_FULL_MIN = 1025;
// 背景图切换断点（与侧栏无关，保持独立）
const BACKGROUND_MAX = 900;

function read(relative) {
  return fs.readFileSync(path.join(hexo.base_dir, relative), 'utf8');
}

// 注释里也会写断点数值（同源说明），统计前先剔除，避免把注释算成媒体查询
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function countLiteral(text, kind, width) {
  const re = new RegExp(kind + '-width:\\s*' + width + 'px', 'g');
  return (text.match(re) || []).length;
}

function check() {
  const errors = [];
  const config = read('_config.stellar.yml');
  const musicPage = read('source/music/index.md');
  const patch = read('patches/hexo-theme-stellar+2.0.0.patch');

  // 1. JS 常量必须存在且等于唯一来源
  const jsConstant = config.match(/var RIGHTBAR_DRAWER_MAX = (\d+);/);
  if (!jsConstant) {
    errors.push('body_end 注入脚本里找不到 `var RIGHTBAR_DRAWER_MAX = ...;`');
  } else if (Number(jsConstant[1]) !== RIGHTBAR_DRAWER_MAX) {
    errors.push(`RIGHTBAR_DRAWER_MAX 为 ${jsConstant[1]}，应为 ${RIGHTBAR_DRAWER_MAX}`);
  }

  // 1b. 左栏抽屉断点（注入脚本首帧前决定默认可见性）
  const leftJsConstant = config.match(/var LEFTBAR_DRAWER_MAX = (\d+);/);
  if (!leftJsConstant) {
    errors.push('head_end 注入脚本里找不到 `var LEFTBAR_DRAWER_MAX = ...;`');
  } else if (Number(leftJsConstant[1]) !== LEFTBAR_DRAWER_MAX) {
    errors.push(`LEFTBAR_DRAWER_MAX 为 ${leftJsConstant[1]}，应为 ${LEFTBAR_DRAWER_MAX}`);
  }
  const leftFullJsConstant = config.match(/var LEFTBAR_FULL_MIN = (\d+);/);
  if (!leftFullJsConstant) {
    errors.push('head_end 注入脚本里找不到 `var LEFTBAR_FULL_MIN = ...;`');
  } else if (Number(leftFullJsConstant[1]) !== LEFTBAR_FULL_MIN) {
    errors.push(`LEFTBAR_FULL_MIN 为 ${leftFullJsConstant[1]}，应为 ${LEFTBAR_FULL_MIN}`);
  }

  // 1c. 背景图 preload 的 media 属性必须与断点一致（桌面 901+ / 移动 ≤900）
  const preloadDesktop = (config.match(/media="\(min-width: 901px\)"/g) || []).length;
  const preloadMobile = (config.match(/media="\(max-width: 900px\)"/g) || []).length;
  if (preloadDesktop !== 1 || preloadMobile !== 1) {
    errors.push(`背景图 preload media 应各出现 1 处（min-width: 901px / max-width: 900px），` +
      `实际 ${preloadDesktop} / ${preloadMobile}`);
  }

  // 1d. head_end 初始可见性与 ≥1025 强制完整：按左栏梯次决定
  //     依据：≤667 抽屉默认隐藏；≥668 内联默认显示；≥1025 无条件完整（不读存储也不写）
  if (!config.match(/window\.innerWidth > LEFTBAR_DRAWER_MAX/)) {
    errors.push('head_end 注入脚本里找不到 `window.innerWidth > LEFTBAR_DRAWER_MAX`（初始可见性判定）');
  }
  if (!config.match(/window\.innerWidth >= LEFTBAR_FULL_MIN/)) {
    errors.push('head_end 注入脚本里找不到 `window.innerWidth >= LEFTBAR_FULL_MIN`（≥1025 强制完整形态）');
  }

  // 2. 媒体查询字面量：按「出现次数」比对，避免只改其中一处时漏检
  //    （注释里的同源说明不计入；新增/删除断点媒体查询后请同步这里的期望计数）
  //    自定义样式已拆分到 source/css/site-custom.css，由 minify 压缩、全站共享缓存
  const css = stripComments(read('source/css/site-custom.css'));
  const expected = [
    ['max', RIGHTBAR_DRAWER_MAX, 2],        // 右栏抽屉：样式 + 透明背景（≤1180 右栏抽屉化）
    ['max', LEFTBAR_DRAWER_MAX, 1],         // 左栏抽屉渲染：移动顶栏 + 单列 + 左栏滑出（≤667）
    ['min', LEFTBAR_DRAWER_MAX + 1, 2],     // 668–768 内联覆盖块 + 668–919 仅窄条块
    ['max', 768, 1],                        // 668–768 内联覆盖块（主题 ≤768 抽屉化抵消）
    ['max', LEFTBAR_RAIL_MAX, 1],           // 668–919 仅窄条 + 隐藏态恢复入口
    ['min', LEFTBAR_FULL_MIN, 1],           // ≥1025 隐藏收纳按钮（形态由 JS/首帧归一）
    ['min', RIGHTBAR_DRAWER_MAX + 1, 1],    // 无右栏页面左栏常驻固定定位（右栏常驻区间的网格修正）
    ['max', BACKGROUND_MAX, 1]              // 窄屏背景图
  ];
  expected.forEach(([kind, width, count]) => {
    const actual = countLiteral(css, kind, width);
    if (actual !== count) {
      errors.push(`source/css/site-custom.css 中 ${kind}-width: ${width}px 出现 ${actual} 处，期望 ${count} 处` +
        `（改断点或增删媒体查询时，请同步 scripts/breakpoints.js 的期望计数）`);
    }
  });
  const widths = [];
  const widthRe = /(?:max|min)-width:\s*(\d+)px/g;
  let match;
  while ((match = widthRe.exec(css))) widths.push(Number(match[1]));
  const nearMiss = [
    RIGHTBAR_DRAWER_MAX - 1, RIGHTBAR_DRAWER_MAX + 2,
    LEFTBAR_DRAWER_MAX - 1, LEFTBAR_DRAWER_MAX + 2,
    LEFTBAR_RAIL_MAX - 1, LEFTBAR_RAIL_MAX + 2,
    LEFTBAR_FULL_MIN - 1, LEFTBAR_FULL_MIN + 2,
    BACKGROUND_MAX - 1, BACKGROUND_MAX + 1
  ];
  widths.forEach(width => {
    if (nearMiss.includes(width)) {
      errors.push(`source/css/site-custom.css 出现可疑断点 ${width}px（应使用 ${RIGHTBAR_DRAWER_MAX}/${RIGHTBAR_DRAWER_MAX + 1}、` +
        `${LEFTBAR_DRAWER_MAX}/${LEFTBAR_DRAWER_MAX + 1}、${LEFTBAR_RAIL_MAX}/${LEFTBAR_RAIL_MAX + 1}、` +
        `${LEFTBAR_FULL_MIN}/${LEFTBAR_FULL_MIN + 1} 或 ${BACKGROUND_MAX}）`);
    }
  });

  // 3. 音乐页自带样式：必须用到 1180/1181（三段式靠它切换），且不允许近失误值
  //    （1599/1600/600/420 等其他布局断点不在本校验范围）
  const musicCss = stripComments(musicPage);
  const musicExpected = [
    ['max', RIGHTBAR_DRAWER_MAX, 1],      // 堆叠段
    ['min', RIGHTBAR_DRAWER_MAX + 1, 2]   // 两列段 + 三段式段
  ];
  musicExpected.forEach(([kind, width, count]) => {
    const actual = countLiteral(musicCss, kind, width);
    if (actual !== count) {
      errors.push(`source/music/index.md 中 ${kind}-width: ${width}px 出现 ${actual} 处，期望 ${count} 处`);
    }
  });
  const musicWidths = [];
  const musicRe = /(?:max|min)-width:\s*(\d+)px/g;
  while ((match = musicRe.exec(musicCss))) musicWidths.push(Number(match[1]));
  musicWidths.forEach(width => {
    if (nearMiss.includes(width)) {
      errors.push(`source/music/index.md 出现可疑断点 ${width}px（应使用 ${RIGHTBAR_DRAWER_MAX}/${RIGHTBAR_DRAWER_MAX + 1}）`);
    }
  });

  // 4. 主题补丁必须与常量一致（补丁不能改，但可以校验）
  const patchRight = countLiteral(patch, 'max', RIGHTBAR_DRAWER_MAX);
  if (patchRight !== 1) {
    errors.push(`patches/ 补丁中 max-width: ${RIGHTBAR_DRAWER_MAX}px 出现 ${patchRight} 处，期望 1 处（rightbarDrawerQuery）`);
  }
  const patchLeft = countLiteral(patch, 'max', LEFTBAR_DRAWER_MAX);
  if (patchLeft !== 2) {
    errors.push(`patches/ 补丁中 max-width: ${LEFTBAR_DRAWER_MAX}px 出现 ${patchLeft} 处，期望 2 处（leftbarDrawerQuery / leftbarHiddenQuery，断点 667）`);
  }
  const patchRailOnly = countLiteral(patch, 'max', LEFTBAR_RAIL_MAX);
  if (patchRailOnly !== 1) {
    errors.push(`patches/ 补丁中 max-width: ${LEFTBAR_RAIL_MAX}px 出现 ${patchRailOnly} 处，期望 1 处（leftbarRailOnlyQuery）`);
  }
  const patchFullOnly = countLiteral(patch, 'min', LEFTBAR_FULL_MIN);
  if (patchFullOnly !== 1) {
    errors.push(`patches/ 补丁中 min-width: ${LEFTBAR_FULL_MIN}px 出现 ${patchFullOnly} 处，期望 1 处（leftbarFullOnlyQuery）`);
  }

  if (errors.length) {
    throw new Error('[breakpoints] 断点校验失败：\n- ' + errors.join('\n- '));
  }
  console.log('[breakpoints] 断点校验通过（1180/1181 右栏、667/668 + 919/920 + 1024/1025 左栏、背景图 900、注入 JS 与 patches 一致）');
}

hexo.extend.filter.register('before_generate', check);
