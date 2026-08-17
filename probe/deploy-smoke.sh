#!/bin/bash
# 设备地址/密钥读 probe/.local-env（gitignore；模板 .local-env.example）
PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$PROBE_DIR/.local-env" ] && . "$PROBE_DIR/.local-env"
# deploy-smoke.sh — 部署后自动冒烟验证（由 deploy-theme.sh 调用）
#
# 检查（轻量 curl，不依赖 headless 浏览器）：
#   1. 主题身份：登录态 shell 页必须引用 /luci-static/desktop/（抓 bootstrap/argon
#      回退——模板编译失败的典型症状）
#   2. changes apply/revert 端点必须返回 JSON（抓 controller 分叉覆盖——
#      leaf 遮蔽时端点返回页面 HTML，changes 窗口"保存&应用/放弃"会显示 fail）
#   3. version.txt 与期望版本一致（可选参数）
#
# 用法: ./probe/deploy-smoke.sh 1.1|253 [期望版本]
#   1.1 = ${ROUTER_1}（空密码 curl 登录） 253 = ${ROUTER_2}（ssh 铸 session）
set -u

HOST=""; KEY=""
case "${1:-}" in
    1.1) HOST="${ROUTER_1:-<ROUTER_1>}"; KEY="" ;;
    253) HOST="${ROUTER_2:-<ROUTER_2>}"; KEY="${SSH_KEY_2:-}" ;;
    *) echo "用法: $0 1.1|253 [期望版本]"; exit 2 ;;
esac
EXPECT_VER="${2:-}"
OPT=(-o ConnectTimeout=10)
[ -n "$KEY" ] && OPT+=(-i "$KEY")
FAIL=0
say() { echo "  $1"; }

COOKIE_FILE=$(mktemp)
cleanup() { rm -f "$COOKIE_FILE"; }
trap cleanup EXIT

# ===== 登录 =====
if [ -z "$KEY" ]; then
    curl -s -c "$COOKIE_FILE" -o /dev/null \
        -d "luci_username=root&luci_password=" "http://$HOST/cgi-bin/luci/"
    CK="sysauth_http"
else
    TOK=$(ssh "${OPT[@]}" "root@$HOST" \
        "ubus call session create '{\"timeout\":900}'" 2>/dev/null | grep -o '[0-9a-f]\{32\}' | head -1)
    if [ -z "$TOK" ]; then
        echo "!! smoke: 无法铸 ubus session（ssh 失败？）"; exit 2
    fi
    ssh "${OPT[@]}" "root@$HOST" \
        "ubus call session set '{\"ubus_rpc_session\":\"$TOK\",\"values\":{\"token\":\"$TOK\",\"username\":\"root\"}}'" >/dev/null 2>&1
    CK="sysauth"
    printf '%s\n' "# Netscape HTTP Cookie File" \
        "$HOST	FALSE	/	FALSE	0	$CK	$TOK" > "$COOKIE_FILE"
fi

# ===== 1. 主题身份 =====
HTML=$(curl -s -b "$COOKIE_FILE" "http://$HOST/cgi-bin/luci/")
if echo "$HTML" | grep -q '/luci-static/desktop/'; then
    say "OK   主题 = desktop"
else
    say "FAIL 主题未渲染 desktop（可能 bootstrap/argon 回退）"
    echo "$HTML" | grep -o 'luci-static/[a-zA-Z]*' | sort -u | head -3 | sed 's/^/      实际: /'
    FAIL=1
fi
if echo "$HTML" | grep -q '/luci-static/bootstrap'; then
    say "FAIL 检测到 bootstrap 资源"
    FAIL=1
fi

# ===== 1b. favicon: 页面 head 必须引用 favorit.png =====
if echo "$HTML" | grep -q 'rel="icon"[^>]*favorit.png'; then
    say "OK   favicon = favorit.png"
else
    say "FAIL favicon link 缺失（期望 favorit.png）"
    FAIL=1
fi

# ===== 2. changes apply/revert 端点返回 JSON =====
# SAFETY (0.1.0-127+): apply/revert 是真实配置操作——ucode track 的 apply
# 执行 ubus uci apply（90s rollback 窗口，冒烟不 confirm）。若设备上存在
# pending changes（用户改了一半的配置），冒烟会真的应用它们并在 90 秒后
# 自动回滚——用户会看到 LuCI 的"配置被回滚"警告（2026-08-16 真实发生）。
# 因此有 pending changes 时跳过这两个端点的冒烟（端点存在性由页面引用
# 与 index 冒烟覆盖；controller 未挂载时 revert/apply 也会 404 于下）。
PENDING=$(ssh "${OPT[@]}" "root@$HOST" "uci changes 2>/dev/null | wc -l" 2>/dev/null)
if [ "${PENDING:-0}" -gt 0 ]; then
    say "SKIP changes apply/revert（设备有 $PENDING 条 pending changes，不动真格）"
else
    for EP in revert apply; do
        R=$(curl -s -b "$COOKIE_FILE" -X POST "http://$HOST/cgi-bin/luci/admin/desktop/changes/$EP")
        case "$R" in
            \{*) say "OK   changes/$EP → JSON ($(echo "$R" | head -c 40))" ;;
            *)   say "FAIL changes/$EP 未返回 JSON: $(echo "$R" | head -c 60)"; FAIL=1 ;;
        esac
    done
fi

# ===== 3. 版本 =====
if [ -n "$EXPECT_VER" ]; then
    V=$(ssh "${OPT[@]}" "root@$HOST" "cat /www/luci-static/desktop/version.txt 2>/dev/null" 2>/dev/null)
    if [ "$V" = "$EXPECT_VER" ]; then
        say "OK   版本 = $V"
    else
        say "FAIL 版本期望 $EXPECT_VER，实际 ${V:-无}"
        FAIL=1
    fi
fi

# ===== 4. 保存链路（2026-08-18：官方 25.x 曾静默吞掉 UCI 写——保存返回
# ok 但 UCI 从未写入。每次部署都实测 POST save → uci 写盘 → 恢复原值）=====
say "检查 保存链路 (desktop/save → uci 写盘)"
SMOKE_VAL="{\"smoke\":\"$(date +%s)\"}"
OLD_VAL=$(ssh "${OPT[@]}" "root@$HOST" "uci -q get desktop.mobile_widgets.config" 2>/dev/null)
curl -s -b "$COOKIE_FILE" -o /dev/null \
    --data-urlencode "section=mobile_widgets" --data-urlencode "data=$SMOKE_VAL" \
    "http://$HOST/cgi-bin/luci/admin/desktop/save"
GOT=$(ssh "${OPT[@]}" "root@$HOST" "uci -q get desktop.mobile_widgets.config" 2>/dev/null)
if [ "$GOT" = "$SMOKE_VAL" ]; then
    say "OK   保存链路 → uci 写盘成功"
else
    say "FAIL 保存链路未写盘 (got=[${GOT:-无}])"
    FAIL=1
fi
# 恢复原值（绝不留下 smoke 数据）
if [ -n "$OLD_VAL" ]; then
    ssh "${OPT[@]}" "root@$HOST" "uci set desktop.mobile_widgets.config='$OLD_VAL'; uci commit desktop" >/dev/null 2>&1
else
    ssh "${OPT[@]}" "root@$HOST" "uci -q delete desktop.mobile_widgets; uci commit desktop" >/dev/null 2>&1
fi

if [ $FAIL -eq 0 ]; then
    echo "== smoke PASS"
else
    echo "== ⚠️  smoke FAIL"
fi
exit $FAIL
