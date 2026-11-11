# HANDOFF — Fx-blog 交接文档

> 本文件面向"下一轮接手的人/AI"。目标是：读完之后能在**不改坏站点**的前提下继续开发。
> 最后更新：2026-11-11（第十八批：音乐页歌词区粘附 + 右缘留白）
> 状态标记：**【实测】**= 本轮实际跑过/量过；**【推算】**= 按 CSS 公式推导，未在浏览器里量；**【未覆盖】**= 从没跑过。

---

## 1. 项目概览与技术栈

| 项 | 值 |
| --- | --- |
| 站点 | Hexo 博客「Fx的博客」，部署到 GitHub Pages **项目页子路径 `/Fx-blog/`** |
| 生成器 | Hexo 8.1.2（`package.json` 里 `hexo: ^8.0.0`） |
| 主题 | `hexo-theme-stellar` **2.0.0（已锁版本，不要升级）** |
| 渲染 | `hexo-renderer-ejs` / `hexo-renderer-marked` / `hexo-renderer-stylus` |
| 音乐插件 | `hexo-tag-aplayer ^3.0.4`（必须保留，见 §10） |
| 补丁 | `patch-package 8.0.1`，`postinstall` 自动重放 `patches/` |
| 压缩 | `clean-css` / `html-minifier-terser` / `terser`（devDependencies，由 `tools/minify.js` 调用） |
| 本机 Node | v26.13.0 / npm 11.20.0【实测】 |
| CI Node | actions/setup-node 固定 **node-version: 22**（与主题 2.0.0 的 `engines: >=22` 一致） |
| 文章量 | **全站只有 1 篇** `source/_posts/hello-world.md`【实测】 |

目录要点：

```
D:\Fx-blog
├─ _config.yml             # Hexo 主配置（theme: stellar，无 deploy 段）
├─ _config.stellar.yml     # 主题配置 + 自研注入（约 1640 行，含绝大部分自研 CSS/JS）
├─ patches/                # ⚠ 必须被 git 跟踪
├─ scripts/                # Hexo 构建期脚本（site-root / playlist / menu-pages）
├─ tools/build.js          # 唯一构建入口（clean → generate → minify，本地与 CI 同源）
├─ tools/minify.js         # 构建后压缩 + 子路径修正
├─ tools/measure.js        # 首屏体积测量（固定口径，见 §9）
├─ source/js/              # spa.js / site-player.js / music-page.js（自研前端）
├─ source/music/           # 音乐页（index.md 内含音乐页专属样式）、audio/、lrc/
├─ source/_data/           # playlist.yml（歌单唯一数据源）、icons.yml
└─ .github/workflows/pages.yml
```

---

## 2. 部署方式

- 目标：GitHub Pages **项目页**，路径前缀 `/Fx-blog/`（对应仓库名）。若是 `<owner>.github.io` 仓库，工作流会自动切成根路径。
- 工作流：`.github/workflows/pages.yml`
  1. `push` 到 `main`/`master`，或 `workflow_dispatch` 手动触发；
  2. `npm ci`（触发 `postinstall` → `patch-package` 重放主题补丁，**这一步失败会导致断点回退到 768px 且构建不报错**）；
  3. 依据 `GITHUB_REPOSITORY` 生成 `_config.pages.yml`（只含 `url:` 与 `root:`，**不入库**，已在 `.gitignore`）；
  4. `npm run build:pages`（= `node tools/build.js --pages`，与本地 `npm run build` 同一段流程，只多传一份 `_config.pages.yml`）；
  5. `upload-pages-artifact` 上传 `public/` → `deploy-pages`。
- **本地与 CI 同源**：两边都只走 `tools/build.js`（`clean → generate → minify`）。差别仅在于 `--pages` 会把 `_config.pages.yml` 追加进 `--config`，用来把 `root` 覆盖成 `/Fx-blog/`。不要在 workflow 里另写 `hexo generate && node tools/minify.js`。

---

## 3. 构建与验证命令（最容易踩的坑）

```powershell
npm run build        # ✅ 唯一正确的构建：hexo clean → hexo generate → node tools/minify.js
npm run build:pages  # CI 用：同上，但带 _config.pages.yml 覆盖 root=/Fx-blog/（文件须先存在）
npm run build:raw    # ⚠ 只跑 hexo generate，不压缩也不清理，别用来验证产物
npm run clean        # hexo clean，删 public/ 与 db.json（已包含在 build 里）
npm run measure      # 首屏体积测量，固定口径见 §9（需先 build）
npm run server       # hexo server，本地预览（注意：本地没有 _config.pages.yml 时 root 是 /，不是 /Fx-blog/）
```

- **不要用 `npx hexo generate` 代替 `npm run build`。** 它不压缩，且 `tools/minify.js` 里那套"给 `src="/images/..."` 补子路径前缀"的逻辑不会执行，产物既大又可能在子路径下 404。
- 成功判据【实测】：末尾输出 `Done: css N, html N, js N, saved NNNKB` 与 `[build] 完成`，且退出码 0。
- `npm run build` **每次都先 `hexo clean`**，所以连续两次构建的产物应完全一致（本轮实测：两次均为 118 个文件 / 8,651,865 字节 / 清单 SHA-256 相同）。若两次数字不同，说明有构建产物流入了版本库或 `clean` 被绕过。
- 失败判据：`tools/build.js` 任一步失败即中止；`tools/minify.js` 会把压缩失败的文件逐条打成 `FAILED <file>`，最后 `process.exitCode = 1`，构建必须视为失败——不要因为"页面能打开"就放过。
- 验证产物的最低要求：
  - `public/index.html` 与 `public/music/index.html` 的 `<script>`/`<link>` 路径以 `/Fx-blog/` 开头（在有 `_config.pages.yml` 的构建下）；
  - 页面 `document.documentElement.scrollWidth === documentElement.clientWidth`（无横向滚动条）；
  - 音乐页只有一个 `<audio>`，其 `id="music-audio"`、宿主 `#site-audio-host` 在 `#main` 之外。

---

## 4. 五个核心机制（改任何相关代码前必读）

### 4.1 SPA 无刷新换页 —— `source/js/spa.js`

- 自研，**刻意替代**主题的 `partial_navigation`（配置里已 `enabled: false`）。
- 只替换页面级区域：`#site-cover`、`#main`、`#rightbar-region`、`body` 的 `data-page-*` 属性、`.site-shell[data-regions]`，外加 `document.title` 与 `window.canonical.param.permalink`（从目标页的 `data-stellar-script="defines"` 里解析）。
- 左栏、抽屉、折叠状态、播放器**不重建**，所以换页不闪、不断播。
- 兼容性判定（任一不满足就整页跳转）：目标文档恰好 1 个 `#main`、有 `.site-shell`、有 `js/spa.js`、**没有**非托管 `<script>`（除 `data-stellar-script` 与纯 JS type）、目标文档的托管脚本集合是当前文档的**子集**（不能要求相等：asset 脚本是运行时注入的）。
- 其它：12s 超时 + `AbortController`；进度条 `#spa-progress`；`history.scrollRestoration='manual'` + 每帧记录滚动位置；换页完成派发 `stellar:navigation-complete`，并补派发一次 `pageshow({persisted:true})` 让主题侧栏扩展重挂。
- 侧栏链接同步用「`href` + 同 `href` 第 n 次出现」配对，**不要退回纯 `href` 映射**——`/` 有多个链接（头像/站名/首页菜单），纯 href 会把 `brand-image--avatar` 类互相覆盖。

### 4.2 不断播 —— `source/js/site-player.js`

- 全站**只有一个** `<audio>`，`id="music-audio"`，常驻宿主 `#site-audio-host`（`position:fixed`、0×0，挂在 `body` 上，**在 `#main` 之外**）。
- 换页流程：`commit()` 先 `SitePlayer.unmount()` 把 `<audio>` 移回宿主 → 替换 `#main`（并删掉目标文档里的 `#music-audio` 占位）→ 若新页是音乐页再 `mount('.music-now__info')`。移动同一个媒体元素不会中断播放、不会重新请求。
- `preload="none"`、初始**不设** `src`，点选曲目才 `load()`。
- 视图有两个：音乐页大卡片，以及右下角抽屉迷你播放器 `#music-drawer`（`buildMini()`）；音乐页和无右栏页面会隐藏抽屉，避免重复。
- 对外 API：`window.SitePlayer.{ensure,play,toggle,next,prev,seek,mount,unmount,subscribe,state,playlist,index}`；事件 `siteplayer:change|time|meta`。
- ⚠ **不要复用/新建第二个 `<audio>`，也不要把 `#music-audio` 当"每页一个"来写。**

### 4.3 脚本幂等 —— 托管脚本约定

- 所有注入脚本必须带 `data-stellar-script`（本项目统一写 `data-stellar-script="site"`），否则 SPA 换页**不会重放**，音乐页在无刷新进入时会失灵。
- 重放 = 克隆新 `<script>` 节点替换旧节点；因此脚本自身的状态必须放在闭包外可判重的位置：
  - `music-page.js`：按列表节点身份判重（`boundList === list`），换页后旧节点消失 → 用 `cleanup` 退订 `SitePlayer`；
  - 右栏脚本：`toggleBtn.__stellarBound`、`rightbar.__stellarStopClick` 一次性标记；
  - `site-player.js`：`ensureAudio()` 单例，`playlistCache` 缓存构建期注入的歌单。
- 新增脚本时照抄这个模式：**DOM 级监听要能按节点身份判重，订阅要能 cleanup**。

### 4.4 右栏逻辑 —— `_config.stellar.yml` body_end 内联脚本 + 注入样式

- 断点唯一来源（JS）：`RIGHTBAR_DRAWER_MAX = 1180` → **>1180 常驻，≤1180 抽屉**。
- CSS 媒体查询只能写字面量，无法与 JS 共享常量；因此由 `scripts/breakpoints.js`（`before_generate`）在构建期校验：注入 CSS 的 1180/1181、900/901 字面量、`source/music/index.md` 的 1180/1181、JS 常量、`patches/` 里的 `rightbarDrawerQuery`/`leftbar*Query` 四方必须一致，否则构建失败。改断点时只改数值、校验会指出其余未同步处。
- CSS 侧同样口径：`@media (max-width: 1180px) { :root { --rightbar-col-w: 0px } }`，抽屉是 `position:fixed` 右侧滑入（宽 `min(380px, 85vw)`），开关按钮 `#custom-rightbar-toggle`（`body.show-rightbar` 时右移、箭头翻转）。
- 显示控制同时切 class 与属性：`show-rightbar` + `inert` / `aria-hidden`。
- 无右栏页面（music/about/categories/tags/archives）：`#rightbar-region` 不存在 → 隐藏开关按钮、不渲染第三列（`--rightbar-col-w: 0` 由 `data-regions` 控制）。
- 点击 `document` 任意处关闭抽屉；右栏内部点击 `stopPropagation`。
- 窗口变宽（`resize` 去抖 100ms）→ 若已常驻则强制收回抽屉，并用 `sb-no-transition` 临时关掉过渡避免闪动。

### 4.5 固定侧栏（无右栏页面的三列对齐）—— 同文件 `@media (min-width: 1181px)`

- 问题：无右栏页面只有两列，`justify-content: center` 会让整块重新居中，切页时左栏横向"跳一下"。
- 方案：`≥1181px` 且 `:not([data-regions~='rightbar'])` 时，把 `aside#leftbar-region` 改为 `position: fixed`，第一列宽度 = `calc(var(--leftbar-w) + var(--nd-off))`，`justify-content: start`。
- `--nd-off = max(0px, (100vw - var(--sbw) - 1720px) / 2)`；`--sbw` 由 head_end 内联脚本实时写入（`innerWidth - clientWidth`）。
- 折叠态要复现首页同样的 138px 位移（右栏列 380 的一半），用 `min(138px, max(0px, (100vw - var(--sbw) - 1444px) / 2))` 渐进，1366 等窄屏位移为 0。
- 音乐页 `≥1600` 的右缘对齐也用同一套变量（见 §6 注释）。

---

## 5. 硬约束（写代码前逐条对照）

