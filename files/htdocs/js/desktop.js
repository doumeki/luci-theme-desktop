/* Desktop Theme - Desktop Icons + Pin Management */

(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop.js: LuCIDesktop namespace not found'); return; }

    var pinnedItems = [];
    var hiddenIcons = [];
    // Icon layout (UCI desktop.icon_layout): url -> {
    //   icon:    user-chosen icon id (optional; overrides the automatic
    //            url->icon mapping from icon-url-map.js, which serves as
    //            the default when unset — not persisted, follows updates)
    //   desktop: {col, row} grid cell indices on the desktop
    //   mobile:  {col, row} reserved for a future mobile layout
    // }
    var iconLayout = {};

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
                // The icon layout (user icon choice + positions) is SHARED
                // across desktop and mobile — saved under plain
                // 'icon_layout' (the mobile slot lives inside each entry).
                // Without this, a mobile icon choice vanished on reload.
                if (c.icon_layout && typeof c.icon_layout === 'object') {
                    iconLayout = normalizeLayout(c.icon_layout);
                }
            } else {
                if (c.pins) pinnedItems = c.pins;
                if (c.hidden_icons) hiddenIcons = c.hidden_icons;
                if (c.icon_layout && typeof c.icon_layout === 'object') {
                    iconLayout = normalizeLayout(c.icon_layout);
                } else {
                    // One-time migration: legacy icon_positions + icon_choices
                    // merge into the single icon_layout map.
                    var legacy = {};
                    if (c.icon_positions && typeof c.icon_positions === 'object') {
                        Object.keys(c.icon_positions).forEach(function(u) {
                            legacy[u] = { desktop: { col: c.icon_positions[u].col, row: c.icon_positions[u].row } };
                        });
                    }
                    if (c.icon_choices && typeof c.icon_choices === 'object') {
                        Object.keys(c.icon_choices).forEach(function(u) {
                            legacy[u] = legacy[u] || {};
                            legacy[u].icon = c.icon_choices[u];
                        });
                    }
                    iconLayout = normalizeLayout(legacy);
                    if (Object.keys(iconLayout).length > 0) saveIconLayout();
                }
            }
        } catch(e) {}
    }

    function savePins() {
        LuCIDesktop.saveDesktopSection(configSection('pins'), pinnedItems);
    }

    // Normalize an icon layout entry to v2 shape:
    //   {col,row,icon} (v1) -> {icon, desktop:{col,row}, mobile:{col,row}}
    function normalizeLayout(map) {
        var out = {};
        Object.keys(map || {}).forEach(function(u) {
            var e = map[u] || {};
            var entry = {};
            if (e.icon) entry.icon = e.icon;
            if (e.desktop && typeof e.desktop.col === 'number') {
                entry.desktop = { col: e.desktop.col, row: e.desktop.row };
            } else if (typeof e.col === 'number') {
                entry.desktop = { col: e.col, row: e.row || 0 };
            }
            if (e.mobile && typeof e.mobile.col === 'number') {
                entry.mobile = { col: e.mobile.col, row: e.mobile.row };
            }
            if (Object.keys(entry).length > 0) out[u] = entry;
        });
        return out;
    }

    // Icon layout persistence (drag position + icon choice, one map).
    function saveIconLayout() {
        LuCIDesktop.saveDesktopSection('icon_layout', iconLayout);
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
        // Re-read the per-tab config (#desktop-config: pins / hidden icons /
        // icon layout). init() calls it on boot; exposed because the link
        // dialog and tests seed state by writing that script tag directly.
        reloadConfig: function() {
            loadConfig();
        },

        init: function() {
            loadConfig();
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

        // Quantum grid-snap drag engine; positions persist to UCI
        // desktop.icon_layout via the onPositionChange callback.
        _initQuantumDrag: function() {
            var self = this;
            console.log('[desktop] quantum drag init: mobile=' + LuCIDesktop.isMobile() +
                ' engine=' + !!window.LuCIDesktop.QuantumIcons +
                ' container=' + !!document.getElementById('desktop-icons'));
            // desktop.js registers and inits immediately on load; the engine
            // modules are loaded BEFORE desktop.js in the templates, but a
            // stale cached page could still run init first — retry once
            // after window load instead of silently disabling the drag.
            if (!window.LuCIDesktop.QuantumIcons) {
                if (!this._dragRetry) {
                    this._dragRetry = true;
                    var retry = function() { self._dragRetry = false; self._initQuantumDrag(); };
                    if (document.readyState === 'complete') setTimeout(retry, 0);
                    else window.addEventListener('load', retry);
                }
                return;
            }
            // init() may run more than once (tests, re-boot) — never leak
            // a second engine that also listens for mousedown.
            if (this._qicons) { this._qicons.destroy(); this._qicons = null; }
            try {
                this._qicons = new LuCIDesktop.QuantumIcons({
                    gridW: 96,
                    gridH: 90,
                    marginLeft: 16,
                    marginTop: 16,
                    onPositionChange: function(icon, col, row) {
                        var url = icon.getAttribute('data-url');
                        if (!url) return;
                        iconLayout[url] = Object.assign({}, iconLayout[url], { desktop: { col: col, row: row } });
                        saveIconLayout();
                    }
                });
            } catch(e) {
                console.log('[desktop] quantum drag init failed:', e.message);
            }
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

        // URLs of user-added custom links (pins marked custom:true). They
        // are NOT in the LuCI menu tree, so every menu-driven cleanup must
        // skip them — otherwise the user's own link is deleted as a
        // "ghost" on the next page load.
        _customUrlSet: function() {
            var set = {};
            pinnedItems.forEach(function(p) { if (p && p.custom) set[p.url] = true; });
            return set;
        },

        // Remove pins/hidden entries whose URL no longer exists in the menu tree.
        // Prevents "ghost icons" from uninstalled/deleted apps.
        cleanGhostApps: function() {
            var validUrls = this.menuUrls();
            if (Object.keys(validUrls).length === 0) {
                console.log('[ghost-clean] no menu data, skip');
                return;
            }
            var customUrls = this._customUrlSet();

            // Clean pinned items (array of {url, title})
            var removedPins = [];
            var oldPinLen = pinnedItems.length;
            pinnedItems = pinnedItems.filter(function(p) {
                if (p.custom) return true;   // user's own link — never a ghost
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
                if (customUrls[h]) return true;   // hiding a custom link is valid
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

            // Clean icon layout entries (position + choice) for urls that
            // no longer exist in the menu tree.
            var removedLayout = 0;
            Object.keys(iconLayout).forEach(function(u) {
                if (customUrls[u]) return;   // position/icon of a custom link
                if (!validUrls[u]) {
                    delete iconLayout[u];
                    removedLayout++;
                    console.log('[ghost-clean] icon layout ghost: ' + u);
                }
            });
            if (removedLayout > 0) {
                console.log('[ghost-clean] removed ' + removedLayout + ' icon layout entries');
                saveIconLayout();
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

        // ===== Custom URL shortcuts =====
        // A custom link is a pin with custom:true — same storage as a
        // pinned menu item, but the URL is NOT in the LuCI menu tree (see
        // _customUrlSet/cleanGhostApps) and it carries newTab: external
        // sites cannot be framed (X-Frame-Options → blank window).

        // Normalize what the user typed into an openable URL, or null when
        // it must not be opened (never javascript:/data:, never
        // protocol-relative).
        normalizeUrl: function(raw) {
            var u = (raw || '').replace(/^\s+|\s+$/g, '');
            if (!u) return null;
            // A leading placeholder may already BE the scheme or the whole
            // origin — never prefix http:// over it:
            //   {httpx}://host:3000   keep (scheme placeholder)
            //   {origin}/cgi-bin/...  keep (already scheme://host:port)
            //   {router}:3000         host → add http:// like any bare host
            var lead = /^\{[a-z][a-z0-9]*\}/i.exec(u);
            if (lead) {
                var name = lead[0].slice(1, -1).toLowerCase();
                var rest = u.slice(lead[0].length);
                if (name === 'httpx') {
                    if (rest.indexOf('://') === 0) return u;
                    if (rest.indexOf('//') === 0) return lead[0] + ':' + rest;   // {httpx}//host
                    return lead[0] + '://' + rest;                               // {httpx}host
                }
                if (name === 'origin') return u;
                if (/^:\/\//.test(rest) || /^[a-z][a-z0-9+.\-]*:/i.test(rest)) return u;
                return 'http://' + u;
            }
            if (/^[a-z][a-z0-9+.\-]*:/i.test(u)) {          // explicit scheme
                return /^https?:/i.test(u) ? u : null;
            }
            if (u.indexOf('//') === 0) return null;          // protocol-relative
            if (u.charAt(0) === '/') return u;               // LuCI / static path
            if (/^(admin|cgi-bin)\//.test(u)) return '/' + u;
            return 'http://' + u;                            // bare host or IP
        },

        // Placeholders in a custom URL, resolved at OPEN time — one
        // shortcut then keeps working whether the router is reached by host
        // name or by IP (the URL is STORED as typed, never expanded):
        //   {router} → location.hostname  (tec.com | 192.168.1.1)
        //   {httpx}  → http | https       (the scheme in use right now)
        //   {port}   → location.port      (LuCI's own port; '' for 80/443)
        //   {origin} → location.origin    (scheme://host:port)
        // e.g. {httpx}://{router}:300 reaches a service on the router
        // whatever name the shell happened to be opened with.
        // {host} / {hostname} are accepted as aliases of {router}.
        resolveUrlVars: function(url) {
            if (!url || url.indexOf('{') === -1) return url;
            if (typeof location === 'undefined') return url;
            return url
                .replace(/\{(?:router|host|hostname)\}/gi, location.hostname)
                .replace(/\{httpx\}/gi, (location.protocol || '').replace(':', ''))
                .replace(/\{port\}/gi, location.port || '')
                .replace(/\{origin\}/gi, location.origin);
        },

        // A URL that leaves this LuCI origin (default: open in a new tab).
        isExternalUrl: function(url) {
            if (!url || url.charAt(0) === '/') return false;
            if (typeof location === 'undefined') return true;
            return url.indexOf(location.origin + '/') !== 0;
        },

        addCustomUrl: function(title, url, newTab) {
            var name = (title || '').replace(/^\s+|\s+$/g, '') || url;
            var entry = null;
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url) { entry = pinnedItems[i]; break; }
            }
            if (entry) {
                entry.title = name;
                entry.custom = true;
                entry.newTab = !!newTab;
            } else {
                entry = { url: url, title: name, custom: true, newTab: !!newTab };
                pinnedItems.push(entry);
            }
            savePins();
            this.renderShortcuts();
            return entry;
        },

        // Open a shortcut: a custom link flagged newTab leaves the shell
        // (external sites refuse framing), everything else opens as a
        // desktop window like any app. {host}-style placeholders expand
        // here, against the address the shell was opened with.
        openShortcut: function(url, title) {
            var target = this.resolveUrlVars(url);
            for (var i = 0; i < pinnedItems.length; i++) {
                var p = pinnedItems[i];
                if (p.url === url && p.custom && p.newTab) {
                    window.open(target, '_blank', 'noopener');
                    return;
                }
            }
            WM.open(target, title);
        },

        editCustomUrl: function(url) {
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url && pinnedItems[i].custom) {
                    this._showLinkDialog(pinnedItems[i]);
                    return;
                }
            }
        },

        // Editing a link's URL must not lose what is keyed by the URL: the
        // icon the user picked, the desktop grid cell and the hidden state
        // all live in icon_layout / hidden_icons. Without this the icon
        // reverted to the default (and the stale entry was pruned later as
        // a ghost).
        _moveLinkMeta: function(oldUrl, newUrl) {
            if (!oldUrl || !newUrl || oldUrl === newUrl) return;
            if (iconLayout[oldUrl]) {
                iconLayout[newUrl] = iconLayout[oldUrl];
                delete iconLayout[oldUrl];
                saveIconLayout();
            }
            var hi = hiddenIcons.indexOf(oldUrl);
            if (hi !== -1) {
                hiddenIcons.splice(hi, 1);
                if (hiddenIcons.indexOf(newUrl) === -1) hiddenIcons.push(newUrl);
                saveHidden();
            }
        },

        // Add / edit dialog. Reuses the icon-picker overlay CSS (already
        // linked by BOTH header branches — no template change needed).
        _showLinkDialog: function(existing) {
            var self = this;
            var isEdit = !!existing;
            var overlay = document.createElement('div');
            overlay.className = 'icon-picker-overlay link-dialog-overlay open';
            overlay.innerHTML =
                '<div class="icon-picker-panel link-dialog">' +
                    '<div class="icon-picker-header">' +
                        '<span class="icon-picker-title">' + _(isEdit ? 'Edit Link' : 'Add Custom URL') + '</span>' +
                        '<button type="button" class="icon-picker-close">&times;</button>' +
                    '</div>' +
                    '<div class="link-dialog-body">' +
                        '<label class="link-field"><span>' + _('Name') + '</span>' +
                            '<input type="text" class="link-name" maxlength="40"></label>' +
                        '<label class="link-field"><span>' + _('Address (URL)') + '</span>' +
                            '<input type="text" class="link-url" placeholder="https://example.com"></label>' +
                        '<label class="link-check"><input type="checkbox" class="link-newtab"> ' +
                            _('Open in a new browser tab') + '</label>' +
                        '<div class="link-hint">' +
                            _('LuCI pages (/cgi-bin/luci/…) open inside the desktop; external sites open in a browser tab.') +
                        '</div>' +
                        '<div class="link-hint">' +
                            _('Tip: {router} is the address you are using now — {httpx}://{router}:300 reaches this router on port 300 (also {port}, {origin}).') +
                        '</div>' +
                        '<div class="link-error"></div>' +
                    '</div>' +
                    '<div class="link-actions">' +
                        '<button type="button" class="link-cancel">' + _('Cancel') + '</button>' +
                        '<button type="button" class="link-save">' + _('Save') + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            var nameEl = overlay.querySelector('.link-name');
            var urlEl = overlay.querySelector('.link-url');
            var tabEl = overlay.querySelector('.link-newtab');
            var errEl = overlay.querySelector('.link-error');
            var tabTouched = isEdit;   // never auto-toggle an existing choice

            if (isEdit) {
                nameEl.value = existing.title || '';
                urlEl.value = existing.url || '';
                tabEl.checked = !!existing.newTab;
            }

            // Typing a URL keeps the tab checkbox in sync with what the URL
            // implies — until the user sets it by hand. Placeholders expand
            // first so http://{host}:300 is judged as the real target.
            urlEl.addEventListener('input', function() {
                if (tabTouched) return;
                var u = self.normalizeUrl(urlEl.value);
                tabEl.checked = u ? self.isExternalUrl(self.resolveUrlVars(u)) : false;
            });
            tabEl.addEventListener('change', function() { tabTouched = true; });

            var close = function() { overlay.remove(); document.removeEventListener('keydown', onKey); };
            var onKey = function(ev) {
                if (ev.key === 'Escape') close();
                else if (ev.key === 'Enter' && ev.target === urlEl) save();
            };
            document.addEventListener('keydown', onKey);
            overlay.querySelector('.icon-picker-close').addEventListener('click', close);
            overlay.querySelector('.link-cancel').addEventListener('click', close);
            overlay.addEventListener('mousedown', function(ev) { if (ev.target === overlay) close(); });

            var save = function() {
                var url = self.normalizeUrl(urlEl.value);
                if (!url) {
                    errEl.textContent = _('Enter a valid http(s) address or a LuCI path.');
                    urlEl.focus();
                    return;
                }
                var oldUrl = isEdit ? existing.url : null;
                if (oldUrl && oldUrl !== url) {
                    self.unpinItem(oldUrl);
                    self._moveLinkMeta(oldUrl, url);   // keep icon/position/hidden
                }
                self.addCustomUrl(nameEl.value, url, tabEl.checked);
                close();
            };
            overlay.querySelector('.link-save').addEventListener('click', save);

            setTimeout(function() { nameEl.focus(); }, 0);
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
                return {
                    title: p.title, url: p.url, pinned: true, pinIndex: i,
                    custom: !!p.custom, newTab: !!p.newTab
                };
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

            // Current viewport grid: stored positions from a LARGER window
            // (or a reinstall) must be clamped into the visible grid or
            // icons end up off-screen ("missing") or stacked on the last
            // cell after the engine pulls them back. Rows are also
            // clamped so tall layouts collapse into view.
            var boxW = container.clientWidth || 400;
            var boxH = container.clientHeight || 300;
            var gridCols = Math.max(1, Math.floor((boxW - MARGIN_LEFT) / CELL_W));
            var gridRows = Math.max(1, Math.floor((boxH - MARGIN_TOP) / CELL_H));
            var taken = {};

            visible.forEach(function(item, i) {
                // Icon layout (UCI) wins over the auto layout; desktop
                // positions come from the entry's desktop field.
                var layoutEntry = iconLayout[item.url];
                var pos = layoutEntry && layoutEntry.desktop;
                var col, row;
                if (pos && typeof pos.col === 'number' && typeof pos.row === 'number') {
                    col = Math.max(0, Math.min(gridCols - 1, pos.col));
                    row = Math.max(0, Math.min(gridRows - 1, pos.row));
                } else {
                    col = i % COLS;
                    row = Math.floor(i / COLS);
                }
                // Collision: never place two icons on the same cell —
                // advance to the next free cell, wrapping across rows and
                // back to the top (guard prevents an infinite loop when
                // every cell is taken; a tiny window then allows overlap).
                var guard = gridCols * gridRows;
                while (taken[col + ',' + row] && guard-- > 0) {
                    col++;
                    if (col >= gridCols) { col = 0; row++; }
                    if (row >= gridRows) { row = 0; }
                }
                taken[col + ',' + row] = true;
                var left = MARGIN_LEFT + col * CELL_W;
                var top = MARGIN_TOP + row * CELL_H;
                var label = item.title.length > 10 ? item.title.substring(0, 9) + '..' : item.title;

                html += '<div class="desktop-icon' + (item.installable ? ' installable' : '') +
                    '" data-url="' + esc(item.url) + '"';
                html += ' style="left:' + left + 'px;top:' + top + 'px" title="' + esc(item.title) +
                    (item.installable ? ' (' + _('Not installed') + ')' : '') + '">';
                html += '<div class="desktop-icon-img">';
                // Emoji rendering: user icon choice (icon_layout.icon)
                // wins, then the IconConfig url mapping; falls back to the
                // legacy first-letter SVG when nothing matches.
                var catIcon = null;
                var choiceId = layoutEntry ? layoutEntry.icon : null;
                if (choiceId && window.LuCIDesktop.IconConfig) {
                    catIcon = window.LuCIDesktop.IconConfig.getIconById(choiceId);
                }
                if (!catIcon && window.LuCIDesktop.IconConfig) {
                    // Custom links have no menu entry to match, and a URL
                    // fragment could match by accident (a link containing
                    // "/ping" would become the diagnostic icon) — they fall
                    // back to the generic link icon instead.
                    catIcon = item.custom
                        ? window.LuCIDesktop.IconConfig.getIconById('link')
                        : window.LuCIDesktop.IconConfig.matchUrl(item.url);
                }
                if (catIcon) {
                    var catBg = hexToRgba(LuCIDesktop.IconConfig.colors[catIcon.category], 0.16);
                    html += '<span class="desktop-icon-emoji" style="background:' + catBg + '">' + catIcon.emoji + '</span>';
                } else {
                    html += '<svg width="40" height="40" viewBox="0 0 40 40">';
                    html += '<rect width="40" height="40" rx="6" fill="' + (item.pinned ? 'rgba(74,144,217,0.2)' : 'rgba(255,255,255,0.1)') + '"/>';
                    html += '<text x="20" y="26" text-anchor="middle" style="fill:var(--icon-text,currentColor)" font-size="18">' + esc(item.title.charAt(0)) + '</text>';
                    html += '</svg>';
                }
                // Install badge: little "+" in the corner for installable items
                if (item.installable) {
                    html += '<span class="install-badge">+</span>';
                }
                html += '</div>';
                html += '<div class="desktop-icon-label">' + esc(label) + '</div></div>';
            });
            container.innerHTML = html;
            // Notify the quantum drag engine (its grid overlay is a child of
            // #desktop-icons and gets wiped by innerHTML above).
            try {
                document.dispatchEvent(new CustomEvent('desktop-icons-rendered'));
            } catch(e) {}
        },

        bindEvents: function() {
            // init() may run more than once (re-boot, tests) — never bind
            // a second set of click/dblclick/touch handlers on top of the
            // first (duplicated handlers fire N times per gesture).
            if (this._eventsBound) return;
            this._eventsBound = true;
            var container = document.getElementById('desktop-icons');
            if (!container) return;
            var self = this;

            container.addEventListener('dblclick', function(e) {
                if (LuCIDesktop.isMobile()) return;   // mobile: single tap opens
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                Desktop.openShortcut(icon.getAttribute('data-url'), icon.getAttribute('title') || '');
            });

            // Mobile: single tap opens (desktop keeps double-click). A
            // long-press that opened the context menu suppresses this.
            container.addEventListener('click', function(e) {
                if (!LuCIDesktop.isMobile()) return;
                if (self._suppressTapOpen) {
                    self._suppressTapOpen = false;
                    return;
                }
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                Desktop.openShortcut(icon.getAttribute('data-url'), icon.getAttribute('title') || '');
            });

            // Mobile: long-press an icon → the same icon context menu as
            // right-click on desktop (Change Icon / Reset Icon / Open /
            // Hide / pin actions). Movement cancels the press.
            container.addEventListener('touchstart', function(e) {
                if (!LuCIDesktop.isMobile()) return;
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                var t = e.touches[0];
                if (!t) return;
                self._lpSX = t.clientX;
                self._lpSY = t.clientY;
                clearTimeout(self._lpTimer);
                self._lpTimer = setTimeout(function() {
                    self._lpTimer = null;
                    var url = icon.getAttribute('data-url');
                    var title = icon.getAttribute('title') || '';
                    var rect = icon.getBoundingClientRect();
                    var pinned = null;
                    for (var i = 0; i < pinnedItems.length; i++) {
                        if (pinnedItems[i].url === url) { pinned = pinnedItems[i]; break; }
                    }
                    if (pinned) {
                        self._showIconMenu(rect.left + rect.width / 2, rect.bottom + 4, pinned);
                    } else {
                        self._showDefaultIconMenu(rect.left + rect.width / 2, rect.bottom + 4, url, title, icon);
                    }
                    // swallow the tap that follows the long-press
                    self._suppressTapOpen = true;
                }, 500);
            }, { passive: true });

            container.addEventListener('touchmove', function(e) {
                if (!self._lpTimer) return;
                var t = e.touches[0];
                if (!t) return;
                if (Math.abs(t.clientX - self._lpSX) > 12 || Math.abs(t.clientY - self._lpSY) > 12) {
                    clearTimeout(self._lpTimer);
                    self._lpTimer = null;
                }
            }, { passive: true });

            container.addEventListener('touchend', function() {
                clearTimeout(self._lpTimer);
                self._lpTimer = null;
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
            html += '<div class="context-item" data-act="changeicon">' + _('Change Icon') + '</div>';
            if (iconLayout[url] && iconLayout[url].icon) {
                html += '<div class="context-item" data-act="reseticon">' + _('Reset Icon') + '</div>';
            }
            html += '<div class="context-item" data-act="hide">' + _('Hide') + '</div>';
            m.innerHTML = html;
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'open') {
                    Desktop.openShortcut(url, title);
                } else if (a === 'install') {
                    Desktop.installDefault(url);
                } else if (a === 'changeicon') {
                    Desktop.openIconPicker(url);
                } else if (a === 'reseticon') {
                    if (iconLayout[url]) { delete iconLayout[url].icon; saveIconLayout(); }
                    Desktop.renderShortcuts();
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
                '<div class="context-item" data-act="changeicon">' + _('Change Icon') + '</div>' +
                (iconLayout[pinned.url] && iconLayout[pinned.url].icon ? '<div class="context-item" data-act="reseticon">' + _('Reset Icon') + '</div>' : '') +
                '<div class="context-item" data-act="rename">' + _('Rename') + '</div>' +
                (pinned.custom ? '<div class="context-item" data-act="editlink">' + _('Edit Link') + '</div>' : '') +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="unpin">' + _('Unpin') + '</div>';
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'open') {
                    Desktop.openShortcut(pinned.url, pinned.title);
                } else if (a === 'editlink') {
                    Desktop.editCustomUrl(pinned.url);
                } else if (a === 'changeicon') {
                    Desktop.openIconPicker(pinned.url);
                } else if (a === 'reseticon') {
                    if (iconLayout[pinned.url]) { delete iconLayout[pinned.url].icon; saveIconLayout(); }
                    Desktop.renderShortcuts();
                } else if (a === 'rename') {
                    var name = prompt(_('New name:'), pinned.title);
                    if (name && name.trim()) { pinned.title = name.trim(); savePins(); Desktop.renderShortcuts(); }
                } else if (a === 'unpin') {
                    Desktop.unpinItem(pinned.url);
                }
                m.remove();
            });
        },

        // Open the icon chooser for a desktop shortcut; persist the choice
        // into the icon layout (UCI desktop.icon_layout) and re-render.
        openIconPicker: function(url) {
            var self = this;
            if (!window.LuCIDesktop.IconPicker) { console.warn('[desktop] IconPicker not loaded'); return; }
            var currentId = (iconLayout[url] && iconLayout[url].icon) || null;
            if (!currentId && window.LuCIDesktop.IconConfig) {
                var mapped = window.LuCIDesktop.IconConfig.matchUrl(url);
                if (mapped) currentId = mapped.id;
            }
            window.LuCIDesktop.IconPicker.open({
                url: url,
                currentId: currentId,
                onSelect: function(iconId) {
                    if (!iconId) return;   // cancelled
                    iconLayout[url] = Object.assign({}, iconLayout[url], { icon: iconId });
                    saveIconLayout();
                    self.renderShortcuts();
                }
            });
        },

        _showDesktopMenu: function(x, y) {
            var m = _makeMenu(x, y);
            m.id = 'desktop-context-menu';
            m.innerHTML =
                '<div class="context-item context-has-sub" data-act="new">' + _('New') +
                    '<span class="context-arrow">&#8250;</span>' +
                    '<div class="context-submenu">' +
                        '<div class="context-item" data-act="addlink">' + _('Link') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="theme">' + _('Theme') + '</div>' +
                '<div class="context-item" data-act="widgets">' + _('Widgets') + '</div>' +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="rearrange">' + _('Rearrange Icons') + '</div>' +
                '<div class="context-item" data-act="refresh">' + _('Refresh') + '</div>';
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'new') {
                    // Touch has no hover — tapping the parent opens the
                    // submenu (and keeps the menu itself open).
                    act.classList.toggle('open');
                    return;
                }
                if (a === 'addlink') Desktop._showLinkDialog(null);
                else if (a === 'theme') window.ThemeSettings ? ThemeSettings.open() : alert(_('Theme settings loading...'));
                else if (a === 'widgets') WidgetManager.openSettings();
                else if (a === 'rearrange') Desktop.rearrangeIcons();
                else if (a === 'refresh') {
                    Object.keys(DESKTOP.windows).forEach(function(id) {
                        var w = DESKTOP.windows[id];
                        var iframe = w.el && w.el.querySelector('iframe');
                        if (iframe) iframe.src = iframe.src;
                    });
                }
                m.remove();
            });
        },

        // Reset every icon back to the auto layout: 4 columns, top-to-bottom
        // from [0,0]. Clears the persisted drag positions (UCI) so the
        // auto layout sticks until the user drags again.
        rearrangeIcons: function() {
            // Reset every icon back to the auto layout: clear the stored
            // DESKTOP grid cells but keep the icon choice and the mobile
            // position.
            Object.keys(iconLayout).forEach(function(u) {
                delete iconLayout[u].desktop;
                if (Object.keys(iconLayout[u]).length === 0) delete iconLayout[u];
            });
            saveIconLayout();
            this.renderShortcuts();
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

    // '#RRGGBB' + alpha -> 'rgba(r,g,b,a)' (for emoji category chip bg)
    function hexToRgba(hex, alpha) {
        var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
        if (!m) return 'rgba(255,255,255,0.1)';
        var n = parseInt(m[1], 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (alpha || 0.16) + ')';
    }

    DESKTOP.register('desktop', Desktop);
    window.Desktop = Desktop;
})();
