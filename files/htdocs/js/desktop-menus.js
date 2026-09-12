/* Desktop Theme - Desktop context menus + custom link dialog
 *
 * The three right-click menus (default icon / pinned icon / desktop) and
 * the Add/Edit Link dialog. All actions call back into the public
 * window.Desktop API, so the menus stay decoupled from the icon renderer
 * and the custom-URL helpers.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('desktop-menus.js: LuCIDesktop namespace not found'); return; }
    var State = DESKTOP.desktopState;

    // Keep this much empty space between the menu and the viewport edge
    // (covers the border + drop shadow so the menu never looks clipped).
    var MENU_MARGIN = 6;

    // Clamp an ALREADY-RENDERED menu into the viewport on BOTH axes.
    //
    // offsetWidth/offsetHeight (not getBoundingClientRect) are used because
    // the layout size is what we position against: .context-menu has an
    // entrance animation (scale 0.95 -> 1), and a rect measured mid-animation
    // is ~5% too small, which would let the final (unscaled) menu poke past
    // the edge again.
    //
    // The menu must contain its items before this runs: an empty
    // .context-menu measures 0x0 in the test shell (and ~min-width x 10px in
    // production), so every "does it fit?" test is false and the clamp
    // silently no-ops — that was the right/bottom clipping bug.
    function _placeMenu(menu, x, y) {
        var vw = window.innerWidth || document.documentElement.clientWidth || 0;
        var vh = window.innerHeight || document.documentElement.clientHeight || 0;
        var w = menu.offsetWidth;
        var h = menu.offsetHeight;

        // Open at the click, then hug the far edge when it would overflow.
        // A menu WIDER/TALLER than the viewport is pinned to the top/left
        // margin (never a negative coordinate).
        var left = x;
        if (left + w > vw - MENU_MARGIN) left = vw - w - MENU_MARGIN;
        if (left < MENU_MARGIN) left = MENU_MARGIN;

        var top = y;
        if (top + h > vh - MENU_MARGIN) top = vh - h - MENU_MARGIN;
        if (top < MENU_MARGIN) top = MENU_MARGIN;

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        // Taller than the viewport: pin to the top and make it scroll
        // instead of running off the bottom. max-height/overflow are only
        // applied in this extreme case, so a normal menu never becomes a
        // clipping container for its absolutely-positioned submenu.
        if (h + MENU_MARGIN * 2 > vh) {
            menu.style.maxHeight = Math.max(0, vh - MENU_MARGIN * 2) + 'px';
            menu.style.overflowY = 'auto';
        }
    }

    // SINGLE entry point for every popup menu (desktop / pinned icon /
    // default icon / Start-Menu "Pin to Desktop"): create it, render the
    // caller's HTML, append, then clamp. Callers that inject content after
    // this returns reintroduce the off-screen bug.
    function _makeMenu(x, y, html) {
        document.querySelectorAll('#desktop-context-menu, #icon-context-menu, #pin-menu')
            .forEach(function(m) { m.remove(); });
        var menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = html || '';
        menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;';
        document.body.appendChild(menu);
        _placeMenu(menu, x, y);
        return menu;
    }

    var menus = {
        // The one popup-menu factory (create + render + viewport clamp).
        // Exposed so startmenu.js's Pin-to-Desktop menu reuses it instead of
        // keeping a second, drifting copy of the placement math.
        _makeMenu: _makeMenu,

        _showDefaultIconMenu: function(x, y, url, title, iconEl) {
            var installable = iconEl && iconEl.classList.contains('installable');
            var html = '';
            if (!installable) {
                html += '<div class="context-item" data-act="open">' + _('Open') + '</div>';
            } else {
                // Not installed: offer Install instead of Open (Open would 404)
                html += '<div class="context-item" data-act="install">' + _('Install') + '</div>';
            }
            html += '<div class="context-item" data-act="changeicon">' + _('Change Icon') + '</div>';
            if (State.layout()[url] && State.layout()[url].icon) {
                html += '<div class="context-item" data-act="reseticon">' + _('Reset Icon') + '</div>';
            }
            html += '<div class="context-item" data-act="hide">' + _('Hide') + '</div>';
            var m = _makeMenu(x, y, html);
            m.id = 'icon-context-menu';
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
                    var layout = State.layout();
                    if (layout[url]) { delete layout[url].icon; State.saveIconLayout(); }
                    Desktop.renderShortcuts();
                } else if (a === 'hide') {
                    if (confirm(_('Hide this icon?'))) {
                        iconEl.style.display = 'none';
                        State.hidden().push(url);
                        State.saveHidden();
                    }
                }
                m.remove();
            });
        },

        _showIconMenu: function(x, y, pinned) {
            var m = _makeMenu(x, y,
                '<div class="context-item" data-act="open">' + _('Open') + '</div>' +
                '<div class="context-item" data-act="changeicon">' + _('Change Icon') + '</div>' +
                (State.layout()[pinned.url] && State.layout()[pinned.url].icon ? '<div class="context-item" data-act="reseticon">' + _('Reset Icon') + '</div>' : '') +
                '<div class="context-item" data-act="rename">' + _('Rename') + '</div>' +
                (pinned.custom ? '<div class="context-item" data-act="editlink">' + _('Edit Link') + '</div>' : '') +
                '<div class="context-separator"></div>' +
                '<div class="context-item" data-act="unpin">' + _('Unpin') + '</div>');
            m.id = 'icon-context-menu';
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
                    var layout = State.layout();
                    if (layout[pinned.url]) { delete layout[pinned.url].icon; State.saveIconLayout(); }
                    Desktop.renderShortcuts();
                } else if (a === 'rename') {
                    var name = prompt(_('New name:'), pinned.title);
                    if (name && name.trim()) { pinned.title = name.trim(); State.savePins(); Desktop.renderShortcuts(); }
                } else if (a === 'unpin') {
                    Desktop.unpinItem(pinned.url);
                }
                m.remove();
            });
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
                            _('{router} = the host name you are using now, {httpx} = http or https, {port} = this port, {origin} = scheme://host:port. Example: {httpx}://{router}:3000') +
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

        // Place a context submenu: it opens to the right of its row, but
        // flips to the LEFT when that would run off the screen (the menu is
        // usually opened near an edge). The flyout is laid out but
        // visibility:hidden in CSS, so it is measurable as-is; forcing
        // display/visibility here keeps that true even if the stylesheet
        // failed to load (a display:none box has no size).
        _placeSubmenu: function(parent) {
            if (!parent || !parent.querySelector) return;
            var sub = parent.querySelector('.context-submenu');
            if (!sub) return;
            var rect = parent.getBoundingClientRect();
            var prevVis = sub.style.visibility, prevDisp = sub.style.display;
            sub.style.visibility = 'hidden';
            sub.style.display = 'block';
            var w = sub.offsetWidth || 120;
            sub.style.display = prevDisp;
            sub.style.visibility = prevVis;
            parent.classList.toggle('sub-left', rect.right + w + 8 > window.innerWidth);
        },

        // Order (0.1.0-234, user-specified): settings first (theme/widgets),
        // then a single separator, then the actions (new/rearrange/refresh).
        _showDesktopMenu: function(x, y) {
            var m = _makeMenu(x, y,
                '<div class="context-item" data-act="theme">' + _('Theme') + '</div>' +
                '<div class="context-item" data-act="widgets">' + _('Widgets') + '</div>' +
                '<div class="context-separator"></div>' +
                '<div class="context-item context-has-sub" data-act="new">' + _('New') +
                    '<span class="context-arrow">&#8250;</span>' +
                    '<div class="context-submenu">' +
                        '<div class="context-item" data-act="addlink">' + _('Link') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="context-item" data-act="rearrange">' + _('Rearrange Icons') + '</div>' +
                '<div class="context-item" data-act="refresh">' + _('Refresh') + '</div>');
            m.id = 'desktop-context-menu';
            m.addEventListener('mouseenter', function(e) {
                var row = e.target.closest && e.target.closest('.context-has-sub');
                if (row) Desktop._placeSubmenu(row);
            }, true);
            m.addEventListener('click', function(e) {
                var act = e.target.closest('.context-item');
                if (!act) return;
                var a = act.getAttribute('data-act');
                if (a === 'new') {
                    // Touch has no hover — tapping the parent opens the
                    // submenu (and keeps the menu itself open).
                    Desktop._placeSubmenu(act);
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
        }
    };

    DESKTOP.desktopMenus = menus;
})();
