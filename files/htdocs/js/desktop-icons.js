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
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + ((n & 255)) + ',' + (alpha || 0.16) + ')';
    }

    // Mobile icon order: on mobile #desktop-icons is a CSS grid (mobile.css,
    // 4 columns), so the visual order IS the DOM order. The persisted order
    // lives in each icon_layout entry's reserved `mobile` field as {col,row}
    // (grid cell — the shape desktop-state v2 already documented). Entries
    // without a slot keep their default relative order, placed after all
    // positioned icons.
    var MOBILE_COLS = 4;
    var MOBILE_SLOTS_BIG = 1e6;

    function mobileSlotOf(entry) {
        if (entry && entry.mobile &&
            typeof entry.mobile.col === 'number' && typeof entry.mobile.row === 'number') {
            return entry.mobile.row * MOBILE_COLS + entry.mobile.col;
        }
        return null;
    }

    var icons = {
        // Exposed for tests (mobile reorder ordering); see mobileSlotOf.
        mobileSlotOf: function(entry) { return mobileSlotOf(entry); },

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

            // Mobile: CSS-grid order == item order here — sort by the
            // persisted mobile slot; icons WITHOUT one fall back to their
            // implicit default index, so dragging to the END of the grid
            // works too (positioned/unpositioned share one number line).
            // Desktop keeps its own absolute grid and reads
            // layoutEntry.desktop further below, unchanged.
            if (DESKTOP.isMobile()) {
                visible = visible
                    .map(function(item, i) {
                        var slot = mobileSlotOf(iconLayout[item.url]);
                        return { item: item, key: (slot === null) ? i : slot };
                    })
                    .sort(function(a, b) { return a.key - b.key; })
                    .map(function(x) { return x.item; });
            }

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

        // Reset every icon back to the auto layout: clear the stored
        // DESKTOP grid cells but keep the icon choice — and on mobile also
        // clear the persisted mobile slots, since that IS the mobile auto
        // layout the user is rearranging.
        rearrangeIcons: function() {
            var mobile = LuCIDesktop.isMobile();
            var iconLayout = State.layout();
            Object.keys(iconLayout).forEach(function(u) {
                delete iconLayout[u].desktop;
                if (mobile) delete iconLayout[u].mobile;
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

        // ===== Mobile drag-reorder =====
        // The quantum engine is intentionally NOT instantiated on mobile
        // (desktop.js); icons are CSS-grid items whose visual order is their
        // DOM order. Gesture contract mirrors the long-press menu above:
        //   press + move >= 12px (before the 500ms menu timer fires)
        //                              -> drag-reorder (menu cancelled)
        //   press held ~500ms steady   -> context menu; that touch never
        //                                 becomes a drag
        //   tap (no move)              -> opens the icon (unchanged)
        _resetDragState: function() {
            this._dragIcon = null;
            this._dragActive = false;
            this._dragBarred = false;
            this._dragGrab = null;
            this._dragOrigin = null;
        },

        // Paint the icon under the finger; transform is relative to the
        // node's static grid position (re-based after each DOM swap).
        _paintMobileDrag: function(t) {
            var icon = this._dragIcon;
            if (!icon || !this._dragGrab || !this._dragOrigin) return;
            icon.style.transform =
                'translate(' + Math.round(t.clientX - this._dragGrab.x - this._dragOrigin.x) + 'px,' +
                Math.round(t.clientY - this._dragGrab.y - this._dragOrigin.y) + 'px)';
        },

        // Engage: grab offsets are passed IN — the long-press start coords
        // live on the facade (`self._lpSX`), not on this module object, and
        // bindEvents may be invoked as a facade method (0.1.0-177 rake).
        _engageMobileDrag: function(icon, sx, sy) {
            var rect = icon.getBoundingClientRect();
            this._dragActive = true;
            icon.classList.add('drag-reorder');
            this._dragGrab = { x: sx - rect.left, y: sy - rect.top };
            this._dragOrigin = { x: rect.left, y: rect.top };
        },

        // Paint the icon under the finger; transform is relative to the
        // node's static grid position (re-based after each DOM swap).

        // Reorder preview: map the pointer onto the grid — cell math mirrors
        // mobile.css (4 columns, 92px rows, 2px row / 4px column gap, 10px
        // padding) — and move the node into that slot.
        _reorderMobileDrag: function(t) {
            var icon = this._dragIcon;
            var container = document.getElementById('desktop-icons');
            if (!icon || !container || icon.parentNode !== container) return;
            var r = container.getBoundingClientRect();
            var kids = Array.prototype.slice.call(container.querySelectorAll('.desktop-icon'));
            var count = kids.length;
            if (count < 2 || icon.parentNode !== container) return;
            var stride = (r.width - 20 - 4 * (MOBILE_COLS - 1)) / MOBILE_COLS + 4; // px column pitch
            var col = Math.floor((t.clientX - r.left - 10) / stride);
            col = Math.max(0, Math.min(MOBILE_COLS - 1, col));
            var pitch = 94; // 92px row + 2px gap
            var row = Math.max(0, Math.min(Math.ceil(count / MOBILE_COLS) - 1,
                Math.floor((t.clientY - r.top - 10) / pitch)));
            var target = kids[row * MOBILE_COLS + col];
            if (!target || target === icon) return;
            if (kids.indexOf(target) < kids.indexOf(icon)) {
                container.insertBefore(icon, target);
            } else {
                container.insertBefore(icon, target.nextSibling);
            }
            // Re-base the painted transform onto the node's new static spot:
            // clear the transform, measure the fresh grid position, repaint.
            icon.style.transform = '';
            var rect = icon.getBoundingClientRect();
            this._dragOrigin = { x: rect.left, y: rect.top };
            this._paintMobileDrag(t);
        },

        // Persist the visual order: grid cell == DOM index. Writes each
        // entry's mobile {col,row} into icon_layout. Returns whether the
        // layout changed (caller re-renders to snap; a re-run with the same
        // order writes nothing).
        _finishMobileDrag: function() {
            var icon = this._dragIcon;
            if (icon) {
                icon.classList.remove('drag-reorder');
                icon.style.transform = '';
            }
            this._dragActive = false;
            this._dragIcon = null;
            var container = document.getElementById('desktop-icons');
            if (!container) return false;
            var layout = State.layout();
            var dirty = false;
            Array.prototype.slice.call(container.querySelectorAll('.desktop-icon'))
                .forEach(function(el, i) {
                    var url = el.getAttribute('data-url');
                    if (!url) return;
                    var entry = layout[url] || {};
                    var col = i % MOBILE_COLS;
                    var row = Math.floor(i / MOBILE_COLS);
                    var m = entry.mobile;
                    if (!m || m.col !== col || m.row !== row) {
                        layout[url] = Object.assign({}, entry, { mobile: { col: col, row: row } });
                        dirty = true;
                    }
                });
            return dirty;
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
            // Hide / pin actions). Movement >=12px BEFORE the timer fires
            // engages drag-reorder instead (one shared threshold).
            //
            // `self` here is whatever bindEvents was called on — from
            // Desktop.init that is the FACADE, which mirrors the pre-existing
            // fields but not the NEW mobile-drag state. Store new state on
            // the module object `icons` (closure) or the methods below are
            // unreachable (0.1.0-177 rake, again).
            container.addEventListener('touchstart', function(e) {
                if (!LuCIDesktop.isMobile()) return;
                var icon = e.target.closest('.desktop-icon');
                if (!icon) return;
                var t = e.touches[0];
                if (!t) return;
                self._lpSX = t.clientX;
                self._lpSY = t.clientY;
                icons._resetDragState();
                icons._dragIcon = icon;
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
                    // the menu touch must never turn into a drag
                    icons._dragBarred = true;
                    // swallow the tap that follows the long-press
                    self._suppressTapOpen = true;
                }, 500);
            }, { passive: true });

            container.addEventListener('touchmove', function(e) {
                if (!LuCIDesktop.isMobile()) return;
                var t = e.touches[0];
                if (!t) return;
                if (icons._dragActive && icons._dragIcon) {
                    e.preventDefault();
                    // Per-move: pointer decides where the icon will land.
                    // Swap into the hovered cell live (_reorderMobileDrag
                    // re-bases + repaints when it swaps); the paint below
                    // covers frames where the cell didn't change. Without
                    // the swap call the DOM order never changes and the
                    // drop math ends up a no-op (0.1.0-247).
                    icons._reorderMobileDrag(t);
                    icons._paintMobileDrag(t);
                    return;
                }
                if (!self._lpTimer) return;
                var dx = t.clientX - self._lpSX;
                var dy = t.clientY - self._lpSY;
                if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
                    clearTimeout(self._lpTimer);
                    self._lpTimer = null;
                    // moving before the menu timer fires supersedes it
                    if (icons._dragIcon && !icons._dragBarred) {
                        icons._engageMobileDrag(icons._dragIcon, self._lpSX, self._lpSY);
                        icons._reorderMobileDrag(t);
                    }
                }
            }, { passive: false });

            container.addEventListener('touchend', function(e) {
                clearTimeout(self._lpTimer);
                self._lpTimer = null;
                if (icons._dragActive && icons._dragIcon) {
                    e.preventDefault();   // no synthetic click after a move
                    if (icons._finishMobileDrag()) {
                        State.saveIconLayout();   // the drop must survive a
                        // reload — same contract as the icon-chooser path
                        self.renderShortcuts();
                    }
                    // the grid moved under this touch — never open the app
                    self._suppressTapOpen = true;
                }
                icons._resetDragState();
            }, { passive: false });

            container.addEventListener('touchcancel', function() {
                clearTimeout(self._lpTimer);
                self._lpTimer = null;
                if (icons._dragActive && icons._dragIcon) {
                    // Drag reorder only touched the DOM mid-gesture — State
                    // is untouched until touchend, so re-rendering restores
                    // the stored order.
                    icons._dragIcon.classList.remove('drag-reorder');
                    icons._dragIcon.style.transform = '';
                    self.renderShortcuts();
                }
                icons._resetDragState();
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
