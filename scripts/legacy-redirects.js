'use strict';

// 历史遗留地址兜底：hello-world 早期没有写 date，permalink 曾按构建当天生成，
// 漂出过 /2026/11/13/ 与 /2026/11/14/ 两个地址。这里只为这两条生成 200 的跳转页，
// 指向固定后的 /2026/11/04/hello-world/，其余不存在的路径仍走正常 404。
// 纯静态页面（meta refresh + location.replace），不依赖主题、插件或服务端。
function normalizeRoot(root) {
  return (root || '/').replace(/\/?$/, '/');
}

const TARGET = '2026/11/04/hello-world/';
const LEGACY = ['2026/11/13/hello-world/', '2026/11/14/hello-world/'];

hexo.extend.generator.register('legacy_redirects', function () {
  const root = normalizeRoot(hexo.config.root);
  const target = root + TARGET;
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>页面已迁移</title>',
    '<meta name="robots" content="noindex">',
    '<link rel="canonical" href="' + target + '">',
    '<meta http-equiv="refresh" content="0; url=' + target + '">',
    '<script>location.replace(' + JSON.stringify(target) + ' + location.hash);</script>',
    '</head>',
    '<body>',
    '<p>页面已迁移到 <a href="' + target + '">' + target + '</a></p>',
    '</body>',
    '</html>'
  ].join('\n');

  return LEGACY.map(function (from) {
    return { path: from + 'index.html', data: html };
  });
});
