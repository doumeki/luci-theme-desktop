#!/bin/bash
# run-slot.sh <label> <target> [--geometry]
#
# One slot, end to end: deploy the current HEAD, run L4 twice (cold is recorded,
# only the warm run is a verdict), then the L3 wide scan and the profile gate.
# Optional --geometry adds the same-page reference diff on the table pages.
#
#   probe/run-slot.sh dev1 1.1
#   probe/run-slot.sh d253 253
#   probe/run-slot.sh istoreos <ip> --geometry
#
# Output: /tmp/compat-hot/<label>/report.json, /tmp/compat-scan/<label>/report.json
set -u
LABEL="${1:?usage: run-slot.sh <label> <target> [--geometry]}"
TARGET="${2:?usage: run-slot.sh <label> <target> [--geometry]}"
GEO=0; [ "${3:-}" = "--geometry" ] && GEO=1

cd "$(dirname "$0")/.." || exit 1
[ -f probe/.local-env ] && . probe/.local-env

case "$TARGET" in
    1.1) HOST="${ROUTER_1:?ROUTER_1 is not set in probe/.local-env}" ;;
    253) HOST="${ROUTER_2:?ROUTER_2 is not set in probe/.local-env}" ;;
    *)   HOST="$TARGET" ;;
esac
export PROBE_ROUTER="$HOST"
export PROBE_SSH="$HOST"

echo "== slot $LABEL @ $HOST $(date '+%F %T') =="
ssh -o BatchMode=yes -o ConnectTimeout=8 "root@$HOST" 'head -2 /etc/openwrt_release' 2>/dev/null || {
    echo "!! $HOST unreachable"; exit 1; }
[ "$TARGET" = "1.1" ] && unset PROBE_SSH   # dev1: empty-password curl login

echo "--- deploy ---"
./probe/deploy-theme.sh "$TARGET" 2>&1 | tail -6 || exit 1

echo "--- L4 cold (recorded, not a verdict) ---"
node probe/compat-hot.js --label "${LABEL}-cold" 2>&1 | grep -E '^\[summary\]' || true

echo "--- L4 warm ---"
node probe/compat-hot.js --label "$LABEL" > /tmp/hot-$LABEL.log 2>&1; L4=$?
grep -E '^\[hot\]|^\[summary\]' /tmp/hot-$LABEL.log

echo "--- L3 ---"
node probe/compat-scan.js --label "$LABEL" > /tmp/scan-$LABEL.log 2>&1; L3=$?
grep -E '^\[summary\]|^\[geometry\]|^\[profile\]|^\[menu\]' /tmp/scan-$LABEL.log

echo "--- profile gate ---"
node probe/fingerprint.js 2>&1 | grep -E '^\[gate\]|^\[fingerprint\]'

# Browser-level app probe: transport OK is not "the app works". Third-party
# apps are shells over their own daemons (dockerd, oafd, linkease :8897) and
# render those daemons' raw errors inside a 200 page. APP=1 means an error
# surface was visible; qualify firmware-side vs theme-side by re-running the
# same probe with the stock theme (argon) before blaming the theme.
echo "--- app runtime (browser-level error surfaces) ---"
APP=0
APPS="${APPS:-admin/services/dockerman,admin/services/oaf,admin/services/linkease}"
node probe/app-runtime.js --paths "$APPS" --json /tmp/app-$LABEL.json > /tmp/app-$LABEL.log 2>&1; APP=$?
grep -E '^\[app\]' /tmp/app-$LABEL.log

# Tab-bar contract (alias/call/template tabs must all keep the same bar).
# Opt-in per firmware: app paths differ (OAF exists on iStoreOS only).
#   TABS_APPS=admin/services/oaf,admin/system/admin probe/run-slot.sh ...
echo "--- tab contract ---"
TABS=0
if [ -n "${TABS_APPS:-}" ]; then
    node probe/tab-contract.js --app "$TABS_APPS" --json /tmp/tabs-$LABEL.json > /tmp/tabs-$LABEL.log 2>&1; TABS=$?
    grep -E '^\[tabs\]' /tmp/tabs-$LABEL.log
fi

# Whole-tree UI contract (R1 menu sweep / R2 tab hrefs / R5 theme assets).
# curl only, ~1-2 min; fail=0 with firmware dead-entry notes is a pass.
echo "--- ui contract (menu sweep + tab hrefs + assets) ---"
UI=0
node probe/ui-contract.js --json /tmp/ui-$LABEL.json > /tmp/ui-$LABEL.log 2>&1; UI=$?
grep -E '^\[ui\]' /tmp/ui-$LABEL.log

if [ "$GEO" = 1 ]; then
    echo "--- geometry (table pages) ---"
    GEOM_PAGES=admin/status/processes,admin/status/overview,admin/network/network,admin/network/dhcp,admin/network/firewall,admin/status/routes,admin/system/package-manager \
        node tests/theme-geometry.js 2>&1 | grep -E '^(PASS|FAIL|SKIP)|^  (FAIL|NOTE)'
fi

echo "== done $LABEL: L4=$L4 L3=$L3 APP=$APP TABS=${TABS:-0} UI=${UI:-0} =="
