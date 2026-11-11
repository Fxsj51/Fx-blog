'use strict';

// 断点一致性自检：CSS 媒体查询只能写字面量，跨语言无法真正共享常量，
// 所以这里在构建期做校验，改了一处而漏改另一处时直接构建失败。
//
// 同源三处：
//   1. _config.stellar.yml 注入 CSS 的媒体查询字面量（1180/1181、900/901）
//   2. _config.stellar.yml body_end 注入脚本里的 RIGHTBAR_DRAWER_MAX
//   3. patches/hexo-theme-stellar+2.0.0.patch 里主题的 rightbarDrawerQuery / leftbar*Query
// 另外 source/music/index.md 自带 <style> 也用了 1180/1181，一并校验。
const fs = require('fs');
const path = require('path');

const RIGHTBAR_DRAWER_MAX = 1180;
const LEFTBAR_DRAWER_MAX = 900;

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

  // 2. 媒体查询字面量：按「出现次数」比对，避免只改其中一处时漏检
  //    （注释里的同源说明不计入；新增/删除断点媒体查询后请同步这里的期望计数）
  const css = stripComments(config);
  const expected = [
    ['max', RIGHTBAR_DRAWER_MAX, 2],      // 抽屉样式、透明背景（音乐抽屉改为收起态，不再用它）
    ['min', RIGHTBAR_DRAWER_MAX + 1, 1],  // 无右栏页面固定侧栏
    ['max', LEFTBAR_DRAWER_MAX, 3],       // 背景图预加载 + 两处左栏抽屉
    ['min', LEFTBAR_DRAWER_MAX + 1, 2]    // 背景图预加载 + 折叠态区间
  ];
  expected.forEach(([kind, width, count]) => {
    const actual = countLiteral(css, kind, width);
    if (actual !== count) {
      errors.push(`注入 CSS 中 ${kind}-width: ${width}px 出现 ${actual} 处，期望 ${count} 处` +
        `（改断点或增删媒体查询时，请同步 scripts/breakpoints.js 的期望计数）`);
    }
  });
  const widths = [];
  const widthRe = /(?:max|min)-width:\s*(\d+)px/g;
  let match;
  while ((match = widthRe.exec(css))) widths.push(Number(match[1]));
  const nearMiss = [RIGHTBAR_DRAWER_MAX - 1, RIGHTBAR_DRAWER_MAX + 2, LEFTBAR_DRAWER_MAX - 1, LEFTBAR_DRAWER_MAX + 2];
  widths.forEach(width => {
    if (nearMiss.includes(width)) {
      errors.push(`注入 CSS 出现可疑断点 ${width}px（应使用 ${RIGHTBAR_DRAWER_MAX}/${RIGHTBAR_DRAWER_MAX + 1} 或 ${LEFTBAR_DRAWER_MAX}/${LEFTBAR_DRAWER_MAX + 1}）`);
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
    errors.push(`patches/ 补丁中 max-width: ${LEFTBAR_DRAWER_MAX}px 出现 ${patchLeft} 处，期望 2 处（leftbarDrawerQuery / leftbarHiddenQuery）`);
  }

  if (errors.length) {
    throw new Error('[breakpoints] 断点校验失败：\n- ' + errors.join('\n- '));
  }
  console.log('[breakpoints] 断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）');
}

hexo.extend.filter.register('before_generate', check);
