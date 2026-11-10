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

  // 2. 所有 max/min-width 字面量：不允许出现断点附近的手误值
  const widths = [];
  const widthRe = /(?:max|min)-width:\s*(\d+)px/g;
  let match;
  while ((match = widthRe.exec(config))) widths.push(Number(match[1]));
  if (!widths.includes(RIGHTBAR_DRAWER_MAX)) {
    errors.push(`注入 CSS 中缺少 max-width: ${RIGHTBAR_DRAWER_MAX}px`);
  }
  if (!widths.includes(RIGHTBAR_DRAWER_MAX + 1)) {
    errors.push(`注入 CSS 中缺少 min-width: ${RIGHTBAR_DRAWER_MAX + 1}px`);
  }
  if (!widths.includes(LEFTBAR_DRAWER_MAX)) {
    errors.push(`注入 CSS 中缺少 max-width: ${LEFTBAR_DRAWER_MAX}px`);
  }
  if (!widths.includes(LEFTBAR_DRAWER_MAX + 1)) {
    errors.push(`注入 CSS 中缺少 min-width: ${LEFTBAR_DRAWER_MAX + 1}px`);
  }
  const nearMiss = [RIGHTBAR_DRAWER_MAX - 1, RIGHTBAR_DRAWER_MAX + 2, LEFTBAR_DRAWER_MAX - 1, LEFTBAR_DRAWER_MAX + 2];
  widths.forEach(width => {
    if (nearMiss.includes(width)) {
      errors.push(`注入 CSS 出现可疑断点 ${width}px（应使用 ${RIGHTBAR_DRAWER_MAX}/${RIGHTBAR_DRAWER_MAX + 1} 或 ${LEFTBAR_DRAWER_MAX}/${LEFTBAR_DRAWER_MAX + 1}）`);
    }
  });

  // 3. 音乐页自带样式：必须用到 1180/1181（三段式靠它切换），且不允许近失误值
  //    （1599/1600/600/420 等其他布局断点不在本校验范围）
  const musicWidths = [];
  const musicRe = /(?:max|min)-width:\s*(\d+)px/g;
  while ((match = musicRe.exec(musicPage))) musicWidths.push(Number(match[1]));
  if (!musicWidths.includes(RIGHTBAR_DRAWER_MAX)) {
    errors.push(`source/music/index.md 中缺少 max-width: ${RIGHTBAR_DRAWER_MAX}px`);
  }
  if (!musicWidths.includes(RIGHTBAR_DRAWER_MAX + 1)) {
    errors.push(`source/music/index.md 中缺少 min-width: ${RIGHTBAR_DRAWER_MAX + 1}px`);
  }
  musicWidths.forEach(width => {
    if (nearMiss.includes(width)) {
      errors.push(`source/music/index.md 出现可疑断点 ${width}px（应使用 ${RIGHTBAR_DRAWER_MAX}/${RIGHTBAR_DRAWER_MAX + 1}）`);
    }
  });

  // 4. 主题补丁必须与常量一致（补丁不能改，但可以校验）
  if (!new RegExp(`max-width:\\s*${RIGHTBAR_DRAWER_MAX}px`).test(patch)) {
    errors.push(`patches/ 补丁中的 rightbarDrawerQuery 不再是 max-width: ${RIGHTBAR_DRAWER_MAX}px`);
  }
  const leftbarHits = (patch.match(new RegExp(`max-width:\\s*${LEFTBAR_DRAWER_MAX}px`, 'g')) || []).length;
  if (leftbarHits < 2) {
    errors.push(`patches/ 补丁中 leftbarDrawerQuery / leftbarHiddenQuery 应各有 max-width: ${LEFTBAR_DRAWER_MAX}px（当前 ${leftbarHits} 处）`);
  }

  if (errors.length) {
    throw new Error('[breakpoints] 断点校验失败：\n- ' + errors.join('\n- '));
  }
  console.log('[breakpoints] 断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）');
}

hexo.extend.filter.register('before_generate', check);
