/* Desktop Theme - Desktop Icons + Pin Management */

(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop.js: LuCIDesktop namespace not found'); return; }

    var pinnedItems = [];
    var hiddenIcons = [];

    // Default desktop shortcuts. Terminal's path differs per LuCI runtime
    // AND per luci-app-ttyd version — probe ALL known candidates and use
    // the first that resolves:
    //   ucode, new ttyd (luci-app-ttyd 26.x, OpenWrt 25.12 official):
    //     /admin/services/ttyd/ttyd  (menu.d "admin/services/ttyd/ttyd",
    //     verified 2026-08-17 on official OpenWrt 25.12.5)
    //   ucode, old ttyd (ImmortalWrt 25.12 etc.): /admin/system/ttyd/ttyd
    //   lua track: /admin/system/terminal
    // The footer injects window.__LUCI_RUNTIME__ = 'ucode'|'lua' AFTER this
    // module loads, so resolve lazily via runtimeTerminalUrls().
    function runtimeTerminalUrls() {
        return (window.__LUCI_RUNTIME__ === 'ucode')
            ? ['/cgi-bin/luci/admin/services/ttyd/ttyd', '/cgi-bin/luci/admin/system/ttyd/ttyd']
            : ['/cgi-bin/luci/admin/system/terminal'];
    }
    function resolvedTerminalUrl() {
        // Probe result wins; before the probe settles, the newest candidate.
        return (window.Desktop && window.Desktop._terminalUrl) || runtimeTerminalUrls()[0];
    }
    var DEFAULT_SHORTCUTS = [
        { title: _('Status'), url: '/cgi-bin/luci/admin/status/overview' },
        { title: _('Terminal'), url: '/cgi-bin/luci/admin/system/ttyd/ttyd', _runtimePath: true },
        { title: _('System'), url: '/cgi-bin/luci/admin/system/system' },
        { title: _('Firewall'), url: '/cgi-bin/luci/admin/network/firewall' }
    ];
    // Runtime-dependent entries (Terminal) resolved at consume time — the
    // footer injects __LUCI_RUNTIME__ after this module loads.
    function effectiveDefaults() {
        return DEFAULT_SHORTCUTS.map(function(d) {
            return d._runtimePath
                ? { title: d.title, url: resolvedTerminalUrl(), _runtimePath: true }
                : d;
        });
    }

    // ===== Config (all UCI-based, no localStorage) =====
    // Mobile and desktop keep SEPARATE pin/widget configs (mobile_pins etc.)
    function configSection(base) {
        return LuCIDesktop.isMobile() ? 'mobile_' + base : base;
    }
    function loadConfig() {
        try {
            var c = LuCIDesktop.getConfig();
            if (LuCIDesktop.isMobile()) {
                if (c.mobile_pins) pinnedItems = c.mobile_pins;
                if (c.mobile_hidden) hiddenIcons = c.mobile_hidden;
            } else {
                if (c.pins) pinnedItems = c.pins;
                if (c.hidden_icons) hiddenIcons = c.hidden_icons;
            }
        } catch(e) {}
    }

    function savePins() {
        LuCIDesktop.saveDesktopSection(configSection('pins'), pinnedItems);
    }

    function saveHidden() {
        // Update in-page config immediately (DOM only — backend POST below)
        try {
            if (LuCIDesktop.isMobile()) LuCIDesktop.setSectionLocal('mobile_hidden', hiddenIcons);
            else LuCIDesktop.setSectionLocal('hidden_icons', hiddenIcons);
        } catch(e) {}
        LuCIDesktop.saveDesktopSection(configSection('hidden'), hiddenIcons);
    }

    // ===== Desktop Module =====
    var Desktop = {
        init: function() {
            loadConfig();
            this.cleanGhostApps();
            this.renderShortcuts();
            this.bindEvents();
            // Default shortcuts (Status/Terminal/System/Firewall) are baked
            // into the theme, so cleanGhostApps never sees them. The
            // availability probe runs from shell.js boot() instead of here:
            // the Terminal URL is runtime-dependent (__LUCI_RUNTIME__ is
            // injected by the footer AFTER this module registers), so an
            // early probe here would resolve the wrong path and never hide
            // a missing ttyd on ucode (bugfix 2026-08-16, 1.1 ImmortalWrt).
        },

        // Build the set of URLs registered in the LuCI menu tree.
        menuUrls: function() {
            var data = window.LuCIMenuData;
            var urls = {};
            if (!data) return urls;
            data.forEach(function(cat) {
                if (cat.subs) {
                    cat.subs.forEach(function(sub) {
                        if (sub.href) urls[sub.href] = true;
                    });
                }
                if (cat.href) urls[cat.href] = true;
            });
            return urls;
        },

        // Default shortcuts get a live availability check. The menu tree is
        // the cheap prior (page registered + ACL granted); anything absent
        // from the tree gets a network probe as a fallback, because the
        // tree may be incomplete. Unavailable shortcuts are dropped from
        // the desktop (runtime only — never persisted into hiddenIcons,
        // which is the user's own Hide gesture).
        probeDefaultShortcuts: function() {
            var self = this;
            var menuUrls = this.menuUrls();
            if (this._unavailable) return;
            this._unavailable = {};

            var probed = 0;
            effectiveDefaults().forEach(function(item) {
                // Runtime-dependent entries (Terminal) may live at ANY of
                // several known paths depending on luci-app-ttyd version —
                // try them in order and keep the first that resolves.
                var candidates = item._runtimePath ? runtimeTerminalUrls() : [item.url];
                // Menu tree is the cheap prior: if ANY candidate is
                // registered, use that exact one (tree is authoritative —
                // it reflects what THIS firmware actually serves).
                for (var c = 0; c < candidates.length; c++) {
                    if (menuUrls[candidates[c]]) {
                        if (item._runtimePath) self._terminalUrl = candidates[c];
                        return;
                    }
                }
                // Absent from the tree: probe for real. HEAD avoids
                // rendering the full page body. First 200 wins; total 404
                // marks every candidate unavailable.
                probed++;
                (function probeNext(cands, idx) {
                    if (idx >= cands.length) {
                        cands.forEach(function(u) { self._unavailable[u] = true; });
                        console.log('[probe] hiding default shortcut 404: ' + cands.join(', '));
                        self._finishProbeRender();
                        return;
                    }
                    fetch(cands[idx], { method: 'HEAD', credentials: 'same-origin' })
                        .then(function(r) {
                            if (r.ok) {
                                if (item._runtimePath) self._terminalUrl = cands[idx];
                                self._finishProbeRender();
                                return;
                            }
                            probeNext(cands, idx + 1);
                        })
                        .catch(function() {
                            probeNext(cands, idx + 1);
                        });
                })(candidates, 0);
            });
            // Nothing to probe — still re-render once: Desktop.init renders
            // BEFORE the footer injects __LUCI_RUNTIME__ (runtime-dependent
            // URLs resolved to the Lua path). By the time this runs the
            // runtime IS injected, so a re-render fixes the Terminal icon
            // URL (bugfix 0.1.0-137: icon stayed on the 404 Lua path).
            if (probed === 0) {
                this._finishProbeRender();
            }
        },

        // Re-render after the availability probe settles. ALWAYS re-render
        // (even when everything is available): init's early render used the
        // pre-injection runtime resolution, and this runs with the real
        // __LUCI_RUNTIME__ available (probeDefaultShortcuts is called from
        // shell.js boot(), after the footer injected it).
        _finishProbeRender: function() {
            var self = this;
            setTimeout(function() { self.renderShortcuts(); }, 0);
        },

        // Remove pins/hidden entries whose URL no longer exists in the menu tree.
        // Prevents "ghost icons" from uninstalled/deleted apps.
        cleanGhostApps: function() {
            var validUrls = this.menuUrls();
            if (Object.keys(validUrls).length === 0) {
                console.log('[ghost-clean] no menu data, skip');
                return;
            }

            // Clean pinned items (array of {url, title})
            var removedPins = [];
            var oldPinLen = pinnedItems.length;
            pinnedItems = pinnedItems.filter(function(p) {
                if (!validUrls[p.url]) {
                    removedPins.push(p.url);
                    console.log('[ghost-clean] pin ghost: ' + p.url + ' title="' + p.title + '"');
                    return false;
                }
                return true;
            });
            if (removedPins.length > 0) {
                console.log('[ghost-clean] removed ' + removedPins.length + ' pins: ' + removedPins.join(', '));
                savePins();
            }

            // Clean hidden icons (array of URL strings)
            var removedHidden = [];
            var oldHiddenLen = hiddenIcons.length;
            hiddenIcons = hiddenIcons.filter(function(h) {
                if (!validUrls[h]) {
                    removedHidden.push(h);
                    console.log('[ghost-clean] hidden ghost: ' + h);
                    return false;
                }
                return true;
            });
            if (removedHidden.length > 0) {
                console.log('[ghost-clean] removed ' + removedHidden.length + ' hidden: ' + removedHidden.join(', '));
                saveHidden();
            }

            if (removedPins.length === 0 && removedHidden.length === 0) {
                console.log('[ghost-clean] all clean, no ghosts (checked ' + oldPinLen + ' pins + ' + oldHiddenLen + ' hidden)');
            }
        },

        pinItem: function(url, title) {
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url) { pinnedItems[i].title = title; savePins(); this.renderShortcuts(); return; }
            }
            pinnedItems.push({url: url, title: title});
            savePins();
            this.renderShortcuts();
        },

        unpinItem: function(url) {
            pinnedItems = pinnedItems.filter(function(p) { return p.url !== url; });
            savePins();
            this.renderShortcuts();
        },

        renderShortcuts: function() {
            var container = document.getElementById('desktop-icons');
            if (!container) return;

            // Default shortcuts whose availability probe failed (e.g.
            // Terminal when luci-app-ttyd is not installed) are NOT hidden
            // anymore — they render as INSTALLABLE (badge + Install in the
            // context menu) so the user can install the component in place
            // (2026-08-16).
            var self = this;
            var defaults = effectiveDefaults().map(function(d) {
                var unavailable = !!(self._unavailable || {})[d.url];
                return { title: d.title, url: d.url, installable: unavailable };
            });

            var all = defaults.concat(pinnedItems.map(function(p, i) {
                return { title: p.title, url: p.url, pinned: true, pinIndex: i };
            }));

            // Grid layout: columns, auto-arranged top-to-bottom
            var COLS = 4;
            var CELL_W = 96;
            var CELL_H = 90;
            var MARGIN_LEFT = 16;
            var MARGIN_TOP = 16;

            var html = '';
            // Filter out hidden icons
            var visible = all.filter(function(item) { return hiddenIcons.indexOf(item.url) === -1; });

            visible.forEach(function(item, i) {
                var col = i % COLS;
                var row = Math.floor(i / COLS);
                var left = MARGIN_LEFT + col * CELL_W;
                var top = MARGIN_TOP + row * CELL_H;
                var label = item.title.length > 10 ? item.title.substring(0, 9) + '..' : item.title;

                html += '<div class="desktop-icon' + (item.installable ? ' installable' : '') +
                    '" data-url="' + esc(item.url) + '"';
                html += ' style="left:' + left + 'px;top:' + top + 'px" title="' + esc(item.title) +
                    (item.installable ? ' (' + _('Not installed') + ')' : '') + '">';
                html += '<div class="desktop-icon-img">';
                html += '<svg width="40" height="40" viewBox="0 0 40 40">';
                html += '<rect width="40" height="40" rx="6" fill="' + (item.pinned ? 'rgba(74,144,217,0.2)' : 'rgba(255,255,255,0.1)') + '"/>';
                html += '<text x="20" y="26" text-anchor="middle" style="fill:var(--icon-text,currentColor)" font-size="18">' + esc(item.title.charAt(0)) + '</text>';
                html += '</svg>';
                // Install badge: little "+" in the corner for installable items
                if (item.installable) {
                    html += '<span class="install-badge">+</span>';
                }
                html += '</div>';
                html += '<div class="desktop-icon-label">' + esc(label) + '</div></div>';
            });
            container.innerHTML = html;
        },

        bindEvents: function() {
            var container = document.getElementById('desktop-icons');
            if (!container) return;
            var self = this;

            container.addEventListener('dblclick', function(e) {
                if (LuCIDesktop.isMobile()) return;   // mobile: single tap opens
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                WM.open(icon.getAttribute('data-url'), icon.getAttribute('title') || '');
            });

            // Mobile: single tap opens (desktop keeps double-click)
            container.addEventListener('click', function(e) {
                if (!LuCIDesktop.isMobile()) return;
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                WM.open(icon.getAttribute('data-url'), icon.getAttribute('title') || '');
            });

            container.addEventListener('click', function(e) {
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                document.querySelectorAll('.desktop-icon.selected').forEach(function(el) { el.classList.remove('selected'); });
                icon.classList.add('selected');
            });

            // Right-click: menu for all icons
            container.addEventListener('contextmenu', function(e) {
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                e.preventDefault();
                e.stopPropagation();
                var url = icon.getAttribute('data-url');
                var title = icon.getAttribute('title') || '';
                // Check if pinned
                var pinned = null;
                for (var i = 0; i < pinnedItems.length; i++) {
                    if (pinnedItems[i].url === url) { pinned = pinnedItems[i]; break; }
                }
                if (pinned) {
                    self._showIconMenu(e.clientX, e.clientY, pinned);
                } else {
                    self._showDefaultIconMenu(e.clientX, e.clientY, url, title, icon);
                }
            });

            // Desktop right-click
            var desktopEl = document.getElementById('desktop');
            if (desktopEl) {
                desktopEl.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                    self._showDesktopMenu(e.clientX, e.clientY);
                });
            }

            document.addEventListener('click', function(e) {
                if (!e.target.closest('#desktop-context-menu, #icon-context-menu'))
                    document.querySelectorAll('#desktop-context-menu, #icon-context-menu').forEach(function(m) { m.remove(); });
            });
        },

        _showDefaultIconMenu: function(x, y, url, title, iconEl) {
            var m = _makeMenu(x, y);
            m.id = 'icon-context-menu';
            var installable = iconEl && iconEl.classList.contains('installable');
            var html = '';
            if (!installable) {
                html += '<div class="context-item" data-act="open">' + _('Open') + '</div>';
            } else {
                // Not installed: offer Install instead of Open (Open would 404)
                html += '<div class="context-item" data-act="install">' + _('Install') + '</div>';
            }
            html += '<div class="context-item" data-act="hide">' + _('Hide') + '</div>';
            m.innerHTML = html;
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'open') {
                    WM.open(url, title);
                } else if (a === 'install') {
                    Desktop.installDefault(url);
                } else if (a === 'hide') {
                    if (confirm(_('Hide this icon?'))) {
                        iconEl.style.display = 'none';
                        hiddenIcons.push(url);
                        saveHidden();
                    }
                }
                m.remove();
            });
        },

        // Install a missing default component (currently: luci-app-ttyd for
        // the Terminal shortcut). POSTs the install endpoint, then polls
        // the status endpoint every 2s and reloads once installed.
        installDefault: function(url) {
            var self = this;
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/cgi-bin/luci/admin/desktop/install_ttyd', true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = function() {
                try {
                    var r = JSON.parse(xhr.responseText);
                    if (r && r.ok && r.already) {
                        // Already installed (menu tree may lag) — just reload
                        self._reloadPage();
                        return;
                    }
                    if (!r || !r.ok) {
                        if (window.TrayManager) {
                            TrayManager.notify(_('Install failed'), { type: 'error', duration: 5000 });
                        }
                        return;
                    }
                    // started — toast + poll
                    if (window.TrayManager) {
                        TrayManager.notify(_('Installing Terminal…'), { duration: 3000 });
                    }
                    self._installPoll();
                } catch(e) {}
            };
            xhr.onerror = function() {
                if (window.TrayManager) {
                    TrayManager.notify(_('Install failed'), { type: 'error', duration: 5000 });
                }
            };
            xhr.send('url=' + encodeURIComponent(url));
        },

        // Reload hook (stubbed in tests — location.reload is not
        // configurable in firefox).
        _reloadPage: function() {
            location.reload();
        },

        // Single status check: GET ttyd_status; when installed, call done().
        // Used by _installPoll (every 2s) and by tests.
        checkInstallStatus: function(done) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/cgi-bin/luci/admin/desktop/ttyd_status', true);
            xhr.onload = function() {
                try {
                    var r = JSON.parse(xhr.responseText);
                    if (r && r.installed) {
                        if (done) done(true);
                        return;
                    }
                    if (done) done(false);
                } catch(e) {
                    if (done) done(false);
                }
            };
            xhr.onerror = function() { if (done) done(false); };
            xhr.send();
        },

        // Poll the install status endpoint until ttyd exists, then reload.
        _installPoll: function() {
            var self = this;
            if (this._installTimer) clearInterval(this._installTimer);
            this._installTimer = setInterval(function() {
                self.checkInstallStatus(function(installed) {
                    if (installed) {
                        clearInterval(self._installTimer);
                        self._installTimer = null;
                        self._reloadPage();
                    }
                });
            }, 2000);
        },

        _showIconMenu: function(x, y, pinned) {
            var m = _makeMenu(x, y);
            m.id = 'icon-context-menu';
            m.innerHTML =
                '<div class="context-item" data-act="open">' + _('Open') + '</div>' +
                '<div class="context-item" data-act="rename">' + _('Rename') + '</div>' +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="unpin">' + _('Unpin') + '</div>';
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'open') {
                    WM.open(pinned.url, pinned.title);
                } else if (a === 'rename') {
                    var name = prompt(_('New name:'), pinned.title);
                    if (name && name.trim()) { pinned.title = name.trim(); savePins(); Desktop.renderShortcuts(); }
                } else if (a === 'unpin') {
                    Desktop.unpinItem(pinned.url);
                }
                m.remove();
            });
        },

        _showDesktopMenu: function(x, y) {
            var m = _makeMenu(x, y);
            m.id = 'desktop-context-menu';
            m.innerHTML =
                '<div class="context-item" data-act="theme">' + _('Theme') + '</div>' +
                '<div class="context-item" data-act="widgets">' + _('Widgets') + '</div>' +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="refresh">' + _('Refresh') + '</div>';
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'theme') window.ThemeSettings ? ThemeSettings.open() : alert(_('Theme settings loading...'));
                else if (a === 'widgets') WidgetManager.openSettings();
                else if (a === 'refresh') {
                    Object.keys(DESKTOP.windows).forEach(function(id) {
                        var w = DESKTOP.windows[id];
                        var iframe = w.el && w.el.querySelector('iframe');
                        if (iframe) iframe.src = iframe.src;
                    });
                }
                m.remove();
            });
        }
    };

    function _makeMenu(x, y) {
        document.querySelectorAll('#desktop-context-menu, #icon-context-menu').forEach(function(m) { m.remove(); });
        var menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;';
        document.body.appendChild(menu);
        // Clamp inside the viewport — long-press near the right/bottom
        // edge must not push the menu off-screen
        var r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) {
            menu.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
        }
        if (r.bottom > window.innerHeight) {
            menu.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
        }
        return menu;
    }

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    DESKTOP.register('desktop', Desktop);
    window.Desktop = Desktop;
})();
