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
            this.setupTaskMgr();
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

        // Tray entry for the Task Manager via the extensible TrayManager
        // API (0.1.0-275; replaces the desktop-context-menu entry of 274).
        // Desktop = Windows-style corner overflow chevron (0.1.0-278);
        // mobile = a first-class tray icon, never tucked behind the small
        // chevron (user request 2026-11-04: on a phone the manager must be
        // one tap away, so it shows directly in the tray bar).
        // Waits for the tray module when it has not evaluated yet (the
        // real page loads taskbar.js before tray.js — deferred retry,
        // 0.1.0-277); graceful no-op when the window manager is absent.
        setupTaskMgr: function() {
            // DESKTOP.register(name, impl) only fills the subsystems map —
            // it never exposes a DESKTOP.<name> property. tray.js mirrors
            // the manager on window.TrayManager; that mirror is the
            // cross-module access path.
            var trayMgr = window.TrayManager;
            if (!trayMgr || !trayMgr.register || !trayMgr.enable || !window.WM) {
                // Production load order: taskbar.js evals BEFORE tray.js
                // (header.htm script list), and DESKTOP.register runs
                // init() right at eval time, so window.TrayManager is
                // still missing here — the 0.1.0-276 button never appeared
                // on real devices. Defer to a moment after every script
                // has evaluated; the installed guard below keeps the
                // retry idempotent (0.1.0-277).
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', function() {
                        Taskbar.setupTaskMgr();
                    }, {once: true});
                } else {
                    setTimeout(function() { Taskbar.setupTaskMgr(); }, 0);
                }
                return;
            }
            // Mobile: the task manager entry lives in the switcher header
            // next to the notifications bell (0.1.0-299). Keeping a second
            // tray icon here made the phone taskbar four buttons wide, which
            // the user rejected — so the tray entry is desktop-only.
            if (Taskbar.isMobileLayout()) {
                Taskbar.watchMobileLayout();
                return;
            }
            if (trayMgr.items.taskmgr) return;
            trayMgr.register({
                id: 'taskmgr',
                // the render API sets textContent; the SVG swaps in below
                icon: '',
                tooltip: _('Task Manager'),
                onClick: function() {
                    window.WM.open('/cgi-bin/luci/admin/desktop/taskmgr', _('Task Manager'));
                },
                order: 10,
                // desktop: Windows-style, tucked behind the tray chevron
                overflow: true
            });
            trayMgr.enable('taskmgr');
            Taskbar.paintTaskMgrIcon();
            Taskbar.watchMobileLayout();
        },

        // Same verdict as LuCIDesktop.isMobile(), without depending on
        // shell.js having evaluated first; 768px matches the CSS breakpoint.
        isMobileLayout: function() {
            if (window.LuCIDesktop && window.LuCIDesktop.isMobile) {
                return !!window.LuCIDesktop.isMobile();
            }
            return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        },

        paintTaskMgrIcon: function() {
            var trayMgr = window.TrayManager;
            var el = trayMgr && trayMgr.items && trayMgr.items.taskmgr && trayMgr.items.taskmgr.el;
            if (!el || !el.querySelector) return;
            var ic = el.querySelector('.tray-item-icon');
            if (!ic) return;
            ic.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">'
                + '<rect x="2" y="2" width="12" height="12" rx="2.2" stroke="currentColor" stroke-width="1.5"/>'
                + '<path d="M4.4 9.6l1.9-2.9 1.7 3.6 1.5-4.6 1.2 2.7h1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
                + '</svg>';
        },

        // Rotation / resize across the 768px breakpoint adds or removes the
        // desktop tray entry (mobile keeps the switcher-header entry only).
        watchMobileLayout: function() {
            if (Taskbar._layoutMq) return;
            var mq = window.matchMedia && window.matchMedia('(max-width: 768px)');
            if (!mq || !mq.addEventListener) return;
            Taskbar._layoutMq = mq;
            mq.addEventListener('change', function() {
                var trayMgr = window.TrayManager;
                if (!trayMgr) return;
                if (Taskbar.isMobileLayout()) {
                    if (trayMgr.items.taskmgr) trayMgr.disable('taskmgr');
                    return;
                }
                if (!trayMgr.items.taskmgr) {
                    Taskbar.setupTaskMgr();
                    return;
                }
                var def = trayMgr.registry.taskmgr;
                if (def && !def.overflow) {
                    def.overflow = true;
                    trayMgr.disable('taskmgr');
                    trayMgr.enable('taskmgr');
                    Taskbar.paintTaskMgrIcon();
                }
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

            // Right-click on a window button: close that window
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

            // Right-click on the empty taskbar surface: inert since
            // 0.1.0-274 — the Task Manager entry lives in the desktop
            // context menu now. Window buttons keep their individual
            // close-on-right-click above; the browser's own menu stays
            // suppressed on the taskbar surface.
            var bar = document.getElementById('taskbar');
            if (bar) bar.addEventListener('contextmenu', function(e) {
                if (e.target.closest('.taskbar-window-btn')) return;
                e.preventDefault();
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

            // Pinned windows keep their tab at the FRONT of the taskbar —
            // re-sort so the pinned tabs always lead the list.
            DESKTOP.on('window-pinned', function() {
                self.renderWindowButtons();
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
            // A pinned window already open keeps its tab in front
            this.renderWindowButtons();
        },

        // Sort taskbar tabs: pinned windows first (in pin order), then the
        // normal windows in open order. Stable sort keeps both groups in
        // their existing DOM order.
        renderWindowButtons: function() {
            var list = document.getElementById('taskbar-windows');
            if (!list) return;
            var btns = Array.prototype.slice.call(list.querySelectorAll('.taskbar-window-btn'));
            if (btns.length < 2) return;
            btns.sort(function(a, b) {
                var wa = DESKTOP.windows && DESKTOP.windows[a.getAttribute('data-window-id')];
                var wb = DESKTOP.windows && DESKTOP.windows[b.getAttribute('data-window-id')];
                var pa = !!(wa && wa.pinned);
                var pb = !!(wb && wb.pinned);
                return (pb ? 1 : 0) - (pa ? 1 : 0);
            });
            var frag = document.createDocumentFragment();
            btns.forEach(function(b) { frag.appendChild(b); });
            list.appendChild(frag);
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
