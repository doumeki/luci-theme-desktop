/* Desktop Theme - Iframe Bridge
 *
 * Connects the desktop shell to iframe content:
 *   - CSS injection to hide iframe-internal chrome
 *   - Link click interception → open in new window
 *   - Form submit interception
 *   - postMessage protocol for cross-window communication
 *
 * Depends on: shell.js, wm.js
 */
(function() {
    'use strict';

    // Third-party app user lists: the app force-cards the list below 768px
    // (.view-toggle hidden, #tableViewWrapper display:none !important) so
    // its own switchView() can't win either. On small screens take over the
    // toggle: drive body[data-list-view] (cascade.css has matching
    // higher-specificity rules). Runs BEFORE the LuCIDesktop check — the
    // embedded page copy of this file loads without shell.js, so it must
    // not depend on the namespace. Buttons render late (arcombine), so
    // retry until they exist. Desktop (>768px) is untouched.
    function initListView(attempts) {
        if (window.innerWidth > 768) return;
        if (document.body && document.body.className.indexOf('embedded') === -1) return;
        var btnTable = document.getElementById('btnTableView');
        var btnCard = document.getElementById('btnCardView');
        if (!btnTable || !btnCard) {
            if ((attempts || 0) < 40) setTimeout(function() { initListView((attempts || 0) + 1); }, 500);
            return;
        }
        var setView = function(v) {
            document.body.setAttribute('data-list-view', v);
        };
        btnTable.addEventListener('click', function() { setView('table'); });
        btnCard.addEventListener('click', function() { setView('card'); });
        setView('card');   // app's mobile default
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { initListView(0); });
    } else {
        initListView(0);
    }

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('iframe-bridge.js: LuCIDesktop namespace not found'); return; }

    var messageRegistered = false;

    // CSS rules injected into each iframe to suppress its own chrome
    var CHROME_HIDER_CSS = [
        'body > header { display: none !important; }',
        '.main-left { display: none !important; }',
        '.main > .main-left { display: none !important; }',
        'footer { display: none !important; }',
        'body > footer { display: none !important; }',
        '.breadcrumb { display: none !important; }',
        '#modemenu { display: none !important; }',
        '.showSide { display: none !important; }',
        '.darkMask { display: none !important; }',
        '.main-right { margin-left: 0 !important; }',
        '#maincontent > .container { margin-left: 0 !important; }',
        'body.embedded { padding-top: 0 !important; }'
    ].join('\n');

    var IframeBridge = {
        init: function() {
            if (!messageRegistered) {
                window.addEventListener('message', this.handleMessage.bind(this));
                messageRegistered = true;
            }
        },

        // Inject CSS to hide the iframe page's internal chrome
        injectChromeHider: function(doc) {
            // Prevent duplicate injection
            if (doc.querySelector('style#__desktop-chrome-hider')) return;

            // Use document.createElement (works for both Document and Element proxies)
            var style = document.createElement('style');
            style.id = '__desktop-chrome-hider';
            style.textContent = CHROME_HIDER_CSS;

            // doc.head works for Document; doc.querySelector('head') for Element proxies
            var head = doc.head || doc.querySelector('head');
            if (head) {
                head.appendChild(style);
            } else {
                // Fallback: append to the element itself
                doc.appendChild(style);
            }
        },

        // Inject click interceptor into iframe document
        //
        // General rules, not per-app heuristics: the embedded page must
        // behave exactly like vanilla LuCI, with only two deltas —
        //   1. nothing may open a new browser tab (redirect in-frame)
        //   2. embed=1 must survive navigation (href is repaired before
        //      the browser's default action runs)
        // Listening at the bubble phase lets the page's own handlers run
        // first; if one returns false (e.g. an inline onclick like
        // cbi_t_switch), defaultPrevented is set and we do nothing.
        // JS-driven navigations (location.href = …) never produce a click
        // event — those are covered by the header.htm bounce-back instead.
        injectLinkInterceptor: function(doc, winId, postMessageFn) {
            var sendMsg = postMessageFn || function(msg) {
                window.postMessage(msg, '*');
            };

            doc.addEventListener('click', function(e) {
                if (e.defaultPrevented) return;   // the page already decided
                var t = e.target;
                if (!t || typeof t.closest !== 'function') return;

                var a = t.closest('a[href]');
                if (a) {
                    var href = a.getAttribute('href');
                    if (!href) return;
                    var target = (a.getAttribute('target') || '').toLowerCase();
                    var escapes = target === '_blank' || target === '_new' || target === '_top' ||
                                  (target !== '' && target !== '_self' && target !== '_parent');

                    if (escapes) {
                        // Would open a new browser tab — keep it in the app
                        // frame instead. External links keep native behavior
                        // (a real browser tab).
                        if (!IframeBridge.isLuCIUrl(href)) return;
                        e.preventDefault();
                        var embedUrl = IframeBridge.getEmbedUrl(href);
                        var targetIframe = findIframeForDoc(doc);
                        if (targetIframe) {
                            targetIframe.src = embedUrl;
                        } else if (doc.defaultView) {
                            doc.defaultView.location.href = embedUrl;
                        }
                        return;
                    }

                    // Plain link: let the browser navigate the iframe
                    // natively, but repair the href so the target page
                    // renders embedded (single round-trip, no reload).
                    if (href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
                    if (IframeBridge.isLuCIUrl(href) || href.charAt(0) === '/') {
                        var fixed = IframeBridge.getEmbedUrl(href);
                        if (fixed !== href) a.setAttribute('href', fixed);
                    }
                    return;
                }

                // Tab menus: clicking the li body (outside the anchor
                // text) should switch tabs too — natively only the anchor
                // text is clickable. Matches both the desktop theme's own
                // sibling tabs (ul.tabs > li.tabmenu-item-*) and LuCI's
                // cbi tab menu (ul.cbi-tabmenu > li). Simulating a click
                // runs the page's own handler (e.g. cbi_t_switch) natively.
                var li = t.closest('ul.cbi-tabmenu > li') ||
                         t.closest('ul.tabs > li[class^="tabmenu-item-"]');
                if (!li) return;
                var tabA = li.querySelector('a[href]');
                if (tabA) tabA.click();
            }, false);
        },

        // Inject cbi-save interceptor. A cbi Save lands the delta on the
        // server, but the changes toast only appears on the shell's poll —
        // waiting up to 10s made "did my save register?" a real confusion.
        // Ping the shell right when the Save button is clicked so it
        // re-checks the uci-changes endpoint a moment later instead of
        // waiting for the next poll tick.
        // Note: LuCI 26 embed pages render NO <form> element (the buttons
        // live in a div.cbi-page-actions; the View saves via per-field ubus
        // uci RPCs, never a POST to the page URL), and cbi.js creates the
        // action buttons dynamically after load — so neither a form-submit
        // listener nor a direct button binding is reliable. Document-level
        // delegation catches the click whenever it lands.
        injectFormInterceptor: function(doc) {
            doc.addEventListener('click', function(e) {
                try {
                    var t = e.target;
                    if (!t || !t.closest) return;
                    if (!t.closest('button.cbi-button-save')) return;
                    window.parent.postMessage({
                        type: 'desktop-app-save',
                        submitType: 'save',
                        isUci: false
                    }, '*');
                } catch (err) {}
            }, true);
        },

        // Session-level auto-refresh state (user decision 2026-08-16): the
        // state is NOT persisted — every page load starts ON. Within the
        // page, _arOn tracks the CURRENT toggle state (updated by every
        // broadcast) so a NEWLY opened iframe inherits the user's in-page
        // choice instead of always starting ON (bugfix 0.1.0-133: "先关
        // autofresh 再开 app, 发现是 refresh 的").
        _arOn: true,

        // Broadcast auto-refresh on/off to all open iframes AND remember
        // it for iframes opened later (onIframeLoad → getAutoRefresh).
        // Called by taskbar toggle AND onIframeLoad (to apply initial state).
        broadcastAutoRefresh: function(on) {
            this._arOn = !!on;
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                try {
                    iframes[i].contentWindow.postMessage({type: 'set-auto-refresh', on: on}, '*');
                    var xhr = iframes[i].contentWindow.XHR;
                    if (xhr) {
                        if (on) { if (xhr.run) xhr.run(); }
                        else { if (xhr.halt) xhr.halt(); }
                    }
                } catch(e) {}
            }
        },

        // Broadcast theme change to all open iframes (called when theme settings saved).
        broadcastTheme: function(vals) {
            var msg = {type: 'theme-changed'};
            if (vals.app_dark_mode !== undefined) {
                msg.darkMode = vals.app_dark_mode === '1' || vals.app_dark_mode === true;
            }
            if (vals.app_primary_color) msg.primary = vals.app_primary_color;
            if (vals.app_primary_color_dark) msg.primaryDark = vals.app_primary_color_dark;

            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                try {
                    iframes[i].contentWindow.postMessage(msg, '*');
                } catch(e) {}
            }
        },

        // Current in-page auto-refresh state — the toggle's live value,
        // NOT a persisted default (user decision 2026-08-16: state is not
        // kept across page loads; F5/re-login resets to ON via fresh JS).
        getAutoRefresh: function() {
            return this._arOn;
        },

        // Fit the ttyd terminal iframe to the .main-right viewport
        // remainder. The ttyd page ships the app iframe with inline
        // min-height:500px (1.1/ImmortalWrt: inside #view; 253/legacy
        // LuCI: directly in .main-right, ~380px) which never fills the
        // window — a large empty band below the shell input (user report
        // 2026-08-16). Sized via JS (not CSS :has()/flex — the embedded
        // Firefox is too old for :has(), and flex collapses the iframe).
        // No-op on regular pages. retries: new luci-app-ttyd (26.x)
        // injects the :7681 iframe from JS AFTER the page load event, so
        // the initial call finds nothing — a #view container marks the
        // page as ttyd, and we re-run until the iframe appears.
        fitTtydIframe: function(doc, retries) {
            try {
                var iframe = doc.querySelector('#view iframe');
                var view = iframe ? doc.querySelector('#view') : null;
                var mr = doc.querySelector('.main-right');
                if (!mr) return;
                if (!iframe) {
                    // Legacy ttyd (253): iframe sits directly in .main-right
                    // and points at the ttyd port (7681).
                    var cands = mr.querySelectorAll('iframe');
                    for (var i = 0; i < cands.length; i++) {
                        if ((cands[i].src || '').indexOf(':7681') !== -1) {
                            iframe = cands[i];
                            break;
                        }
                    }
                    if (!iframe) {
                        // Late-injected ttyd iframe (new luci-app-ttyd):
                        // retry while this is a ttyd page (#view present).
                        if (doc.querySelector('#view') && (retries || 0) < 6) {
                            var self = this;
                            setTimeout(function() {
                                self.fitTtydIframe(doc, (retries || 0) + 1);
                            }, 1000);
                        }
                        return;
                    }
                }
                var mrBottom = mr.getBoundingClientRect().bottom;
                var top = view ? view.getBoundingClientRect().top
                               : iframe.getBoundingClientRect().top;
                if (!(mrBottom > 0) || !(top >= 0)) return;
                var targetH = mrBottom - top - 4;
                if (targetH < 100) return;   // sanity: page not laid out yet
                iframe.style.height = targetH + 'px';
                iframe.style.minHeight = targetH + 'px';
            } catch (e) {}
        },

        // Handle all iframe setup when an iframe loads
        onIframeLoad: function(iframe, winId) {
            try {
                var doc = iframe.contentDocument || iframe.contentWindow.document;
                if (!doc) return;

                // Detect logout / session expiry
                var loc = iframe.contentWindow.location;
                if (loc && loc.pathname) {
                    var path = loc.pathname;
                    if (path === '/cgi-bin/luci/' || path === '/cgi-bin/luci' ||
                        path.indexOf('/admin/logout') !== -1) {
                        window.top.location.href = loc.href;
                        return;
                    }
                    // If page loaded as desktop shell (missing embed=1 after redirect),
                    // reload with embed=1. Only if shell DOM is actually present.
                    if (loc.href.indexOf('embed=1') === -1 && path.indexOf('/admin/') !== -1) {
                        if (doc.getElementById('desktop') || doc.getElementById('taskbar')) {
                            iframe.src = IframeBridge.getEmbedUrl(loc.href);
                            return;
                        }
                    }
                }

                this.injectChromeHider(doc);
                this.injectLinkInterceptor(doc, winId);
                this.injectFormInterceptor(doc);
                this.injectFocusNotifier(doc, winId);
                this.injectWindowOpenOverride(iframe.contentWindow, doc);
                // ttyd terminal: size the app iframe to fill the window
                // (user report 2026-08-16: empty band below the shell).
                this.fitTtydIframe(doc);

                // Apply current auto-refresh state to this iframe only
                var arOn = this.getAutoRefresh();
                this.broadcastAutoRefresh(arOn);

                // Keep the original app name from the menu as window title.
                // doc.title is the page's internal tab name which is less useful
                // on the taskbar than the app name set during WM.open().
            } catch (e) {
                console.warn('iframe-bridge: cannot access iframe content for ' + winId, e.message);
            }
        },

        // Notify parent when user clicks inside the iframe (for window focusing)
        injectFocusNotifier: function(doc, winId) {
            doc.addEventListener('mousedown', function() {
                WM.focus(winId);
            });
        },

        // Override window.open to prevent popups — redirect to same iframe
        injectWindowOpenOverride: function(win, doc) {
            try {
                var origOpen = win.open;
                win.open = function(url, target, features) {
                    if (!url || target === '_self' || target === '_parent' || target === '_top') {
                        return origOpen.call(win, url, target, features);
                    }
                    // Redirect popup/new-tab to same iframe
                    var embedUrl = IframeBridge.getEmbedUrl(url || 'about:blank');
                    var targetIframe = findIframeForDoc(doc);
                    if (targetIframe) targetIframe.src = embedUrl;
                    return null; // block the popup
                };
            } catch(e) {}
        },

        // Handle postMessage from iframe windows
        handleMessage: function(e) {
            var msg = e.data;
            if (!msg || typeof msg.type !== 'string') return;

            switch (msg.type) {
                case 'open-window':
                    if (msg.url) {
                        WM.open(msg.url, msg.title || '');
                    }
                    break;

                case 'set-title':
                    if (msg.id) {
                        WM.setTitle(msg.id, msg.title || '');
                    }
                    break;

                case 'iframe-loaded':
                    // iframe signaled it finished loading
                    // Could update title, but onIframeLoad handles that
                    break;

                case 'uci-changed':
                    DESKTOP.emit('uci-changed', { count: msg.count || 0 });
                    break;
            }
        },

        // Check if URL is a LuCI internal page
        isLuCIUrl: function(url) {
            if (!url) return false;
            // Hash-only links
            if (url.charAt(0) === '#') return false;
            // JavaScript pseudo-links
            if (url.indexOf('javascript:') === 0) return false;
            // External URLs (absolute with different protocol/host)
            if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
                // Same-origin check: if it starts with our origin, treat as internal
                // But we simplify: external http/https are never LuCI internal
                return false;
            }
            // Must be a LuCI path
            return url.indexOf('/cgi-bin/luci/') === 0 || url.indexOf('/admin/') === 0;
        },

        // Get embed URL — rebuild the query properly so embed=1 is always
        // a clean parameter. Substring checks fail on URLs whose query was
        // built from a REQUEST_URI that already carried '?embed=1'
        // (double-question-mark mangling, e.g. '?embed=1?tab.x=y' from app
        // templates) — those must be repaired, not passed through.
        getEmbedUrl: function(url) {
            if (!url) return url;
            // Only LuCI/relative paths get the embed param
            if (url.charAt(0) !== '/' && url.indexOf('http') !== 0) return url;
            var qi = url.indexOf('?');
            var path = qi === -1 ? url : url.substring(0, qi);
            var q = qi === -1 ? '' : url.substring(qi + 1);
            var kept = [];
            if (q) {
                var parts = q.split('&');
                for (var i = 0; i < parts.length; i++) {
                    var p = parts[i];
                    if (!p) continue;
                    var eq = p.indexOf('=');
                    var key = eq === -1 ? p : p.substring(0, eq);
                    if (key === 'embed') continue;       // drop existing embed
                    if (p.indexOf('?') !== -1) continue; // drop mangled leftovers
                    kept.push(p);
                }
            }
            return path + (kept.length ? '?' + kept.join('&') + '&embed=1' : '?embed=1');
        }
    };

    // Find the iframe element that contains a given document
    function findIframeForDoc(doc) {
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
            try {
                if (iframes[i].contentDocument === doc) return iframes[i];
            } catch(e) {}
        }
        return null;
    }

    DESKTOP.register('iframe-bridge', IframeBridge);
    window.IframeBridge = IframeBridge;
})();
