#!/bin/bash
# 构建并部署 luci-theme-desktop 到指定设备
# 位置: theme git 的 probe/ 目录
#
# 用法:
#   ./probe/deploy-theme.sh 1.1      # ROUTER_1（见 probe/.local-env）
#   ./probe/deploy-theme.sh 253      # ROUTER_2（见 probe/.local-env）
#   ./probe/deploy-theme.sh <IP>     # 完整 IP 亦可
#
# 流程: make compile（当前 checkout 分支!）→ 找最新 ipk → scp → md5 对比(防中断)
#       → opkg install --force-reinstall → 清 Lua 模板缓存(仅 253) → 确认版本
#
# ⚠️ 分支分工（2026-08-15 合并后）: 单包双轨 —— 同一 ipk 同时含 Lua(.htm) 与
#   ucode(.ut) 模板 + runtime.lua 抽象层，两台设备都装合并分支（merge-plan）
#   构建的同一包。
#
# 本机环境（构建树路径 / 设备 IP / ssh key）读 probe/.local-env（gitignore，
# 模板见 .local-env.example）——公开仓库不含任何本机地址。
PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$PROBE_DIR/.local-env" ]; then . "$PROBE_DIR/.local-env"; fi
# 构建树根: 环境变量优先，否则按 probe/ 相对位置（主题 clone 在
# <buildtree>/package/custom/luci-theme-desktop 时自动成立）
LEDE_ROOT="${LEDE_ROOT:-$(cd "$PROBE_DIR/../../../.." && pwd)}"

usage() {
    echo "用法: $0 <目标>  目标: 1.1 / 253 / <IP>（设备地址见 probe/.local-env）"
    exit 1
}
[ $# -eq 1 ] || usage

TARGET="$1"
case "$TARGET" in
    1.1)        HOST="${ROUTER_1:-<ROUTER_1>}"; KEY="" ;;
    253)        HOST="${ROUTER_2:-<ROUTER_2>}"; KEY="${SSH_KEY_2:-}" ;;
    *)          HOST="$TARGET"; KEY="" ;;
esac

# 合并后单包双机，无需分支防呆（历史: 装错 track 曾导致主题不兼容）
THEME_GIT="$LEDE_ROOT/package/custom/luci-theme-desktop"
echo "== 当前 theme 分支: $(git -C "$THEME_GIT" branch --show-current 2>/dev/null)（单包双轨，双机通吃）"

echo "== 编译 luci-theme-desktop =="
make -C "$LEDE_ROOT" package/custom/luci-theme-desktop/compile V=s >/tmp/deploy-theme-build.log 2>&1 || {
    echo "!! 编译失败，日志: /tmp/deploy-theme-build.log"; exit 1; }

IPK="$(ls -t "$LEDE_ROOT"/bin/packages/x86_64/base/luci-theme-desktop_*.ipk 2>/dev/null | head -1)"
if [ -z "$IPK" ]; then echo "!! 找不到 ipk"; exit 1; fi
echo "== 包: $(basename "$IPK")"

OPT=(-o ConnectTimeout=10)
[ -n "$KEY" ] && OPT+=(-i "$KEY")
echo "== 部署到 $HOST =="

# scp 到固定文件名（避免远端残留旧版本文件，安装时路径统一）
scp -O "${OPT[@]}" -q "$IPK" "root@$HOST:/tmp/luci-theme-desktop.ipk" || {
    echo "!! $HOST scp 失败"; exit 1; }

# md5 对比：scp 中断会留下旧文件且 opkg 照装（旧坑）
LOCAL_MD5="$(md5sum "$IPK" | cut -d' ' -f1)"
REMOTE_MD5="$(ssh "${OPT[@]}" "root@$HOST" "md5sum /tmp/luci-theme-desktop.ipk | cut -d' ' -f1")"
if [ -z "$REMOTE_MD5" ] || [ "$LOCAL_MD5" != "$REMOTE_MD5" ]; then
    echo "!! $HOST 传输不完整 (local=$LOCAL_MD5 remote=$REMOTE_MD5)"; exit 1
fi
echo "== 传输完整 (md5 ok)"

