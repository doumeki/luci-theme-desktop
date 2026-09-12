/* Desktop Theme - Start Menu
 *
 * Two-panel start menu rendered from LuCIMenuData (JSON set by header.htm).
 * Category list on left, sub-items on right. Search/filter at top.
 *
 * Depends on: shell.js, wm.js
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('startmenu.js: LuCIDesktop namespace not found'); return; }

    var visible = false;

    // SINGLE SOURCE OF TRUTH for start menu category icons: slug -> argon
    // glyph + color. To add or adjust a category icon, edit THIS table only.
    // catIconHTML() copies the two values onto the icon node as data-glyph +
    // an inline color, and startmenu.css draws every one of them with a
    // single generic rule (`.menu-cat-icon[data-glyph]::before`). There is no
    // parallel CSS list to keep in sync any more.
    //
    // The glyph codes/colors mirror the 12 legacy [data-title=...] rules in
    // cascade.css (kept there unchanged for the classic LuCI sidebar). The
    // font is files/htdocs/fonts/argon.*, shipped with the theme; a codepoint
    // is usable exactly when cascade.css has a `content:` value for it.
    // Slugs the font has no glyph for stay OUT of this table and fall back to
    // emoji/first letter (see catFallback) — nothing to do for those.
    // Real slugs measured on both test routers: status/system/services/nas/
    // control/vpn/network/nlbw. The other entries cover common installs.
    var CAT_ICONS = {
        status:     { g: '\ue906', c: 'var(--primary, var(--accent-color, #5e72e4))' },
        system:     { g: '\ue90a', c: '#fb6340' },
        services:   { g: '\ue909', c: '#11cdef' },
        nas:        { g: '\ue90c', c: '#f3a4b5' },
        vpn:        { g: '\ue90b', c: '#aaad03' },
        network:    { g: '\ue908', c: '#8965e0' },
        nlbw:       { g: '\ue90d', c: '#2dce89' },   // Argon's Bandwidth_Monitor
        docker:     { g: '\ue911', c: '#6699ff' },
        statistics: { g: '\ue913', c: '#5603ad' },
        stats:      { g: '\ue913', c: '#5603ad' },
        control:    { g: '\ue912', c: 'var(--primary, var(--accent-color, #5e72e4))' },
        asterisk:   { g: '\ue914', c: '#fb6340' },
        logout:     { g: '\ue907', c: '#adb5bd' }
    };

    function catIcon(id) {
        return (id && Object.prototype.hasOwnProperty.call(CAT_ICONS, id))
            ? CAT_ICONS[id] : null;
    }

    // Fallback for a category the icon font cannot draw: the emoji the shared
    // LuCI url->icon table maps the first sub-item to (same table the desktop
    // shortcuts use), else the title's first letter. Never leaves the icon
    // slot empty.
    function catFallback(cat) {
        var sub = cat.subs && cat.subs.length ? cat.subs[0] : null;
        var href = (sub && sub.href) || cat.href || '';
        var cfg = DESKTOP.IconConfig;
        var icon = (href && cfg && typeof cfg.matchUrl === 'function')
            ? cfg.matchUrl(href) : null;
        if (icon && icon.emoji) return icon.emoji;
        return (cat.title || '').charAt(0) || '?';
    }

    function catIconHTML(cat) {
        var id = cat && cat.id ? String(cat.id) : '';
        var ic = catIcon(id);
        if (ic) {
            // Glyph + color ride on the node (data-glyph / inline color) and
            // startmenu.css renders them via one generic ::before rule.
            return '<span class="menu-cat-icon" aria-hidden="true" data-glyph="' +
                escapeHTML(ic.g) + '" style="color:' + escapeHTML(ic.c) + '"></span>';
        }
        return '<span class="menu-cat-icon menu-cat-icon-fallback" aria-hidden="true">' +
            escapeHTML(catFallback(cat)) + '</span>';
    }

    var StartMenu = {
        init: function() {
            this.render();
            this.bindEvents();
        },

        render: function() {
            var menuEl = document.getElementById('start-menu');
            if (!menuEl) return;

            // Try to read menu data from multiple sources
            var data = window.LuCIMenuData;
            if (!data || !data.length) {
                // Fallback: parse JSON from <script id="menu-data"> tag
                var scriptEl = document.getElementById('menu-data');
                if (scriptEl && scriptEl.textContent) {
                    try {
                        data = JSON.parse(scriptEl.textContent);
                        window.LuCIMenuData = data;
                    } catch(e) {
                        console.warn('startmenu: failed to parse menu-data script tag');
                    }
                }
            }
            if (!data || !data.length) {
                menuEl.innerHTML = '<div class="menu-empty">' + _('No menu items') + '</div>';
                return;
            }

            var html = '<div class="menu-search"><input type="text" placeholder="' + _('Search...') + '" id="menu-search-input"></div>';
            html += '<div class="menu-panels">';

            // Left panel: categories
            html += '<div class="menu-categories">';
            data.forEach(function(cat, i) {
                html += '<div class="menu-category-item' + (i === 0 ? ' active' : '') + '" data-category="' + escapeHTML(cat.id || '') + '">';
                html += catIconHTML(cat);
                html += escapeHTML(cat.title);
                html += '</div>';
            });
            html += '</div>';

            // Right panel: sub-items for each category
            html += '<div class="menu-items">';
            data.forEach(function(cat, catIdx) {
                html += '<div class="menu-category" data-category="' + cat.id + '"';
                if (catIdx > 0) html += ' style="display:none"';
                html += '>';

                if (cat.subs && cat.subs.length) {
                    cat.subs.forEach(function(sub) {
                        if (!sub.title) return;
                        html += '<div class="menu-item" data-href="' + escapeHTML(sub.href || '') + '"';
                        html += ' data-title="' + escapeHTML(sub.title) + '">';
                        html += escapeHTML(sub.title);
                        html += '</div>';
                    });
                } else if (cat.href) {
                    // Category is a direct link (no subs)
                    html += '<div class="menu-item" data-href="' + escapeHTML(cat.href) + '"';
                    html += ' data-title="' + escapeHTML(cat.title) + '" data-category="' + cat.id + '">';
                    html += escapeHTML(cat.title);
                    html += '</div>';
                }

                html += '</div>';
            });
            html += '</div></div>'; // close menu-panels

            // About / version footer + logout. The version is fetched from
            // a static file (no template involvement) when not yet known.
            if (!window.__DESKTOP_THEME_VERSION__) {
                try {
                    fetch('/luci-static/desktop/version.txt?v=' + Date.now()).then(function(r) { return r.text(); }).then(function(t) {
                        window.__DESKTOP_THEME_VERSION__ = (t || '').trim() || '?.?.?';
                        var f = menuEl.querySelector('.menu-footer-ver');
                        if (f) f.textContent = _('Desktop Theme v') + window.__DESKTOP_THEME_VERSION__;
                    }).catch(function() {});
                } catch(e) {}
            }
            var ver = window.__DESKTOP_THEME_VERSION__ || '?.?.?';
            html += '<div class="menu-footer">' +
                '<span class="menu-footer-ver">' + _('Desktop Theme v') + ver + '</span>' +
                '<a class="menu-footer-git" href="https://github.com/doumeki/luci-theme-desktop" target="_blank" rel="noopener" title="GitHub">' +
                '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
                '<span>GitHub</span></a>' +
                '<button class="menu-logout-btn" title="' + _('Logout') + '">' + _('Exit') + '</button>' +
                '</div>';

            menuEl.innerHTML = html;
        },

        // Continuous paging: one 48px notch of accumulated drag = one
        // category step (0 = not far enough yet). Direction mirrors the
        // desktop HOVER behaviour — dragging DOWN walks down the sidebar
        // list (= next), dragging UP walks back; horizontal drags work the
        // same way (left = next). Called repeatedly while dragging, so a
        // long swipe pages several categories instead of one.
        _swipeNotch: function(acc, vertical, step) {
            if (Math.abs(acc) < (step || 48)) return 0;
            var sign = acc > 0 ? 1 : -1;
            return vertical ? sign : -sign;
        },

        // Swipe left/right on the apps area → previous/next category.
        // Mobile only in practice (touch events); mouse users keep clicking
        // the sidebar. No wrap-around: the ends simply stop, like clicking.
        _swipeCategory: function(step) {
            var menuEl = document.getElementById('start-menu');
            if (!menuEl) return false;
            var cats = menuEl.querySelectorAll('.menu-category-item');
            if (cats.length < 2) return false;
            var idx = -1;
            for (var i = 0; i < cats.length; i++) {
                if (cats[i].classList.contains('active')) { idx = i; break; }
            }
            if (idx === -1) idx = 0;
            var next = idx + step;
            if (next < 0 || next >= cats.length) return false;
            this.showCategory(cats[next].getAttribute('data-category'));
            if (cats[next].scrollIntoView) {
                try { cats[next].scrollIntoView({ block: 'nearest' }); } catch (e) {}
            }
            return true;
        },

        bindEvents: function() {
            // Bind once: a second call would stack duplicate handlers and
            // every gesture/click would fire twice.
            if (this._eventsBound) return;
            this._eventsBound = true;
            var self = this;
            var menuEl = document.getElementById('start-menu');
            if (!menuEl) return;

            // Hover to switch category (KDE-style) — checks setting dynamically
            menuEl.addEventListener('mouseover', function(e) {
                if (!self._readSetting('menu_hover_mode', true)) return;
                var catItem = e.target.closest('.menu-category-item');
                if (catItem) {
                    var catId = catItem.getAttribute('data-category');
                    self.showCategory(catId);
                }
            });

            // Category switching (click for touch)
            menuEl.addEventListener('click', function(e) {
                var catItem = e.target.closest('.menu-category-item');
                if (catItem) {
                    var catId = catItem.getAttribute('data-category');
                    self.showCategory(catId);
                    return;
                }

                // Menu item click
                var item = e.target.closest('.menu-item');
                if (item) {
                    var href = item.getAttribute('data-href');
                    var title = item.getAttribute('data-title') || '';
                    if (href) {
                        WM.open(href, title);
                        self.hide();
                    }
                }
            });

            // ===== Touch gestures: drag to page through categories =====
            // Continuous (follow-the-finger) paging that mimics the desktop
            // hover effect: one step per 48px of travel, several steps in a
            // long drag. Vertical: down = next, up = previous. Horizontal
            // works too (left = next). The search field is excluded so
            // caret/selection keep working; desktop is untouched (touch
            // events never fire there).
            var tx = 0, ty = 0, tracking = false, acc = 0, vert = true;
            var STEP = 48;   // theme setting 'swipe_step' (read per gesture)
            menuEl.addEventListener('touchstart', function(e) {
                tracking = false;
                if (e.touches.length !== 1) return;
                if (e.target.closest && e.target.closest('.menu-search')) return;
                tx = e.touches[0].clientX; ty = e.touches[0].clientY;
                acc = 0; vert = true;
                // Read per gesture so a settings change applies immediately.
                STEP = self._readSettingNum('swipe_step', 48);
                tracking = true;
            }, { passive: true });
            menuEl.addEventListener('touchmove', function(e) {
                if (!tracking || e.touches.length !== 1) return;
                var cx = e.touches[0].clientX, cy = e.touches[0].clientY;
                var dx = cx - tx, dy = cy - ty;
                tx = cx; ty = cy;
                // One axis owns the gesture: whichever moved more overall.
                if (Math.abs(dx) > Math.abs(dy)) { vert = false; acc += dx; }
                else { vert = true; acc += dy; }
                while (true) {
                    var notch = self._swipeNotch(acc, vert, STEP);
                    if (!notch) break;
                    if (!self._swipeCategory(notch)) { acc = 0; break; }   // hit an end
                    acc -= (vert ? notch : -notch) * STEP;
                }
            }, { passive: true });
            menuEl.addEventListener('touchend', function() { tracking = false; }, { passive: true });
            menuEl.addEventListener('touchcancel', function() { tracking = false; }, { passive: true });

            // Right-click on menu item → Pin to Desktop
            menuEl.addEventListener('contextmenu', function(e) {                var item = e.target.closest('.menu-item');
                if (!item) return;
                var href = item.getAttribute('data-href');
                var title = item.getAttribute('data-title') || '';
                if (!href) return;
                e.preventDefault();
                self.showPinMenu(e.clientX, e.clientY, href, title);
            });

            // Search
            var searchInput = document.getElementById('menu-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    self.filter(this.value);
                });
            }

            // Close on outside click
            document.addEventListener('mousedown', function(e) {
                if (visible && !menuEl.contains(e.target) && e.target.id !== 'btn-start') {
                    self.hide();
                }
            });

            // Logout button
            var logoutBtn = menuEl.querySelector('.menu-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', function() {
                    if (confirm(_('Are you sure you want to logout?'))) {
                        window.top.location.href = '/cgi-bin/luci/admin/logout';
                    }
                });
            }

            // Close on Escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && visible) {
                    self.hide();
                }
            });
        },

        toggle: function() {
            if (visible) {
                this.hide();
            } else {
                this.show();
            }
        },

        show: function() {
            var menuEl = document.getElementById('start-menu');
            if (!menuEl) return;
            menuEl.style.display = '';
            visible = true;
            // Keep the panel inside the viewport whatever the taskbar
            // position or the configured height. Measured at open time:
            // a bottom taskbar anchors the panel above it, a top taskbar
            // below it, and max-height always leaves the far edge visible
            // (the fixed CSS height used to push the panel off-screen on
            // short viewports / large height settings).
            if (!(window.LuCIDesktop && LuCIDesktop.isMobile())) {
                var tb = document.getElementById('taskbar');
                var tbRect = tb ? tb.getBoundingClientRect() : null;
                var gap = 8;
                if (tbRect && tbRect.top > window.innerHeight / 2) {
                    menuEl.style.top = 'auto';
                    menuEl.style.bottom = Math.max(gap, window.innerHeight - tbRect.top + 4) + 'px';
                    menuEl.style.maxHeight = Math.max(180, tbRect.top - gap) + 'px';
                } else if (tbRect) {
                    menuEl.style.bottom = 'auto';
                    menuEl.style.top = (tbRect.bottom + 4) + 'px';
                    menuEl.style.maxHeight = Math.max(180, window.innerHeight - tbRect.bottom - gap) + 'px';
                } else {
                    menuEl.style.maxHeight = Math.max(180, window.innerHeight - gap * 2) + 'px';
                }
            }
            // Version footer (data-version on #start-menu) refreshes on open
            var verEl = menuEl.querySelector('.menu-footer-ver');
            if (verEl && window.__DESKTOP_THEME_VERSION__) {
                verEl.textContent = _('Desktop Theme v') + window.__DESKTOP_THEME_VERSION__;
            }

            // Focus search input (desktop only — on mobile the autofocus
            // pops the soft keyboard, which covers the menu)
            setTimeout(function() {
                if (window.LuCIDesktop && LuCIDesktop.isMobile()) return;
                var input = document.getElementById('menu-search-input');
                if (input) input.focus();
            }, 50);
        },

        hide: function() {
            var menuEl = document.getElementById('start-menu');
            if (!menuEl) return;
            menuEl.style.display = 'none';
            visible = false;
        },

        showPinMenu: function(x, y, url, title) {
            // Reuse the SINGLE popup-menu factory in desktop-menus.js: it
            // renders the items first, then clamps the real width AND height
            // into the viewport. This used to be a second copy of the
            // placement math — one that worked only because it happened to
            // measure after innerHTML, while the desktop menus did not.
            var make = window.LuCIDesktop && LuCIDesktop.desktopMenus && LuCIDesktop.desktopMenus._makeMenu;
            var html = '<div class="context-item" data-action="pin">' + _('Pin to Desktop') + '</div>';
            var menu;
            if (typeof make === 'function') {
                menu = make(x, y, html);
            } else {
                // Defensive only (desktop-menus.js not loaded yet): show the
                // action unclamped rather than lose it. Placement math must
                // not be duplicated here.
                menu = document.createElement('div');
                menu.className = 'context-menu';
                menu.innerHTML = html;
                menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;';
                document.body.appendChild(menu);
            }
            menu.id = 'pin-menu';

            var self = this;
            menu.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                if (act.getAttribute('data-action') === 'pin') {
                    // Prompt for display name
                    var name = prompt(_('Desktop label:'), title);
                    if (name && name.trim()) {
                        if (window.Desktop) Desktop.pinItem(url, name.trim());
                    }
                }
                menu.remove();
            });

            // Close on outside click
            setTimeout(function() {
                document.addEventListener('click', function closeMenu() {
                    if (menu.parentNode) menu.remove();
                    document.removeEventListener('click', closeMenu);
                }, {once: true});
            }, 50);
        },

        showCategory: function(catId) {
            // Highlight category in left panel
            var catItems = document.querySelectorAll('#start-menu .menu-category-item');
            catItems.forEach(function(item) {
                item.classList.toggle('active', item.getAttribute('data-category') === catId);
            });

            // Show matching panel in right side
            var panels = document.querySelectorAll('#start-menu .menu-category');
            panels.forEach(function(panel) {
                panel.style.display = panel.getAttribute('data-category') === catId ? '' : 'none';
            });
        },

        filter: function(query) {
            query = (query || '').toLowerCase();
            var items = document.querySelectorAll('#start-menu .menu-item');
            var categories = document.querySelectorAll('#start-menu .menu-category');

            items.forEach(function(item) {
                var title = (item.getAttribute('data-title') || '').toLowerCase();
                if (!query || title.indexOf(query) !== -1) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });

            // Show/hide category panels based on whether they have visible items
            categories.forEach(function(cat) {
                if (!query) {
                    // Restore: show all category panels
                    cat.style.display = '';
                    return;
                }
                var hasVisible = false;
                var catItems = cat.querySelectorAll('.menu-item');
                catItems.forEach(function(item) {
                    if (item.style.display !== 'none') hasVisible = true;
                });
                cat.style.display = hasVisible ? '' : 'none';
            });
        },

        // Numeric theme setting (range fields are stored as strings).
        _readSettingNum: function(key, def) {
            try {
                var t = LuCIDesktop.getSection('theme');
                var v = t ? parseFloat(t[key]) : NaN;
                if (!isNaN(v) && v >= 8 && v <= 400) return v;   // sane bounds
            } catch(e) {}
            return def;
        },

        _readSetting: function(key, def) {
            try {
                var t = LuCIDesktop.getSection('theme');
                if (t && t[key] !== undefined) return t[key] === '1' || t[key] === true;
            } catch(e) {}
            return def;
        }
    };

    function escapeHTML(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    DESKTOP.register('startmenu', StartMenu);
    window.StartMenu = StartMenu;
})();
