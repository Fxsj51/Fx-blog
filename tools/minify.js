'use strict';

const fs = require('fs');
const path = require('path');
const CleanCSS = require('clean-css');
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');
const { normalizeRoot, replaceSiteRoot } = require('../scripts/site-root');

const publicDir = path.resolve(__dirname, '..', 'public');
const stats = { css: 0, html: 0, js: 0, saved: 0, failed: 0 };

function walk(dir, ext, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, files);
    else if (entry.name.endsWith(ext)) files.push(full);
  }
  return files;
}

function report(file, before, after) {
  if (after < before) stats.saved += before - after;
  const rel = path.relative(publicDir, file);
  console.log(`  ${rel}: ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB`);
}

// 单个文件压缩失败时记录文件名，最后统一让构建失败，避免静默发布未压缩产物
function fail(file, message) {
  stats.failed++;
  console.error(`  FAILED ${path.relative(publicDir, file)}: ${message}`);
}

// GitHub Pages 项目页部署在 /<repo>/ 下；构建时由 _config.pages.yml 提供 root。
// 该文件由 CI 临时生成，已在 .gitignore 中忽略；本地没有时按根路径处理。
function getSiteRoot() {
  const pagesConfig = path.resolve(__dirname, '..', '_config.pages.yml');
  if (!fs.existsSync(pagesConfig)) return '/';
  const match = fs.readFileSync(pagesConfig, 'utf8').match(/^root:\s*(['"]?)([^'"\s]+)\1/m);
  return match ? normalizeRoot(match[2]) : '/';
}

// 主题配置里的本地图片路径是根绝对路径，这里统一补上子路径前缀。
function fixLocalPaths(content, root) {
  const withRoot = replaceSiteRoot(content, root);
  if (root === '/') return withRoot;
  const encodedRoot = root.slice(1).replace(/\//g, '&#x2F;');
  return withRoot
    .replace(/(\bsrc=["'])\/(images\/)/g, `$1${root}$2`)
    .replace(/(\bsrc=["'])&#x2F;images&#x2F;/g, `$1&#x2F;${encodedRoot}images&#x2F;`)
    .replace(/(\burl\(["']?)\/(images\/)/g, `$1${root}$2`);
}

async function run() {
  if (!fs.existsSync(publicDir)) {
    console.error('public/ 不存在，请先运行 hexo generate');
    process.exit(1);
  }
  const siteRoot = getSiteRoot();
  if (siteRoot !== '/') console.log(`Site root: ${siteRoot}`);

  console.log('Minify CSS...');
  const cssFiles = walk(publicDir, '.css').filter(f => !path.relative(publicDir, f).startsWith('assets'));
  const cleanCss = new CleanCSS({ level: 2, rebase: false });
  for (const file of cssFiles) {
    let source = fs.readFileSync(file, 'utf8');
    source = fixLocalPaths(source, siteRoot);
    const result = cleanCss.minify(source);
    if (result.errors.length) {
      fail(file, result.errors.join('; '));
      continue;
    }
    fs.writeFileSync(file, result.styles);
    report(file, source.length, result.styles.length);
    stats.css++;
  }

  console.log('Minify HTML...');
  const htmlFiles = walk(publicDir, '.html');
  for (const file of htmlFiles) {
    let source = fs.readFileSync(file, 'utf8');
    source = fixLocalPaths(source, siteRoot);
    try {
      const result = await minifyHtml(source, {
        collapseWhitespace: true,
        conservativeCollapse: false,
        removeComments: true,
        removeRedundantAttributes: false,
        removeAttributeQuotes: false,
        useShortDoctype: true,
        minifyCSS: true,
        // 页面注入了多段内联脚本（统计、断点、日历等），一并压缩；
        // type="application/json" 的数据块不受影响
        minifyJS: true,
        keepClosingSlash: true,
        ignoreCustomFragments: [/<%[\s\S]*?%>/, /<\?[\s\S]*?\?>/]
      });
      fs.writeFileSync(file, result);
      report(file, source.length, result.length);
      stats.html++;
    } catch (error) {
      fail(file, error.message);
    }
  }

  console.log('Minify JS (classic scripts only)...');
  const runtimeDir = path.join(publicDir, 'js', 'runtime');
  const jsFiles = walk(publicDir, '.js').filter(f => {
    const rel = path.relative(publicDir, f);
    return !rel.startsWith('assets' + path.sep) && !f.startsWith(runtimeDir + path.sep);
  });
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    try {
      const result = await minifyJs(source, {
        compress: { passes: 1 },
        mangle: true,
        format: { comments: false }
      });
      fs.writeFileSync(file, result.code);
      report(file, source.length, result.code.length);
      stats.js++;
    } catch (error) {
      fail(file, error.message);
    }
  }

  console.log(`Done: css ${stats.css}, html ${stats.html}, js ${stats.js}, saved ${(stats.saved / 1024).toFixed(0)}KB`);
  if (stats.failed) {
    console.error(`压缩失败 ${stats.failed} 个文件，构建产物不完整`);
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
