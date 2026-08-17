/* Desktop Theme - Shell namespace
 * Global namespace, event system, and boot sequence.
 *
 * This file MUST load first (before any other desktop JS modules).
 */
window.LuCIDesktop = (function() {
    'use strict';

    var listeners = {};

    var self = {
        windows: {},
        nextZIndex: 100,
        nextWindowId: 1,
        activeWindowId: null,
        subsystems: {},
        dragging: null,
        resizing: null
    };

    // ===== Notification registry (categories + per-notice suppression) =====
    // key → { category: 'system'|'theme'|'feedback', suppressible, label }
    // suppressible notices get a "Do not show again" checkbox on the toast
    // (per-key, permanent — restore by deleting the localStorage key in
    // devtools; the settings panel tab was removed 2026-08 as unnecessary).
    // Each suppressible notice is toggled SEPARATELY (per key — not per
    // category). System warnings (changes/password) are never suppressible;
    // feedback toasts (duration>0) auto-dismiss and need no toggle.
    self.notificationRegistry = {
        'password':             { category: 'system', suppressible: false },
        'changes':              { category: 'system', suppressible: false },
        'platform-compat':      { category: 'theme', suppressible: true,  label: _('Platform compatibility warnings') },
        'wp-refresh-failed':    { category: 'theme', suppressible: true,  label: _('Wallpaper refresh failed') },
        'wp-picsum-unreachable':{ category: 'theme', suppressible: true,  label: _('Picsum unreachable') },
        'wp-saved':             { category: 'theme', suppressible: true,  label: _('Wallpaper saved to built-in') },
        'widget-max':           { category: 'theme', suppressible: true,  label: _('Max instances warning') }
    };

    // Mobile detection: the server's UA verdict (footer.htm) is
    // authoritative; without it (embed mode, dev, tests) fall back to
    // narrow viewport OR touch-only device. A touchscreen laptop / AIO
    // reports (pointer: coarse) but ALSO (pointer: fine) when a mouse is
    // present — that combination must stay desktop (theme-compat-doc B2，记忆库).
    self.isMobile = function() {
        if (window.__IS_MOBILE__ === true) return true;
        return window.matchMedia &&
            (window.matchMedia('(max-width: 768px)').matches ||
             (window.matchMedia('(pointer: coarse)').matches &&
              !window.matchMedia('(pointer: fine)').matches));
    };

    // Fire-and-forget server log (controller action_log → /var/log/desktop-ui.log).
    // Used for boot platform diagnostics — silent if no backend (file:// dev).
    self.log = function(msg) {
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/cgi-bin/luci/admin/desktop/log?lines=' +
                   encodeURIComponent('[theme] ' + msg + '\n'), true);
            x.send();
        } catch(e) {}
    };

    // Boot probe: fetch platform capabilities once per session. Degraded
    // dependencies (theme-compat-doc Part A，记忆库) get one toast notification;
    // the full picture goes to the server log for post-release debugging.
    self.probePlatform = function() {
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/cgi-bin/luci/admin/desktop/platform', true);
            x.onload = function() {
                var p;
                try { p = JSON.parse(x.responseText); } catch(e) { return; }
                if (!p || typeof p !== 'object') return;
                self._platform = p;
                var warns = [];
                if (p.dmidecode === false) warns.push(_('Physical RAM shown as estimate (dmidecode missing)'));
                if (p.curl === false) warns.push(_('Online wallpaper unavailable (curl missing)'));
                if (p.top_cpu_ok === false) warns.push(_('CPU usage may be inaccurate on this build'));
                // Keep the warning text for the bell's manual review —
                // even after the user permanently dismisses the toast,
                // clicking the bell must be able to re-show it.
                self._platformWarns = warns;
                if (warns.length && window.TrayManager && TrayManager.notify) {
                    // suppressible: theme-level notice — the toast carries a
                    // per-key "Do not show again" checkbox (legacy ✕-dismissal
                    // key still respected by TrayManager.isSuppressed).
                    TrayManager.notify(warns.join('；'), {
                        type: 'warn',
                        title: _('Platform compatibility'),
                        icon: '⚠️',
                        key: 'platform-compat',
                        suppressible: true
                    });
                }
                self.log('[platform] ver=' + (p.version || 'unknown') +
                    ' arch=' + (p.arch || 'unknown') +
                    ' ua=' + (navigator.userAgent || '').replace(/\s+/g, ' ').substring(0, 120) +
                    ' mobile=' + (self.isMobile() ? 1 : 0) +
                    ' dmidecode=' + (p.dmidecode ? 1 : 0) +
                    ' curl=' + (p.curl ? 1 : 0) +
                    ' thermal=' + (p.thermal_zones !== undefined ? p.thermal_zones : '?') +
                    ' top_ok=' + (p.top_cpu_ok ? 1 : 0));
            };
            x.send();
        } catch(e) {}
    };

    // Simple event emitter
    self.on = function(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
    };

    self.emit = function(event, data) {
        var fns = listeners[event];
        if (fns) {
            fns.forEach(function(fn) { fn(data); });
        }
    };

    // Register a subsystem module
    self.register = function(name, impl) {
        self.subsystems[name] = impl;
        if (impl.init && typeof impl.init === 'function') {
            impl.init();
        }
    };

    // ucode-only LuCI: detect a dead theme controller and guide the user
    // to install luci-lua-runtime. The theme controller is Lua; on official
    // OpenWrt 25.x the ucode dispatcher only loads it via luci-lua-runtime —
    // when that package is missing, /admin/desktop/* responds with HTML
    // (404/login) instead of JSON and the theme API silently fails. There
    // is no ucode-side endpoint we could add (ucode LuCI has no entry()
    // routing), so we detect by probing the Lua endpoint and show the
    // install command. Lua-runtime devices skip this entirely.
    self._checkLuaRuntime = function() {
        if (window.__LUCI_RUNTIME__ !== 'ucode') return;
        if (document.getElementById('lua-runtime-banner')) return;
        // theme API probe: expects {"count":...} JSON from the Lua controller
        fetch('/cgi-bin/luci/admin/desktop/uci_changes', { credentials: 'same-origin' })
            .then(function(r) {
                return r.json().then(function(j) { return j && typeof j.count !== 'undefined'; })
                    .catch(function() { return false; });
            })
            .then(function(ok) {
                if (!ok) self._showLuaRuntimeBanner();
            })
            .catch(function() { /* unreachable — leave it */ });
    };

    self._showLuaRuntimeBanner = function() {
        var banner = document.createElement('div');
        banner.id = 'lua-runtime-banner';
        banner.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#f39c12;color:#000;font-size:13px;' +
            'padding:8px 14px;display:flex;align-items:center;gap:10px;' +
            'flex-wrap:wrap;font-family:monospace;';
        var text = document.createElement('span');
        text.textContent = _('Missing luci-lua-runtime — install to enable theme features') + ' ';
        var cmd = document.createElement('code');
        cmd.style.cssText = 'background:rgba(0,0,0,0.15);padding:2px 8px;border-radius:4px;';
        cmd.textContent = 'apk add --allow-untrusted luci-lua-runtime  # or: opkg install luci-lua-runtime';
        var hint = document.createElement('span');
        hint.textContent = _('then refresh');
        var btn = document.createElement('button');
        btn.textContent = _('Refresh');
        btn.style.cssText =
            'background:#000;color:#f39c12;border:none;border-radius:4px;' +
            'padding:4px 14px;font-size:12px;cursor:pointer;';
        btn.addEventListener('click', function() { location.reload(); });
        banner.appendChild(text);
        banner.appendChild(cmd);
        banner.appendChild(hint);
        banner.appendChild(btn);
        document.body.appendChild(banner);
    };

    // Boot sequence: called from footer.htm after all JS loaded
    self.boot = function() {
        document.documentElement.classList.add('desktop-ready');
        // Clear any drag overlay / disabled iframes left by an interrupted drag
        if (self.hideDragOverlay) self.hideDragOverlay();
        // Apply theme defaults, merge any saved values on top — no dependency on CSS :root
        if (window.ThemeConfig) {
            ThemeConfig.applyCss(ThemeConfig.mergeDefaults(ThemeConfig.readFromConfig()));
        }
        // WidgetManager registers are done, now load saved config
        if (window.WidgetManager && WidgetManager._loadAll) {
            WidgetManager._loadAll();
        }
        // Re-probe default shortcuts NOW: __LUCI_RUNTIME__ was injected by
        // the footer immediately before boot(), but Desktop.init ran at
        // module registration (before the injection) — the terminal's
        // runtime-dependent URL was resolved wrongly there (ucode runtime
        // fell back to the Lua path, so a missing ttyd was never hidden;
        // bugfix 2026-08-16, 1.1 ImmortalWrt). Re-running with the real
        // runtime probes the correct URL. probeDefaultShortcuts is
        // idempotent (fetch + _unavailable map) and skips registered URLs.
        if (window.Desktop && Desktop.probeDefaultShortcuts) {
            Desktop.probeDefaultShortcuts();
        }
        // Lua-runtime bootstrap check (official OpenWrt 25.x): no-op when
        // luci-lua-runtime is present or on Lua-runtime devices.
        self._checkLuaRuntime();
        // Detect new session (login) vs same-session refresh (F5/Ctrl+R)
        self._isNewSession = !sessionStorage.getItem('_desktop_sid');
        if (self._isNewSession) sessionStorage.setItem('_desktop_sid', '1');
        console.log('[boot] ' + (self._isNewSession ? 'new session (login)' : 'page refresh (F5)'));
        // Apply desktop wallpaper image (fast path: cached URL only, no XHR)
        self._applyWallpaper({forceRefresh: false});
        // 登录后静默检查新图（有新图才换，失败保持旧图）；F5 永不刷新——
        // 设计规则：bing 登录用新图，F5 优先旧图（bg-refresh 的 XHR 随
        // 页面卸载而中止，F5 后的页面只读 UCI 里最后确认的 URL）。
        if (self._isNewSession) self._backgroundRefresh();
        // Register keyboard shortcuts
        self._initKeyboard();
        // Handle ?app= URL parameter
        self._handleAppParam();
        // Direct visit to a non-landing page: the header injected the
        // target path — open it as an app window (desktop AND mobile).
        self._openBootApp();
        // Tray indicators: unsaved UCI changes + root password warning
        self._initUciIndicator();

        // Platform probe: alert on degraded capabilities, log for debugging
        // (once per session — _platformProbed guards it)
        if (!self._platformProbed) {
            self._platformProbed = true;
            setTimeout(self.probePlatform, 500);
        }



    // Toast events from any subsystem → Win10-style notifications.
    // duration 0 (default) = stays until dismissed; pass a positive
    // value for transient feedback (download progress etc).
    // Theme-level persistent notices (registry suppressible && no duration)
    // get a per-key "Do not show again" checkbox; feedback toasts
    // (duration>0) and system warnings never do.
    self.on('toast', function(d) {
        if (!d || !d.msg || !window.TrayManager) return;
        var reg = (d.key && self.notificationRegistry && self.notificationRegistry[d.key]) || null;
        var persistent = !(typeof d.duration === 'number' && d.duration > 0);
        TrayManager.notify(d.msg, {
            type: d.type || 'info',
            duration: (typeof d.duration === 'number') ? d.duration : 0,
            key: d.key || undefined,
            suppressible: !!(reg && reg.suppressible && persistent)
        });
    });
    };

    // Poll server for uncommitted UCI changes and root password state.
    // The tray bell icon shows a count badge/highlight; notifications
    // pop actively: on new uncommitted changes, after save/apply
    // (count → 0), and once per session when root has no password.
    // Clicking the bell re-pops the current toasts for review.
    self._initUciIndicator = function() {
        var btn = document.getElementById('btn-notifications');
        if (!btn) return;

        var _count = 0;
        var _noPw = false;
        var _prevCount = 0;
        var _changesNotified = false;   // notify once per uncommitted batch
        var _pwNotified = false;        // notify once per session
        var _lastSubmitType = null;     // 'save' | 'apply' | 'revert' (from app-save msg)

        // The "View" action opens a dedicated changes window — the official
        // uci-changes modal can only open inside a live LuCI page, which is
        // invisible when no app window is focused. /admin/desktop/changes is
        // a self-contained page (controller/desktop.lua) with Apply/Revert
        // buttons; WM.open is single-instance per URL, so repeated clicks
        // just focus the existing window.
        var sendShowChanges = function() {
            WM.open('/cgi-bin/luci/admin/desktop/changes', _('Unsaved Changes'));
        };

        // force: bell clicks are an explicit "show me my notifications" —
        // re-pop even when a copy is already on screen (TrayManager
        // dismisses the old one first). Passive triggers (boot, state
        // transitions) stay deduped. NOTE: force does NOT bypass per-notice
        // suppression — "Do not show again" is permanent (2026-08).
        var notifyChanges = function(force) {
            if (window.TrayManager) {
                TrayManager.notify(_('Unsaved Changes') + ': ' + _count,
                    { title: _('Unsaved Changes'), icon: '⚙️', type: 'warn',
                      key: 'changes', force: force,  // no duration: stays until dismissed
                      action: { label: _('View'), onClick: function() {
                          sendShowChanges();
                      } } });
            }
        };
        // ===== Notification categories (toast suppression model) =====
        // key 即类别；可抑制项 = toast 内 "Do not show again" checkbox（per-key，
        // 永久——bell force 不绕过，恢复 = devtools 删 localStorage key）:
        //   security (password)      → 系统级，不可抑制（每次会话必弹）
        //   changes (changes)        → 系统级，不可抑制（核心功能）
        //   platform (platform-compat) → 主题级，可抑制（per-key checkbox）
        //   event (emit('toast') 常驻) → 主题级，可抑制（per-key checkbox）
        //   feedback (duration>0)    → 自动消失，不抑制
        var notifyPassword = function(force) {
            if (window.TrayManager) {
                TrayManager.notify(_('No password set!'),
                    { title: _('Security'), icon: '⚠️', type: 'error',
                      key: 'password', force: force,  // no duration: stays until dismissed
                      action: { label: _('Set password'), onClick: function() {
                          WM.open('/cgi-bin/luci/admin/system/admin', _('Password'));
                      } } });
            }
        };

        // Badge number shared by the desktop bell and the mobile
        // app-switcher bell: max(on-screen toast count, unsaved-changes
        // count). Toasts give the bell its "N notifications" number; the
        // changes count rides along so replaying one changes toast (bell
        // click) doesn't drop the badge from 5 to 1. With a clear screen
        // it shows the changes count alone.
        self.notificationCount = function() {
            var toasts = document.querySelectorAll('.desktop-toast:not(.toast-hiding)').length;
            return toasts > _count ? toasts : _count;
        };

        var updateBtn = function() {
            btn.classList.toggle('has-changes', _count > 0);
            btn.classList.toggle('has-warning', _noPw);
            var badge = document.getElementById('btn-notifications-badge');
            if (badge) {
                var n = self.notificationCount();
                badge.textContent = n > 0 ? String(n) : '';
                badge.hidden = n === 0;
            }
            var t = [];
            if (_count > 0) t.push(_('Unsaved Changes') + ': ' + _count);
            if (_noPw) t.push(_('No password set!'));
            btn.title = t.join(' · ') || _('Notifications');
        };

        // Bell = toggle, Windows notification-center style: if any toast is
        // on screen, one click closes them all (the badge falls back to the
        // uncommitted-changes count — the orange glow still advertises
        // pending work); otherwise the current notifications pop for
        // review. force=true keeps a permanent-dismissed compat warning
        // re-showable via the bell.
        // Replay the current notifications (desktop bell + mobile
        // app-switcher bell). Desktop bell = Win10-style toggle: with toasts
        // on screen one click closes them all; otherwise the pending
        // changes / no-password / platform warnings re-pop for review.
        // forceReview (mobile switcher bell — the ONLY notification entry on
        // mobile, the tray bell is hidden there) = ALWAYS review: re-pop
        // forcibly instead of closing, so the toasts the user came to read
        // never just vanish (bugfix 2026-08-15: first tap hid the stale
        // on-screen toast and showed nothing — "notification closes too
        // fast, need a second tap").
        self.replayNotifications = function(forceReview) {
            var onScreen = document.querySelectorAll('.desktop-toast:not(.toast-hiding)').length;
            if (!forceReview && onScreen > 0) {
                if (window.TrayManager) TrayManager.dismissAll();
                return;
            }
            if (_count > 0) notifyChanges(true);
            if (_noPw) notifyPassword(true);
            var warns = window.LuCIDesktop && LuCIDesktop._platformWarns;
            if (warns && warns.length && window.TrayManager) {
                TrayManager.notify(warns.join('；'), {
                    type: 'warn',
                    title: _('Platform compatibility'),
                    icon: '⚠️',
                    key: 'platform-compat',
                    force: true,
                    suppressible: true
                });
            }
        };
        btn.addEventListener('click', self.replayNotifications);

        // Toasts appear/disappear outside the uci poll — refresh the badge
        // immediately when the tray changes (tray.js dispatches it).
        document.addEventListener('desktop:toast-count', updateBtn);

        var check = function() {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/cgi-bin/luci/admin/desktop/uci_changes', true);
            xhr.onload = function() {
                if (xhr.status !== 200) return;
                try {
                    var r = JSON.parse(xhr.responseText);
                    _count = r.count || 0;
                    _noPw = !!r.no_password;

                    // Active notifications on state transitions
                    if (_count > 0 && _prevCount === 0 && !_changesNotified) {
                        _changesNotified = true;
                        notifyChanges();
                    } else if (_count === 0 && _prevCount > 0) {
                        // Saved/applied/reverted — feedback instead of hiding it
                        _changesNotified = false;
                        if (window.TrayManager) {
                            // The advertised batch is gone — drop its toast so
                            // it can't linger with a stale count.
                            TrayManager.dismiss('changes');
                            var doneMsg = (_lastSubmitType === 'revert') ? _('Reverted') : _('Saved');
                            var doneIcon = (_lastSubmitType === 'revert') ? '↩️' : '✅';
                            TrayManager.notify(doneMsg,
                                { title: _('Configuration'), icon: doneIcon, type: 'info',
                                  key: 'saved', duration: 3000 });
                        }
                    } else if (_count > 0 && _changesNotified && _count !== _prevCount) {
                        // The server auto-applies parts of a save (e.g. system
                        // page options), so the pending count can drop while the
                        // toast is on screen. Keep its number in sync with the
                        // endpoint — a toast that disagrees with the changes
                        // window it opens is the mismatch users reported.
                        if (window.TrayManager) {
                            TrayManager.updateMessage('changes', _('Unsaved Changes') + ': ' + _count);
                        }
                    }
                    // Consume the submit type regardless of branch taken
                    _lastSubmitType = null;
                    if (_noPw && !_pwNotified) {
                        _pwNotified = true;
                        notifyPassword();
                    }
                    _prevCount = _count;
                    updateBtn();
                } catch(e) {}
            };
            xhr.send();
        };

        check();
        setInterval(check, 10000);

        // An embedded page rendered an empty state and asked to be closed
        // (e.g. the changes window after its last entry was reverted).
        window.addEventListener('message', function(e) {
            if (!e.data || !e.data.type) return;
            if (e.data.type === 'desktop-app-close') {
                for (var cid in self.windows) {
                    var cw = self.windows[cid];
                    if (cw.el && cw.url && cw.url.indexOf('/desktop/changes') !== -1) {
                        WM.close(cid);
                    }
                }
                return;
            }

            // An app window submitted a form — check immediately (short delay
            // lets the server finish) instead of waiting for the poll. For
            // uci apply/revert pages, close the uci windows after submit.
            if (e.data.type !== 'desktop-app-save') return;
            _lastSubmitType = e.data.submitType || null;
            setTimeout(function() {
                if (e.data.isUci) {
                    for (var id in self.windows) {
                        var w = self.windows[id];
                        if (!w.el) continue;
                        if (w.url && w.url.indexOf('/uci/') !== -1) {
                            WM.close(id);
                        }
                    }
                }
                check();
            }, 1500);
        });
    };

    // Parse ?app=admin/status/overview URL parameter and auto-open the window.
    // Supports full paths and shortcuts; looks up title from menu data.
    self._handleAppParam = function() {
        try {
            var qs = window.location.search;
            if (!qs) return;
            var m = qs.match(/[?&]app=([^&]+)/);
            if (!m) return;
            var app = decodeURIComponent(m[1]);
            console.log('[app-url] ?app=' + app);
            // Normalize: strip leading /cgi-bin/luci/ if present
            var appPath = app.replace(/^\/cgi-bin\/luci\//, '');
            // Build full URL
            var url = (appPath.indexOf('/cgi-bin/') === 0) ? appPath : '/cgi-bin/luci/' + appPath;
            // Look up title from menu data
            var title = '';
            var data = window.LuCIMenuData;
            if (data) {
                for (var i = 0; i < data.length && !title; i++) {
                    var cat = data[i];
                    if (cat.subs) {
                        for (var j = 0; j < cat.subs.length; j++) {
                            if (cat.subs[j].href && cat.subs[j].href.indexOf(appPath) !== -1) {
                                title = cat.subs[j].title;
                                console.log('[app-url] found title: ' + title + ' in ' + cat.id);
                                break;
                            }
                        }
                    }
                    if (!title && cat.href && cat.href.indexOf(appPath) !== -1) {
                        title = cat.title;
                        console.log('[app-url] found title: ' + title + ' (top-level)');
                    }
                }
            }
            if (window.WM) {
                WM.open(url, title || appPath);
                console.log('[app-url] WM.open: ' + url + ' title="' + (title || appPath) + '"');
            }
        } catch(e) { console.log('[app-url] error:', e.message); }
    };

    // Direct visit to a non-landing page: the header injects
    // __DESKTOP_BOOT_APP__ (e.g. /cgi-bin/luci/admin/status/overview) so
    // the shell renders AND that page opens as an app window — desktop
    // and mobile alike (mobile has no multi-window, but the window opens
    // behind the switcher/home navigation). Falls back to _handleAppParam
    // semantics when the var is absent (landing page / ?app=).
    self._openBootApp = function() {
        try {
            var app = window.__DESKTOP_BOOT_APP__;
            if (!app) return;
            console.log('[boot-app] opening: ' + app);
            var appPath = app.replace(/^\/cgi-bin\/luci\//, '');
            var url = (appPath.indexOf('/cgi-bin/') === 0) ? appPath : '/cgi-bin/luci/' + appPath;
            if (window.WM) {
                WM.open(url, appPath);
                console.log('[boot-app] WM.open: ' + url);
            }
        } catch(e) { console.log('[boot-app] error:', e.message); }
    };

    // Apply desktop wallpaper (reads wallpaper config, picks randomly via crypto.getRandomValues)
    // opts.refresh: if false, skip cache-expiry XHR (used by Apply/OK to avoid re-fetch)
    self._applyWallpaper = function(opts) {
        opts = opts || {};
        try {
            var c = self.getConfig();
            var wp = document.getElementById('desktop-wallpaper');
            if (!wp) return;

            // opts.mode overrides stale desktop-config (e.g. after saveToConfig updated UCI but not DOM)
            var mode = opts.mode ||
                       (c.theme && c.theme.desktop_wallpaper) ||
                       (c.wallpaper && c.wallpaper.mode) || 'gradient';

            console.log('[wp:apply] mode:', mode, 'opts.mode:', opts.mode, 'url:', (opts.url || '').substring(0,60), 'force:', opts.forceRefresh);

            if (mode === 'gradient') {
                console.log('[wp:apply] → gradient, clearing desktop bg (was: ' + wp.style.backgroundImage.substring(0, 60) + ')');
                wp.style.backgroundImage = '';
                wp.style.backgroundSize = '';
                wp.style.backgroundPosition = '';
                if (c.wallpaper) { c.wallpaper.mode = mode; c.wallpaper.url = null; self.setSectionLocal('wallpaper', c.wallpaper); }
                if (opts.callback) opts.callback();
                return;
            }

            // Helper: pick random index using crypto.getRandomValues (true CSPRNG)
            var randomIndex = function(max) {
                if (max <= 1) return 0;
                if (window.crypto && crypto.getRandomValues) {
                    var buf = new Uint32Array(1);
                    crypto.getRandomValues(buf);
                    return buf[0] % max;
                }
                return Math.floor(Math.random() * max);
            };

            // Helper: apply wallpaper URL. Browser cache serves it instantly on revisit.
            var applyUrl = function(url) {
                if (!url) return;
                console.log('[wp:apply] desktop BEFORE:', wp.style.backgroundImage.substring(0, 80));
                wp.style.backgroundImage = 'url("' + url + '")';
                wp.style.backgroundSize = 'cover';
                wp.style.backgroundPosition = 'center';
                void wp.offsetWidth;
                console.log('[wp:apply] desktop AFTER:', wp.style.backgroundImage.substring(0, 80));
            };

            // If caller provides a URL (e.g. from preview), use it directly — no XHR
            if (opts.url) {
                console.log('[wp:apply] → direct URL from caller');
                applyUrl(opts.url);
                if (!c.wallpaper) c.wallpaper = {};
                c.wallpaper.url = opts.url;
                c.wallpaper.mode = mode;
                self.setSectionLocal('wallpaper', c.wallpaper);
                if (opts.callback) opts.callback();
                return;
            }

            // builtin: pick random from preloaded list (no XHR)
            if (mode === 'builtin' && c.wallpaper && c.wallpaper.builtin && c.wallpaper.builtin.length > 0) {
                var picked = c.wallpaper.builtin[randomIndex(c.wallpaper.builtin.length)];
                console.log('[wp:apply] → builtin, picked:', picked.substring(picked.lastIndexOf('/')+1));
                applyUrl(picked);
                c.wallpaper.mode = mode;
                c.wallpaper.url = picked;
                self.setSectionLocal('wallpaper', c.wallpaper);
                if (opts.callback) opts.callback();
                return;
            }

            // bing / picsum: use server-cached URL if snapshot mode matches current
            var snapshotMode = c.wallpaper && c.wallpaper.mode;
            var urlMismatch = (snapshotMode && snapshotMode !== mode);
            console.log('[wp:apply] snapshotMode:', snapshotMode, 'urlMismatch:', urlMismatch);

            if (!urlMismatch && c.wallpaper && c.wallpaper.url) {
                console.log('[wp:apply] → cached URL');
                applyUrl(c.wallpaper.url);
            }

            if (c.wallpaper && c.wallpaper.mode !== mode) {
                console.log('[wp:apply] sync mode:', c.wallpaper.mode, '→', mode);
                c.wallpaper.mode = mode;
                c.wallpaper.url = null;  // clear old mode's URL
                self.setSectionLocal('wallpaper', c.wallpaper);
            }

            // XHR only for explicit refresh or no cached URL (fast path on boot/Apply)
            if (opts.forceRefresh || !(c.wallpaper && c.wallpaper.url)) {
                // Picsum auto-refresh off: a login force-refresh must NOT
                // re-download when a cached image already exists (manual
                // Refresh / Apply are unaffected — they don't pass through here)
                if (opts.forceRefresh && mode === 'picsum' &&
                    (c.theme && c.theme.picsum_auto_refresh) !== '1' &&
                    c.wallpaper && c.wallpaper.url) {
                    console.log('[wp:apply] skip login refresh: picsum auto refresh disabled');
                    if (opts.callback) opts.callback();
                    return;
                }
                var url = '/cgi-bin/luci/admin/desktop/random_wallpaper?mode=' + encodeURIComponent(mode);
                if (opts.forceRefresh) url += '&force=1';
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.onload = function() {
                    try {
                        if (xhr.status !== 200) { if (opts.callback) opts.callback(); return; }
                        var r = JSON.parse(xhr.responseText);
                        if (r.url && r.url !== (c.wallpaper && c.wallpaper.url)) {
                            var img = new Image();
                            img.onload = function() {
                                applyUrl(r.url);
                                if (c.wallpaper) {
                                    c.wallpaper.url = r.url;
                                    c.wallpaper.mode = mode;
                                    self.setSectionLocal('wallpaper', c.wallpaper);
                                }
                                if (opts.callback) opts.callback();
                            };
                            img.onerror = function() { if (opts.callback) opts.callback(); };
                            img.src = r.url;
                            return;
                        }
                    } catch(e) {}
                    if (opts.callback) opts.callback();
                };
                xhr.onerror = function() { if (opts.callback) opts.callback(); };
                xhr.send();
            } else {
                console.log('[wp:apply] → skip XHR, cached URL OK');
                if (opts.callback) opts.callback();
            }
        } catch(e) {}
    };

    // Keyboard shortcuts
    self._initKeyboard = function() {
        var tabStack = []; // Alt+Tab order
        var tabIndex = -1;
        var tabHeld = false;

        self.on('window-opened', function(d) { tabStack.push(d.id); });
        self.on('window-closed', function(d) {
            tabStack = tabStack.filter(function(id) { return id !== d.id; });
            if (tabIndex >= tabStack.length) tabIndex = tabStack.length - 1;
        });

        document.addEventListener('keydown', function(e) {
            // Alt+Tab: cycle windows
            if (e.altKey && e.key === 'Tab') {
                e.preventDefault();
                if (!tabHeld) { tabIndex = -1; tabHeld = true; }
                if (tabStack.length === 0) return;
                tabIndex = (tabIndex + 1) % tabStack.length;
                if (window.WM) WM.focus(tabStack[tabIndex]);
                if (window.WM) WM.restore(tabStack[tabIndex]);
                return;
            }
            // Meta / Win key: toggle start menu
            if (e.key === 'Meta' || e.key === 'OS') {
                e.preventDefault();
                if (self.subsystems['startmenu']) {
                    self.subsystems['startmenu'].toggle();
                }
                return;
            }
            // Alt+F4: close active window
            if (e.altKey && e.key === 'F4') {
                e.preventDefault();
                if (self.activeWindowId && window.WM) {
                    WM.close(self.activeWindowId);
                }
                return;
            }
            // Meta+D: toggle show desktop
            if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
                e.preventDefault();
                var tb = self.subsystems['taskbar'];
                if (tb && tb.showDesktop) {
                    var allMin = Object.keys(self.windows).every(function(id) {
                        return self.windows[id].minimized;
                    });
                    if (allMin) { tb.restoreAll(); } else { tb.showDesktop(); }
                }
                return;
            }
        });

        document.addEventListener('keyup', function(e) {
            if (!e.altKey) { tabHeld = false; tabIndex = -1; }
        });
    };


    // Generate unique window ID
    self.nextId = function() {
        return 'win-' + (self.nextWindowId++);
    };

    // Bring window to front
    self.bringToFront = function(winId) {
        self.activeWindowId = winId;
    };

    // Clamp a value between min and max (inclusive)
    self.clamp = function(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    };

    // Unified drag overlay — prevents iframes from stealing mouse events during drag/resize.
    // opts: {cursor: 'grabbing'|'move', zIndex: 99999}
    self.showDragOverlay = function(opts) {
        // Don't create duplicate
        var existing = document.getElementById('__desktop-drag-overlay');
        if (existing) return existing;

        opts = opts || {};
        var overlay = document.createElement('div');
        overlay.id = '__desktop-drag-overlay';
        overlay.style.cssText =
            'position:fixed;inset:0;' +
            'z-index:' + (opts.zIndex || 99999) + ';' +
            'cursor:' + (opts.cursor || 'grabbing') + ';';
        document.body.appendChild(overlay);

        // Disable pointer events on iframes so they don't steal mouse events
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            iframes[i].style.pointerEvents = 'none';
        }
        return overlay;
    };

    self.hideDragOverlay = function() {
        var overlay = document.getElementById('__desktop-drag-overlay');
        if (overlay) {
            overlay.remove();
        }

        // Restore pointer events on iframes
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            iframes[i].style.pointerEvents = '';
        }
    };

    // Background wallpaper refresh: silent fetch + preload, no impact if network fails
    self._backgroundRefresh = function() {
        setTimeout(function() {
            try {
                var c = self.getConfig();
                var mode = (c.theme && c.theme.desktop_wallpaper) ||
                           (c.wallpaper && c.wallpaper.mode);
                console.log('[wp:bg-refresh] mode=' + mode + ' has_url=' + !!(c.wallpaper && c.wallpaper.url) + ' panel_open=' + !!document.getElementById('theme-settings-panel'));
                if (mode === 'picsum') {
                    if ((c.theme && c.theme.picsum_auto_refresh) !== '1') {
                        console.log('[wp:bg-refresh] skip: picsum auto refresh disabled'); return;
                    }
                } else if (mode !== 'bing') { console.log('[wp:bg-refresh] skip: not bing or picsum'); return; }
                if (!c.wallpaper || !c.wallpaper.url) { console.log('[wp:bg-refresh] skip: no cached URL'); return; }

                var wp = document.getElementById('desktop-wallpaper');
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/cgi-bin/luci/admin/desktop/random_wallpaper?mode=' + encodeURIComponent(mode), true);
                // The wallpaper mode may have changed while the download was
                // in flight (user switched bing→picsum and applied). Never
                // clobber the user's newer choice with a stale download.
                var currentMode = function() {
                    try {
                        var cur = self.getConfig();
                        return (cur.theme && cur.theme.desktop_wallpaper) ||
                               (cur.wallpaper && cur.wallpaper.mode);
                    } catch(e) { return mode; }
                };
                xhr.onload = function() {
                    if (xhr.status !== 200) { console.log('[wp:bg-refresh] XHR failed: ' + xhr.status); return; }
                    var r;
                    try { r = JSON.parse(xhr.responseText); } catch(e) { console.log('[wp:bg-refresh] JSON parse error'); return; }
                    // Only apply if server actually downloaded a new image (not cached)
                    if (r.cached) { console.log('[wp:bg-refresh] skip: server cache hit, no new download'); return; }
                    console.log('[wp:bg-refresh] got url=' + (r.url || '').substring(0, 60) + ' current=' + (c.wallpaper.url || '').substring(0, 60));
                    if (!r.url) { console.log('[wp:bg-refresh] skip: no url'); return; }
                    if (currentMode() !== mode) {
                        console.log('[wp:bg-refresh] skip: mode changed to ' + currentMode() + ' during download');
                        return;
                    }

                    // Preload before applying — don't flash broken images
                    var img = new Image();
                    img.onload = function() {
                        if (currentMode() !== mode) {
                            console.log('[wp:bg-refresh] skip (img): mode changed during download');
                            return;
                        }
                        console.log('[wp:bg-refresh] applying new wallpaper');
                        if (wp) {
                            wp.style.backgroundImage = 'url("' + r.url + '")';
                            wp.style.backgroundSize = 'cover';
                            wp.style.backgroundPosition = 'center';
                        }
                        c.wallpaper.url = r.url;
                        c.wallpaper.mode = mode;
                        self.setSectionLocal('wallpaper', c.wallpaper);
                        // Update preview in open panel too, if the user is viewing
                        // the same mode — bg-refresh applied a new desktop image
                        var panelOpen = !!document.getElementById('theme-settings-panel');
                        var selMode = (document.getElementById('ts-desktop_wallpaper') || {}).value;
                        if (!panelOpen || selMode === mode) {
                            var preview = document.getElementById('wp-preview-img');
                            if (preview) {
                                preview.style.backgroundImage = 'url("' + r.url + '")';
                                preview.style.backgroundSize = 'cover';
                                preview.style.backgroundPosition = 'center';
                            }
                        } else {
                            console.log('[wp:bg-refresh] panel open on different mode, skipped preview update');
                        }
                        // Persist silently + confirm desktop file (picsum only)
                        if (c.theme) {
                            self.saveDesktopSection('settings', c.theme);
                        }
                        if (mode === 'bing' || mode === 'picsum') {
                            var cx = new XMLHttpRequest();
                            cx.open('POST', '/cgi-bin/luci/admin/desktop/confirm_wallpaper', true);
                            cx.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                            cx.onload = function() {
                                try { var resp = JSON.parse(cx.responseText); console.log('[wp:bg-refresh] confirm: ' + (resp.ok ? 'ok' : 'fail')); } catch(e) {}
                            };
                            cx.onerror = function() { console.log('[wp:bg-refresh] confirm: network error'); };
                            cx.send('mode=' + encodeURIComponent(mode));
                        }
                    };
                    img.onerror = function() { console.log('[wp:bg-refresh] image preload failed, keeping current'); };
                    img.src = r.url;
                };
                xhr.onerror = function() { console.log('[wp:bg-refresh] XHR network error'); };
                xhr.send();
            } catch(e) { console.log('[wp:bg-refresh] error:', e.message); }
        }, 5000);
    };

    // ===== Unified config access layer (P1) =====
    // #desktop-config (template-injected JSON) is the per-tab source of
    // truth. Reads go through getConfig(): one parse, cached, re-parsed
    // only when the DOM text changed (external DOM writers such as the
    // settings panels keep taking effect); a parse failure degrades to {}
    // instead of throwing into every consumer.
    // NOTE: getConfig/getSection return the LIVE cached object — consumers
    // that mutate it must write back via setSection/setSectionLocal.
    var _configCache = null;
    var _configText = null;

    self.getConfig = function() {
        var el = document.getElementById('desktop-config');
        if (!el) return {};
        var t = el.textContent;
        if (_configText !== t) {
            _configText = t;
            try {
                var c = JSON.parse(t);
                _configCache = (c && typeof c === 'object') ? c : {};
            } catch (e) {
                _configCache = {};
                console.log('[config] desktop-config parse failed — using {}');
            }
        }
        return _configCache;
    };

    self.getSection = function(name) {
        var c = self.getConfig();
        return (c && typeof c[name] === 'object' && c[name]) ? c[name] : {};
    };

    // DOM-only write: updates the tab's config (and cache) immediately,
    // no backend POST. Used by writers that coalesce their own saves
    // (sticky-note store debounce).
    self.setSectionLocal = function(name, data) {
        var c = self.getConfig();
        c[name] = data;
        var el = document.getElementById('desktop-config');
        if (el) {
            el.textContent = JSON.stringify(c);
            _configText = el.textContent;   // our own write — keep cache identity
        }
    };

    // DOM + immediate backend POST (single endpoint). Returns the XHR so
    // callers can serialize on it (widget _sendSave waits for onload).
    self.setSection = function(name, data) {
        self.setSectionLocal(name, data);
        return self.saveDesktopSection(name, data);
    };

    // Unified UCI persistence — POST section + JSON data to single endpoint.
    // Returns the XHR (callers may attach onload/onerror to serialize);
    // sync=true performs a blocking send for page-unload flushes.
    // PENDING-FLUSH: every async save also records its LATEST payload per
    // section; on pagehide/beforeunload the pending payload is re-sent
    // SYNCHRONOUSLY. Without this a fire-and-forget POST that hasn't left
    // the browser yet is killed by the unload — the UCI never sees the
    // change (widgets vanishing after a quick refresh, auto-refresh toggle
    // reverting). The latest payload per section wins, so rapid successive
    // saves (drag/resize/typing) flush exactly one final state. 2026-08.
    var _pendingFlush = {};   // section -> latest data not yet flushed

    self.saveDesktopSection = function(section, data, sync) {
        if (!sync) _pendingFlush[section] = data;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/cgi-bin/luci/admin/desktop/save', !sync);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.send('section=' + encodeURIComponent(section) +
                 '&data=' + encodeURIComponent(JSON.stringify(data)));
        return xhr;
    };

    function flushPendingSaves() {
        for (var s in _pendingFlush) {
            var d = _pendingFlush[s];
            delete _pendingFlush[s];
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/cgi-bin/luci/admin/desktop/save', false);  // sync
                xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
                xhr.send('section=' + encodeURIComponent(s) +
                         '&data=' + encodeURIComponent(JSON.stringify(d)));
            } catch(e) {}
        }
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flushPendingSaves);
        window.addEventListener('beforeunload', flushPendingSaves);
        // Test hook: force-flush pending saves (tests/js/shell.test.js).
        self.flushPendingSaves = flushPendingSaves;
    }

    return self;
})();
