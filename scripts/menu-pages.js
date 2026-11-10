'use strict';

// 菜单里的「分类」「标签」索引页。
// 有数据时使用 Stellar 的 categories/tags 布局；没有数据时退化为 page 布局，
// 由页面内容显示空状态，避免主题布局在空数据下不输出任何内容。
const PAGES = [
  {
    path: 'categories/',
    title: '分类',
    layout: 'categories',
    source: 'categories',
    empty: '<p>暂无分类。发布文章时在文章头部添加 <code>categories</code> 字段，这里会自动生成分类列表。</p>'
  },
  {
    path: 'tags/',
    title: '标签',
    layout: 'tags',
    source: 'tags',
    empty: '<p>暂无标签。发布文章时在文章头部添加 <code>tags</code> 字段，这里会自动生成标签列表。</p>'
  }
];

function hasPosts(collection) {
  return collection.length > 0 &&
    collection.reduce((found, item) => found || item.length > 0, false);
}

hexo.extend.generator.register('menu_index_pages', function(locals) {
  return PAGES.map(({ path, title, layout, source, empty }) => {
    const hasData = hasPosts(locals[source]);
    const pageLayout = hasData ? layout : 'page';
    return {
      path,
      layout: pageLayout,
      data: {
        layout: pageLayout,
        title,
        content: hasData ? '' : empty
      }
    };
  });
});