# 包管理器兼容（opkg 老固件 / apk 新固件如 ImmortalWrt 25.12+）
# 优先 opkg（--force-reinstall 保证重装生效）；否则 apk（新固件不认 ipk，
# 需先 ipk2apk 转换；本地静态 apk-tools 放 /tmp/apk.static，见 probe-README）
PM=$(ssh "${OPT[@]}" "root@$HOST" "command -v opkg >/dev/null 2>&1 && echo opkg || (command -v apk >/dev/null 2>&1 && echo apk || echo none)")
echo "== 包管理器: ${PM:-none}"
case "$PM" in
    opkg)
        ssh "${OPT[@]}" "root@$HOST" \
            "opkg install --force-reinstall /tmp/luci-theme-desktop.ipk 2>&1 | tail -2" || {
            echo "!! $HOST 安装失败 (opkg)"; exit 1; }
        ;;
    apk)
        # ipk2apk 转换（需本机 fakeroot + apk mkpkg；静态 apk 见 README）
        CONV="${DEPLOY_IPK2APK:-/tmp/ipk2apk}"
        if [ ! -x "$CONV" ]; then
            echo "!! apk 固件需要 ipk2apk 转换器（$CONV 不存在）"
            echo "   获取: curl -L -o /tmp/ipk2apk https://raw.githubusercontent.com/sbwml/ipk2apk/main/bin/ipk2apk && chmod +x /tmp/ipk2apk"
            exit 1
        fi
        APK_DIR=$(mktemp -d)
        # 转换器需要 PATH 里的 apk（mkpkg）+ fakeroot。本机无 apk-tools 时
        # 用静态版（见 probe-README）: 放 /tmp/apk.static 或 /usr/local/bin/apk
        APKTOOL="$(command -v apk 2>/dev/null || echo /tmp/apk.static)"
        if [ "$APKTOOL" = "/tmp/apk.static" ] && [ ! -x "$APKTOOL" ]; then
            echo "!! 需要静态 apk-tools: curl -L -o /tmp/apk.static https://github.com/sbwml/apk-tools/releases/download/v3.0.5-static/apk.static-x86_64 && chmod +x /tmp/apk.static"
            exit 1
        fi
        if [ "$APKTOOL" = "/tmp/apk.static" ]; then
            # 转换脚本调用的是 `apk`（不是 apk.static）——建个临时符号链接
            APK_BIN_DIR=$(mktemp -d)
            ln -sf /tmp/apk.static "$APK_BIN_DIR/apk"
            export PATH="$APK_BIN_DIR:$PATH"
        fi
        if ! "$CONV" "$IPK" "$APK_DIR" >/tmp/ipk2apk.log 2>&1; then
            echo "!! ipk2apk 转换失败，日志: /tmp/ipk2apk.log"; exit 1
        fi
        [ -n "${APK_BIN_DIR:-}" ] && rm -rf "$APK_BIN_DIR"
        APK="$(ls "$APK_DIR"/*.apk 2>/dev/null | head -1)"
        [ -z "$APK" ] && { echo "!! 转换无输出 apk"; exit 1; }
        echo "== 转换: $(basename "$IPK") → $(basename "$APK")"
        scp -O "${OPT[@]}" -q "$APK" "root@$HOST:/tmp/luci-theme-desktop.apk" || {
            echo "!! $HOST scp apk 失败"; exit 1; }
        rm -rf "$APK_DIR"
        ssh "${OPT[@]}" "root@$HOST" \
            "apk add --allow-untrusted --force-overwrite /tmp/luci-theme-desktop.apk 2>&1 | grep -vE 'WARNING|wget|unexpected|^ERROR: wget' | tail -4" || {
            echo "!! $HOST 安装失败 (apk)"; exit 1; }
        # apk 不自动执行 uci-defaults（post-install 已写主题/种子，通常无需；
        # 若配置缺失可手动: for f in /etc/uci-defaults/*; do sh \$f; done）
        ;;
    *)
        echo "!! $HOST 无 opkg/apk"; exit 1 ;;
esac

# uci-defaults 执行兜底：opkg 固件行为不一（有的装包即执行并消费文件，有的等开机），
# apk 流程不自动执行 —— 统一在装后手动跑一次我们的文件（幂等），保证主题激活。
# 配合 30_luci-theme-desktop 的无条件注册块，升级/重装必定切回 desktop。
ssh "${OPT[@]}" "root@$HOST" '
    for f in /etc/uci-defaults/*luci-theme-desktop*; do
        [ -f "$f" ] && { sh "$f"; echo "uci-defaults ran: $f"; }
    done
    true
' 2>/dev/null
echo "== uci-defaults 兜底执行 (注册+激活主题, 幂等; 文件已被固件消费时自动跳过)"

# ===== 内容 tab era（2026-11-15）=====
# 不再由部署脚本写 desktop.settings.tab_era：脚本不可能知道别人的固件属于
# 哪一代 LuCI（两台的 luci.version 被 OEM 改成同一个假戳，luci.js 两台都没
# 有，cbi.js 大小一致），按目标名硬编码只会把 1.1/253 绑死。
# 现在它是设备上的设置项：设置 → 主题 → 兼容性 → 「Tab 优先」：
#   自动（跟随设备，unset）/ 页面内（老 LuCI 19.07）/ 标题栏（现代）
# 老 LuCI 设备由用户手动选「页面内」；unset / 自动 = 现代 = 修复前行为。
echo "== Tab 优先 是设备设置项（设置→主题→兼容性），部署不写入 tab_era"

# Lua track 模板缓存：装包不清的话 header.htm 渲染旧版（JS 静态文件不受影响）。
# 单包双轨后两台目标都是 Lua track —— 无条件清（2026-11-15: EzOpWrt 换固件后
# 旧缓存遮蔽新菜单树，原 KEY 条件导致 1.1 目标漏清，故改无条件）
ssh "${OPT[@]}" "root@$HOST" "rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache" 2>/dev/null
echo "== 已清 Lua 模板缓存 (luci-indexcache/modulecache)"

ssh "${OPT[@]}" "root@$HOST" "echo '-- version.txt:' && cat /www/luci-static/desktop/version.txt" 2>/dev/null

# ===== 部署后自动冒烟（deploy-smoke.sh）=====
# 抓两类历史事故：主题回退（模板编译失败→bootstrap/argon）与 changes 端点
# 变 HTML（controller 分叉被覆盖→leaf 遮蔽）。FAIL 则整体退出非零。
echo "== 部署后冒烟验证 =="
if ! bash "$(dirname "$0")/deploy-smoke.sh" "$TARGET"; then
    echo "!! ⚠️  冒烟未通过——部署可能有问题，请检查后重新验证"
    exit 1
fi
echo "== $HOST 完成"
