/* Desktop Theme - Taskbar
 *
 * Bottom taskbar: start button, window list, clock, system tray.
 * Listens to LuCIDesktop events for window lifecycle.
 *
 * Depends on: shell.js, wm.js
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('taskbar.js: LuCIDesktop namespace not found'); return; }

    var clockInterval = null;
    var allMinimized = false;      // track show-desktop state
    var minimizedSnapshots = [];   // window IDs that were visible before show-desktop

    var Taskbar = {
        _initialized: false,

        init: function() {
            if (this._initialized) return;
            this._initialized = true;
            this.localizeChrome();
            this.setupStartButton();
            this.setupWindowList();
            this.setupShowDesktop();
            this.setupAutoRefresh();
            this.startClock();
            this.bindEvents();
        },

        // Localize static taskbar tooltips (header.ut title attributes are
        // server-rendered; the theme's i18n is client-side).
        localizeChrome: function() {
            var ids = { 'btn-home': 'Home', 'btn-switcher': 'Recent Apps', 'btn-notifications': 'Notifications' };
            for (var id in ids) {
                var el = document.getElementById(id);
                if (el) el.title = _(ids[id]);
            }
        },

        setupAutoRefresh: function() {
            var btn = document.getElementById('btn-auto-refresh');
            if (!btn) return;

            // Read initial state from config
            var on = this._readAutoRefresh();
            this._setToggleState(btn, on);

            var self = this;
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOn = !btn.classList.contains('on');
                self._setToggleState(btn, isOn);
                self._saveAutoRefresh(isOn);
                // TODO: emit event to control XHR polling in iframes
                DESKTOP.emit('auto-refresh-toggled', {on: isOn});
            });
        },

        _setToggleState: function(btn, on) {
            btn.classList.toggle('on', on);
            btn.title = on ? _('Auto Refresh: ON') : _('Auto Refresh: OFF');
        },

        // SESSION-LEVEL switch (user decision 2026-08-16): auto-refresh is
        // NOT persisted — every page load starts ON (the default), a
        // temporary toggle only affects the current session (broadcast to
        // open iframes). F5/reload always restores ON. No UCI write, no
        // direct broadcast here — the emit below drives the single
        // broadcast (see auto-refresh-toggled listener in bindEvents).
        _readAutoRefresh: function() {
            return true;
        },

        _saveAutoRefresh: function(on) {
            // Session-level: nothing to persist. The click handler emits
            // auto-refresh-toggled, which bindEvents forwards to iframes.
        },

        setupStartButton: function() {
            var btn = document.getElementById('btn-start');
            if (!btn || btn._desktopBound) return;
            btn._desktopBound = true;
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (DESKTOP.subsystems['startmenu']) {
                    DESKTOP.subsystems['startmenu'].toggle();
                }
            });
        },

        setupShowDesktop: function() {
            var self = this;
            var btn = document.getElementById('btn-show-desktop');
            if (!btn) return;
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (allMinimized) {
                    self.restoreAll();
                } else {
                    self.showDesktop();
                }
            });
        },

        showDesktop: function() {
            minimizedSnapshots = [];
            var ids = Object.keys(DESKTOP.windows);
            for (var i = 0; i < ids.length; i++) {
                var w = DESKTOP.windows[ids[i]];
                if (w && !w.minimized) {
                    minimizedSnapshots.push(ids[i]);
                }
            }
            for (var j = 0; j < minimizedSnapshots.length; j++) {
                WM.minimize(minimizedSnapshots[j]);
            }
            allMinimized = true;
        },

        restoreAll: function() {
            for (var i = 0; i < minimizedSnapshots.length; i++) {
                WM.restore(minimizedSnapshots[i]);
            }
            minimizedSnapshots = [];
            allMinimized = false;
        },

        setupWindowList: function() {
            var list = document.getElementById('taskbar-windows');
            if (!list) return;
            list.addEventListener('click', function(e) {
                var btn = e.target.closest('.taskbar-window-btn');
                if (!btn) return;
                var winId = btn.getAttribute('data-window-id');
                if (!winId) return;

                // Click on active window = minimize; inactive = focus
                if (DESKTOP.activeWindowId === winId) {
                    WM.minimize(winId);
                } else {
                    var w = DESKTOP.windows[winId];
                    if (w && w.minimized) {
                        WM.restore(winId);
                    } else {
                        WM.focus(winId);
                    }
                }
            });

            // Right-click context menu on window buttons
            list.addEventListener('contextmenu', function(e) {
                var btn = e.target.closest('.taskbar-window-btn');
                if (!btn) return;
                e.preventDefault();
                var winId = btn.getAttribute('data-window-id');
                if (winId) {
                    // Simple: right-click closes
                    WM.close(winId);
                }
            });
        },

        startClock: function() {
            var clockEl = document.getElementById('taskbar-clock');
            if (!clockEl) return;

            var update = function() {
                var now = new Date();
                var h = now.getHours().toString().padStart(2, '0');
                var m = now.getMinutes().toString().padStart(2, '0');
                clockEl.textContent = h + ':' + m;
            };
            update();
            clockInterval = setInterval(update, 30000);
        },

        // Listen to window lifecycle events
        bindEvents: function() {
            var self = this;

            DESKTOP.on('window-opened', function(data) {
                allMinimized = false;  // new window = not all minimized
                self.addWindowButton(data.id, data.title);
            });

            DESKTOP.on('window-closed', function(data) {
                self.removeWindowButton(data.id);
            });

            DESKTOP.on('window-focused', function(data) {
                self.setActiveWindow(data.id);
            });

            DESKTOP.on('window-minimized', function(data) {
                self.setMinimized(data.id, true);
            });

            DESKTOP.on('window-restored', function(data) {
                self.setMinimized(data.id, false);
            });

            DESKTOP.on('window-title-changed', function(data) {
                self.updateWindowTitle(data.id, data.title);
            });

            // Auto-refresh toggle: broadcast to all open iframes via bridge
            DESKTOP.on('auto-refresh-toggled', function(data) {
                if (window.IframeBridge && IframeBridge.broadcastAutoRefresh) {
                    IframeBridge.broadcastAutoRefresh(data.on);
                }
            });
        },

        addWindowButton: function(winId, title) {
            var list = document.getElementById('taskbar-windows');
            if (!list) return;

            var btn = document.createElement('button');
            btn.className = 'taskbar-window-btn';
            btn.setAttribute('data-window-id', winId);
            btn.setAttribute('title', title);
            // Truncate title
            if (title.length > 25) {
                title = title.substring(0, 23) + '..';
            }
            btn.textContent = title || _('Window');
            list.appendChild(btn);
        },

        removeWindowButton: function(winId) {
            var btn = document.querySelector('.taskbar-window-btn[data-window-id="' + winId + '"]');
            if (btn) btn.remove();
        },

        setActiveWindow: function(winId) {
            var buttons = document.querySelectorAll('.taskbar-window-btn');
            buttons.forEach(function(b) {
                b.classList.remove('active');
            });
            var activeBtn = document.querySelector('.taskbar-window-btn[data-window-id="' + winId + '"]');
            if (activeBtn) activeBtn.classList.add('active');
        },

        setMinimized: function(winId, minimized) {
            var btn = document.querySelector('.taskbar-window-btn[data-window-id="' + winId + '"]');
            if (btn) {
                btn.classList.toggle('minimized', minimized);
            }
        },

        updateWindowTitle: function(winId, title) {
            var btn = document.querySelector('.taskbar-window-btn[data-window-id="' + winId + '"]');
            if (btn) {
                if (title.length > 25) title = title.substring(0, 23) + '..';
                btn.textContent = title;
                btn.setAttribute('title', title);
            }
        }
    };

    DESKTOP.register('taskbar', Taskbar);
    window.Taskbar = Taskbar;
})();
