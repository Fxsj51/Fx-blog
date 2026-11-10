'use strict';

// Stellar 2.0 的 article.related_posts_limit 通过 popular_posts_json helper 取文末相关文章。
// 主题文档指向 hexo-related-popular-posts，但该插件 5.0.1 依赖 Node 22 已移除的 SlowBuffer，
// 在 CI（Node 22）下无法加载；这里按同一调用契约提供轻量实现：
// 按共享标签数量排序，返回 { json: [{ title, path }] }。
// 没有共享标签的文章不参与（宁可整块不渲染，也不凑无关文章）。
hexo.extend.helper.register('popular_posts_json', function(options, post) {
  const maxCount = Number(options && options.maxCount) || 0;
  const root = (hexo.config.root || '/').replace(/\/?$/, '/');
  if (!post || maxCount <= 0) return { json: [] };

  const tags = post.tags ? post.tags.toArray().map(tag => tag.name) : [];
  if (tags.length === 0) return { json: [] };

  // 该 helper 在 after_post_render 阶段被调用，其他文章的 content/excerpt 尚未写入，
  // 所以只输出标题与链接，摘要由主题模板在缺失时自动省略。
  const related = hexo.locals.get('posts').toArray()
    .filter(item => item._id !== post._id && item.published !== false)
    .map(item => {
      const itemTags = item.tags ? item.tags.toArray().map(tag => tag.name) : [];
      return { item, shared: itemTags.filter(name => tags.includes(name)).length };
    })
    .filter(entry => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.item.date.valueOf() - a.item.date.valueOf())
    .slice(0, maxCount);

  return {
    json: related.map(({ item }) => ({
      title: item.title,
      path: root + String(item.path).replace(/^\/+/, '')
    }))
  };
});
