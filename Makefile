# LuCI Desktop Theme
# Copyright 2026 DMKLIGHT
#
# Licensed under the Apache License v2.0
# http://www.apache.org/licenses/LICENSE-2.0

include $(TOPDIR)/rules.mk

THEME_NAME:=desktop
THEME_TITLE:=Desktop

PKG_NAME:=luci-theme-$(THEME_NAME)
PKG_VERSION:=0.1.0
# 125 = merged branch (Lua track + ucode track unified, 2026-08-15)
PKG_RELEASE:=167

include $(INCLUDE_DIR)/package.mk

define Package/luci-theme-$(THEME_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=4. Themes
  # luci-base: templates/controller run inside LuCI (stock official
  # OpenWrt firmware ships NO LuCI — pull the core in).
  # luci-lua-runtime: the theme controller (desktop.lua) is Lua — on
  # ucode-only LuCI (official OpenWrt 25.x) it is NOT loaded without the
  # Lua compat layer (changes/* 403/HTML → smoke FAIL). Present in both
  # 24.10 (opkg) and 25.12 (apk) feeds; ImmortalWrt carries it too.
  DEPENDS:=+libc +curl +luci-base +luci-lua-runtime
  TITLE:=Desktop Theme - iframe shell
  URL:=https://github.com/your-name/luci-theme-desktop
  PKGARCH:=all
endef

# stickysync.json holds user sticky-note data — never overwrite on
# upgrade (opkg keeps the existing file when a conffile changed).
define Package/luci-theme-$(THEME_NAME)/conffiles
/etc/luci-theme-desktop/stickysync.json
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/luci-theme-$(THEME_NAME)/install
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/30_luci-theme-$(THEME_NAME) $(1)/etc/uci-defaults/luci-theme-$(THEME_NAME)
	$(INSTALL_DIR) $(1)/www/luci-static/$(THEME_NAME)
	$(CP) -a ./files/htdocs/* $(1)/www/luci-static/$(THEME_NAME)/ 2>/dev/null || true
	$(INSTALL_DIR) $(1)/usr/share/ucode/luci/template/themes/$(THEME_NAME)
	$(CP) -a ./files/usr/share/ucode/luci/template/themes/$(THEME_NAME)/* $(1)/usr/share/ucode/luci/template/themes/$(THEME_NAME)/ 2>/dev/null || true
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/view/themes/$(THEME_NAME)
	$(CP) -a ./files/templates/*.htm $(1)/usr/lib/lua/luci/view/themes/$(THEME_NAME)/ 2>/dev/null || true
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(CP) -a ./files/controller/* $(1)/usr/lib/lua/luci/controller/ 2>/dev/null || true
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/desktop
	$(CP) -a ./files/root/usr/lib/lua/luci/desktop/* $(1)/usr/lib/lua/luci/desktop/ 2>/dev/null || true
	$(INSTALL_DIR) $(1)/usr/libexec/desktop
	$(INSTALL_BIN) ./files/libexec/online_wallpaper $(1)/usr/libexec/desktop/online_wallpaper
	# Shared sticky-note store: a plain JSON file (NOT UCI). Sticky notes
	# write on every keystroke; UCI would rewrite the whole desktop config
	# and fight quoting. File writes are atomic (tmp+rename) and cheap.
	# NOTE: no INSTALL_DATA here — the file is created by the controller on
	# first write. Installing an empty file would clobber user data on
	# every upgrade (opkg keeps conffiles, but only once the package's own
	# installed md5 is known; a data file owned by the runtime is safer).
	$(INSTALL_DIR) $(1)/etc/luci-theme-desktop
endef

define Package/luci-theme-$(THEME_NAME)/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
	if [ -f /etc/uci-defaults/luci-theme-$(THEME_NAME) ]; then
		( . /etc/uci-defaults/luci-theme-$(THEME_NAME) ) && \
		rm -f /etc/uci-defaults/luci-theme-$(THEME_NAME)
	fi
	# No trailing newline: ucode has no string trim(), templates read the
	# version via sprintf() and a newline would corrupt the ?v= URLs
	# (the Lua track's template copes either way — one write serves both).
	printf "0.1.0-$(PKG_RELEASE)" > /www/luci-static/desktop/version.txt
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
	# Lua templates are cached in the uhttpd process (luci.template
	# memory cache) — restart to pick up updated theme templates.
	/etc/init.d/uhttpd restart 2>/dev/null || true
fi
exit 0
endef

$(eval $(call BuildPackage,luci-theme-$(THEME_NAME)))
