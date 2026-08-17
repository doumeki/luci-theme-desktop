# luci-theme-desktop

OpenWrt LuCI 的**桌面操作系统风格主题**：持久桌面外壳（任务栏、开始菜单、
可拖拽窗口管理器、桌面 widget）。所有 LuCI 页面在 iframe 窗口内加载。

**单包同时支持两种 LuCI runtime**：
- **ucode** runtime — `.ut` 模板
- **Lua** runtime — `.htm` 模板

## 截图

### 桌面

![桌面](appearance/desktop1.png)

![桌面窗口](appearance/desktop2.png)

### 移动端

![移动端](appearance/mobile1.png)

![移动端 widget](appearance/mobile2.png)

## 已测试固件

- 官方 OpenWrt 25.12.5
- ImmortalWrt 25.12
- LEDE（OpenWrt 24.10）

## 系统要求

- **LuCI** — 官方 OpenWrt 固件默认不带，先安装：
  `opkg install luci` 或 `apk add luci`
- **luci-lua-runtime** — 主题 controller 基于 Lua。在纯 ucode LuCI
  （官方 OpenWrt 25.x）上，缺少 Lua 兼容层时主题 API（设置保存、通知、
  changes）会**静默失败**。它是包的声明依赖，**安装时自动带上**——
  正常安装无需手动操作；仅当缺失时（如手动跳过依赖安装）自行安装：
  `opkg install luci-lua-runtime` 或 `apk add luci-lua-runtime`

## 功能

- 桌面外壳：任务栏、开始菜单、窗口管理器、桌面快捷方式
- 内置 widget：时钟、便笺、系统信息、网络流量
- 主题设置：颜色、暗色模式、字体、壁纸、移动端布局
- 自动刷新控制与通知管理
- 缺失时可在桌面直接安装终端（ttyd）
- 中英文界面

## 安装

```sh
opkg install luci-theme-desktop_*.ipk          # opkg 固件
apk add --allow-untrusted luci-theme-desktop_*.apk   # apk 固件
uci set luci.main.mediaurlbase=/luci-static/desktop
uci commit luci
```

安装钩子会自动注册主题并写入默认桌面设置。

## 开发

AI 辅助贡献者请先阅读 [`AGENTS.md`](AGENTS.md) —— 架构、铁律与踩坑速查。

测试分级见 `tests/README.md`：
- **L1** — 无头浏览器单元测试，每次 push/PR 由 CI 自动运行
  （`node tests/run-headless.js`，需要 Node + Firefox + geckodriver）
- **L2** — Lua runtime 层测试（可选，需要 OpenWrt 设备）
- **L3** — 设备部署/冒烟探针（可选，机器相关）

## 参考

部分代码参考/改编自
[luci-theme-argon](https://github.com/jerrykuku/luci-theme-argon)
（作者 jerrykuku）。

## 许可证

Apache-2.0
