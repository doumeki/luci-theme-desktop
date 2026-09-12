/* Desktop Theme - Desktop icon rendering, picker + quantum drag
 *
 * Builds the desktop shortcut grid from the default shortcuts, the pins
 * and the persisted icon layout; wires the icon/desktop DOM events; and
 * instantiates the quantum grid-snap drag engine.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop-icons.js: LuCIDesktop namespace not found'); return; }
    var State = DESKTOP.desktopState;

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // Attribute-context escaping. esc() is TEXT-NODE safe only: its
    // textContent -> innerHTML round-trip escapes & < > but leaves quotes
    // intact, so a value containing a literal " would terminate a quoted
    // attribute early. data-url is the worst case — it is read back with
    // getAttribute() on drag (onPositionChange) and on open, so a
    // truncated URL silently writes the icon_layout entry under the wrong
    // key (and the link becomes undraggable). Use esc() for text nodes,
    // escAttr() for anything interpolated inside an attribute value.
    function escAttr(s) {
        return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // '#RRGGBB' + alpha -> 'rgba(r,g,b,a)' (for emoji category chip bg)
    function hexToRgba(hex, alpha) {
        var m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
        if (!m) return 'rgba(255,255,255,0.1)';
        var n = parseInt(m[1], 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (alpha || 0.16) + ')';
    }

    var icons = {
        renderShortcuts: function() {
            var container = document.getElementById('desktop-icons');
            if (!container) return;

            // Default shortcuts whose availability probe failed (e.g.
            // Terminal when luci-app-ttyd is not installed) are NOT hidden
            // anymore — they render as INSTALLABLE (badge + Install in the
            // context menu) so the user can install the component in place
            // (2026-08-16).
            var self = this;
            // effectiveDefaults() is injected by desktop.js (the facade owns
            // the runtime-dependent default catalog + probe).
            var defaults = DESKTOP.desktopIcons.effectiveDefaults().map(function(d) {
                var unavailable = !!(self._unavailable || {})[d.url];
                return { title: d.title, url: d.url, installable: unavailable };
            });

            var all = defaults.concat(State.pins().map(function(p, i) {
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

            var iconLayout = State.layout();
            var hiddenIcons = State.hidden();
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

                var titleText = item.title + (item.installable ? ' (' + _('Not installed') + ')' : '');

                html += '<div class="desktop-icon' + (item.installable ? ' installable' : '') +
                    '" data-url="' + escAttr(item.url) + '"';
                html += ' style="left:' + left + 'px;top:' + top + 'px" title="' + escAttr(titleText) + '">';
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

        pinItem: function(url, title) {
            var pinnedItems = State.pins();
            for (var i = 0; i < pinnedItems.length; i++) {
                if (pinnedItems[i].url === url) { pinnedItems[i].title = title; State.savePins(); this.renderShortcuts(); return; }
            }
            pinnedItems.push({url: url, title: title});
            State.savePins();
            this.renderShortcuts();
        },

        unpinItem: function(url) {
            State.setPins(State.pins().filter(function(p) { return p.url !== url; }));
            State.savePins();
            this.renderShortcuts();
        },

        // Open the icon chooser for a desktop shortcut; persist the choice
        // into the icon layout (UCI desktop.icon_layout) and re-render.
        openIconPicker: function(url) {
            var self = this;
            if (!window.LuCIDesktop.IconPicker) { console.warn('[desktop] IconPicker not loaded'); return; }
            var iconLayout = State.layout();
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
                    var layout = State.layout();
                    layout[url] = Object.assign({}, layout[url], { icon: iconId });
                    State.saveIconLayout();
                    self.renderShortcuts();
                }
            });
        },

        // Reset every icon back to the auto layout: 4 columns, top-to-bottom
        // from [0,0]. Clears the persisted drag positions (UCI) so the
        // auto layout sticks until the user drags again.
        rearrangeIcons: function() {
            // Reset every icon back to the auto layout: clear the stored
            // DESKTOP grid cells but keep the icon choice and the mobile
            // position.
            var iconLayout = State.layout();
            Object.keys(iconLayout).forEach(function(u) {
                delete iconLayout[u].desktop;
                if (Object.keys(iconLayout[u]).length === 0) delete iconLayout[u];
            });
            State.saveIconLayout();
            this.renderShortcuts();
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
                        var iconLayout = State.layout();
                        iconLayout[url] = Object.assign({}, iconLayout[url], { desktop: { col: col, row: row } });
                        State.saveIconLayout();
                    }
                });
            } catch(e) {
                console.log('[desktop] quantum drag init failed:', e.message);
            }
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
                    var pinnedItems = State.pins();
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
                var pinnedItems = State.pins();
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
        }
    };

    DESKTOP.desktopIcons = icons;
})();
