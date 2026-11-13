# tools/verify — 回归脚本

对已构建的站点做无头浏览器回归：用 Chromium 内核（Edge/Chrome）的 CDP 打开 `public/` 下的页面，检查播放器、迷你条、歌词区、布局与统计脚本。

## 运行

```bash
npm run build   # 先构建，脚本直接读 public/
npm run verify  # 一条命令跑全部
```

入口与每个单跑脚本都会自动复用（或后台启动）`tools/preview.js`（:4173，支持 HTTP Range——音频进度条能拖动的前提）：已有服务就复用、跑完不关它；没有就自己起、结束（含 Ctrl+C / 异常）时关闭并释放端口。端口被别的程序占用会直接报错退出，不会静默连上去跑出一堆 `undefined`。

- 站点地址：默认 `http://127.0.0.1:4173`，可用 `VERIFY_BASE=http://127.0.0.1:8080 npm run verify`
- 浏览器：自动探测 Edge/Chrome 常见安装位置，找不到时用 `VERIFY_BROWSER=/path/to/chrome` 指定
- 产物：截图与 JSON 报告写到 `tools/verify/out/`（已 gitignore），失败截图先看这里

## 两类脚本

**有数值断言**（任一失败则 `npm run verify` 非零退出）

| 脚本 | 验证内容 |
| --- | --- |
| `verify-collapse18.js` | 迷你条收起/展开、贴边距离、8s 自动收回、点外/Escape 收起、切歌换封面、SPA 往返、375 与 1180/1181 |
| `verify-loop-vol.js` | 循环三态图标与持久化、音量四档与音量条、键盘操作、375 无横向溢出 |
| `verify-disc-toggle.js` | 唱片播放/暂停与角度、进度条拖动、循环按钮、断点 900/901/1180/1181 |
| `verify-quote.js` | 首页一言卡唯一性与高度稳定、接口失败兜底、SPA 重建、375 抽屉不重叠 |

**观测型**（只打印实测值，供人工比对；异常退出才算问题）

| 脚本 | 观测内容 |
| --- | --- |
| `verify-format-time.js` | `SitePlayer.formatTime` 各入参结果、当前曲目时长/进度文案 |
| `check-dur.js` | 无 LRC 与有 LRC 两种状态下的时长文案 |
| `verify-lyrics-wheel.js` | 无 LRC 锁滚、有 LRC 滚轮与自动跟随、切歌归零、SPA 往返 |
| `verify-flow.js` | 右栏整页滚动/卡片完整性、左栏吸顶、1440/1180/1181/375 几何与溢出 |
| `verify-gc.js` | GoatCounter 计数路径（首页/文章/音乐往返）与 count.js 被拦截时静默 |

## 改哪块跑哪份

耗时为本机实测单跑值（不含 `npm run build`），仅作参考。

| 改到的东西 | 建议跑的脚本 | 耗时 |
| --- | --- | --- |
| 断点 / 布局与横向溢出（1180/1181、900/901、列宽、溢出） | `verify-flow.js` + `verify-disc-toggle.js`（后者含音乐页断点） | 约 66 秒（15 + 50） |
| 迷你播放器（收起展开、底距、封面旋转、自动收回） | `verify-collapse18.js` | 约 2 分 02 秒 |
| 音乐页控件（循环三态、音量、唱片暂停、进度条拖动） | `verify-loop-vol.js` + `verify-disc-toggle.js` | 约 2 分 30 秒（101 + 50） |
| 歌词区（锁滚、双语、时长文案） | `verify-lyrics-wheel.js` + `check-dur.js` | 约 22 秒（14 + 7.5） |
| 右栏卡片与滚动 | `verify-flow.js` | 约 15 秒 |
| 左栏吸顶 | `verify-flow.js` | 约 15 秒 |
| SPA 往返与脚本重放 | `verify-quote.js` + `verify-lyrics-wheel.js` | 约 1 分 07 秒（53 + 14） |
| GoatCounter 计数 | `verify-gc.js` | 约 23 秒 |
| 构建产物与断点校验 | `npm run build`（内含 `scripts/breakpoints.js` 断点校验） | 约 55 秒 |

全套 9 个脚本实测合计约 6 分 33 秒（392 秒），加上起停预览服务与浏览器，一次 `npm run verify` 约 7 分钟。

### 什么时候必须跑全套

- 准备推送或交付前；
- 一次改动跨多个区域（例如同时动了播放器与布局）；
- 改了 `inject` 里的全局样式、公共 JS（`site-player.js` / `spa.js`）或主题 patch——这类改动会波及所有页面，单跑一份说明不了问题。

### 单跑某个脚本

```bash
npm run build          # 首次或改了 source/ 之后
node tools/verify/verify-flow.js
```

- 单跑会自动起预览服务（端口空闲时），跑完自动关闭；端口上已有 `tools/preview.js` 在跑则直接复用，不会起来第二个，也不会关掉你手工起的那个。
- 端口被别的程序占用时报错并退出：`http://127.0.0.1:4173 已被其他程序占用（响应不像 tools/preview.js）…`——关掉占用进程，或用 `VERIFY_BASE` 换端口。
- 想换地址：macOS/Linux `VERIFY_BASE=http://127.0.0.1:8080 node tools/verify/verify-flow.js`；PowerShell `$env:VERIFY_BASE='http://127.0.0.1:8080'; node tools/verify/verify-flow.js`。
- 脚本不再接受命令行 URL 参数，地址统一走 `VERIFY_BASE`。

## 失败时先看哪

1. 有断言脚本先看 `FAIL` 行里的实测值——多数是设计调整后断言过期（贴边距离、断点宽度一类）。
2. 观测型脚本先看是否有 `ERRS []` 以外的 JS 异常，再看 `sw === cw` 是否成立（横向溢出）。
3. 截图在 `tools/verify/out/`，逐张对照 1440/375 两档。

## 说明

- 不新增依赖：只用 Node 内置模块 + 系统已装的 Edge/Chrome。
- 脚本不写仓库内其它位置；`out/` 已忽略。
- 本目录不是产品代码，改动这里不影响 `source/`、`_config*.yml` 或主题 patch。
