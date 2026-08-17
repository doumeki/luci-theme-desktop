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
                html += '<div class="menu-category-item' + (i === 0 ? ' active' : '') + '" data-category="' + cat.id + '">';
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
                '<button class="menu-logout-btn" title="' + _('Logout') + '">' + _('Exit') + '</button>' +
                '</div>';

            menuEl.innerHTML = html;
        },

        bindEvents: function() {
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

            // Right-click on menu item → Pin to Desktop
            menuEl.addEventListener('contextmenu', function(e) {
                var item = e.target.closest('.menu-item');
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
            // Remove existing
            var existing = document.getElementById('pin-menu');
            if (existing) existing.remove();

            var menu = document.createElement('div');
            menu.id = 'pin-menu';
            menu.className = 'context-menu';
            menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;';
            menu.innerHTML =
                '<div class="context-item" data-action="pin">' + _('Pin to Desktop') + '</div>';
            document.body.appendChild(menu);
            // Clamp inside the viewport (long-press near the edge)
            var r = menu.getBoundingClientRect();
            if (r.right > window.innerWidth) {
                menu.style.left = Math.max(4, window.innerWidth - r.width - 4) + 'px';
            }
            if (r.bottom > window.innerHeight) {
                menu.style.top = Math.max(4, window.innerHeight - r.height - 4) + 'px';
            }

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
