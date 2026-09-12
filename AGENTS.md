# AGENTS.md — AI 开发指引

> 给使用 AI 编程工具（Cursor / Claude Code / Copilot 等）的贡献者。
> 目标：改代码前 5 分钟理解架构与铁律，避免重复踩坑。

## 项目一句话

OpenWrt LuCI 的**桌面操作系统风格主题**：持久桌面外壳（任务栏、开始菜单、
窗口管理器、桌面 widget），所有 LuCI 页面在 iframe 窗口内加载
（`?embed=1` 区分外壳/内容渲染）。

## 快速验证

```sh
node tests/run-headless.js   # L1 单元测试（Node + Firefox + geckodriver，CI 每次 push/PR 自动跑）
```

## 架构要点（改代码前必读）

1. **双 runtime 单包**：同一 ipk 同时装 ucode（`.ut`）与 Lua（`.htm`）模板，
   LuCI 按 runtime 自动选。**模板改动必须双份同步**：
   `files/usr/share/ucode/luci/template/themes/desktop/*.ut` ↔ `files/templates/*.htm`
   （footer/header/sysauth 三对）。
2. **controller 是 Lua**（`files/controller/desktop.lua`），平台差异全部收敛在
   `luci.desktop.runtime`（runtime.lua）：`isUcode() / cookieName() / sessionValid()
   / getChanges() / apply() / revert()`。**必须函数内 require**（modulecache
   字节码缓存会把模块级 local 变 nil —— 经典坑）。
   **cookie 名随 runtime，不随设备**——`cookieName()` 是唯一权威（Lua→`sysauth`，
   ucode→`sysauth_http`）。不要把"设备"当"track"的代理：设备重刷/换固件会让
   track 漂移，任何"某设备 = 某 track/某 cookie 名"的硬编码都是过期认知。探针要
   读登录响应实际 `Set-Cookie` 的名字（`probe/lib.js`），不要猜。
3. **前端**：`window.LuCIDesktop` 命名空间。模块划分（`files/htdocs/js/`）：
   - `shell.js` — boot 流程、开始菜单、通知
   - `wm.js` — 窗口管理器（open/close/focus/拖拽/标题）
   - `taskbar.js` — 任务栏、auto-refresh 开关（会话级）
   - `desktop.js` — 桌面门面（facade）：转发 `window.Desktop` 公共 API + 组合
     init；保留默认快捷方式目录、可用性探测、ttyd 安装
   - `desktop-state.js` — 共享状态 `pinnedItems`/`hiddenIcons`/`iconLayout` +
     load/save/normalize/迁移，经 `LuCIDesktop.desktopState` 读写
   - `desktop-icons.js` — 图标渲染/网格碰撞布局、图标选择器接入、quantum 拖拽
   - `desktop-menus.js` — 三套右键菜单 + 自定义链接对话框
   - `desktop-links.js` — 自定义 URL（normalize/resolve/open）+ 幽灵清理豁免
   - `mobile.js` — 移动端（switcher、无多窗口）
   - `widget.js` + `widgets/` — 桌面 widget 框架与组件
   - `iframe-bridge.js` — iframe 注入（隐藏 chrome、链接拦截、XHR 轮询控制、
     auto-refresh 广播、ttyd iframe 撑高）
4. **配置存储**：UCI `desktop` 配置（settings/widgets/pins/hidden/mobile_*）；
   便笺存 JSON 文件 `/etc/luci-theme-desktop/stickysync.json`（原子写，非 UCI）。
   种子默认配置在 `files/30_luci-theme-desktop`（`CONFIG_VERSION` 控制是否重写，
   不要随意 bump——会覆盖已装设备的用户配置）。
5. **`__LUCI_RUNTIME__`**：footer 双模板注入（'ucode'/'lua'），前端按 runtime
   选路径（如终端快捷方式）。注入时机在 desktop.js 注册**之后**——依赖它的
   逻辑必须延迟解析/由 shell.js boot 触发。
