# tools/verify — 回归脚本

对已构建的站点做无头浏览器回归：用 Chromium 内核（Edge/Chrome）的 CDP 打开 `public/` 下的页面，检查播放器、迷你条、歌词区、布局与统计脚本。

## 运行

```bash
npm run build   # 先构建，脚本直接读 public/
npm run verify  # 一条命令跑全部
```

入口会自动复用（或后台启动）`tools/preview.js`（:4173，支持 HTTP Range——音频进度条能拖动的前提），跑完自动关闭。

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

## 失败时先看哪

1. 有断言脚本先看 `FAIL` 行里的实测值——多数是设计调整后断言过期（贴边距离、断点宽度一类）。
2. 观测型脚本先看是否有 `ERRS []` 以外的 JS 异常，再看 `sw === cw` 是否成立（横向溢出）。
3. 截图在 `tools/verify/out/`，逐张对照 1440/375 两档。

## 说明

- 不新增依赖：只用 Node 内置模块 + 系统已装的 Edge/Chrome。
- 脚本不写仓库内其它位置；`out/` 已忽略。
- 本目录不是产品代码，改动这里不影响 `source/`、`_config*.yml` 或主题 patch。
