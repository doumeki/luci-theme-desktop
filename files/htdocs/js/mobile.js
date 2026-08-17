/* Desktop Theme — Mobile module
 *
 * Mobile-only features (spec: theme-mobile-spec，记忆库):
 *   - App switcher: fullscreen "recent apps" view with live thumbnails
 *     (iOS style) — tap a card to switch, ✕ to close.
 *
 * Registers a taskbar button (#btn-switcher) — hidden on desktop by CSS.
 * All behavior is gated on mobile mode, so desktop is untouched.
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) return;

    // Same rule as LuCIDesktop.isMobile() (shell.js): server UA verdict
    // wins; fallback = narrow viewport OR touch-only (coarse without fine).
    var IS_MOBILE = window.__IS_MOBILE__ === true ||
        (window.matchMedia && (window.matchMedia('(max-width: 768px)').matches ||
            (window.matchMedia('(pointer: coarse)').matches &&
             !window.matchMedia('(pointer: fine)').matches)));

    // ===== initMobile(forceMobile) — the whole module body =====
    // Extracted so tests can re-run the bindings with a forced mobile
    // verdict (the page itself loads in a desktop viewport). Production
    // calls it once with the natural IS_MOBILE verdict; force overrides
    // it for re-binding on demand.
    function initMobile(forceMobile) {
        var mobile = !!forceMobile || IS_MOBILE;
        // Expose the API in both modes (real impl when mobile, no-op
        // surface otherwise) so callers/tests never see an undefined one.
        if (!mobile) {
            DESKTOP.mobile = {
                openSwitcher: function() {},
                closeSwitcher: function() {}
            };
            return;
        }

    var switcher = null;
    var scrollEl = null;
    var btn = document.getElementById('btn-switcher');

    // Server-side log (fire-and-forget) so the router can be checked
    // without the browser console. GET params — luci-lua-runtime's POST
    // body parsing is unreliable (protocol.lua chunk nil).
    function slog(msg) {
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/cgi-bin/luci/admin/desktop/log?lines=' +
                   encodeURIComponent('[mobile] ' + msg + '\n'), true);
            x.send();
        } catch(e) {}
    }

    // ===== Dev sandbox: inject mock content into thumbnail iframes =====
    function maybeInjectMock(iframe, title, url) {
        if (!window.__DESKTOP_THEME_VERSION__ || window.__DESKTOP_THEME_VERSION__.indexOf('dev') === -1) return;
        try {
            var doc = iframe.contentDocument;
            if (doc && doc.body) {
                doc.body.style.cssText = 'margin:0;padding:0;background:#f5f6fa;font-family:sans-serif;';
                doc.body.innerHTML =
                    '<div style="padding:40px;">' +
                    '<h2 style="margin:0 0 8px;color:#333;">' + (title || 'Page') + '</h2>' +
                    '<p style="color:#999;font-size:13px;margin:0 0 20px;">🔗 ' + (url || '') + '</p>' +
                    '<p style="color:#666;font-size:13px;margin:0;">📋 本地开发模式</p></div>';
            }
        } catch(e) {}
    }

    // ===== Build switcher overlay (once) =====
    function buildSwitcher() {
        if (switcher) return;
        switcher = document.createElement('div');
        switcher.id = 'app-switcher';
        switcher.className = 'app-switcher';
        switcher.style.display = 'none';
        switcher.innerHTML =
            '<div class="switcher-header">' +
            '  <span class="switcher-title">' + (_('Recent Apps') || 'Recent Apps') + '</span>' +
            '  <button class="switcher-bell" title="' + (_('Notifications') || 'Notifications') + '">🔔<span class="switcher-bell-badge" hidden></span></button>' +
            '</div>' +
            '<div class="switcher-options">' +
            '  <span class="switcher-opt-label">' + (_('Auto Refresh') || 'Auto Refresh') + '</span>' +
            '  <button class="switcher-ar-toggle" title="' + (_('Auto Refresh') || 'Auto Refresh') + '"></button>' +
            '</div>' +
            '<div class="switcher-scroll"></div>' +
            '<button class="switcher-close" title="Close">✕</button>';
        document.body.appendChild(switcher);
        scrollEl = switcher.querySelector('.switcher-scroll');

        // 🔔: replay the current notifications (same as the desktop bell —
        // the tray bell is hidden on mobile, so the switcher is the entry).
        // forceReview=true: ALWAYS re-pop (never the desktop bell's
        // toggle-close) — closing here would hide the toasts the user came
        // to read (bugfix 2026-08-15).
        switcher.querySelector('.switcher-bell').addEventListener('click', function() {
            closeSwitcher();
            if (window.LuCIDesktop && typeof LuCIDesktop.replayNotifications === 'function') {
                LuCIDesktop.replayNotifications(true);
            }
        });

        // Top-right ✕: close ALL open apps, then exit the switcher
        switcher.querySelector('.switcher-close').addEventListener('click', function() {
            Object.keys(DESKTOP.windows).forEach(function(id) {
                if (window.WM) WM.close(id);
            });
            closeSwitcher();
        });
        switcher.addEventListener('click', function(e) {
            if (e.target === switcher || e.target.classList.contains('switcher-scroll')) closeSwitcher();
        });

    // ===== Auto-refresh toggle (mobile entry — the taskbar button is
    // hidden on mobile, so the switcher owns the switch) =====
    // SESSION-LEVEL switch (user decision 2026-08-16): the state is NOT
    // persisted — every page LOAD starts with auto-refresh ON (the
    // default). Within the page the state is kept in a module variable so
    // reopening the switcher (or any in-page view) does NOT reset it —
    // only an F5 / re-login (fresh JS context) restores the default ON.
    var arToggle = switcher.querySelector('.switcher-ar-toggle');
    if (arToggle) {
        arToggle.addEventListener('click', function() {
            var isOn = !arToggle.classList.contains('on');
            arToggle.classList.toggle('on', isOn);
            setAutoRefresh(isOn);
        });
    }
    }

    // In-page auto-refresh state. Module-level so it survives switcher
    // reopen/reinit within the page, but resets to the default ON on every
    // page load (F5 / re-login = fresh JS context).
    var _arOn = true;

    function readAutoRefresh() {
        return _arOn;
    }

    // Session-level set: remember the in-page state + broadcast to open
    // iframes (so already-open pages react immediately). NOT persisted to
    // UCI — an F5/re-login restores the default ON.
    function setAutoRefresh(on) {
        _arOn = !!on;
        DESKTOP.emit('auto-refresh-toggled', { on: on });
    }

    // ===== iOS-style parallax: cards scale/fade with distance from center =====
    var rafPending = false;
    function updateParallax() {
        rafPending = false;
        if (!switcher || switcher.style.display === 'none') return;
        var vw = switcher.clientWidth;
        var center = vw / 2;
        var cards = scrollEl.querySelectorAll('.switcher-card');
        cards.forEach(function(card) {
            var rect = card.getBoundingClientRect();
            var cardCenter = rect.left + rect.width / 2;
            var dist = Math.abs(cardCenter - center);
            var t = Math.min(1, dist / (vw * 0.85));
            card.style.transform = 'scale(' + (1 - 0.16 * t) + ')';
            card.style.opacity = String(1 - 0.6 * t);
            // Center card on top — its kill button must stay tappable
            card.style.zIndex = String(Math.max(1, Math.round((1 - t) * 10)));
        });
    }
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(updateParallax);
    }

    // ===== Render current windows as thumbnail cards =====
    function renderCards() {
        scrollEl.innerHTML = '';
        var ids = Object.keys(DESKTOP.windows);
        if (ids.length === 0) {
            // No apps left — the switcher closes itself
            closeSwitcher();
            return;
        }
        ids.forEach(function(id, idx) {
            var w = DESKTOP.windows[id];
            if (!w || !w.el) return;

            var card = document.createElement('div');
            card.className = 'switcher-card' + (DESKTOP.activeWindowId === id ? ' active' : '');
            card.setAttribute('data-wid', id);
            // Staggered entrance (slide-in from the right)
            card.style.animationDelay = (idx * 0.06) + 's';

            var thumb = document.createElement('div');
            thumb.className = 'switcher-thumb';
            var iframe = document.createElement('iframe');
            // Dev sandbox has no backend — always thumbnail about:blank mock
            var isDev = window.__DESKTOP_THEME_VERSION__ &&
                        window.__DESKTOP_THEME_VERSION__.indexOf('dev') !== -1;
            iframe.src = (!isDev && w.url && w.url.indexOf('about:') !== 0) ? w.url : 'about:blank';
            iframe.setAttribute('scrolling', 'no');
            iframe.addEventListener('load', function() {
                maybeInjectMock(iframe, w.title, w.url);
            });
            thumb.appendChild(iframe);
            card.appendChild(thumb);

            var meta = document.createElement('div');
            meta.className = 'switcher-meta';
            meta.innerHTML =
                '<span class="switcher-name">' + (w.title || id) + '</span>' +
                '<button class="switcher-kill" title="' + (_('Close') || 'Close') + '">✕</button>';
            card.appendChild(meta);

            // Windows hidden via the titlebar hide button are dimmed here
            if (w.el && w.el.style.display === 'none') card.classList.add('hidden');

            // Tap card → restore (if hidden) and switch to that window
            card.addEventListener('click', function(e) {
                console.log('[switcher] card click, target=' + (e.target.className || e.target.tagName) + ' wid=' + id);
                slog('card click target=' + (e.target.className || e.target.tagName) + ' wid=' + id);
                if (e.target.classList.contains('switcher-kill')) return;
                if (w.el && w.el.style.display === 'none') w.el.style.display = '';
                closeSwitcher();
                if (window.WM && typeof WM.focus === 'function') WM.focus(id);
            });
            // ✕ → close window, re-render
            card.querySelector('.switcher-kill').addEventListener('click', function(e) {
                e.stopPropagation();
                console.log('[switcher] kill click, wid=' + id);
                slog('kill click wid=' + id);
                if (window.WM) WM.close(id);
                console.log('[switcher] after WM.close, windows=' + Object.keys(DESKTOP.windows).length);
                slog('after close windows=' + Object.keys(DESKTOP.windows).length);
                renderCards();
            });

            scrollEl.appendChild(card);
        });
    }

    // 🔔 badge: same number as the desktop tray bell (max of on-screen
    // toasts and the unsaved-changes count), refreshed on open and while
    // the switcher is up (toast adds/dismissals dispatch desktop:toast-count).
    function updateBellBadge() {
        var badge = document.querySelector('.switcher-bell-badge');
        if (!badge) return;
        var n = (window.LuCIDesktop && typeof LuCIDesktop.notificationCount === 'function')
            ? LuCIDesktop.notificationCount() : 0;
        badge.textContent = n > 0 ? String(n) : '';
        badge.hidden = n === 0;
    }
    document.addEventListener('desktop:toast-count', updateBellBadge);

    function openSwitcher() {
        buildSwitcher();
        renderCards();
        updateBellBadge();
        // Sync auto-refresh toggle state from config each open (a change
        // made in the settings panel or another tab must be reflected).
        var arToggle = switcher.querySelector('.switcher-ar-toggle');
        if (arToggle) arToggle.classList.toggle('on', readAutoRefresh());
        switcher.style.display = '';
        document.documentElement.classList.add('switcher-open');
        // Snap to the active card once layout settles
        setTimeout(function() {
            var active = scrollEl.querySelector('.switcher-card.active');
            if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            updateParallax();
        }, 60);
    }

    function closeSwitcher() {
        if (!switcher || switcher.style.display === 'none') return;
        switcher.classList.add('switcher-closing');
        setTimeout(function() {
            switcher.style.display = 'none';
            switcher.classList.remove('switcher-closing');
            scrollEl.innerHTML = '';   // destroy thumbnails (release iframes)
            document.documentElement.classList.remove('switcher-open');
        }, 170);
    }

    // ===== Taskbar button + app-dot area open the switcher =====
    function toggleSwitcher() {
        if (switcher && switcher.style.display !== 'none') closeSwitcher();
        else openSwitcher();
    }
    if (btn) {
        btn.addEventListener('click', toggleSwitcher);
    }
    var winArea = document.getElementById('taskbar-windows');
    if (winArea) {
        winArea.addEventListener('click', toggleSwitcher);
    }

    // ===== HOME: back to desktop — hide all windows (restorable via
    // the app switcher) and close the switcher overlay if open =====
    var homeBtn = document.getElementById('btn-home');
    if (homeBtn) {
        homeBtn.addEventListener('click', function() {
            slog('HOME clicked, windows=' + Object.keys(DESKTOP.windows).length);
            closeSwitcher();
            var n = 0;
            Object.keys(DESKTOP.windows).forEach(function(id) {
                var w = DESKTOP.windows[id];
                if (w && w.el) {
                    w.el.style.setProperty('display', 'none', 'important');
                    w.minimized = true;
                    n++;
                }
            });
            DESKTOP.activeWindowId = null;
            slog('HOME hidden=' + n);
        });
    }

    // Parallax on scroll (registered after buildSwitcher creates scrollEl)
    var origBuild = buildSwitcher;
    buildSwitcher = function() {
        origBuild();
        if (scrollEl && !scrollEl.__parallaxBound) {
            scrollEl.addEventListener('scroll', onScroll, { passive: true });
            scrollEl.__parallaxBound = true;
        }
    };

    // TEMP-DIAG: capture every touch/mousedown while the switcher is open —
    // records where the tap actually lands (click may be swallowed by the
    // horizontal scroller or overlapping scaled cards)
    document.addEventListener('touchstart', function(e) {
        if (!switcher || switcher.style.display === 'none') return;
        var t = e.target;
        var touch = e.touches && e.touches[0];
        slog('touchstart hit=' + (t.className ? String(t.className).substring(0, 30) : t.tagName) +
             (touch ? ' x=' + Math.round(touch.clientX) + ' y=' + Math.round(touch.clientY) : ''));
    }, true);
    document.addEventListener('mousedown', function(e) {
        if (!switcher || switcher.style.display === 'none') return;
        var t = e.target;
        slog('mousedown hit=' + (t.className ? String(t.className).substring(0, 30) : t.tagName) +
             ' x=' + Math.round(e.clientX) + ' y=' + Math.round(e.clientY));
    }, true);

    // Android back / Escape closes the switcher first
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && switcher && switcher.style.display !== 'none') {
            e.preventDefault();
            closeSwitcher();
        }
    });

        DESKTOP.mobile = { openSwitcher: openSwitcher, closeSwitcher: closeSwitcher };
    }

    // Boot once with the natural verdict. reinit re-runs initMobile and
    // re-attaches ITSELF afterwards — a no-op (desktop) pass replaces the
    // mobile object, so the hook must survive that swap.
    function makeReinit() {
        return function(force) {
            initMobile(force);
            if (DESKTOP.mobile) DESKTOP.mobile.reinit = makeReinit();
        };
    }
    initMobile(false);
    DESKTOP.mobile.reinit = makeReinit();
})();

