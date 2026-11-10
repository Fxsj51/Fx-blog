# HANDOFF — Fx-blog 交接文档

> 本文件面向"下一轮接手的人/AI"。目标是：读完之后能在**不改坏站点**的前提下继续开发。
> 最后更新：2026-11-10（第二批：构建收敛 + 体积测量口径 + 清理，见 §15）
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

---

## 12. 本地音频与歌单登记方式

- **歌单唯一数据源**：`source/_data/playlist.yml`（数组，字段见文件头注释：`title/artist/source/year/cover/audio/lrc/duration/license/attribution/sourceUrl`）。
  - 远程曲目：`audio` 写完整 `https://` 地址；
  - 本地曲目：`audio` 写 `music/audio/xxx.mp3`，并把文件放到 `source/music/audio/`（该目录有 `README.txt` 说明）；
  - 歌词：`lrc` 写 `music/lrc/xxx.lrc`，文件放 `source/music/lrc/`；缺省或文件无时间轴时，音乐页显示「纯音乐，请欣赏」。
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


