/* Desktop Theme - Desktop facade
 *
 * Thin facade over the desktop modules:
 *   desktop-state.js  — shared pins/hidden/icon_layout stores + persistence
 *   desktop-icons.js  — icon rendering/grid, picker wiring, quantum drag
 *   desktop-menus.js  — context menus + custom link dialog
 *   desktop-links.js  — custom URL helpers + ghost-clean exemption
 *
 * It keeps the default shortcut catalog (Status/Terminal/System/Firewall)
 * and the runtime-dependent Terminal path resolution, because the
 * availability probe (probeDefaultShortcuts) and the ttyd install flow
 * live here too. Everything else is forwarded so window.Desktop keeps its
 * exact public API. Load order: state → icons → links → menus → facade.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop.js: LuCIDesktop namespace not found'); return; }

    var State = DESKTOP.desktopState;
    var Icons = DESKTOP.desktopIcons;
    var Menus = DESKTOP.desktopMenus;
    var Links = DESKTOP.desktopLinks;

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

    // Icons render the same runtime-resolved default shortcut list; hand the
    // provider over so it does not duplicate the runtime logic.
    Icons.effectiveDefaults = effectiveDefaults;

    var Desktop = {
        // ===== State =====
        // Re-read the per-tab config (#desktop-config: pins / hidden icons /
        // icon layout). init() calls it on boot; exposed because the link
        // dialog and tests seed state by writing that script tag directly.
        reloadConfig: function() {
            State.load();
        },

        // ===== Icons (desktop-icons.js) =====
        renderShortcuts: Icons.renderShortcuts,
        _initQuantumDrag: Icons._initQuantumDrag,
        openIconPicker: Icons.openIconPicker,
        pinItem: Icons.pinItem,
        unpinItem: Icons.unpinItem,
        rearrangeIcons: Icons.rearrangeIcons,
        bindEvents: Icons.bindEvents,

        // ===== Menus + link dialog (desktop-menus.js) =====
        _showDefaultIconMenu: Menus._showDefaultIconMenu,
        _showIconMenu: Menus._showIconMenu,
        _showDesktopMenu: Menus._showDesktopMenu,
        _placeSubmenu: Menus._placeSubmenu,
        _showLinkDialog: Menus._showLinkDialog,

        // ===== Custom URLs + ghost clean (desktop-links.js) =====
        menuUrls: Links.menuUrls,
        _customUrlSet: Links._customUrlSet,
        cleanGhostApps: Links.cleanGhostApps,
        normalizeUrl: Links.normalizeUrl,
        resolveUrlVars: Links.resolveUrlVars,
        isExternalUrl: Links.isExternalUrl,
        addCustomUrl: Links.addCustomUrl,
        openShortcut: Links.openShortcut,
        editCustomUrl: Links.editCustomUrl,
        _moveLinkMeta: Links._moveLinkMeta,

        // ===== Boot composition =====
        init: function() {
            State.load();
            this.cleanGhostApps();
            this.renderShortcuts();
            this.bindEvents();
            // Quantum snap-drag (desktop only — mobile uses CSS grid and
            // single-tap open, so the engine is not instantiated there).
            if (!LuCIDesktop.isMobile() && window.LuCIDesktop.QuantumIcons) {
                this._initQuantumDrag();
            }
            // Default shortcuts (Status/Terminal/System/Firewall) are baked
            // into the theme, so cleanGhostApps never sees them. The
            // availability probe runs from shell.js boot() instead of here:
            // the Terminal URL is runtime-dependent (__LUCI_RUNTIME__ is
            // injected by the footer AFTER this module registers), so an
            // early probe here would resolve the wrong path and never hide
            // a missing ttyd on ucode (bugfix 2026-08-16, 1.1 ImmortalWrt).
        },

        // ===== Default shortcut availability + ttyd install =====
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
        }
    };

    DESKTOP.register('desktop', Desktop);
    window.Desktop = Desktop;
})();