1. 新脚本必须带 `data-stellar-script` 属性，否则 SPA 换页不会重放。
2. 全站只能有一个 `<audio>`，宿主是 `#site-audio-host`（**在 `#main` 之外**）；不要复用 `#music-audio` 这个 id 去"每页建一个"。
3. 资源路径一律走 `__SITE_ROOT__` 占位符（构建期由 `scripts/site-root.js` 按 `hexo.config.root` 替换），**不要写死 `/`**。
4. 不改 `node_modules`、不改 `patches/` 内容、不改主题源码。要改主题行为只能新增 `patches/*.patch`。
5. 不要打开主题的 `partial_navigation`（当前 `false`），会和 `spa.js` 抢点击。
6. 断点 **1180 / 900 不要动**：1180 与 `patches/` 里的 `rightbarDrawerQuery`、JS `RIGHTBAR_DRAWER_MAX` 同源；900 与 `patches/` 里的 `leftbarDrawerQuery`/`leftbarHiddenQuery` 同源。
7. `patches/` 必须被 git 跟踪（已确认入库），否则 CI `npm ci` 后补丁失效且**构建不报错**，断点会静默回退到 768。

---

## 6. 已修改文件清单（原生 vs 自研）

### 原生主题（`node_modules/hexo-theme-stellar`，只读，勿直接改）

- 布局 `layout/**/*.ejs`、样式 `source/css/**`、运行时 `source/js/main.js` 等。
- 唯一改动方式：`patches/hexo-theme-stellar+2.0.0.patch`，内容只有两处 `max-width` 从 768 改 900：
  - `leftbarDrawerQuery`、`leftbarHiddenQuery`（`source/js/main.js`）。
  - `rightbarDrawerQuery` 保持主题原值 1180，未打补丁。
- 主题版本锁 `2.0.0`；`package.json` 的 `postinstall` 自动重放。

### 自研（项目自己的代码，全部需要维护）

| 文件 | 作用 |
| --- | --- |
| `_config.stellar.yml` | 主题配置 + **主体自研注入**：`inject.head_end`（预加载、`site-player.js`、`--vh/--sbw` 计算脚本、约 1150 行注入样式）、`inject.body_end`（`#music-drawer`、`music-page.js`、`spa.js`、`#mobile-brand-bar`、`#custom-rightbar-toggle`、右栏/黄历/历史卡片脚本）。约 1640 行。 |
| `scripts/site-root.js` | `__SITE_ROOT__` / `__SITE_BRAND_NAME__` / `__SITE_BRAND_TAGLINE__` 占位符替换（`after_render:html` 与 `:css`）；同时给 `tools/minify.js` 复用 `normalizeRoot`/`replaceSiteRoot`。 |
| `scripts/playlist.js` | `{% playlist %}` 标签（音乐页卡片）；并把歌单注入为 `<script id="site-playlist" type="application/json">` 到 `</head>` 前，供播放器读同一份数据。 |
| `scripts/menu-pages.js` | 生成 `/categories/`、`/tags/` 索引页；无数据时退化为 `page` 布局显示空状态。 |
| `tools/build.js` | 唯一构建入口：`hexo clean` → `hexo generate` → `tools/minify.js`；`--pages` 时把 `_config.pages.yml` 追加进 `--config`。本地与 CI 共用。 |
| `tools/minify.js` | 构建后压缩 CSS/HTML/JS；按 `_config.pages.yml` 的 `root` 修正 `src="/images/..."` 与 `url(/images/...)`；单文件失败即让构建失败。 |
| `tools/measure.js` | 首屏体积测量（口径见 §9），输出 HTML/CSS/JS 的原始与 gzip、首屏图片、移动/桌面两档首屏合计、整页原始字节。 |
| `source/js/spa.js` | 无刷新换页（§4.1）。 |
| `source/js/site-player.js` | 全站单例播放器（§4.2）。 |
| `source/js/music-page.js` | 音乐页视图 + LRC 歌词解析/滚动高亮；无歌词显示「纯音乐，请欣赏」。 |
| `source/music/index.md` | 音乐页内容 + **音乐页专属样式**（含三段式布局与右缘对齐公式）。 |
| `source/_data/playlist.yml` | 歌单**唯一**数据源。 |

> 已删除的旧文件：`source/js/aplayer-player.js`（由 `site-player.js` 取代，目录内已确认不存在）；`_multiconfig.yml`（旧配置副本，无引用，已删除且 `.gitignore` 中对应忽略行一并移除）。

> **刻意保留的备份资产**：`source/images/` 下的 `01.png` 1.8MB、`02.jpg` 0.5MB、`03.jpg` 1.7MB、`CP.png` 1.4MB 共约 **5.2MB**，是现有 webp 派生图的原始文件，**当前没有任何页面引用它们**。这是用户明确决定保留的备份，**不是遗留垃圾，不要移动或删除**（它们会随 git 一起分发；如要瘦身需先确认原始文件另有备份）。

---

## 7. 布局回归基准

### 7.1 横向几何公式（有右栏的页面：首页 / 文章页）

设视口宽 `V`，滚动条宽 `sbw = V - document.documentElement.clientWidth`（本机无头 Edge 实测 8px，但**不要写死**，代码里用 `--sbw`）：

```
off      = max(0, (V - sbw - 1720) / 2)     # 1720 = 340 + 1000 + 380
左栏      = [off, off + 340]                 # 折叠时宽度 64
主栏      = [off + 340, off + 340 + M]，M = min(1000, V - sbw - 720)
右栏列    = 380px，紧贴主栏右侧
右栏内容右缘 = off + 1720 - 15（右栏内有 15px 内边距，实测锚点）
```

### 7.2 各档基准值（单位 px，右栏页）

| 视口 | off | 左栏 | 主栏 | 右栏内容 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1920 | 96 | 96–436 | 436–1436（1000） | 1421–1801【实测锚点】 | 音乐页歌词 1501–1801【实测锚点】 |
| 1760 | 16 | 16–356 | 356–1356（1000） | 1341–1721【推算】 | 音乐页歌词 1421–1721【推算】 |
| 1600 | 0 | 0–340 | 340–1212（872） | 1197–1577【推算】 | 已进入"主栏被压缩"区间 |
| 1181–1599 | 0 | 0–340 | `V - sbw - 720`（1181→453，1366→638，1500→772） | 右缘贴视口，宽 380 | >1180 右栏常驻；音乐页为"上行通栏 + 下行歌单/歌词两列" |
| ≤1180 | 0 | 0（抽屉） | `V - sbw`（1180→~1172） | 抽屉，`min(380, 85vw)` | `--rightbar-col-w: 0` |
| ≤900 | 0 | 抽屉 | `V - sbw`，`padding: 80px 20px 160px` | 抽屉 | 左栏抽屉 + `#mobile-brand-bar` |

> 2560 的实测锚点（来自 `source/music/index.md` 注释）：首页右栏 1741–2121，歌词 1821–2121。
> 上表除标注"实测锚点"外均为**按公式推算**，本轮没有可用的浏览器测量脚本（见 §11）。

### 7.3 音乐页（歌单 / 歌词）横向范围

- `≥1600`：`grid: 888px | 1fr | 300px`；歌词列 `300px` 固定，右缘与首页右栏右缘重合，歌词顶部与「当前曲目」卡片齐平。
- `1181–1599`：第 1 行「当前曲目」通栏；第 2 行「歌单列 + 16px + 300px 歌词列」，歌词右缘 = 主栏右缘。
- `≤1180`：整页纵向堆叠（当前曲目 → 歌单 → 歌词），歌词高度 300px。
- `≤600`：当前曲目卡片改为纵向，唱片 88px。

### 7.4 硬性回归条件

任何改动后必须满足：

1. `document.documentElement.scrollWidth === document.documentElement.clientWidth`（含音乐页、首页、文章页、about）——横向溢出会破坏 `sticky` 与右缘对齐。
2. 切页（首页 ↔ 关于 ↔ 音乐）时左栏不横向位移，主栏左缘不变。
3. 音乐页歌词右缘在 1920 下仍是 1801，在 2560 下仍是 2121（±1px 容差）。

---

## 8. 已知问题

1. **`pageshow` 重挂的内存残留**：`spa.js` 每次换页都派发 `pageshow({persisted:true})` 让主题扩展重挂到新 `#main`；主题侧以 root 元素身份做幂等判断，但旧节点上的监听/IntersectionObserver 是否完全释放**未验证**。SPA 内存增长目前只有推算，没有实测（见 §11）。
2. **音频 `preload="none"` 不可回退**：初始不设 `src` 是刻意的（不点播不占流量），代价是无法在不触发请求的情况下拿到时长；列表里的 `duration` 来自 `playlist.yml`，播放后才被真实元数据覆盖。
3. **`favicon.ico` 缺失**：`source/` 下没有任何 favicon 文件，`/favicon.ico` 会 404（主题也没注入 `<link rel="icon">`）。属已知噪音，不影响功能。
4. **残留变量 `--rightbar-w`**：`_config.stellar.yml` 的 `:root` 里仍声明 `--rightbar-w: 380px`，但实际布局用的是 `--rightbar-col-w`；全库无引用（主题用的是 `--rightbar-width-extra`）。可安全删除，本轮按"不动样式"原则未改。
5. **唱片动画与"减少动态效果"**：`prefers-reduced-motion: reduce` 下只停住**未播放**的唱片（`.music-now__disc:not(.is-playing)`）；播放中的旋转被视为用户主动触发的反馈而保留。若产品口径要求完全关闭，需要改 `source/music/index.md` 内的 `@media (prefers-reduced-motion: reduce)`。
6. **断点常量分散**：`1180` 同时出现在 CSS（多处）、JS（`RIGHTBAR_DRAWER_MAX`）、主题补丁（`rightbarDrawerQuery`，主题原值）；`900` 出现在 CSS 与补丁。改一处必漏，见 §13 待办。

---

## 9. 性能基线

**唯一口径 = `npm run measure`**（`tools/measure.js`）。改完构建后重新跑一次，把输出贴到本节，不要手算。

**口径定义**：

- 统计对象：`public/index.html` 及其**同源**静态引用；第三方（`cdn.jsdelivr.net` 的 lunar.js、`uapis.cn`、`baike.baidu.com` 等）不计。
- **首屏传输**（按档位）：HTML + 全部 CSS + 全部 `<script src>` + `media` 命中的预加载背景图 + 非懒加载 `<img>`；gzip 用 `zlib.gzipSync` 整文件压缩后求和（webp 不可压，按实际传输计入）。桌面档取 `media="(min-width: 901px)"` 的图，移动档取 `media="(max-width: 900px)"` 的图，两者互斥。
- **整页原始字节**：HTML + 所有同源静态引用（含 `loading="lazy"` 图片与两个背景图变体、preload 与 stylesheet/script 的重复按路径去重），未压缩。
- 条件：`npm run build`（含 `hexo clean`）刚产出的 `public/`；gzip 是"可复现的下限估算"，**不等于**服务器 brotli 后的真实传输量。

【实测，2026-11-10，Node v26.13.0 / Windows / 构建产物 118 文件】

| 档位 | 首屏传输（gzip） | 首屏原始 |
| --- | --- | --- |
| 桌面（>900px） | **642.3 KB** | 1005.6 KB |
| 移动（≤900px） | **241.2 KB** | 604.7 KB |

明细（原始 / gzip）：`index.html` 74.5 KB / 20.8 KB；CSS 2 个 312.7 KB / 43.3 KB（`main.css` 308.2 KB + `stellar-icons.css` 4.5 KB）；JS 9 个 63.8 KB / 23.4 KB；首屏图只有一张背景 `03-bg-1600.webp` 554.6 KB（桌面）/ `03-bg-900.webp` 153.7 KB（移动）；**整页原始字节 1159.3 KB**。

> 结论很清楚：体积大头是背景图（554.6 KB 桌面），其次是 `main.css`（308.2 KB）。要优化先动这两处（换尺寸档位/压缩 webp/拆分 CSS），而不是加 JS 懒加载。
> ⚠ 旧记录「首屏移动 161KB / 桌面 348KB」**已作废**——单张背景图就超过 348 KB，旧口径不可复现，不要引用。

LCP / CLS：**尚未测量**。要复测需要：`npm run server` 起本地服务 → 无头浏览器 CDP 取 `PerformanceObserver` 的 `largest-contentful-paint` 与 `layout-shift`，并注明视口、网络节流、缓存状态；测完把条件与数值一并写进本节。

---

## 10. 依赖现状

- 已移除：`hexo-theme-landscape`（`themes/` 下只剩 `.gitkeep`）、直接声明的 `cheerio`（现在由 `hexo-theme-stellar` 自己依赖 `cheerio ^1.1.0`，不需要站点再声明）。
- **必须保留 `hexo-tag-aplayer ^3.0.4`**：它注册 `{% aplayer %}` / `{% aplayerlrc %}` / `{% meting %}` 等标签并挂 `after_post_render` 滤镜。当前源码里已无任何 `aplayer`/`meting` 引用（`_config.yml` 仍留着 `aplayer: { meting: true }` 配置段），但只要有人（或历史文章）用这些标签，缺插件会**直接让构建失败**；它同时是主题文档里音频用法的官方入口，自研播放器只负责"全站单例播放"，不提供 markdown 标签能力。因此不要移除。
- `patch-package` 放在 devDependencies 且 `postinstall` 直接调用，`npm ci` 会装 devDependencies，所以 CI 里能正常重放补丁。
- `.npmrc` 只有 `allow-scripts=hexo-util`（与 npm 的脚本白名单相关），无 registry/engine-strict 配置。