6. **依赖**：`luci-base + luci-lua-runtime`（Makefile DEPENDS，安装自动带上；
   controller 是 Lua 的，纯 ucode LuCI（官方 25.x 默认无）不装兼容层则
   controller 不加载——changes/* 403/HTML、保存静默失败；缺时手动
   `opkg install luci-lua-runtime` / `apk add luci-lua-runtime`）。

## 开发铁律

- 改 JS 后必须跑 `node tests/run-headless.js`；新增测试文件仍要加进
  `tests/js/test-runner.html` 的 script 列表，但**漏加不再静默**：run-headless
  自动把磁盘上的 `tests/js/*.test.js` 与 runner 清单对照，多、少、重复都直接
  fail 并列出该加/该删的文件名（0.1.0-230 起）。
- 改界面文案 = **只改 dict**（`files/htdocs/js/i18n.js` 的 `zh_cn` 块）+ 跑
  `node tools/gen-i18n.js` 生成 pot/po（dict 是唯一来源；run-headless 有防漂移
  检查，dict 改了没重生成会 fail）。不要再手改 pot/po。
- 改模板/controller 后：部署 + smoke（`probe/deploy-theme.sh` 自带冒烟：主题身份/
  changes JSON）。
- 版本号：`Makefile` 的 `PKG_RELEASE` +1，提交信息注明版本。
- 提交信息用英文。

## 敏感信息与个人测试信息（红线）

本仓库会发布到公开远端，**推送不可撤销**，而 CI 只跑 L1 测试、**没有任何**
密钥扫描兜底。所以：

- **红线**：任何被 git 跟踪的文件里都不得出现真实设备地址/主机名、口令、
  token、私钥内容或私钥路径、个人环境路径（本机绝对路径、个人 ssh key 名等）。
  文档、注释、示例脚本一视同仁——公开仓库是永久且可被索引的。
- **个人值只放本地**：设备地址、ssh key 等写进 **gitignored** 的
  `probe/.local-env`（仓库只提供 `probe/.local-env.example` 模板，自行复制填写）。
  脚本/代码**只从环境变量或该文件读取**，绝不写死。
- **覆盖用既有变量**：`ROUTER_1` / `ROUTER_2` / `SSH_KEY_2`
  （`probe/.local-env`）与 `PROBE_ROUTER` / `PROBE_SSH` / `PROBE_SSH_KEY`
  （进程环境，单次运行覆盖）。接新设备时优先复用这些变量，不要新增写死的默认值。
- **占位符约定**：文档/示例里用
  `<router-ip-or-host>`、`<ssh-host>`、`<path-to-private-key>`、`${VAR}`；
  需要示例 IP 时用 RFC 5737 文档网段（`192.0.2.x`、`198.51.100.x`、`203.0.113.x`）。
- **分享复现步骤时**：只贴命令与占位符，别贴真实值；把个人数据留在本地。
- **自动化保障**：L1 套件（`node tests/run-headless.js`，CI 每次 push/PR 执行）
  内置敏感信息扫描闸门，扫描所有会被公开的文件（`files/`、`tests/`、`tools/`、
  `probe/`、`Makefile`、`.gitignore`、`AGENTS.md`、`tests/README.md`）。命中
  设备 IP、私钥标记、赋值型凭据、内部域名，或 `probe/.local-env` 真值泄漏，
  即 **fail**，输出只给 `文件:行号` + 脱敏片段。确属误报要**精确豁免**：在命中
  行加 `// secret-scan-allow: <rule>` 注释，或在 `tests/run-headless.js` 顶部的
  `SECRET_SCAN_ALLOW` 加一条 `文件:规则`；**不要**整体关掉检查。
- **新贡献者三步上手**：
  1. `cp probe/.local-env.example probe/.local-env`，填入自己的设备地址与 key 路径；
  2. `node tests/run-headless.js` —— L1 测试（无需路由器，应全绿）；
  3. `bash probe/deploy-theme.sh <device>` —— 构建 + 部署 + 冒烟（`<device>` 用
     `probe/.local-env` 里定义的别名或地址）。

## 踩坑速查（AI 高频翻车点）

| 坑 | 对策 |
|---|---|
| 模板只改了一份 | `.ut` 与 `.htm` 双份同步 |
| controller 模块级 require | 函数体内 require（幂等） |
| ucode 模板用字符串方法 | 用 `match()` 正则（ucode 无 `.to_lower()` 等） |
| 探针布局测不出真机问题 | headless 视口下限 500px——布局探针手动把 iframe 压到 390px |
| 第三方应用表格改不动 | 某些应用的行是 `tr{display:flex;flex-wrap:wrap}`，`table-layout` 无效 |
| i18n 报错/缺翻译 | 只改 `i18n.js` 的 dict → 跑 `node tools/gen-i18n.js`；run-headless 防漂移检查 |
| widget 样式越渲染越乱 | 静态样式进 `widget.css`，动态值走内联/`--var`；**禁止 `el.style.cssText +=` 累加**（render 必须幂等，run-headless 自动扫描 widgets/*.js） |
| 部署后没生效（Lua track） | 清 `/tmp/luci-modulecache` + 重启 uhttpd（deploy 脚本已处理） |
| 用设备名推断 track/cookie 名 | 换固件后登录失败——cookie 名只问 runtime：`cookieName()`（Lua `sysauth` / ucode `sysauth_http`）；探针读登录响应实际 `Set-Cookie` |
| firefox 探针崩溃 | kill 残留重试（`[g]eckodriver --port` 模式）；**绝不裸 `pkill -f firefox`** |
| ttyd 页面 iframe 不撑满 | 新版 luci-app-ttyd 的 iframe 是 JS 延迟注入——`fitTtydIframe` 有重试 |
| 弹出层开到屏幕外 | **先把内容渲染进去再测量**（空菜单量到 0×0，夹取静默失效）；**宽度和高度都夹**进视口；统一入口 `_makeMenu(x,y,html)`（`desktop-menus.js`，三套右键菜单 + `showPinMenu` 都走它）；`display:none` 的元素量不到尺寸；二级菜单按行位置翻转方向 |
| 子菜单方向不翻 | 右边缘要翻到左侧（`.sub-left`），鼠标 `mouseenter` 用捕获阶段监听 |
| 改 URL 丢图标/位置 | 图标选择、格子位置、隐藏状态都按 URL 存，改 URL 要迁移（`_moveLinkMeta`） |
| 自定义 pin 被当幽灵删 | 不在菜单树里的 pin 要 `custom:true` 豁免幽灵清理（pins/hidden/icon_layout 三处） |
| 用假设限制手势 | 先真机实测再定约束——移动端开始菜单列表不滚动，按"会滚动"加的门槛让手势失效 |
| 外壳模式没有 fonts.css | 外壳分支只链 shell/window/taskbar/startmenu/icon-picker/widget/mobile.css——`cascade.css`/`fonts.css` 只在 embed 分支。外壳里要用图标字体（argon）必须在 `startmenu.css` 自声明 `@font-face` |
| 加分类图标要改两处 | 0.1.0-229 起单一来源：只改 `startmenu.js` 的 `CAT_ICONS`（`slug → {g:字形码, c:颜色}`，码位从 `cascade.css` 旧规则 `content` 抄）；CSS 一条通用 `[data-glyph]::before` 自动渲染。字形没覆盖的走 emoji/首字母兜底，图标槽用 `min-width`（勿写死宽度，否则 emoji 压标题） |
| contenteditable 取值 | 永远别用 `textContent`（Enter 产生的是块级子元素/`<br>`，换行会全丢），按 DOM 形状序列化 |

## 第三方应用样式修补（壳内）

桌面壳内嵌的第三方应用（passwall2 等）自带**内联 `<style>`**，在壳内可能渲染错乱
（如 passwall2 分流规则表 ≤1152px 变 flex 卡片、表头消失）。修补约定：

1. **默认方式 = 主题动态注入**：
   - 样式写成独立文件：`files/htdocs/css/apps/<app>-<fix>.css`
   - 在 `iframe-bridge.js` 的 `APP_CSS` 表注册（URL 子串匹配 + 文件路径 + style id）
   - 页面加载后 `injectAppCss()` fetch 注入——**晚于应用内联样式**，且选择器加 `body` 前缀
     提高 specificity，可压过应用的 `!important`
   - **删除文件 = 静默回退**（fetch 404 直接跳过），绝不报错
2. **不要直改 feed 文件**：会被 feed 更新冲掉，且影响所有主题。
   只有当"所有主题都必须修"时才考虑直改，并说明理由。
3. 注入规则尽量限定在应用自己的断点内（同款 `@media`），避免影响无关页面。
4. 注意：老 LuCI（Lua 调度器）不解析 menu.d JSON 路由——纯 JS 应用页面 404 时
   （如 lienol socat main 分支），CSS 注入救不了路由，需 Lua 控制器/换分支。

## 测试分层

- **L1**：`node tests/run-headless.js` — 浏览器单元测试（无需路由器，CI 跑）
- **L2**：`tests/lua/test-runtime.lua` — runtime 抽象层，需 OpenWrt 设备
- **L3**：`probe/` — 部署/冒烟/真机探针，需 OpenWrt 设备

详见 `tests/README.md`。

## 更多文档

- `tests/README.md` — 测试手册（三级别、CI）
