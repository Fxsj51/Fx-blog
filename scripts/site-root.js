'use strict';

const ROOT_PLACEHOLDER = '__SITE_ROOT__';

// 把 Hexo 的 root 归一化为以 / 结尾：''、'/'、'/Fx-blog' → '/Fx-blog/'
function normalizeRoot(root) {
  return (root || '/').replace(/\/?$/, '/');
}

function replaceSiteRoot(text, root) {
  if (!text.includes(ROOT_PLACEHOLDER)) return text;
  return text.split(ROOT_PLACEHOLDER).join(normalizeRoot(root));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 品牌名/签名只在主题配置里写一次，构建时注入移动顶栏，避免两处硬编码
function replaceBrand(text) {
  if (!text.includes('__SITE_BRAND_')) return text;
  const themeConfig = (hexo.theme && hexo.theme.config) || {};
  const brand = (themeConfig.leftbar && themeConfig.leftbar.brand) || {};
  const name = escapeHtml(brand.name || hexo.config.title || '');
  const tagline = escapeHtml(brand.tagline || '');
  return text
    .split('__SITE_BRAND_NAME__').join(name)
    .split('__SITE_BRAND_TAGLINE__').join(tagline);
}

// 自定义注入的本地资源路径使用 __SITE_ROOT__ 占位符，
// 构建时按 Hexo 的 root 配置替换，兼容 GitHub Pages 项目页子路径。
function replaceRoot(text) {
  return replaceBrand(replaceSiteRoot(text, hexo.config.root));
}

// tools/minify.js 也会 require 本文件复用 normalizeRoot/replaceSiteRoot，
// 那种场景下没有 hexo 全局对象，跳过 filter 注册。
if (typeof hexo !== 'undefined') {
  hexo.extend.filter.register('after_render:html', replaceRoot);
  hexo.extend.filter.register('after_render:css', replaceRoot);
}

module.exports = { normalizeRoot, replaceSiteRoot };
