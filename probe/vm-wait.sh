#!/bin/bash
# vm-wait.sh <host> - wait for a freshly booted firmware, refresh its host key,
# and print what is actually running. Safe to run repeatedly.
#
# The host key changes whenever the disk is swapped; every later ssh call fails
# with "REMOTE HOST IDENTIFICATION HAS CHANGED" until it is refreshed.
set -u
H="${1:?usage: vm-wait.sh <host>}"

for i in $(seq 1 90); do
    if timeout 2 bash -c "echo > /dev/tcp/$H/22" 2>/dev/null; then
        echo "ssh port up after $((i * 2))s"
        break
    fi
    sleep 2
done

ssh-keygen -R "$H" >/dev/null 2>&1
ssh-keyscan -H "$H" >> ~/.ssh/known_hosts 2>/dev/null

ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$H" '
    head -4 /etc/openwrt_release
    echo "---"
    uname -sr
    echo -n "pkg: "; command -v opkg >/dev/null && echo opkg || (command -v apk >/dev/null && echo apk || echo none)
    echo -n "theme: "; uci -q get luci.main.mediaurlbase
    echo -n "version: "; cat /www/luci-static/desktop/version.txt 2>/dev/null || echo none
' 2>&1