---

## 11. 回归测试资产（现状：缺失）

交接时提到的 `verify-spa.js`、`verify-sync.js`、`verify-spa-geo.js`、`verify-1180.js`、`verify-cards.js`、`verify-lazy.js` **在本机不存在**，`tools/` 下只有 `minify.js`；`discprobe.js`、`cdpdisc.js`、`geomprobe.js`、`.preview/` 同样不存在。【实测】

因此本轮**没有可移动的脚本**，`tools/verify/` 也未创建（不留空目录）。这意味着：

- §7 的"实测锚点"是之前留下的数字，本轮无法重新测量；
- 任何 SPA / 布局改动目前**没有自动化回归手段**，只能人工在浏览器里按 §7.4 检查。

下一轮若要补，建议每个脚本只做一件事并输出 PASS/FAIL + 退出码：SPA 换页不整页刷新、播放器跨页不断播、1180/1181 断点行为、右栏卡片渲染、图片懒加载、几何范围比对（直接比对 §7.2 表）。

### 11.1 验证脚本一律无头（硬规则）

- 工作区（`C:\Users\XIONG\Documents\Trae-CN\temp_20261110_02`）里的验证/截图脚本都是**直连 CDP**：`spawn(msedge, ['--headless=new', '--remote-debugging-port=…'])` 起独立实例，**不是** Playwright `launch()`，也不是 IDE 浏览器面板。
- **默认必须无头**：不得去掉 `--headless=new`，不得再加 `--start-maximized` / `--window-position` 之类会把窗口弹到用户桌面、抢焦点挡屏幕的一次性调试参数。
- 窗口被遮挡时浏览器会暂停合成/动画，导致过渡停在起始帧、截图与焦点断言抖动——用 `--disable-backgrounding-occluded-windows`、`--disable-renderer-backgrounding`、`--disable-features=CalculateNativeWinOcclusion` 解决，**不要**改用有头窗口。
- 真实输入在无头下照常：鼠标用 CDP `Input.dispatchMouseEvent`、键盘用 `Input.dispatchKeyEvent`（原生 button 用 Space 触发 click，range 用方向键），都走浏览器输入管线。
- 音频在无头下可解码、可推进进度（配 `--autoplay-policy=no-user-gesture-required`），但**没有真实音频输出**：音量只能断言 `audio.volume` / `muted` / 图标与存储，不能断言"能听见"；需要听觉确认的项只能由人工在本地做。
- 冒烟脚本：`node smoke-headless.js`（构建产物加载 + 一张截图 + PASS/FAIL 退出码）。

---

## 12. 本地音频与歌单登记方式

- **歌单唯一数据源**：`source/_data/playlist.yml`（数组，字段见文件头注释：`title/artist/source/year/cover/audio/lrc/zhlrc/credits/duration/license/attribution/sourceUrl`）。
  - 远程曲目：`audio` 写完整 `https://` 地址；
  - 本地曲目：`audio` 写 `music/audio/xxx.mp3`，并把文件放到 `source/music/audio/`（该目录有 `README.txt` 说明）；
  - 歌词：`lrc` 写 `music/lrc/xxx.lrc`，文件放 `source/music/lrc/`；缺省或文件无时间轴时，音乐页显示「纯音乐，请欣赏」。
  - 译文：`zhlrc` 写 `music/lrc/xxx.zh.lrc`（与 `lrc` 同名加 `.zh`），缺省时只显示原文，不显示空的第二行。
  - 曲目信息：`credits` 为嵌套映射（`lyricist` / `composer` / `arranger` / `album`），缺哪项就整项不显示；整块都没值时信息区不渲染。
  - 公开曲目必须填 `license` 与 `attribution`；本地曲目 `license: 本地曲目` 即可。
  - **路径规则**（只在 `scripts/playlist.js` 的 `resolveUrl` 实现一次）：`http://` / `https://` 开头的绝对地址原样输出，不拼站点根，可直接指向对象存储/CDN；其他写法按站内相对路径补 Hexo root（子路径部署为 `/Fx-blog/`）。两种写法可在同一份歌单混用，`cover` / `lrc` 同理。
- 歌单被两处消费：音乐页 `{% playlist %}`（`scripts/playlist.js`）与构建期注入的 `<script id="site-playlist" type="application/json">`（`site-player.js` 读取）。**不要在别处再写第二份曲目数组。**

### 12.1 给本地曲目补歌词（`npm run lyrics`）

