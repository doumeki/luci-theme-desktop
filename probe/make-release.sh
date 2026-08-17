#!/bin/bash
# make-release.sh — 构建 ipk + 转 apk，创建 GitHub Release 并上传两个 asset。
#
# 用法: bash probe/make-release.sh [版本]   （版本默认读 Makefile PKG_RELEASE，如 0.1.0-167）
#       bash probe/make-release.sh --build-only   （只构建+转换，不发布，用于验证）
#
# 依赖:
#   - GITHUB_TOKEN 环境变量（GitHub Personal Access Token，repo 权限）
#   - /tmp/ipk2apk（sbwml 转换器；GitHub 429 时用 gh-proxy.com 镜像下载）
#   - apk-tools：PATH 里 apk（mkpkg）或 /tmp/apk.static（静态版，自动建符号链接）
#   - fakeroot
#   - OpenWrt 构建树（LEDE_ROOT：环境变量或 probe/ 相对位置自动探测）
#
# 仓库从 git remote origin 解析；GITHUB_REPO 环境变量可覆盖。
set -e

PROBE_DIR="$(cd "$(dirname "$0")" && pwd)"
THEME_GIT="$(cd "$PROBE_DIR/.." && pwd)"
[ -f "$PROBE_DIR/.local-env" ] && . "$PROBE_DIR/.local-env"
LEDE_ROOT="${LEDE_ROOT:-$(cd "$PROBE_DIR/../../../.." && pwd)}"

BUILD_ONLY=0
[ "$1" = "--build-only" ] && BUILD_ONLY=1 && shift

# ---- 版本 ----
VER="${1:-}"
if [ -z "$VER" ]; then
    REL=$(grep '^PKG_RELEASE:=' "$THEME_GIT/Makefile" | cut -d= -f2)
    VER="0.1.0-$REL"
fi
TAG="v$VER"
echo "== 发布 $TAG"

# ---- 仓库 ----
if [ -z "${GITHUB_REPO:-}" ]; then
    REMOTE=$(git -C "$THEME_GIT" remote get-url origin 2>/dev/null || true)
    GITHUB_REPO=$(echo "$REMOTE" | sed -E 's#.*github.com[:/]([^/]+/[^/]+)(\.git)?$#\1#')
fi
GITHUB_REPO="${GITHUB_REPO:-doumeki/luci-theme-desktop}"

if [ "$BUILD_ONLY" -eq 0 ] && [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "!! 需要 GITHUB_TOKEN 环境变量"; exit 1
fi

# ---- 1. 构建 ipk ----
echo "== 构建 ipk (make compile)"
make -C "$LEDE_ROOT" package/custom/luci-theme-desktop/compile V=s >/tmp/release-build.log 2>&1 || {
    echo "!! 构建失败，日志: /tmp/release-build.log"; exit 1; }
IPK=$(ls -t "$LEDE_ROOT"/bin/packages/x86_64/base/luci-theme-desktop_*.ipk 2>/dev/null | head -1)
[ -z "$IPK" ] && { echo "!! 找不到 ipk（构建树 x86_64 路径？）"; exit 1; }
echo "   ipk: $(basename "$IPK") ($(du -h "$IPK" | cut -f1))"

# ---- 2. ipk2apk 转换 ----
echo "== 转换 apk (ipk2apk)"
CONV="${DEPLOY_IPK2APK:-/tmp/ipk2apk}"
[ -x "$CONV" ] || { echo "!! 需要转换器: $CONV"; exit 1; }
APKTOOL="$(command -v apk 2>/dev/null || echo /tmp/apk.static)"
if [ "$APKTOOL" = "/tmp/apk.static" ] && [ ! -x "$APKTOOL" ]; then
    echo "!! 需要静态 apk-tools: /tmp/apk.static"; exit 1
fi
APK_DIR=$(mktemp -d)
APK_BIN=""
if [ "$APKTOOL" = "/tmp/apk.static" ]; then
    APK_BIN=$(mktemp -d)
    ln -sf /tmp/apk.static "$APK_BIN/apk"
    export PATH="$APK_BIN:$PATH"
fi
"$CONV" "$IPK" "$APK_DIR" >/tmp/ipk2apk.log 2>&1 || { echo "!! 转换失败，日志: /tmp/ipk2apk.log"; exit 1; }
APK=$(ls "$APK_DIR"/*.apk 2>/dev/null | head -1)
[ -z "$APK" ] && { echo "!! 转换无输出 apk"; exit 1; }
echo "   apk: $(basename "$APK") ($(du -h "$APK" | cut -f1))"
[ -n "$APK_BIN" ] && rm -rf "$APK_BIN"

if [ "$BUILD_ONLY" -eq 1 ]; then
    echo "== --build-only: 产物就绪，未发布。"
    echo "   $IPK"
    echo "   $APK"
    rm -rf "$APK_DIR"
    exit 0
fi

# ---- 3. 创建 Release（同名 tag 已存在会失败）----
echo "== 创建 GitHub Release $TAG -> $GITHUB_REPO"
BODY=$(cat <<RELEASE_EOF
## luci-theme-desktop $VER

Desktop-style LuCI theme (iframe shell: taskbar, start menu, window manager, widgets).

### Files
- \`$(basename "$IPK")\` — opkg firmware (OpenWrt 24.10 and earlier, LEDE)
- \`$(basename "$APK")\` — apk firmware (OpenWrt 25.12+, ImmortalWrt 25.12; converted via ipk2apk)

### Prerequisites (official OpenWrt firmware)
1. official OpenWrt ships **without LuCI** — install it first:
   \`opkg install luci\` / \`apk add luci\`
2. **luci-lua-runtime** is required (the theme controller is Lua-based).
   It is a declared dependency of the package and installs automatically;
   if the theme settings save / notifications are broken, install it
   manually: \`opkg install luci-lua-runtime\` / \`apk add --allow-untrusted luci-lua-runtime\`

### Install
\`\`\`sh
opkg install $(basename "$IPK")
# or
apk add --allow-untrusted $(basename "$APK")
# then
uci set luci.main.mediaurlbase=/luci-static/desktop
uci commit luci
\`\`\`

After installing, open the router web UI — you land on the desktop.
Right-click the desktop for theme settings and diagnostics.
RELEASE_EOF
)
PAYLOAD=$(printf '%s' "$BODY" | python3 -c "
import json, sys
print(json.dumps({'tag_name': '$TAG', 'name': '$TAG', 'body': sys.stdin.read(), 'draft': False, 'prerelease': False}))")
RESP=$(curl -s -m 30 -X POST -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" -d "$PAYLOAD" \
    "https://api.github.com/repos/$GITHUB_REPO/releases")
RID=$(printf '%s' "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or '')" 2>/dev/null || true)
if [ -z "$RID" ]; then
    printf '%s' "$RESP" | head -c 300; echo
    echo "!! Release 创建失败（tag $TAG 已存在？先删旧 release/tag）"; exit 1
fi
echo "   release id: $RID"

# ---- 4. 上传 assets ----
for f in "$IPK" "$APK"; do
    NAME=$(basename "$f")
    echo "== 上传 $NAME"
    curl -s -m 300 -X POST -H "Authorization: token $GITHUB_TOKEN" \
        -H "Content-Type: application/octet-stream" --data-binary @"$f" \
        "https://uploads.github.com/repos/$GITHUB_REPO/releases/$RID/assets?name=$NAME" \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print('   ->', d.get('name'), d.get('size'), 'bytes')"
done

rm -rf "$APK_DIR"
echo "== 完成: https://github.com/$GITHUB_REPO/releases/tag/$TAG"
