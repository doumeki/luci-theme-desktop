#!/bin/bash
# clear-password.sh <host> [ssh-key]
#
# Make the root password empty so probe/lib.js can log in with the passwordless
# curl flow (luci_username=root & empty password). Devices that already have a
# password can still be browsed with a forged ubus session, but they cannot run
# the full L4 uci-write flows, so the test matrix normally uses blank-password
# test boxes.
#
# THIS CHANGES THE DEVICE. Run it only on test units, with the owner's consent.
set -u
H="${1:?usage: clear-password.sh <host> [ssh-key]}"
KEY="${2:-}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=8)
[ -n "$KEY" ] && SSH+=(-i "$KEY")

cur=$("${SSH[@]}" "root@$H" "awk -F: '\$1==\"root\"{print \$2}' /etc/shadow" 2>/dev/null)
if [ -z "$cur" ]; then
    echo "cannot read /etc/shadow on $H (need root ssh)"; exit 1
fi
if [ -z "$cur" ]; then
    echo "root password already empty"
else
    echo "clearing root password"
    "${SSH[@]}" "root@$H" 'passwd -d root >/dev/null 2>&1 || sed -i "s/^root:[^:]*:/root::/" /etc/shadow' || exit 1
fi

# verify with the same request lib.js uses
raw=$(curl -s -c - -o /dev/null -d "luci_username=root&luci_password=" "http://$H/cgi-bin/luci/" 2>/dev/null)
if printf '%s' "$raw" | grep -qE '(sysauth_http|sysauth)[[:space:]]+[0-9a-f]'; then
    echo "passwordless login OK (cookie issued)"
else
    echo "passwordless login STILL FAILING"; exit 1
fi