`tools/lyrics.js`：读 `source/_data/playlist.yml`，逐首去 [lrclib](https://lrclib.net) 搜同步歌词，成功的写成 `.lrc` 并在该条 `audio` 下方补 `lrc:` 字段；失败/待定的条目原样不动。

```bash
npm run lyrics                        # 只处理还没有 lrc 的本地曲目（可重复运行）
npm run lyrics -- --dry-run           # 只打印匹配结果，不写任何文件
npm run lyrics -- --force             # 已有 lrc 的也重抓（会覆盖同名 .lrc）
npm run lyrics -- --pick "曲名=记录id"  # 多条候选待定时，手工指定用哪一条
```

匹配规则：
1. `GET https://lrclib.net/api/search?track_name=..&artist_name=..`，标题/歌手取 `playlist.yml`；
2. 只要 `syncedLyrics` 非空的候选（`plainLyrics` 没时间轴，不可用），排除 `instrumental: true`；候选歌手必须与 `playlist.yml` 的 `artist` 一致（归一化后比较，全不匹配才退回全部）；
3. 真实时长由脚本自己解析 MP3 帧头算出（ID3 里没有 `TLEN`，不引入任何新依赖），与候选 `duration` 差值 **≤ 3 秒**才算合格；
4. 多条时用专辑名收敛：先要求与音频 ID3 的 `TALB` **完全一致**，再退化为「去括号后缀 + 抹平标点」后一致；
5. 仍多条时只采用「时长差最小且唯一」的一条；若并列则判定**待定**，不写 lrc，把候选（id、时长、专辑、差值）打出来等人拍板（用 `--pick` 定）。

写文件规则：路径固定 `source/music/lrc/<与音频同名的 basename>.lrc`（不重命名、不改扩展名），UTF-8 无 BOM，保留 lrclib 原始 `[mm:ss.xx]` 时间轴，不重排、不补空行。请求间隔 1.2s，遇到 429 退避重试三次，网络失败只跳过当前曲目。

当前 5 首本地曲目的结果：Billie Jean / Come And Get Your Love / That's The Way It Is / 海阔天空 已写入；14.3 Billion Years 是纯音乐（候选全部 `instrumental` 或无同步歌词），保持「纯音乐，请欣赏」占位。以后加歌只需把 mp3 放进 `source/music/audio/`、在 `playlist.yml` 登记 `audio` 和 `license`，然后跑 `npm run lyrics`；待定的用 `--pick`。

### 12.2 双语歌词与曲目信息（`npm run lyrics:zh`）

`tools/lyrics-zh.js`：构建期一次性抓取，运行时（浏览器）**不向第三方发任何请求**。读 `playlist.yml`，给已有原词的曲目补中文译文与曲目信息。

```bash
npm run lyrics:zh                      # 已处理过的跳过（credits 在即视为已处理）
npm run lyrics:zh -- --dry-run         # 只打印匹配/对齐结果，不写文件
npm run lyrics:zh -- --force           # 重抓并覆盖 .zh.lrc 与 credits
npm run lyrics:zh -- --pick "曲名=歌曲id"  # 多条候选并列时手工指定
```

数据来源（网易云音乐非官方公开接口，无文档、可能 403 / 返回空 / 改结构；脚本每次请求都带 `Referer: https://music.163.com/` 与桌面 UA，判空判错，请求间隔 1.2s，429 退避三次，失败只跳过当前曲目）：

| 用途 | 接口 |
| --- | --- |
| 搜索候选 | `GET https://music.163.com/api/search/get/web?s=<曲名 歌手>&type=1&limit=20` |
| 原词 + 译文 | `GET https://music.163.com/api/song/lyric?id=<id>&lv=1&tv=1` → `lrc.lyric` / `tlyric.lyric` |
| 专辑名 | `GET https://music.163.com/api/song/detail?ids=[<id>]` → `album.name` |

匹配规则（沿用 12.1，另加歌名收敛）：
1. 候选 `duration` 与脚本解析 MP3 帧头算出的真实时长差值 **≤ 3 秒**；
2. 歌手归一化后一致；歌名归一化后一致（避免 `(Live)/(Extended)` 混入）；
3. 多条时用 ID3 `TALB` 与候选专辑收敛：先全等、再去括号后缀/抹标点后相等；
4. 仍多条只接受「时长差最小且唯一」的一条，否则列候选跳过、不猜（可用 `--pick` 定）。
5. 实测 `Come And Get Your Love` 有 5 个 ±3s 候选（同为 Guardians of the Galaxy 两种发行版），按「歌名全等 + 专辑同族 + 时长差 0.05s 最小」收敛到 id=28864241；两个 GotG 发行的译文内容一致。

译文落盘规则（关键）：
- 网易云 `lrc`/`tlyric` 用的是它自己的时间轴，和本仓库既有 `.lrc`（lrclib 抄本）**不一定对齐**（Redbone 的开头副歌就有 ~9s 偏差）。因此不能直接抄 `tlyric` 时间戳，而是把两份原词按**顺序做单调对齐**（动态规划、按词重合度打分、允许插空），再把译文挂到本仓库原词同一句的**原时间戳**上；
- 译文中找不到对应原句的行直接丢弃（宁缺勿错），不机翻、不凑数；原词行没译文时页面只显示原文，不留空行；
- 存成与音频同名的独立文件 `source/music/lrc/<basename>.zh.lrc`（UTF-8，含时间戳），`playlist.yml` 该条补 `zhlrc:`；
- 曲目信息从网易云 `lrc` 头部的「作词 : / 作曲 : / 编曲 :」信息行抽取（这些行会从歌词里剔除，不会当歌词显示），专辑取详情接口；空字段不写，一项都没有时整块不写。

当前结果：

| 曲目 | 原文行 | 译文行（挂到原文） | 作词 | 作曲 | 编曲 | 专辑 |
| --- | --- | --- | --- | --- | --- | --- |
| Billie Jean | 64 | 38 | Michael Jackson | Michael Jackson | Michael Jackson | Thriller |
| Come And Get Your Love | 71 | 50 | Lolly Vegas | Lolly Vegas | — | Guardians of the Galaxy (Deluxe) |
| That's The Way It Is | 32 | 29 | — | Daniel Lanois/Rocco Deluca | — | The Music of Red Dead Redemption 2 (Original Soundtrack) |
| 14.3 Billion Years | 0（纯音乐） | 0 | — | — | — | Outer Wilds - Original Soundtrack |
| 海阔天空 | 32 | 0（中文原创，不做译文） | 黄家驹 | 黄家驹 | Beyond/梁邦彦 | 海阔天空 |

降级规则：网易云整个接口不可用时，脚本不写任何文件、保留既有数据；某首歌请求失败/候选待定时只跳过该首；页面侧 `zhlrc` 拉取失败或为空时静默降级为只显示原文（`console.warn` 一次，不弹错误），`credits` 为空则整块 `hidden`。

---

## 13. 待办（按优先级）

1. **恢复回归脚本**到 `tools/verify/`（见 §11），至少覆盖 §7.4 三条硬性条件。
2. ~~**断点常量集中**~~ ✅ 已完成：CSS 媒体查询只能写字面量，不再试图变量化；改为 `scripts/breakpoints.js` 构建期校验（注入 CSS / 音乐页 / JS 常量 / `patches/` 四方一致，不一致即构建失败），两处 CSS 源头已加「与补丁同源」注释。1600/1599/420/600 属音乐页布局断点，不参与该校验。
3. ~~**间距阶梯收口**~~ ✅ 已完成：注入 `<style>` 里 43 条 padding/margin 声明按**等值替换**改用 `--gap-*`（涉及 18 个值）。原有 6/8/10/12/16/24 复用 `--gap-xs/sm/md/lg/xl/2xl`；无对应档位的 2/4/14/18/20/28/30/32/40/80/120/160 按像素值新建 `--gap-2/4/14/18/20/28/30/32/40/80/120/160`（值等于原裸值，未调任何数）。刻意排除、保持原样：`margin: 0 auto`、`margin-top: auto`、`margin-top: -3px`（负值），以及音乐页 `source/music/index.md` 自带 `<style>`（不在「注入样式」范围）。0 值不建 `--gap-0`，仍写 `0`。
4. **深浅色切换**：当前 `appearance.color_scheme: auto` 跟随系统，没有手动切换入口；如需手动切换要处理 `localStorage`、`color-scheme` 与背景图/卡片半透明底的对比度。
5. **giscus 评论**：尚未接入；接入需要仓库 ID 与 category ID（在 giscus.app 生成），并注意 SPA 换页后评论 iframe 的重建（`stellar:navigation-complete` 里处理）。
6. 删掉残留 `--rightbar-w`（§8-4）；补 `favicon.ico`（§8-3）。（`_multiconfig.yml` 已删、CI Node 已升 22，均已在第二批完成。）

---

## 14. 已实测通过 / 未覆盖

**本轮实测通过**【实测】：

- `npm run build` 成功（`Done: css 9, html 11, js 37, saved 279KB` + `[build] 完成`，退出码 0）；
- 连续两次 `npm run build` 产物一致：两次均为 118 个文件 / 8,651,865 字节 / 清单 SHA-256 前缀相同（`clean` 已并入构建）；
- `npm run measure` 可复现 §9 数字；
- 产物占位符残留 0（`__SITE_ROOT__` / `__SITE_BRAND_*`），音乐页 `<audio>` 恰好 1 个；
- git 仓库可用，`patches/` 已入库，`node_modules/`、`public/`、`db.json`、`_config.pages.yml` 未入库；
- 补丁已生效：`node_modules/hexo-theme-stellar/source/js/main.js` 中 `leftbarDrawerQuery` / `leftbarHiddenQuery` 均为 `max-width: 900px`；
- 文件清单与交接基本一致（读代码逐项核对）。

**从未跑过的路径**【未覆盖】：

- 全站只有一篇 `hello-world`，**多篇文章的列表、分页（`per_page: 10` 从未真正翻页）、标签云、分类页有数据时的渲染**都没跑过；
- 评论、搜索弹窗、归档页有内容时的表现；
- `giscus` / `artalk` / `waline` 等评论服务（未接入）；
- 真机 iOS Safari / Android 浏览器上的 `100vh`、`backdrop-filter`、音频自动播放策略；
- SPA 长时间换页后的内存增长（只有推算）；
- 子路径 `/Fx-blog/` 的真实线上表现（本轮未推送、未触发 Actions）。

---

## 15. 变更记录

### 第二批（2026-11-10）

| 改动 | 之前 | 之后 |
| --- | --- | --- |
| 构建清理 | `build` = `hexo generate && minify`，重复构建叠加旧产物、体积失真（279KB → 21KB） | `build` = `tools/build.js`，固定 `clean → generate → minify`；两次构建产物字节级一致 |
| 本地/CI 同源 | CI 手写 `npx hexo generate --config ... && node tools/minify.js` | 两边都走 `tools/build.js`，CI 用 `npm run build:pages`（仅多传 `_config.pages.yml`） |
| 体积测量 | 数字靠手算，口径不明（161KB / 348KB 与实测冲突） | `npm run measure` 固定口径，见 §9 |
| CI Node | 20（低于主题 `engines: >=22`） | 22 |
| 遗留文件 | 根目录 `_multiconfig.yml`（无引用，被忽略） | 已删除，`.gitignore` 对应行一并移除 |

未涉及任何布局、样式与前端脚本运行逻辑；构建产物除 `public/` 时间戳外无行为变化。

### 第三批（2026-11-10）

| 改动 | 之前 | 之后 |
| --- | --- | --- |
| 文章阅读时长 | `article.show_reading_time` 未配置（默认关闭） | `true`，文章页 banner 第一行右侧显示「78 字 · 预计阅读 1 分钟」 |
| 文末相关文章 | `article.related_posts_limit` 未配置（等同 0） | `3`，按共享标签数排序取前 3；无相关文章时主题整块不渲染（HTML 无 `#related-posts`） |
| 站点页脚 | 主题默认单行版权（作者占位显示 `John Doe`） | `footer.sitemap` 两栏导航（导航 / 本站）+ `footer.content` 站点名、年份、Hexo 与 Stellar 署名 |
| 相关文章数据源 | 主题要求安装 `hexo-related-popular-posts` | 该插件 5.0.1 依赖 Node 22 已移除的 `SlowBuffer`，在 CI 无法加载；改由 [`scripts/related-posts.js`](scripts/related-posts.js) 注册同名 `popular_posts_json` helper（按共享标签排序，只输出标题与链接） |

**验证结论**

- 布局回归：1440 下 `scrollWidth == clientWidth == 1432`，主栏 340–1052（712px）、右栏 1052–1432（380px）；1920 下 `1912 == 1912`，主栏 436–1436（1000px）、右栏 1436–1816（380px），与第二批基准一致。
- SPA 换页（重点）：首页 → 文章，`window` 标记保留（无整页刷新），`.reading` 与相关文章块正常；文章 → 首页，页脚始终 1 个、sitemap 始终 1 组，不重复也不消失。
- 无数据降级：仅 `hello-world` 一篇时文章页无 `#related-posts`，无空壳区块与多余留白；临时造两篇共享标签文章验证有数据表现后已删除并 `clean` 重建。
- 体积：桌面首屏 gzip 642.2KB / 原始 1005.9KB；移动 241.2KB / 605.0KB；整页原始 1159.6KB（较第二批整页 +0.3KB，主要来自页脚 HTML）。

**待用户补充**（[_config.stellar.yml](_config.stellar.yml) `footer` 段已留注释占位）：备案号/公安备案、社交账号、联系方式；补好后追加到 `footer.content`。

### 补记（2026-11-10）：忽略 IDE 目录

`.gitignore` 在 `.vs/` 旁新增 `.idea/`。此前误入库的 4 个 IDEA 配置文件（`.idea/.gitignore`、`Fx-blog.iml`、`jsonSchemas.xml`、`modules.xml`）已从索引移除、本地文件保留；这些文件只服务 IDE 工程索引（模块定义、JSON Schema 映射），Hexo 构建与 CI 都不读取。

### 第四批（2026-11-10）：双语歌词与曲目信息

| 改动 | 之前 | 之后 |
| --- | --- | --- |
| 双语歌词 | 4 首英文歌只有原词 | 原词一行 + 译文紧跟其下（译文更小更淡），高亮/滚动只跟原词时间；译文缺失的曲目/行只显示原文 |
| 译文来源 | 无 | 构建期 `npm run lyrics:zh` 从网易云抓 `tlyric`，按「顺序单调对齐」挂到本仓库原词时间戳，落盘 `<basename>.zh.lrc` |
| 曲目信息 | 只有歌手名 | 标题下增加一行 `作词/作曲/编曲/专辑`（有则显示、无则整项隐藏、全无则整块不存在） |
| 翻译数据出口 | — | `playlist.yml` 新增 `zhlrc`、`credits`；`scripts/playlist.js` 同时注入 `data-zhlrc` 与 `#site-playlist` JSON |
| 隐藏 audio（SPA 新建节点） | `site-player.js` 会 `setAttribute('controls','')` | 不再挂原生控件，SPA 换页后 `#music-audio` 同样无 `controls` |

**验证结论**（有头 Edge + CDP，`static-server.js` 服务 `public`，两种入口 × 同一份构建，共 **111/111 PASS**）：

- 产物前提：`.music-ctl` 存在且可拖面积宽 218px（1440）/ 260px（375）；`#music-audio` 无 `controls`；`music-page.js` 含 `pointerdown`（不是旧产物）。
- 行数（DOM 实测 = 文件实测）：Billie Jean 64/64 行、译文 38；Come And Get Your Love 71/71、译文 50；That's The Way It Is 32/32、译文 29；14.3 Billion Years 0 行（`无 LRC`）；海阔天空 32 行、0 译文。所有译文都挂在 `.lyric-line` 内部（`strayZh=0`），不存在空第二行。
- seek 高亮（Billie Jean，时长 293.83s）：20% 目标 58.77s → 实际 59.23s 播放中 / 58.77s 暂停，当前行 index=6；60% 176.30 → 176.75 / 176.30，index=36；90% 264.44 → 264.89 / 264.44，index=57 / 56（按实际 `currentTime` 判断，均与 lrc 行一一对应）；20%/60% 当前行译文分别为「然后每个人都转头侧目，幻想自己就是那个幸运儿」「她只是宣称我就是那个人的一个女孩」，随原文行一起进入歌词视口（`scrollTop` 443 / 3199 / 4690）。
- seek 90% 的 Billie Jean 原文行在网易云译文里没有对应句，按降级规则只显示原文；That's The Way It Is 的 20%/60% 有译文（「也难逃一劫」「人生，大概也如此吧」），90% 同样落在无译文行。
- 曲目信息：Billie Jean / Come And Get Your Love / That's The Way It Is / 14.3 Billion Years / 海阔天空 五首都显示了实际抓到的字段；无数据时 `#music-now-credits` 保持 `hidden` 且文本为空（首屏未选曲目即为此状态）。
- 布局：1440 与 375 下 `document.documentElement.scrollWidth == clientWidth`（1432/1432、375/375），歌词行/译文行/信息区均无横向溢出；375 下当前行原文 17px、译文 12px 且译文在原文下方另起一行（`zhTop ≥ srcBottom`）。
- 换页：首页 → 音乐页（真实鼠标点侧栏，`window.__spaMark` 保留，未整页刷新）后五首歌词/译文全正常；音乐页 → 首页 → 音乐页，歌词仍 64 行/38 译文、进度连续（176.296s → 176.854s）、全页始终 1 个 `<audio>`。
- JS 异常：音乐页脚本 0 异常。SPA 测试期间出现过 1 条主题右栏「农历库」异常（`Cannot set properties of null (setting 'innerHTML')` at `/`），已用旧构建（`58df337`）复现同样错误，属既有 CDN 失败竞态，与本次改动无关。
- `npm run build` 通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）。

### 第五批（2026-11-11）：进度条「拖动归 0」根因与加固

**实测复现的根因**（不再是「自动化测试通过」的推断）：本地 `hexo server` 不支持 HTTP Range，`/music/audio/*.mp3` 的 Range 请求回 200 全量且无 `Accept-Ranges`/`Content-Length`，浏览器里 `audio.seekable` 是零宽区间（`[0,0]`）。此时给 `audio.currentTime` 赋值会被吞掉并回读 0，`seeked` 也在 0，于是「拖到哪都归 0」；而代码算出的 ratio 完全正确（拖动序列 0.25/0.5/0.75）。同一份产物换用 `static-server.js`（支持 206）不复现——这就是「用户环境复现、测试环境不复现」的来源。

**加固**（不依赖坐标假设）：

- `pointerdown` 时快照轨道 `rect`（left/width），整段拖动复用，`pointermove` 不再每帧重取；布局变化（时间文本、译文行、滚动条）不会让 rect 抖动。
- `rect.width <= 0`、`NaN`、`Infinity`、`clientX` 非法、`duration` 非有限时一律放弃本次 seek，绝不落到 0。
- 新增 `SitePlayer.canSeek()`（`duration>0` 且 `seekable` 存在非零宽区间）；不可 seek时不画目标位置、不 seek、只 `warn` 一次，避免「拖到 50% 又归 0」的假象。
- 当前/总时长文本固定 `min-width: 5ch` + `tabular-nums`，消除拖动中的横向重排。
- `pointerup` 后 250ms 内不允许 `timeupdate` 回写进度，等 seeked/timeupdate 同步真实位置。
- hover 帧（`buttons=0`）不参与 seek，避免 pointerup 丢失后残留移动把进度打到边缘。
- 侧栏迷你条：删除 `click` 里的按坐标 seek（键盘/辅助技术的 `clientX=0` 会 seek(0)），改为 pointerdown/move/up 真拖动，与音乐页共用 `seekToRatio`/`canSeek`，同样快照 rect、非法值放弃。

**修复后实测**（`:4001` 服务 `public`，有头 Edge + CDP）：

- 1440 直接入口（dur 293.827，轨道 645.7/195.7）：25% 期望 73.457 → 73.608（diff 0.152）；50% 146.913 → 147.082（0.169）；75% 220.37 → 220.537（0.167）。
- 暂停态拖 50%：146.913 → 146.913（diff 0），1 秒后仍 146.913、`paused=true`、回弹 0。
- 375（轨道 57.6/260）：鼠标拖 50% diff 0.171；合成触摸拖 75% diff 0.148；`scrollWidth == clientWidth`（375）。
- 首页 → SPA 进入 `/music/`：拖 50% 146.913 → 147.051（diff 0.137）；歌词 64 行 / 38 译文。
- 两端外再拖回 75%：落点 220.713（期望 220.713，diff 0）。
- 缩放：dsf1.25、dsf1.5、浏览器 zoom 110%、125% 用合成 PointerEvent（clientX 取自同一时刻 rect），diff 分别 0.067 / 0.068 / 0.088 / 0.058。CDP 输入在这些缩放下偶发不送达，故只验证应用层坐标数学与落点。
- 迷你条（右栏 1187/196.8）：合成拖 30% diff 0.082、50% diff 0.107；真实鼠标 50% diff 0.144、30% diff 0.149；`bar.click()`（clientX=0）不再 seek(0)。

**未完全覆盖 / 推断**：dsf1.5 与浏览器 zoom 档的 CDP 输入映射不可靠，改用合成事件；旧产物已排除（`:4001` 返回的 `js/music-page.js` 与磁盘产物 hash 一致）。

**回归**：Billie Jean 歌词 64 行/38 译文；seek 20%/60%/90% 高亮行与按 LRC 独立计算的期望行一致（6/36/56）；`strayZh=0`；全页 1 个 `<audio>`；音乐页 0 异常（唯一异常是首页右栏「农历库」兜底的既有竞态，与本次无关）；构建与断点校验通过。

**附带**：用户替换了 Billie Jean 音频（新文件落盘时带 `(1)` 后缀），已规范回 `michael+jackson-billie+jean.mp3`，`playlist.yml` 路径不变；旧同名文件已被覆盖。

### 本地预览改用 `npm run preview`

**不要再用 `hexo server` 验证音频进度条**：它不返回 `Accept-Ranges`，Range 请求回 200 全量，浏览器 `audio.seekable` 是零宽区间，拖动会被媒体层吞掉（表现为「拖到哪都归 0」）。

`npm run preview`（`tools/preview.js`，零新增依赖，Node 内置 `http`/`fs`）直接服务 `public/`：

- 单段 Range：`206` + `Content-Range` + `Accept-Ranges: bytes` + 精确 `Content-Length`；后缀 `bytes=-N` 取末尾；非法/超出范围回 `416` + `Content-Range: bytes */size`
- Content-Type 覆盖 `.html/.css/.js/.json/.lrc/.xml/.webp/.png/.jpg/.svg/.mp3/.woff/.woff2/.ttf` 等
- 目录解析到 `index.html`，没有就 404（不回退首页）
- 端口默认 `4173`（避开 4000），可用 `npm run preview -- --port 8080` 或 `PORT=8080 npm run preview`
- 响应带 `Cache-Control: no-cache`，改完产物刷新即生效

实测：mp3 `bytes=1000-1999` → 206/`Content-Range: bytes 1000-1999/11868491`/`Content-Length: 1000`；`bytes=-500` → 206 末尾 500 字节；`bytes=999999999-` → 416；`/music/` 中 `seekable=[0,293.827]`，拖 50% 期望 146.913、落点 147.038（diff 0.125）。

### 第六批（2026-11-11）：歌词/译文复核与时间轴结论

**数据来源**：用户提供的三份带时间轴 LRC 与双语对照（Billie Jean 99 条/72 带译，Come 61/56，That's The Way It Is 30/30），原样保存在工作区 `b-lrc-*.txt`、`b-lyrics-*.txt`，不进入仓库。仓库只改 3 个 `.zh.lrc` 与 `playlist.yml` 的 credits。

**时间轴（实测）**：

- Billie Jean：**本节结论已被下方「第七批」取代**（时间轴改为整份采用用户 LRC，译文 34 行，署名改回 `Michael Jackson`）。以下为当时的实测记录，保留备查。本地音频 11251 帧（Xing 声明 11250），帧时长 293.904s，解码 293.827s。贴来末行 4:49.02=289.02s，与文件时长相差 +4.807s，超出「±1.5s 内直接采用」的门槛。实测 `lastAudible(-35dB)=289.30s`，尾部静默 4.53s(-35dB)/2.95s(-50dB)，说明 4:49.03 之后是片尾淡出与近静音，不是时间轴漂移。→ **保留现有时间轴，不做偏移**。贴来时间轴与现有时间轴在 33 个唯一锚点上逐行差 median +0.02s、mean +0.009s、sd 0.039s、范围 -0.07~+0.07s（重复 chorus 不参与配对），两者等价。
- Come And Get Your Love：7975 帧（Xing 7974），帧时长 208.327s，解码 208.253s；`tailZeroSamples=0`（不是数字零样本），`lastAudible(-50dB)=204.40s`、`(-35dB)=203.34s`，尾部静默 3.85/4.91s。→ **不是截断、也不是声明帧数虚报**，音频在 ~3:24.4 自然结束，3:23.03–3:28.10 的尾部歌词落在淡出/近静音区（实际不可闻）。→ **不采用贴来时间轴，保留现有时间轴**。贴来 vs 现有在 12 个唯一锚点上的差为 median -0.175s、mean -0.152s、sd 0.358s、范围 -0.69~+0.79s；常数模型最大残差 0.965s，线性拟合 slope 0.00547、intercept -0.431、残差 sd 0.318s，残差接近 1s，不能用一个常数偏移「校正」。
- 能量包络锚点（Web Audio `decodeAudioData` + 20ms RMS，起音强度 `max(0, rms[i]-rms[i-2])`）每首 8 个：Billie drift median -0.19s、mean -0.336s、sd 0.56s、min -1.19s、max +0.79s（287.43s 的末锚点强度仅 0.101，按不可靠剔除，不影响结论）；Come median -0.32s、mean -0.288s、sd 0.503s、min -1.16s、max +0.34s。两首都没有稳定的常数/线性漂移，故统一保留现有时间轴，贴来版本只用于文本与译文。

**译文挂载规则**：NFKC、弯直引号统一、去括号注释、去标点、连续重复字母收敛（`looove`→`love`）、小写、空白归一后做**保序 LCS**；锚点之间的缺口用局部 DP 允许两侧跳过、2~3 条贴文并成 1 行、1 条贴文拆成 2~3 行（译文挂到该段第一行的现有时间戳）。只采用精确相等（含上述归一）的配对；相似度 ≥0.85 但非精确相等的列为「相近但未采用」，不并入成功数、不硬配；未命中保持无译文，不机翻、不按行号对齐。

**匹配结果（实测）**：

- Billie Jean：LRC 64 文本行 / 贴来 99 条（72 带译）→ 39 行成对、其中 35 行有译文；13 条相近未采用（0.897–0.984，如 `bein'/being` 0.984、`cryin'/crying` 0.983、`till three/til 3:00` 0.902、`uh/ooh` 尾注 0.897–0.911）；29 行仍无译文（多为拟声/重复行，或转写差异如 `40 days` vs `forty days`、`I was on her side` vs `the law was on her side`）；4 行成对但贴文本身无译文。落盘 35 行。
- Come And Get Your Love：71 / 61（56 带译）→ 49 行成对、49 行有译文；22 行仍无译文（含 4 句 intro、`'Cause you're fine`、两处 `Get it from the main vine` 等贴文未覆盖或重复结构不一致的行）；贴来但本地无 12 条。
- That's The Way It Is：32 / 30 → 27 行成对、27 行有译文；5 行仍无译文（1:45.59 `heights/highs` 转写差异、1:51.42 `scar/this scar` 0.935 未采用、3 条纯括号行）；贴来但本地无 3 条。
- 旧 `.zh.lrc` 整体替换，不混入旧网易云译文，因此覆盖率由旧 38/50/29 变为 35/49/27；缺口就是上列「未命中」行。

**署名比对（贴来 vs 原 credits）**：

| 曲目 | 字段 | 原值 | 贴来值 | 采用 |
| --- | --- | --- | --- | --- |
| Billie Jean | lyricist / composer | Michael Jackson | Michael J. Jackson | ~~贴来值~~ → 第七批改回 `Michael Jackson` |
| Billie Jean | arranger | Michael Jackson | Michael Jackson | 一致，不变 |
| Come And Get Your Love | lyricist | Lolly Vegas | Lolly Vegas/Pat Vegas | 贴来值（补上共同作词者） |
| Come And Get Your Love | composer | Lolly Vegas | Lolly Vegas | 一致，不变 |
| That's The Way It Is | composer | Daniel Lanois/Rocco Deluca | 无署名 | 保留原值 |

**验证（构建后 `npm run preview` :4173，有头 Edge + CDP，35/35 PASS）**：

- `npm run build` 通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）。
- DOM 行数/译文数：Billie 64/35、Come 71/49、That's The Way 32/27；每行原文与译文都和文件逐字一致，`strayZh=0`，无空译文。
- seek（暂停态精确落点）：Billie 20% 58.765s→index 6（该行属于相近未采用，无译文）、60% 176.296s→36（同上）、90% 264.444s→56（译文「她说他是我的骨肉」）；Come 20% 41.651s→13（`'Cause you're fine`，无译文）、60% 124.952s→35（「勇敢地来争取你的爱吧」）、90% 187.428s→54（无译文）；That's The Way 20% 49.613s→3（「也难逃一劫」）、60% 148.84s→20（「人生，大概也如此吧」）、90% 223.26s→25（「就是这样吧（这世间辛酸痛苦啊）」）。高亮行与按 LRC 独立计算的期望行全部一致，有译文的行译文随行显示。
- 布局：1440 `scrollWidth==clientWidth==1432`、375 `375==375`；全页始终 1 个 `<audio>`；音乐页 0 JS 异常（本次连首页也没有异常）。
- 换页：首页 → SPA `/music/`（真实鼠标命中链接，`window` 标记保留）→ 播放 Billie 64/35；再回首页、再进音乐页，仍 64/35 且 1 个 audio。
- 音频文件未变化：Billie/Come 的 mp3 blob hash 与 `HEAD` 一致（`341b078`/`12bfff3`），`playlist.yml` 的音频路径与 `.lrc`/`.zh.lrc` 基名一致，无孤儿歌词文件。

### 第七批（2026-11-11）：Billie Jean 时间轴与译文整份替换（取代第六批的 Billie 结论）

**数据来源**：用户提供的 LRC + 双语对，直接采用。原文逐字照录，不做润色、不合并相邻行、不机翻。原始输入留在工作区 `b3-billie-lrc.txt`、`b3-billie-bilingual-a/b.txt`，另存拼接后的干净版 `b4-billie-lrc.txt`、`b4-billie-bilingual.txt`（不进入仓库）；从 `b4` 重跑生成器，产物与仓库两份文件 sha256 完全一致。

**时间轴**：整份替换为新 `.lrc`，67 行 = 64 文本行 + 3 空行（对应原 `[00:50.85]`/`[03:34.88]` 与末条 `[04:49.02]` 仅时间戳条目，转成纯空行作段落分隔）；UTF-8 无 BOM、LF。首行 `[00:29.27] She was more like a beauty queen from a movie scene`，末行 `[04:47.43] Yeah, Billie Jean is not...`。

**译文挂载**：只做精确匹配（同第六批归一化规则：NFKC、弯直引号统一、去括号注释、去标点、重复字母收敛、小写、空白归一），按顺序消费重复行、不循环复用；允许 2~3 条双语并成 1 行（因用户 LRC 本身合并了这些行）。不采用任何相似度近似配对。

**结果**：64 文本行 / 99 条双语（72 带译）→ 38 行成对、34 行有译文（`.zh.lrc` 34 行，格式 `[mm:ss.xx]中文`，无空格）；30 行无译文 = 26 行未命中 + 4 行成对但贴文本身无译（拟声/纯括号注释）。相对旧版：`.lrc` 文本行 64→64，`.zh.lrc` 35→34（−1）；旧译文整体替换，不混入旧网易云译文。

**署名**：`lyricist`/`composer` 由 `Michael J. Jackson` 改回 `Michael Jackson`；`arranger` 本次未提供，保留现值 `Michael Jackson`（与第六批一致，未改动）。

**验证（构建后 `npm run preview` :4173，有头 Edge + CDP，38/38 PASS）**：

- `npm run build` 通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）。
- DOM：Billie 原文 64 行 / 译文 34 行，与文件逐字一致，`strayZh=0`，无空译文；另复核 Come 71/49、That's The Way 32/27 未受影响。
- seek（暂停态精确落点）：20% 58.765s→index 6（无译）、60% 176.296s→36（无译）、90% 264.444s→56（「她说他是我的骨肉」），高亮行与按 LRC 独立计算的期望一致。
- 真实播放锚点：29.643s→index 0、136.032s→25、244.077s→51。
- 布局 1440 `scrollWidth==clientWidth==1432`、375 `375==375`；全页 1 个 `<audio>`；首页→音乐页→首页→音乐页往返后仍是 64/34。
- 音乐页 0 JS 异常；首页仍有 2 次 `Cannot set properties of null (setting 'innerHTML')`（右侧栏农历 CDN 回退，第六批前已存在，与音乐页无关）。

**放宽匹配（同日补充）**：按用户授权，只放开三类等价写法——①省略/缩写（`bein'`↔`being`、`cryin'`↔`crying`、`breakin'`↔`breaking`、`'til`/`till`↔`until`、`'cause`↔`because`、`o'`↔`of`，按撇号判定后统一词形）；②数字与数词（`40`↔`forty`、`3:00`↔`three`）；③单个虚词差异（冠词 `a/an/the` 组内、介词 `in/on/to/into/at/for/with/from/by/of` 组内，其余 token 全同）。纯拟声/感叹、纯括号注释、以及任何需改实词的差异一律不放开。匹配顺序为两遍：先全量精确并固定结果，再在全局剩余序列上做放宽对齐，每条译文只用一次；精确阶段与提交前文件逐字节一致（Billie 34、Come 49、That's The Way 27）。放宽后有译文行数：Billie **34→39（+5）**、Come 49→49（0）、That's The Way 27→27（0）；新增 5 条均为省略/数字类，另有一条同时命中「省略+数字」。无「仅靠虚词微差」而新增的行。构建、断点校验与 41/41 项验证通过（含 3 条新增行真实播放抽查）。

### 第八批（2026-11-11）：四份双语数据直接落地（取代第七批的 Billie 结论）

**数据来源**：用户提供的四份原样数据（同时间戳双行：原文在上、译文在下），保存于工作区 `data-1-come-bilingual.lrc`、`data-2-billie-bilingual.lrc`、`data-3-thatsway-bilingual.lrc`、`data-4-haikuotiankong.lrc`（不进入仓库）。本次不再做 LRC 文本匹配/LCS 对齐，按用户确认的规则直接解析：**连续两行时间戳完全相同 = 原文 + 译文**；单行 = 无译文；仅时间戳的空行转纯空行作段落分隔。时间戳精度按各文件原样保留（Come 3 位小数，其余 2 位）。UTF-8 无 BOM、LF，`[ti:]`/`[ar:]`/`[al:]` 按数据保留。

**产物（行位逐一对应；旧文件备份在工作区 `backup-r2/`）**：

| 曲目 | `.lrc` | `.zh.lrc` | 说明 |
| --- | --- | --- | --- |
| Billie Jean | 99 行（2 头 + 1 空行 + 3 段落空行） | 73 行 | 原文/译文逐行取自带时间戳配对；其中 `[04:48.20]` 一条数据本身两侧同文（`Hee aaow ooh`），按数据保留 |
| Come And Get Your Love | 56 行（3 头 + 1 空行）+ 段落空行 | 55 行 | `.lrc` 同步为用户给的原文时间轴；数据末条 `[03:25.933]` 空时间戳已转为空行并从文末去掉 |
| That's The Way It Is | 30 行（2 头 + 1 空行） | 30 行 | 30 条全部成对 |
| 海阔天空 | 32 行（2 头 + 1 空行）+ 段落空行 | 不创建 | 中文原词带时间轴，无译文文件 |

**时间轴核对（新 LRC 末行 vs 本地 mp3 解码时长，未做任何平移）**：

| 曲目 | 末行时间戳 | 音频时长 | 差 |
| --- | --- | --- | --- |
| Billie Jean | 04:49.00（289.00s） | 293.827s | 尾部余 4.83s（>2s） |
| Come And Get Your Love | 03:23.914（203.914s；数据空尾条 03:25.933） | 208.253s | 余 2.32s（相对末条文本 4.34s，>2s） |
| That's The Way It Is | 03:59.94（239.94s） | 248.067s | 尾部余 8.13s（>2s） |
| 海阔天空 | 04:16.44（256.44s） | 326.0s | 尾部余 69.56s（>2s，旧版末行 04:26.53，按新数据不改） |

四首末行时间戳均未超出音频时长；尾部留白均为音频 outro/尾奏，属正常范围，按要求只报不平移。

**验证（构建后 `npm run preview` :4173，有头 Edge + CDP，47/47 PASS）**：

- `npm run build` 通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）。
- 文件层：Billie 99/73、Come 56/55、That's The Way 30/30、海阔天空 32/0，译文时间戳全部命中原文行位，无多余时间戳。
- DOM：四首行数/译文数与文件完全一致，逐行原文+译文逐字相同，`strayZh=0`、无空译文；海阔天空 DOM 译文 0。
- seek 20/60/90：四首共 12 项全部命中按 LRC 独立计算的期望行，译文随行正确；Billie 真实播放锚点 29.27/135.65/243.69s 高亮行正确。
- 布局 1440 `1432==1432`、375 `375==375`；全页 1 个 `<audio>`；首页→音乐页→首页→音乐页往返后 Billie 仍 99/73 且 1 个 audio；音乐页 0 JS 异常、0 console.error。

**踩坑**：构建前有遗留的 `hexo server` 进程占用 `db.json`，导致 `hexo clean` 报 `EPERM: unlink 'D:\Fx-blog\db.json'`。结束该进程后重建通过；`npm run preview` 不受影响。

### 第九批（2026-11-11）：音乐页五首曲目封面

**数据**：用户把 5 张 500×500 原图放进 `source/music/covers/`（Billie Jean.png / Come And Get Your Love.jpg / That's The Way It Is.jpg / 海阔天空.jpg / 14.3 Billion Years.jpg，合计约 577KB）。原图保留在本地目录但**不纳入版本控制**；仓库只提交页面实际引用的 webp。

**产物（同目录，统一 ASCII slug，避免空格/中文/撇号编码问题）**：

| 曲目 | 文件 | 体积 |
| --- | --- | --- |
| 14.3 Billion Years | `14.3-billion-years.webp` | 30.3KB |
| Billie Jean | `billie-jean.webp` | 24.6KB |
| Come And Get Your Love | `come-and-get-your-love.webp` | 39.8KB |
| That's The Way It Is | `thats-the-way-it-is.webp` | 43.7KB |
| 海阔天空 | `haikuotiankong.webp` | 21.0KB |

规格：原尺寸不放大，500×500，`sharp` 转 webp quality 82、effort 5；合计 159.4KB。`playlist.yml` 5 首各加 `cover:`（相对路径 `music/covers/xxx.webp`），第 5 首同样接入。**未改任何模板/JS**：`scripts/playlist.js` 的 `resolveUrl` 注入 `data-cover`，列表卡、当前曲目唱片图、右栏迷你条本来就统一读 `track.cover`，缺省仍回落到 `images/CP-disc.webp`。

**验证（构建后 `npm run preview` :4173，有头 Edge + CDP，26/26 PASS）**：

- `npm run build` 通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）。
- 5 首逐一切歌：列表 40px 封面、当前曲目唱片图（方形、`object-fit:cover`、圆形裁切）、右栏迷你条封面均与曲名一一对应；唱片图自然宽 500。
- 封面请求全部 200，无 404（含 `That's`/中文/空格文件名均由 ASCII slug 规避）；列表封面 `loading=lazy`，唱片图与迷你条按需加载。
- 1440 `1432==1432`、375 `375==375` 无横向溢出；375 下列表封面 34px 不变形；全页 1 个 `<audio>`。
- SPA：播放海阔天空 → 首页迷你条封面/曲名正确且只取 1 张图 → 返回音乐页 5 张封面全对；整轮往返每张封面恰好 2 次请求（各页渲染各 1 次），无同一渲染内的重复并发。
- 音乐页脚本 0 异常；直接进入 `/music/` 0 异常。SPA 切入音乐页时仍会出现 1 条既有农历库 `innerHTML` TypeError（与本任务无关，保留原状）。
- 备注：`source/_data/caches/images_metadata.json` 随构建新增 5 条封面元数据，一并提交；原图会被 Hexo 复制进 `public/music/covers/`（未加 ignore，仅构建产物，不入库）。

### 第十批（2026-11-11）：唱片改用用户素材 CP-disc.webp（位图盘身 + 圆形 label）

**根因**：两处唱片都没有"盘身"这层。音乐页 `.music-now__disc` 直接把封面 `img` 铺满 120px 并 `border-radius:50%`，等于用封面圆裁掉了唱片；首页迷你条虽用 `CP-disc.webp` 做背景，但 `background-size:cover` 未按素材实际留白补偿，且封面取 55% 直接压在中心透明孔上，看起来是"黑圈套一张方图"。素材本身：256×256 带 alpha，不透明盘面外径 96px（占画布 75%，四周各 32px 透明），中心透明孔半径 47px ≈ 盘径的 **49%**。

**改法（两处同一套结构，尺寸不同）**：

| 位置 | 盘直径 | 背景尺寸 | label（封面） | 中心孔 |
| --- | --- | --- | --- | --- |
| 音乐页 ≥601 | 120px | `center / 133.33% 133.33%` | 52%（62.4px） | 6px |
| 音乐页 ≤600 | 88px | 同上 | 53%（46.6px） | 5px |
| 首页右栏迷你条 | 76px（原 110px） | 同上 | 53%（40.3px） | 4px |

- 133.33% = 1/0.75，让盘缘（含透明留白）刚好被 `overflow:hidden` + `border-radius:50%` 裁成填满容器的正圆；`background-color:#0b0b0c` 兜底未选曲时中心孔不露页面背景。
- 封面改为绝对定位居中 + `object-fit:cover` + `border-radius:50%`，即"中央圆标"，随 `#music-disc` / `.site-mini__disc` 整体旋转，不再出现方形边缘。
- 小尺寸单独把 label 提到 53%（不是等比例缩放）：76–88px 下孔沿抗锯齿更明显，52% 会在孔边留一圈浅色缝隙，压到 53% 后刚好盖住又不吃掉外圈纹路。
- 中心孔用 `::after` 小圆点压在 label 上；音乐页未选曲时 `img:not([src]){visibility:hidden}`，只显示盘身与孔。
- 素材按既有习惯引用：音乐页 `url(../images/CP-disc.webp)`，迷你条走注入变量 `url(__SITE_ROOT__images/CP-disc.webp)`（构建后为 `/images/CP-disc.webp`，兼容 GitHub Pages 子路径）。
- 之前 CSS 画纹路的方案全部撤掉，源码与构建产物里均无 `repeating-radial-gradient`。

**验证（`npm run build` + `npm run preview` :4173 + 有头 Edge/CDP，19/19 PASS）**：

- 构建通过，断点校验通过（1180/1181、900/901 与注入 JS、patches 一致）；`CP-disc.webp` 请求 200（24,380 字节），两页构建产物均含 `133.33%` 与 `background-color:#0b0b0c`。
- 音乐页 1440：盘 119.99px、label 62.39px（52%）、`50%` 圆裁 + `cover`；播放→`running`，暂停→`paused`，恢复→`running`；切到海阔天空 label 换成 `haikuotiankong.webp` 且继续转。
- 音乐页 375：盘 88px、label 46.64px（53%），`375/375` 无横向溢出。
- 首页 1440 迷你条：盘 76px、label 40.27px（53%）、中心孔 4px，播放中同步旋转，点击暂停停转；`1432/1432` 无溢出。
- 首页 375：迷你抽屉按既有设计隐藏，`375/375` 无溢出。
- SPA：播放中 音乐页 → 首页 → 回音乐页，盘 120px、label 仍是当前封面、仍在转，全程 1 个 `<audio>`。
- 音乐页/播放器脚本 0 JS 异常；截图像素抽样确认盘面为近黑（`#000`–`#1a1a1a`）、label 为封面彩色、外圈无白边。
- 截图（工作区，不入库）：`C:\Users\XIONG\Documents\Trae-CN\temp_20261110_02\shots\` 下 `music-1440.png`、`disc-music-1440.png`、`home-1440.png`、`mini-home-1440.png`、`music-375.png`、`home-375.png`。

### 第十一批（2026-11-11）：盘缘黑边/不圆 + 圆标方角

**用户反馈**：唱片看着不圆、四周一圈黑边；封面圆标也不圆、会露方角。

**量到的数据【实测，sharp 直读 alpha】**：
- 原 `CP-disc.webp` 256×256，alpha 包围盒 197×199，位于 (27,28)–(223,226)：左边距 27px（10.55%）、右 32px（12.5%）、上 28px、下 29px。**留白不对称**，盘心比画布中心偏左约 2.5px，且 197 vs 199 说明抗锯齿边缘本身差 2px。
- 上一版按"四周各 12.5%"算出的 `133.33%` 补偿因此错位：盘心相对容器中心偏约 2px，盘缘一侧被裁、一侧刚好贴边，肉眼就是"不圆 + 边缘有暗带"。
- 容器侧还有两处会形成"黑边"：`.music-now__disc` / `.site-mini__disc` 的 `background-color:#0b0b0c` 兜底，以及盘体 `box-shadow`（`0 6px 16px` / `0 4px 12px`），盘缘一旦不满就露深色环。
- 圆标只用 `img{border-radius:50%}`，而父层 `.music-now__disc` / `.site-mini__disc` 一直在做 `transform` 旋转动画，合成层在某些角度会按方形边缘光栅化，导致方角闪露（`--radius-circle` 本身确实是 50%，问题不在圆角值）。

**改法**：
- 新增 `source/images/CP-disc-cropped.webp`：按 alpha 包围盒裁到紧贴图形，再 `fill` 归一为 240×240（几何正圆，四边无透明留白），11KB；原 `CP-disc.webp` 保留不动。
- 盘身改为 `center / 100% 100%` 1:1 铺满，删掉 `background-color` 与 `box-shadow`；容器只保留 `border-radius:50%` + `overflow:hidden` 做圆形裁切。
- 未选曲时的中心孔：改用 `::before` 画 52%（迷你 53%）的深色圆垫在圆标位置，不再用整块深色背景兜底。
- 圆标加 `clip-path: circle(closest-side)`（同时保留 `border-radius:50%`、`object-fit:cover`），不再依赖单一圆角；圆标无 border/外阴影。

**验证【实测，18/18 PASS】**：
- 紫底实验（把盘所在卡片临时刷品红，放大截图逐像素量）：盘缘圆内底色透出仅 0.31%/0.99%/0.58%（音乐 1440/375、迷你 1440），全部是 ~1px 抗锯齿；盘缘距容器边 ≤0.75 CSS px；八向半径差 ≤0.63 CSS px → 盘面铺满、正圆、无深色环。
- 圆标多角度（音乐 1440：0/17/34/51°；音乐 375：0/27/63°；迷你 76px：0/21/58°）用白色封面（Beyond）取样：封面亮像素最远半径比圆半径最多只多 0.32 CSS px，四角亮度 ≤70（黑盘面）→ 任意角度都不露方角。
- 三档尺寸 120/88/76px、圆标 52%/53%/53%；播放→旋转、暂停→停转、切歌→换图继续转、SPA 音乐页↔首页往返正常；全页 1 个 `<audio>`；`CP-disc-cropped.webp` 请求 200；无 JS 异常；1440/375 无横向溢出；构建与断点校验（1180/1181、900/901）通过。
- 375 首页迷你盘仍按既有抽屉布局收纳在视口外（`left=345`、抽屉宽 315），375 首页没有可见盘体；375 的盘缘/圆标证据取自音乐页。
- 截图（工作区，不入库）：`shots\` 下 `edge-music-1440.png`、`edge-music-375.png`、`edge-home-1440.png`（真实背景盘缘放大）、`label-music-1440.png`、`label-music-375.png`、`label-home-1440.png`（非 90° 角圆标放大），`edge-*-probe.png` 为品红底测量图。

### 第十二批（2026-11-11）：右栏仅首页显示 + 文章页左栏固定

**需求**：原来「首页 + 文章页」显示右栏，改为**只有首页**显示；同时文章页左栏要固定，不随页面滚走。断点语义保持 1180/1181、900/901 不变。

**判定改在哪**：
- 只动 `profiles`：`post.rightbar` 改为 `{ enabled: false, widgets: [] }`；`home.rightbar` 仍为 `{ enabled: true, widgets: [toc] }`；全局 `rightbar.enabled: false` 兜底。右栏是否渲染由服务端 layout 计算并写入 `.site-shell[data-regions]`，无 `rightbar` 时主题根本不输出 `aside#rightbar-region`，未在 inject 里叠任何显隐 hack。
- 宽度回收沿用已有规则 `.site-shell:not([data-regions~='rightbar']) .site-workspace`：≥1181 为 `calc(340px + --nd-off) minmax(0,1000px)`、`justify-content:start`，`--nd-off = max(0px,(100vw - sbw - 1720px)/2)`；<1181 为 `340px minmax(0,1000px)`。实测 1440 文章页 `mainW=1000`、`mainLeft=340`、右侧余量 92px（视口决定，不再保留 380px 空列）。

**左栏固定方案**：`position: fixed`（不是 sticky）。
- ≥1181：本就有 `.site-shell:not([data-regions~='rightbar']) aside#leftbar-region{position:fixed}`，横向由 `inset-inline-start: max(0px,(100vw - sbw - 1720px)/2)` 钉住。
- 901–1180：原 sticky 失效——`.site-workspace` 为防横向溢出设了 `overflow-x:hidden`，自身成了滚动容器，sticky 以它为参照于是跟随页面滚走（实测滚到中段 `top=-1824`）。本批在该区间补 `position: fixed; top: 0`（放在既有的 `@media (min-width:901px)` 块内，**不新增媒体查询字面量**，断点校验零改动）。不写 `inset-inline-start`，保留网格给的静态位置：展开态贴 0、折叠态沿用居中偏移；≥1181 仍由上面的 `--nd-off` 规则接管横向位置，互不覆盖。
- ≤900：左栏是抽屉（`position:fixed; top:76px; left:16px` + `transform`），固定规则被媒体查询隔离，开合不受影响。
- 内部滚动：`#leftbar-region .site-region__zone--body` 主题自带 `overflow-y:auto; min-height:0`，栏体固定后内部仍可独立滚到底（未改 CSS）。

**顺带修的空指针**：右栏自定义卡片（农历/黄历/那年今日/一言）是异步回调写 `innerHTML`，SPA 把右栏节点换掉后回调晚到会写 `null`（实测首页报 `TypeError: Cannot set properties of null`）。在 `renderCalendar` / `renderHuangli` / `renderHistory` / `renderQuote` / `useLocalQuote` 及 `loadLunarLibrary` 的 catch 里加了容器存在性守卫。

**验证【实测，右栏 16/16 + 左栏 20/20 PASS】**：
- 1440 首页 `cols=340px 712.381px 380px`、`data-regions="leftbar rightbar"`；SPA 首页→文章未重载，`data-regions="leftbar"`、`mainW=1000`、`cols=340px 999.99px`、右栏开关 `display:none`；返回首页右栏恢复、主栏回 712；直接打开文章页同样 1000/左缘 340；分类/标签/归档/音乐页均无右栏，`1432/1432` 无横向溢出。
- 左栏固定（用临时长文 `zz-scroll-test.md` 验证，已删除并重建 public）：1440 滚动到顶/中/底（`scrollY=0/1456/2910`）左栏均 `fixed`、`top=0`、`mainLeft=340`、`sw=cw=1432`；1440×560 时 `zone.scrollHeight/clientHeight=478/217`，滚到底 `scrollTop=261` 且末项底边 = 容器底边 445（底栏内容不被裁）；1024 中段仍 `fixed top=0`、无溢出；375 文章页抽屉 `left` 从 -316 正常滑到 16 再回到 -316，无溢出；SPA 首页→长文→另一篇→返回，`position` 正确建立/撤销且无内联样式残留；全页 1 个 `<audio>`；无 JS 报错。
- `npm run build` 通过，`[breakpoints] 断点校验通过`。
- 截图（工作区，不入库）：`shots\` 下 `rightbar-home-1440.png`、`rightbar-post-1440.png`、`leftbar-top-1440.png`、`leftbar-mid-1440.png`、`leftbar-bottom-1440.png`、`leftbar-inner-scroll-1440x560.png`。

### 第十三批（2026-11-11）：播放器默认预选第一首 + 循环播放三态

**默认预选**（`source/js/site-player.js`）：
- 新增 `select(i)`：只写 `src` 并 `load()`（`preload="metadata"`），渲染当前曲目、发 `change`，**不调用 play()**；`play(i)` 改为先 `select(i)` 再播放，避免两套载入逻辑。
- `boot()` 里 `if (index < 0) select(0)`：按 `source/_data/playlist.yml` 顺序取第一首（`14.3 Billion Years / Andrew Prahlow`）。音乐页、首页迷你条共用同一模块状态，所以两处默认选中一致；未选曲的深色 `::before` 垫块被封面图完全覆盖，预选后视觉正常。
- 刷新回到第一首；SPA 不重载模块，`index` 保持当前曲目（含切歌后的第二首）。第一首无 LRC，歌词区显示「纯音乐，请欣赏」；有 LRC 的第二首会渲染 99 行、73 条译文。
- 更新音乐页提示文案（原「本页不预加载音频」已不成立）。

**循环三态**（`source/js/site-player.js` + `source/js/music-page.js` + `source/music/index.md`）：
- 按钮 `#music-loop` 放在控件行时长与静音之间，原生 `<button>` + `aria-label`/`title`（列表循环/单曲循环/不循环），键盘 Space/Enter 原生可操作；图标沿用页面既有内联 SVG 写法（同 20px、`currentColor`），未引 iconfont；`off` 态加 `.is-off` 置灰。
- 状态存 `localStorage['stellar:v2:player-loop-mode']`（与 `stellar:v2:*` 命名一致），默认 `list`；刷新与 SPA 均保持。
- 行为：`one` 用 `audio.loop = true`（曲终归零继续，不重载、不触发 ended）；`list` 在 ended 里 `play(index+1)`，最后一首模运算接回第一首；`off` 在 ended 里不跳曲，停在结尾、按钮回「播放」。
- 移动端控件行增加 `#music-loop { order: 4 }`，静音 5、进度条 6，375 下不挤行。

**验证【实测】**：预选 19/19 PASS、循环 15/15 PASS。默认列表循环且未写存储；三态点击/键盘切换、localStorage 值、`audio.loop` 同步；单曲循环曲终 `t=1.4` 仍同一首；不循环最后一首 `paused=true`、索引不变；列表循环最后一首结束 `index=0`；刷新/SPA 后 `one` 保持；1440 控件行 460×34、375 为 260×64 两行、`sw=cw`；全页 1 个 `<audio>`；无 JS 报错。`npm run build` 通过，`[breakpoints] 断点校验通过`。
- 截图（工作区，不入库）：`shots\` 下 `music-preselect-1440.png`、`music-preselect-375.png`、`loop-ctl-1440.png`、`loop-ctl-375.png`。

### 第十四批（2026-11-11）：单曲循环图标换参考图样式 + 音量条改可展开

**仅动单曲循环一个图标**（`source/js/music-page.js`）：
- 参考图（86×69px，唯一内容是一个圆环双弧 + 左上/右下箭头的循环图标）只用于风格对齐；按用户确认，只替换**单曲循环**这一态，并保留原有「1」作为该态标记。
- `LOOP_ONE_PATHS`：`M19.5 13.1A7.6 7.6 0 1 0 5.1 8.8M7.9 7.8L5.1 8.8L4.1 6M5.1 15.2A7.6 7.6 0 0 0 18.9 15.2M19.9 18L18.9 15.2L16.1 16.2`（stroke 2、圆头圆角、`currentColor`、20px，与其它图标同尺寸）。
- **列表循环 / 不循环两态逐字节未动**：仍是 `M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3`，不循环另加斜杠 `M4 4l16 16`；`music/index.md` 里的静态初始图标也回到旧 repeat（默认列表循环）。
- 三态逻辑、`aria-label`/`title`、键盘 Space/Enter、`stellar:v2:player-loop-mode` 持久化全部未改。

**音量：静音按钮 → 可展开音量条**（`source/js/site-player.js` + `source/js/music-page.js` + `source/music/index.md`）：
- 站点播放器新增 `volume`（0～1）与 `stellar:v2:player-volume`：`readVolume()`/`setVolume()`，`ensureAudio()` 里应用 `audio.volume` 并保持 `audio.muted=false`（静音只用 volume=0 表达），snapshot 带 `volume`，API 暴露 `setVolume`/`volume`。
- 音乐页 `#music-mute` 改为「显示/不显示音量条」开关：`.music-vol` 包裹按钮 + `#music-vol-pop` 绝对定位浮层（`right:-6px; bottom:calc(100%+10px)`），默认收起只显示小喇叭（复用原喇叭路径，没有重绘）；点按切换 `is-open` + `aria-expanded`，悬停展开、移开收起（未锁定），浮层 `::after` 12px 透明桥接防止跨越间隙误关，外侧 pointerdown 或 Escape 收起。
- 滑块是原生 `<input type=range>`（0～100 → `player.setVolume(v/100)`），方向键/Home/End 天然可用；拖到 0 换回原来的喇叭+× 图标并 `aria-label="音量（静音）"`，拖回即恢复。`visibility` 不参与过渡（保证展开瞬间可聚焦），展开只影响浮层自身、不参与控件行布局。
- 窄屏取舍：不改既有 order（播放→当前时长→总时长→循环→音量，进度条独占一行），只把 5 号位的按钮换成 wrapper；浮层绝对定位，375 下浮层 145px 宽、`x=123` 完整落在视口内，`scrollWidth===clientWidth`，无横向滚动条闪现。

**验证【实测】**：`npm run build` 通过 + `[breakpoints] 断点校验通过（1180/1181、900/901…）`；CDP 23/23 PASS——两态旧图标逐字节断言、单曲循环新图标+「1」、点按/悬停开合、展开不改变控件行 rect、`sw=cw` 且 `scrollX=0`、滑块 0/0.5/1 与 `audio.volume`/图标/存储一致、方向键 0.99→0.98→0.99、刷新与 SPA 往返保持 0.4、音量 0 刷新仍是静音态、拖回 70 恢复、全页 1 个 `<audio>`、无 JS 报错。
- 截图（工作区，不入库）：`shots\` 下 `loop-vol-1440-closed.png`、`loop-vol-1440-open.png`、`loop-vol-375-closed.png`、`loop-vol-375-open.png`、`loop-icon-list-zoom.png`、`loop-icon-one-zoom.png`、`loop-icon-off-zoom.png`、`vol-icon-zoom.png`。

### 第十五批（2026-11-11）：验证脚本统一无头，不再弹窗

- 问题：工作区脚本是 `spawn(msedge, [...])` 直连 CDP 起**独立浏览器实例**（不是 Playwright、不是 IDE 面板），个别脚本没带 `--headless=new`，于是在用户桌面弹出窗口、抢焦点。
- 处理：工作区所有验证/截图脚本的 62 处 `spawn(EDGE, …)` 统一带 `--headless=new`；清掉 `--window-position` / `--start-maximized` 等调试参数；`music-seek-headed.js` 更名 `music-seek-verify.js` 并改注释；`seek-real-verify.js` / `verify-lyrics*.js` 的"有头"说明同步改掉。
- 新增 `smoke-headless.js`：构建产物加载 + 一张截图 + PASS/FAIL 退出码，作为无头可用性的最小冒烟。
- 规则写进 §11.1：验证脚本默认无头，不得在用户桌面弹窗。【实测】`node smoke-headless.js` PASS（`/music/`、1 个 audio、`scrollWidth=clientWidth=1432`、无 JS 异常），截图 `shots\smoke-headless.png`。

### 第十六批（2026-11-11）：音量图标改四档分级（Windows 样式）

**只动音量图标**（`source/js/music-page.js`、`source/music/index.md`）：
- 旧的二态 `VOL_ON`/`VOL_OFF` 拆成：`VOL_BASE`（喇叭，原几何未变）+ `VOL_MUTE_X`（原「×」）+ 三道同心弧 `VOL_WAVES[1..3]`。
- 分档 `volumeTier(v)`：`!(v>0)` → 0；`v<=1/3` → 1；`v<=2/3` → 2；其余 3。0 档 = 喇叭+×，1 档 1 道波、2 档 2 道波、3 档 3 道波。
- 三道弧同心（圆心 10,12），半径 4.6 / 7.0 / 9.2，±45°，`stroke-width:2`、圆头；弧按档位**累加**（高档同时保留内两道），与系统音量形态一致。
- `syncVolume(st)` 记住上次档位 `volTier`，只在档位变化时重写 `innerHTML`；拖动滑块的 `input` 事件每帧都调用，所以档位跨过 1/3、2/3 的瞬间图标就换，不用松手；键盘 Left/Right（原生 range）与 `SitePlayer.setVolume` 走同一 snapshot，因此同样逐帧同步。
- 图标容器 `#music-mute` 尺寸固定（34×34），四档 SVG 均 24 viewBox / 20px，切换不引起控件行抖动；`data-tier` 仅用于测试断言。
- 音量持久化、静音态（`audio.muted` 恒 false、只用 volume=0）、浮层开合、循环图标三态一律未改。

**验证【实测】**：`npm run build` 通过 + `[breakpoints] 断点校验通过`；`verify-vol-tiers.js` 18/18 PASS——0/0.01/0.33/0.5/0.66/0.99/1 逐档 SVG 实渲染波形数依次 0/1/1/2/2/3/3 且与档位一致、0 档含「×」；真实 CDP 拖动未松手即记录到档位序列 `3,2,2,1,0`；键盘 30→38 由 1 档升 2 档、38→26 回落 1 档；刷新与 SPA 往返后 0.5 仍为 2 道波、全页 1 个 `<audio>`；1440 与 375 均 `scrollWidth===clientWidth`，图标 rect 同为 34×34；无 JS 报错。
- 截图（工作区，不入库）：`shots\` 下 `vol-tier-0.png`、`vol-tier-1.png`、`vol-tier-33.png`、`vol-tier-50.png`、`vol-tier-66.png`、`vol-tier-99.png`、`vol-tier-100.png`、`vol-tier-0-reload.png`。

### 第十七批（2026-11-11）：单曲循环图标按参照图重描

**只改单曲循环一态**（`source/js/music-page.js` 的 `LOOP_ONE_PATHS`），列表循环 / 不循环与其它所有图标逐字节未动（git diff 仅 1 行）。

**从参照图（webp 69×69，图标内容 27×27）量到的几何**（归一到 24×24 viewBox）：
- 环中线半径 10.48、外径 11.65、内径 9.31、线宽 2.35（占图标边长 9.6%），端帽/转角均为圆头圆角；
- 两段弧 180° 旋转对称：上弧约 231°→355°、下弧约 48°→180°（即各约 124°/132°，右、左两个缺口 ~50°）；
- 两处折角箭头同在缺口的环外侧，呈 L 形（臂近似横平竖直、90°，处为圆角）；左上角点约 (0.9,7.1)、臂长约 7.6–8；右下角点约 (20.9,16.2)、臂长约 6.2。
- 该图标不含「1」，本页仍需「1」区分单曲态，故保留居中文字。

**落地路径**（`viewBox 0 0 24 24`、`stroke-width 2.4`、`stroke-linecap/linejoin="round"`）：
`M3.88 5.19A10.6 10.6 0 0 1 22.6 12M20.12 18.81A10.6 10.6 0 0 1 1.4 12M1.45 1.5L1.45 7.5L7.45 7.5M22.55 22.5L22.55 16.5L16.55 16.5`
（r=10.6、上弧 220°→360°、下弧 40°→180°、角点 (1.45,7.5)/(22.55,16.5)、臂长 6.0；参数由 `opt-loop.js` 对参照掩膜做网格搜索得到）

**与参照图偏差【量化】**：把新图标按 27×27 与参照掩膜同尺度比对（50% 亮度阈值），IoU=0.821、precision=0.862、recall=0.945（237 vs 260 px，FP 36 / FN 13），残差集中在 0.5px 内的抗锯齿边缘；环半径偏差 ≤0.15、弧端点角偏差 ≤11°（起点段被箭头覆盖）、箭头角点偏差 ≤1.7。8× 叠加图 `shots\loop-overlay.png` 上重叠区几乎全白，仅剩单像素红/青描边。

**验证【实测】**：`npm run build` 通过 + `[breakpoints] 断点校验通过`；`verify-loop-vol.js` 23/23 PASS——三态切换/曲终行为/持久化/键盘空格切换/刷新与 SPA 往返、单曲态 SVG 路径与「1」符合同一字符串断言、列表与不循环路径逐字节等于旧值；1440 与 375 控件行 `scrollWidth===clientWidth`、音量浮层展开不挤动、全页 1 个 `<audio>`、无 JS 报错。截图（工作区，不入库）：`shots\loop-side-by-side.png`（左参照右新图标）、`shots\loop-overlay.png`、`shots\loop-new-8x.png`、`shots\loop-icon-list-zoom.png`、`shots\loop-icon-one-zoom.png`、`shots\loop-icon-off-zoom.png`、`shots\loop-vol-1440-closed.png`、`shots\loop-vol-375-closed.png`。

### 第十八批（2026-11-11）：音乐页歌词区粘附 + 右缘留白

**只动 `source/music/index.md` 末尾的内联 CSS**，HTML 结构与 `music-page.js` 未动。

**布局现状**：1181–1599 是「当前曲卡片通栏 + 下一行歌单/300px 歌词」；≥1600 才是「左列卡片+歌单 / 右列歌词」并已 sticky；≤1180 单列。

**改法**：
- `@media (min-width:1181px)` 的 `.music-page` 加 `padding-right:64px`：1fr 左列自动收窄 64px（卡片 888→824、歌单同步变窄），歌词右缘也从内容右缘内缩 64px，不再顶到右缘。歌词列宽仍固定 300px，所以行宽/换行/字号/行高均不变。
- 新增 `@media (min-width:1420px) and (max-width:1599px)`：`.music-now` 回到列 1、`.music-lyrics-dock` 改成 `grid-row:1 / span 2`、`.music-lyrics` 恢复 `position:sticky; top:16px`。原因有两条：① 歌词必须在第 1 行起步，滚动到顶时面板才整块落在视口内（原来在卡片下方，首屏底部就出界 78px）；② sticky 的容器必须比面板高才有行程，原来歌词单独在第 2 行、容器 454px ≈ 面板 452px，粘附行程只有 2px，等于没生效。1420 是「卡片进左列后控制行不溢出」的最小宽度：左列需 ≥480（图标/时长/滑块最小宽合计 ~303 + 内边距 40 + 碟片 120 + 间距 20），实测 1420 左列 508、1440 左列 508，控制行最小 303 不换行。
- 1181–1419 左列只有 341–470px，控制行放不下，**保持原「卡片通栏 + 下一行歌单/歌词」且歌词 static**（只受 padding 影响变窄）；≤1180 完全未动（单列、歌词 300px static）。
- ≥1600：左列 `888px`→`824px`，padding 由 1181+ 基底继承；1fr 中间列吸收 64px，右缘对齐公式不变。实测 1920 首页右栏 1436–1816 / 歌词 1452–1752，2560 右栏 1756–2136 / 歌词 1772–2072，即歌词右缘恒为右栏右缘 −64px。

**字号/行高【实测，改前 vs 改后】**（CDP `getComputedStyle`，两侧一致）：
- 1440：原文 16px / 24.8px、译文 12px / 18px / opacity .62、行 padding `7px 0 7px 12px`、左边框 2px；当前行 600 / `rgb(29,185,84)` / `rgba(29,185,84,.1)` / opacity 1。
- 375：原文 17px / 26.35px（主题移动端字号），其余同 1440。
- 注：`.lyric-line` 的 14px 会被主题 `.md-text p` 覆盖成 16px，这是改前就存在的计算值，未动。

**验证【实测】**：`npm run build` 通过 + `[breakpoints] 断点校验通过（1180/1181、900/901…）`；`verify-layout18.js` 21/21 PASS——1440 卡片/歌单均 508（<572）、歌词 300×452 `sticky`、`padding-right:64px` 且 `pageRight-歌词右缘=64`；滚顶(0)/中(320)/内容底(566) 歌词 top 分别 240/16/16、始终完整在 900 视口内、与 `.music-ctl` 矩形无交集；歌词内层 `#music-lyrics-scroll` 可自滚；SPA 首页↔音乐页往返后 sticky 重建、无内联残留；1440 与 375 `scrollWidth===clientWidth`；375 单列 `display:flex` + 歌词 static、99 行歌词可读；全页 1 个 `<audio>`；无 JS 异常/console.error。断点扫描 1180/1181、900/901、1419/1420、1600 均无横向溢出。
- 取舍：sticky 的容器边界就是音乐内容底，再往下是站点页脚，面板会随容器一起释放（标准 sticky 行为）；1440 文档 maxScroll=643，面板完整可见的最大滚动位是 566，故"底"截图取 566。
- 截图（工作区，不入库）：`shots\layout18-1440-top.png`、`shots\layout18-1440-mid.png`、`shots\layout18-1440-bottom.png`、`shots\layout18-1440-spa-return.png`、`shots\layout18-375-full.png`、`shots\layout18-375-lyrics.png`。





