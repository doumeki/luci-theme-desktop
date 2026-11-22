#!/bin/bash
# session-expiry-device.sh — q685 会话过期机制测试(Level 3 设备测试)。
#
# 验证死会话对主题端点可见(q685 修复 C 的行为契约):
#   1) 真实表单登录 → 拿到 sysauth* 会话 cookie
#      (设备设了 web 密码而我们没有时,改为 ssh forge 一个探针自有会话)
#   2) uci_changes 上报 "session":true(活会话)
#   3) ssh 上用 ubus session destroy 灌死该会话(只灌死探针自己的会话)
#   4) uci_changes 上报 "session":false
#   5) 死会话 POST apply → 401 {"ok":false,"msg":"auth"}(q685 用户症状)
#   6) 重新登录/重造会话 → 新 sid,uci_changes 恢复 "session":true
#
# 配置零净变更:只有 GET、一个必 401 的 POST、无任何 uci 写操作。
# 要求目标机已部署含修复 C 的主题(>= 0.1.0-329)。
# 前提:web 登录免密(dev1 如此)。带密码的设备先 export LUCI_WEB_PW=...,
#       否则需要 ssh 可达(dev2/253 用 SSH_KEY_2 或 PROBE_SSH_KEY forge)。
# SSH 侧:dev1 免密;253 需要密钥(SSH_KEY_2,或 export PROBE_SSH_KEY 覆盖)。
#
# 用法:bash tests/session-expiry-device.sh [1.1|253]
# 设备地址从 probe/.local-env 读(ROUTER_1/ROUTER_2),输出已脱敏。
set -u
cd "$(dirname "$0")/.." || exit 1
set -a; source probe/.local-env 2>/dev/null; set +a
D="${1:-1.1}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"
case "$D" in
  1.1) HOST="${ROUTER_1:?ROUTER_1 not set in probe/.local-env}" ;;
  253) HOST="${ROUTER_2:?ROUTER_2 not set in probe/.local-env}"
       K="${PROBE_SSH_KEY:-${SSH_KEY_2:-}}"
       [ -n "$K" ] && SSH="$SSH -i $K" ;;
  *) echo "usage: bash tests/session-expiry-device.sh [1.1|253]"; exit 2 ;;
esac

fails=0
check() { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 (want [$3] got [$2])"; fails=$((fails+1)); fi; }
has() { printf '%s' "$2" | grep -q "$1" && echo 0 || echo 1; }

PW="${LUCI_WEB_PW:-}"
JAR=$(mktemp)
MODE="form"
SID=""
AUTH=()

login_form() {
    rm -f "$JAR"
    curl -s -c "$JAR" -o /dev/null \
      -d "luci_username=root&luci_password=$PW" "http://$HOST/cgi-bin/luci/"
    SID=$(awk '$0 ~ /sysauth/ {print $NF}' "$JAR" | head -1)
    if [ -n "$SID" ]; then MODE="form"; AUTH=(-b "$JAR"); return 0; fi
    return 1
}

# ssh-forged probe-owned session (device has a web password we do not hold).
forge_session() {
    local tok name
    tok=$($SSH "root@$HOST" "ubus call session create '{\"timeout\":900}'" 2>/dev/null \
          | sed -n 's/.*"ubus_rpc_session": *"\([0-9a-f]*\)".*/\1/p')
    [ ${#tok} -eq 32 ] || return 1
    $SSH "root@$HOST" "ubus call session set '{\"ubus_rpc_session\":\"$tok\",\"values\":{\"token\":\"$tok\",\"username\":\"root\",\"acl\":\"unlimited\"}}'" >/dev/null 2>&1
    for name in sysauth sysauth_http; do
        if ! curl -s -H "Cookie: $name=$tok" "http://$HOST/cgi-bin/luci/" | grep -q luci_username; then
            SID="$tok"; MODE="forge"; AUTH=(-H "Cookie: $name=$tok"); return 0
        fi
    done
    return 1
}

login() {
    SID=""
    if login_form; then return 0; fi
    forge_session
}

# 1) authenticated session (form when passwordless, forge otherwise)
login
echo "session mode: $MODE"
check "login yields a 32-hex session id" "${#SID}" "32"

# 2) uci_changes carries the session bit (q685 fix C)
R1=$(curl -s "${AUTH[@]}" "http://$HOST/cgi-bin/luci/admin/desktop/uci_changes")
check "uci_changes reports a live session" "$(has '"session":true' "$R1")" "0"

# 3) destroy OUR probe session out-of-band (ubus over ssh)
$SSH "root@$HOST" \
  "ubus call session destroy '{\"ubus_rpc_session\":\"$SID\"}'" >/dev/null 2>&1

# 4) uci_changes now reports the dead session
R2=$(curl -s "${AUTH[@]}" "http://$HOST/cgi-bin/luci/admin/desktop/uci_changes")
check "uci_changes reports a dead session after destroy" "$(has '"session":false' "$R2")" "0"

# 5) apply with the dead session -> 401 auth (the q685 user symptom)
CODE=$(curl -s "${AUTH[@]}" -X POST -o /dev/null -w '%{http_code}' \
  "http://$HOST/cgi-bin/luci/admin/desktop/changes/apply")
check "apply with a dead session -> 401" "$CODE" "401"

# 6) a fresh session revives the indicator (new session id)
SID_OLD="$SID"
login
R3=$(curl -s "${AUTH[@]}" "http://$HOST/cgi-bin/luci/admin/desktop/uci_changes")
check "fresh session -> live session again" "$(has '"session":true' "$R3")" "0"
check "new session id differs from the destroyed one" "$([ "$SID" != "$SID_OLD" ] && echo 0 || echo 1)" "0"

# cleanup: never leave a forged session behind
[ "$MODE" = "forge" ] && $SSH "root@$HOST" "ubus call session destroy '{\"ubus_rpc_session\":\"$SID\"}'" >/dev/null 2>&1
rm -f "$JAR"
if [ "$fails" -gt 0 ]; then echo "session-expiry-device: $fails check(s) FAILED"; exit 1; fi
echo "session-expiry-device: all checks passed"
