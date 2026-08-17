# AGENTS.md — AI 开发指引

> 本文档给使用 AI 编程工具（Cursor / Claude Code / Copilot 等）的开发者。
> 目标是让 AI 在改代码前 5 分钟内理解架构与铁律，避免重复踩坑。

## 项目一句话

OpenWrt LuCI 的**桌面操作系统风格主题**：持久桌面外壳（任务栏、开始菜单、
窗口管理器、桌面 widget），所有 LuCI 页面在 iframe 窗口内加载
（`?embed=1` 区分外壳/内容渲染）。

## 快速验证

```sh
node tests/run-headless.js          # L1 单元测试（Node + Firefox + geckodriver，CI 每次 push/PR 自动跑）
bash probe/deploy-theme.sh 1.1      # 部署到测试路由器（设备地址在 probe/.local-env，模板 .local-env.example）
```

## 架构要点（改代码前必读）

1. **双 runtime 单包**：同一 ipk 同时装 ucode（`.ut`）与 Lua（`.htm`）模板，
   LuCI 按 runtime 自动选。**模板改动必须双份同步**：
   `files/usr/share/ucode/luci/template/themes/desktop/*.ut` ↔ `files/templates/*.htm`
   （footer/header/sysauth 三对）。
2. **controller 是 Lua**（`files/controller/desktop.lua`），平台差异全部收敛在
   `luci.desktop.runtime`（runtime.lua）：`isUcode() / cookieName() / sessionValid()
   / getChanges() / apply() / revert()`。**必须函数内 require**（253 modulecache
   字节码缓存会把模块级 local 变 nil —— 经典坑）。
3. **前端**：`window.LuCIDesktop` 命名空间。模块划分（`files/htdocs/js/`）：
   - `shell.js` — boot 流程、开始菜单、通知
   - `wm.js` — 窗口管理器（open/close/focus/拖拽/标题）
   - `taskbar.js` — 任务栏、auto-refresh 开关（会话级）
   - `desktop.js` — 桌面快捷方式、可用性探测、ttyd 安装
   - `mobile.js` — 移动端（switcher、无多窗口）
   - `widget.js` + `widgets/` — 桌面 widget 框架与组件
   - `iframe-bridge.js` — iframe 注入（隐藏 chrome、链接拦截、XHR 轮询控制、
     auto-refresh 广播、ttyd iframe 撑高）
4. **配置存储**：UCI `desktop` 配置（settings/widgets/pins/hidden/mobile_*）；
   便笺存 JSON 文件 `/etc/luci-theme-desktop/stickysync.json`（原子写，非 UCI）。
   种子默认配置在 `files/30_luci-theme-desktop`（`CONFIG_VERSION` 控制是否重写，
   **不要随意 bump**——会覆盖已装设备的用户配置）。
5. **`__LUCI_RUNTIME__`**：footer 双模板注入（'ucode'/'lua'），前端按 runtime
   选路径（如终端快捷方式）。注入时机在 desktop.js 注册**之后**——依赖它的
   逻辑必须延迟解析/由 shell.js boot 触发。
6. **依赖**：`luci-base + luci-lua-runtime`（Makefile DEPENDS，controller 是 Lua
   的，纯 ucode LuCI 不装兼容层则 controller 不加载）。

## 开发铁律

- 改 JS 后必须跑 `node tests/run-headless.js`；**新增测试文件要加进
  `tests/js/test-runner.html` 的 script 列表**（漏加 = 测试静默没跑）。
- 改界面文案 = i18n 三方同步（dict/pot/po，run-headless 自动检查不一致）。
- 改模板/controller 后：部署 + smoke（`deploy-theme.sh` 自带冒烟：主题身份/
  changes JSON）。
- 版本号：`Makefile` 的 `PKG_RELEASE` +1，提交信息注明版本。
- git：只在主题仓库操作、不 `git add -A`（外层是大构建树）、提交用双引号、
  开发在 `merge-plan` 分支。
- **发布与本地差异**：`github-release` 分支（公开仓库）**不含任何单应用适配**
  （如特定第三方应用的 CSS/JS 补丁）——`merge-plan` 保留这些供本地设备使用。
  通用改动从 `merge-plan` 挑选同步到 `github-release`（该分支保持单提交，
  用 `git commit --amend`）。

## 踩坑速查（AI 高频翻车点）

| 坑 | 对策 |
|---|---|
| 模板只改了一份 | `.ut` 与 `.htm` 双份同步 |
| controller 模块级 require | 函数体内 require（幂等） |
| ucode 模板用字符串方法 | 用 `match()` 正则（ucode 无 `.to_lower()` 等） |
| 探针布局测不出真机问题 | headless 视口下限 500px——布局探针手动把 iframe 压到 390px |
| 第三方应用表格改不动 | 某些应用的行是 `tr{display:flex;flex-wrap:wrap}`，`table-layout` 无效 |
| i18n 报错/缺翻译 | dict/pot/po 三方对齐后再跑 |
| 部署后没生效（Lua track） | 清 `/tmp/luci-modulecache` + 重启 uhttpd（deploy 脚本已处理） |
| firefox 探针崩溃 | kill 残留重试（`[g]eckodriver --port` 模式）；**绝不裸 `pkill -f firefox`** |
| ttyd 页面 iframe 不撑满 | 新版 luci-app-ttyd 的 iframe 是 JS 延迟注入——`fitTtydIframe` 有重试 |

## 测试分层

- **L1**：`node tests/run-headless.js` — 浏览器单元测试（无需路由器，CI 跑）
- **L2**：`tests/lua/test-runtime.lua` — runtime 抽象层，需 OpenWrt 设备
- **L3**：`probe/` — 部署/冒烟/真机探针（`probe/.local-env` 配置设备，机器相关）

详见 `tests/README.md`。

## 更多文档

- `tests/README.md` — 测试手册（三级别、CI）
- `HANDOVER.md` — 项目内部交接文档（完整踩坑史与架构演进；公开仓库已移除，
  本机开发仓库有完整版）
