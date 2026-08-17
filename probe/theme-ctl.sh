#!/bin/bash
# 设备地址/密钥读 probe/.local-env（gitignore；模板 .local-env.example）
PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$PROBE_DIR/.local-env" ] && . "$PROBE_DIR/.local-env"
# 切换 luci 主题并清缓存，目标解析与 deploy-theme.sh 一致。
# 用法:
#   ./theme-ctl.sh desktop          # 切到 desktop（默认 1.1 设备）
#   ./theme-ctl.sh argon 253        # 切到 argon（253 设备）
# 防止把主题切错设备导致 probe 抓出重复数据。
THEME="$1"; TARGET="${2:-1.1}"
case "$THEME" in
    desktop|argon) ;;
    *) echo "用法: $0 desktop|argon [1.1|253]"; exit 1 ;;
esac
case "$TARGET" in
    1.1)            HOST="${ROUTER_1:-<ROUTER_1>}"; KEY="" ;;
    253)            HOST="${ROUTER_2:-<ROUTER_2>}"; KEY="${SSH_KEY_2:-}" ;;
    *) echo "未知目标: $TARGET"; exit 1 ;;
esac
OPT=(-o ConnectTimeout=10)
[ -n "$KEY" ] && OPT+=(-i "$KEY")
ssh "${OPT[@]}" "root@$HOST" "uci set luci.main.mediaurlbase=/luci-static/$THEME && uci commit luci && rm -rf /tmp/luci-modulecache /tmp/luci-indexcache && echo '== '$HOST': theme=$THEME, mediaurlbase=' \$(uci get luci.main.mediaurlbase)"
