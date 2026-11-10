/* Desktop Theme - Window Manager
 *
 * Window lifecycle: create, close, focus, minimize, maximize, drag, resize.
 * Depends on: shell.js (loaded first)
 */
(function() {
    'use strict';

    var DESKTOP = window.LuCIDesktop;
    if (!DESKTOP) { console.error('wm.js: LuCIDesktop namespace not found'); return; }

    var CASCADE_OFFSET = 30;
    var CASCADE_LEVELS = 4;      // max 4 cascade slots (120px); the 5th
                                 // window wraps back to the start position
    var MIN_WIDTH = 320;
    var MIN_HEIGHT = 200;
    var DEFAULT_WIDTH = 1100;
    var DEFAULT_HEIGHT = 700;
    var DEFAULT_LEFT = 80;
    var DEFAULT_TOP = 40;
    var WINDOW_BOTTOM_GAP = 12;   // gap between a window and the taskbar
    var PIN_BASE = 10000;         // pinned windows live in a high z-index
                                 // band (PIN_BASE + pinSeq) so they always
                                 // stay above every normal window
    var pinSeq = 0;

    // Cascade slot for a NEW window, derived from how many windows are
    // currently on screen — closing windows naturally moves the next
    // opening back toward the start (no ever-growing counter, so a window
    // opened after everything was closed starts at the best position).
    // Level wraps at CASCADE_LEVELS so windows never march off screen.
    function cascadeSlot() {
        var visible = 0;
        document.querySelectorAll('.window').forEach(function(w) {
            if (w.style.display !== 'none' && !w.classList.contains('maximized')) visible++;
        });
        var level = visible % CASCADE_LEVELS;
        return { x: DEFAULT_LEFT + level * CASCADE_OFFSET, y: DEFAULT_TOP + level * CASCADE_OFFSET };
    }

    // Height ceiling for a normal (non-maximized) window: never exceed the
    // default size, and never push the window's bottom edge past the visible
    // area above the taskbar (top is taken into account — a window opened
    // lower on screen gets a smaller ceiling so its bottom stays in view).
    // Maximize uses its own CSS rule (calc(100% - taskbar)) — this caps the
    // open size and the resize drag so a small screen can't be overflowed.
    function maxWindowHeight(top) {
        var taskbar = document.getElementById('taskbar');
        var tbH = taskbar ? taskbar.offsetHeight : 44;
        var avail = window.innerHeight - tbH - WINDOW_BOTTOM_GAP;
        var h = Math.min(DEFAULT_HEIGHT, avail);
        if (typeof top === 'number') h = Math.min(h, avail - top);
        return Math.max(MIN_HEIGHT, h);
    }

    var WM = {
        init: function() {
            // Bind document-level events for drag/resize
            document.addEventListener('mousemove', handleMouseMove);
            // Mouseup can be lost when releasing outside the browser window,
            // leaving the drag overlay + disabled iframes behind. End any
            // drag/resize on window blur as a safety net.
            window.addEventListener('blur', function() {
                var winId = DESKTOP.dragging && DESKTOP.dragging.winId;
                DESKTOP.hideDragOverlay();
                DESKTOP.dragging = null;
                DESKTOP.resizing = null;
                if (winId && DESKTOP.windows && DESKTOP.windows[winId]) {
                    DESKTOP.windows[winId].el.style.cursor = '';
                }
            });
            document.addEventListener('mouseup', handleMouseUp);
            // Touch support
            document.addEventListener('touchmove', handleTouchMove, {passive: false});
            document.addEventListener('touchend', handleTouchEnd);
        },

        open: function(url, title, icon) {
            // Single-instance: same app URL → focus existing window instead of opening a new one
            for (var _id in DESKTOP.windows) {
                var _w = DESKTOP.windows[_id];
                if (_w.url === url) {
                    if (_w.minimized) WM.restore(_id);
                    WM.focus(_id);
                    return;
                }
            }

            var id = DESKTOP.nextId();
            title = title || _('Untitled');
            // Do NOT change document.title here. LuCI/renderer owns the
            // browser tab title; the desktop window titlebar/taskbar uses
            // the passed title only. (User request 2026-09-18: stop
            // overriding the page title; keep the original behavior.)
            var slot = cascadeSlot();
            var winH = maxWindowHeight(slot.y);

            // Create window element
            var win = document.createElement('div');
            win.className = 'window';
            win.setAttribute('data-window-id', id);
            win.style.cssText =
                'left:' + slot.x + 'px;' +
                'top:' + slot.y + 'px;' +
                'width:' + DEFAULT_WIDTH + 'px;' +
                'height:' + winH + 'px;' +
                'z-index:' + (DESKTOP.nextZIndex++) + ';';

            // Titlebar
            var titlebar = document.createElement('div');
            titlebar.className = 'window-titlebar';
            /* Monochrome svg glyphs for the chrome buttons: they inherit
             * hover / pinned tint via currentColor and stay crisp at any
             * row height (the old emoji + unicode arrows could not tint). */
            var TBIC = {
                pin: '<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
                back: '<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
                forward: '<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
                reload: '<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
                lock: '<svg class="tb-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
            };
            /* Two-row chrome v2 (tab-picker batch):
             * row 1 = the app page's top tabs (mirrored out of the iframe)
             *         + window controls on the right. No static window
             *         title here: a tabbed window is identified by the
             *         address bar on row 2 (window.has-tabs switches it).
             * row 2 = pin / back / forward / address (= window title) /
             *         reload. The page's own top tab bar is hidden by the
             *         bridge; the mirror proxies clicks back into the
             *         iframe document. */
            titlebar.innerHTML =
                '<div class="titlebar-row titlebar-main">' +
                '<span class="window-title">' + escapeHTML(title) + '</span>' +
                '<div class="titlebar-tabs">' +
                '</div>' +
                '<div class="window-controls">' +
                '<button class="btn-minimize" title="' + _('Minimize') + '">&minus;</button>' +
                '<button class="btn-maximize" title="' + _('Maximize') + '">&#x25A1;</button>' +
                '<button class="btn-close" title="' + _('Close') + '">&#x2715;</button>' +
                '</div>' +
                '</div>' +
                '<div class="titlebar-row window-tools">' +
                '<button class="btn-pin" title="' + _('Pin to top') + '">' + TBIC.pin + '</button>' +
                '<div class="window-nav">' +
                '<button class="btn-back" title="' + _('Back') + '">' + TBIC.back + '</button>' +
                '<button class="btn-forward" title="' + _('Forward') + '">' + TBIC.forward + '</button>' +
                '</div>' +
                '<div class="titlebar-addr">' + TBIC.lock +
                '<span class="titlebar-addr-text"></span>' +
                '<span class="titlebar-addr-hint">' + _('Search...') + '</span>' +
                '</div>' +
                '<div class="window-nav window-nav-reload">' +
                '<button class="btn-reload" title="' + _('Refresh') + '">' + TBIC.reload + '</button>' +
                '</div>' +
                '</div>';
            titlebar.querySelector('.titlebar-addr-text').textContent = title;

            titlebar.addEventListener('mousedown', function(e) {
                /* The nav buttons carry <svg> glyphs (v2): pressing the
                 * icon makes e.target the svg/path, not the BUTTON, and
                 * a BUTTON-only check started a window drag on arrow
                 * presses ("clicking the arrow does nothing, clicking
                 * beside it works"). closest('button') covers glyph
                 * hits. */
                if (e.target.closest('button') || e.target.closest('.titlebar-addr')) return;
                startDrag(id, e.clientX, e.clientY);
            });

            // Double-click detection (manual — more reliable than dblclick event)
            var lastClickTime = 0;
            titlebar.addEventListener('mousedown', function(e) {
                if (e.target.closest('button') || e.target.closest('.titlebar-addr')) return; // ignore control buttons
                var now = Date.now();
                if (!DESKTOP.isMobile() && now - lastClickTime < 400) {
                    // Double-click detected
                    WM.toggleMaximize(id);
                    lastClickTime = 0;
                } else {
                    lastClickTime = now;
                }
            });

            // Body with iframe
            var body = document.createElement('div');
            body.className = 'window-body';

            // Loading placeholder while the app page loads
            var loading = document.createElement('div');
            loading.className = 'window-loading';
            loading.innerHTML =
                '<div class="window-loading-spinner"></div>' +
                '<div class="window-loading-text">' + _('Loading...') + '</div>';
            body.appendChild(loading);

            var iframe = document.createElement('iframe');
            iframe.src = this.getEmbedUrl(url);

            // Wire up iframe bridge: inject CSS, intercept links, detect logout
            iframe.addEventListener('load', function() {
                if (loading && loading.parentNode) {
                    // The app is already visible behind the hint (it is a
                    // floating chip, not an overlay) — just fade it out.
                    loading.style.opacity = '0';
                    setTimeout(function() { if (loading.parentNode) loading.remove(); }, 300);
                }
                if (window.IframeBridge) {
                    IframeBridge.onIframeLoad(iframe, id);
                }
            });

            body.appendChild(iframe);

            // Resize handles (8 directions)
            var handles = ['nw','n','ne','e','se','s','sw','w'];
            handles.forEach(function(dir) {
                var handle = document.createElement('div');
                handle.className = 'resize-handle resize-' + dir;
                handle.addEventListener('mousedown', function(e) {
                    e.stopPropagation();
                    startResize(id, dir, e.clientX, e.clientY);
                });
                win.appendChild(handle);
            });

            win.appendChild(titlebar);
            win.appendChild(body);

            // Button event handlers
            win.querySelector('.btn-close').addEventListener('click', function() {
                WM.close(id);
            });
            win.querySelector('.btn-minimize').addEventListener('click', function() {
                WM.minimize(id);
            });
            win.querySelector('.btn-maximize').addEventListener('click', function() {
                WM.toggleMaximize(id);
            });
            win.querySelector('.btn-pin').addEventListener('click', function() {
                WM.togglePin(id);
            });

            // In-window browser navigation (0.1.0-303). A LuCI page can hop
            // the frame to another port (ttyd :7681, https :443, …) — a
            // different origin, where the browser forbids reading history.
            // So the window keeps its own URL stack and navigates by src;
            // cross-origin hops still get a working "back" (to the last
            // page we know) instead of three dead buttons.
            /* ---- Tab mirror: browser-style tabs for the app page ----
             * Mirrors the first ul.cbi-tabmenu/ul.tabs/ul.nav-tabs of the
             * frame document (same-origin only) into .titlebar-tabs; clicks
             * are proxied back into the page. Activation and re-rendered
             * bars follow through a debounced MutationObserver - no polling. */
            var tabStrip = titlebar.querySelector('.titlebar-tabs');
            /* Mouse utility: wheel over the strip pans it horizontally.
             * Touch devices pan natively via overflow-x:auto; phones get
             * finger swipe for free, hidden scrollbar either way. */
            tabStrip.addEventListener('wheel', function(ev) {
                if (tabStrip.scrollWidth <= tabStrip.clientWidth) return;
                tabStrip.scrollLeft += (ev.deltaY || 0);
                if (tabStrip.scrollLeft > 0 &&
                    tabStrip.scrollLeft < tabStrip.scrollWidth - tabStrip.clientWidth) {
                    ev.preventDefault();
                }
            }, { passive: false });
            /* Keep the active pill inside the viewport when the strip
             * overflows (called on rebuilds only, never mid-scroll). */
            function alignTabStrip() {
                var act = tabStrip.querySelector('.tb-active');
                var max = tabStrip.scrollWidth - tabStrip.clientWidth;
                if (!act || max <= 0) return;
                var t = act.offsetLeft + act.offsetWidth - tabStrip.clientWidth + 8;
                tabStrip.scrollLeft = Math.max(0, Math.min(t, max));
            }
            var tabSig = '';
            var tabUl = null;
            var tabObs = null;
            var tabTail = null;
            var tabScanAt = 0;
            function stopTabObs() {
                if (tabObs) { try { tabObs.disconnect(); } catch (e) {} tabObs = null; }
                if (tabTail) { try { clearTimeout(tabTail); } catch (e) {} tabTail = null; }
            }
            function tabActive(li) {
                if (li.classList.contains('active') ||
                    li.classList.contains('selected') ||
                    li.classList.contains('cbi-tab')) return true;
                return !!li.querySelector('a.active, a.selected');
            }
            function syncWindowTabs() {
                tabScanAt = Date.now();
                var doc = null;
                try { doc = iframe.contentDocument; } catch (e) { doc = null; }
                var ul = null;
                if (doc && doc.body) {
                    try { ul = doc.querySelector('ul.cbi-tabmenu, ul.tabs, ul.nav-tabs'); } catch (e2) { ul = null; }
                }
                if (!ul || !ul.parentNode) ul = null;
                if (ul) {
                    /* the page's own top bar moves into the chrome */
                    try { ul.style.setProperty('display', 'none', 'important'); } catch (e3) {}
                    /* a re-rendered bar (client-side nav) needs a fresh
                       mirror even when labels and active state are equal */
                    if (ul !== tabUl) { tabUl = ul; tabSig = ''; }
                    var lis = ul.querySelectorAll(':scope > li');
                    if (!lis.length) lis = ul.children;
                    var labs = [], act = -1, k;
                    for (k = 0; k < lis.length; k++) {
                        if (tabActive(lis[k])) act = labs.length;
                        labs.push((lis[k].textContent || '').replace(/\s+/g, ' ').trim());
                    }
                    var sig = labs.join('\u0001') + '#' + act;
                    if (sig !== tabSig) {
                        tabSig = sig;
                        tabStrip.innerHTML = '';
                        for (k = 0; k < labs.length; k++) {
                            var b = document.createElement('button');
                            b.type = 'button';
                            b.className = 'tb-tab' + (k === act ? ' tb-active' : '');
                            b.textContent = labs[k];
                            (function(node, lab) {
                                b.addEventListener('click', function(ev) {
                                    ev.stopPropagation();
                                    ev.preventDefault();
                                    var t = null;
                                    try {
                                        /* Resolve against the live document: the
                                         * captured node dies with its page on
                                         * navigation and a click on a detached
                                         * node is a silent no-op. Re-find the
                                         * tab by its label in the current page. */
                                        var docL = null;
                                        try { docL = iframe.contentDocument; } catch (eL0) { docL = null; }
                                        if (docL && docL.body) {
                                            var ulL = null;
                                            try {
                                                ulL = docL.querySelector('ul.cbi-tabmenu, ul.tabs, ul.nav-tabs');
                                            } catch (eL1) { ulL = null; }
                                            if (ulL && ulL.parentNode) {
                                                var lisL = ulL.querySelectorAll(':scope > li');
                                                if (!lisL.length) lisL = ulL.children;
                                                var k2;
                                                for (k2 = 0; k2 < lisL.length; k2++) {
                                                    if (((lisL[k2].textContent || '').
                                                        replace(/\s+/g, ' ').trim()) === lab) {
                                                        t = lisL[k2].querySelector('a, button') || lisL[k2];
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    } catch (eL) { t = null; }
                                    try {
                                        if (t) {
                                            try {
                                                var hT = t.getAttribute ? t.getAttribute('href') : null;
                                                if (hT) pendSet(pendCalc(hT), ev.currentTarget);
                                            } catch (eT) {}
                                            t.click();
                                            return;
                                        }
                                        /* Stale mirror (document swapped under
                                         * the strip mid-load): drive the
                                         * navigation instead of dead-clicking
                                         * the detached node. Hash/javascript
                                         * targets have no embed form and must
                                         * stay out of src. */
                                        var aS = node.querySelector('a[href]');
                                        var href = aS ? aS.getAttribute('href') : null;
                                        var uT = pendCalc(href);
                                        /* One load per destination: rapid
                                         * taps inside the committed/empty
                                         * window must wait for the same
                                         * flight instead of restarting it. */
                                        if (uT && navPend !== uT) {
                                            pendSet(uT, ev.currentTarget);
                                            iframe.src = uT;
                                        } else if (uT) {
                                            pendSet(uT, ev.currentTarget);
                                        }
                                    } catch (e4) {}
                                });
                            })(lis[k], labs[k]);
                            tabStrip.appendChild(b);
                        }
                        /* Window identity: static title in row 1 leaves,
                         * the tools-row address bar takes over. */
                        win.classList.add('has-tabs');
                        alignTabStrip();
                        tabStrip.classList.remove('tb-fade');
                        void tabStrip.offsetWidth;
                        tabStrip.classList.add('tb-fade');
                    }
                } else if (tabSig !== '' || tabUl) {
                    tabSig = '';
                    tabUl = null;
                    tabStrip.innerHTML = '';
                    win.classList.remove('has-tabs');
                }
                stopTabObs();
                if (doc && doc.body) {
                    try {
                        tabObs = new MutationObserver(function() { scheduleTabScan(); });
                        tabObs.observe(doc.body, { subtree: true, childList: true,
                            attributes: true, attributeFilter: ['class'] });
                    } catch (e5) { tabObs = null; }
                }
            }
            function scheduleTabScan() {
                var wait = 60 - (Date.now() - tabScanAt);
                if (tabTail) { try { clearTimeout(tabTail); } catch (e6) {} tabTail = null; }
                if (wait <= 0) { syncWindowTabs(); return; }
                tabTail = setTimeout(syncWindowTabs, wait);
            }
            var navBtns = {
                back: win.querySelector('.btn-back'),
                forward: win.querySelector('.btn-forward'),
                reload: win.querySelector('.btn-reload')
            };
            var navStack = [iframe.src];
            var navIndex = 0;
            var navOpaque = false;        // current document is cross-origin
            var navSeenSameOrigin = false; // at least one readable URL so far
            var navPend = null;           // embed URL of an in-flight mirror navigation
            var navPendBtn = null;        // mirror pill waiting for that load
            function pendCalc(hRaw) {
                try {
                    if (!hRaw || hRaw.charAt(0) === '#' || hRaw.indexOf('javascript:') === 0) return null;
                    return (window.IframeBridge && IframeBridge.getEmbedUrl) ? IframeBridge.getEmbedUrl(hRaw) : hRaw;
                } catch (eP) { return null; }
            }
            function pendSet(u, btn) { navPend = u || null; navPendBtn = btn || null; }
            function pendClear() {
                var b1 = navPendBtn;
                navPend = null;
                navPendBtn = null;
                try { if (b1 && b1.style) b1.style.opacity = ''; } catch (eC) {}
            }

            function navGo(urlTo) {
                navOpaque = false;
                iframe.src = urlTo;
            }
            function updateNav() {
                navBtns.back.disabled = !(navIndex > 0 || (navOpaque && navSeenSameOrigin));
                navBtns.forward.disabled = !(!navOpaque && navIndex < navStack.length - 1);
                navBtns.reload.disabled = false;
            }
            navBtns.back.addEventListener('click', function(e) {
                e.stopPropagation();
                if (navIndex > 0) {
                    navIndex--;
                    navGo(navStack[navIndex]);
                } else if (navOpaque && navSeenSameOrigin) {
                    navGo(navStack[navIndex]);
                } else {
                    /* Empty own stack. A mirror navigation may still be
                     * in flight: LET IT FINISH. Stopping it here turned
                     * impatient back presses into "page never opens"
                     * (user-reported regression). Give visible feedback
                     * instead: dim the pending pill briefly. With no
                     * pending flight of ours, still stop stray loading. */
                    var b0 = navPend;
                    var btn0 = navPendBtn;
                    try {
                        if (btn0 && btn0.style) {
                            btn0.style.opacity = '0.35';
                            setTimeout(function() {
                                try { btn0.style.opacity = ''; } catch (eB2) {}
                            }, 900);
                        }
                    } catch (eB1) {}
                    if (!b0) { try { iframe.contentWindow.stop(); } catch (eB3) {} }
                }
            });
            navBtns.forward.addEventListener('click', function(e) {
                e.stopPropagation();
                if (!navOpaque && navIndex < navStack.length - 1) {
                    navIndex++;
                    navGo(navStack[navIndex]);
                }
            });
            navBtns.reload.addEventListener('click', function(e) {
                e.stopPropagation();
                if (navOpaque) {
                    navGo(navStack[navIndex]);
                } else {
                    try { iframe.contentWindow.location.reload(); }
                    catch (err) { navGo(navStack[navIndex]); }
                }
            });
            iframe.addEventListener('load', function() {
                pendClear();
                var href = null;
                try { href = iframe.contentWindow.location.href; } catch (err) { href = null; }
                if (href) {
                    navOpaque = false;
                    navSeenSameOrigin = true;
                    if (href !== navStack[navIndex]) {
                        navStack = navStack.slice(0, navIndex + 1);
                        navStack.push(href);
                        navIndex = navStack.length - 1;
                    }
                } else {
                    navOpaque = true;
                }
                updateNav();
                syncWindowTabs();
            });
            updateNav();
            syncWindowTabs();

            // Focus on mousedown anywhere in window
            win.addEventListener('mousedown', function() {
                WM.focus(id);
            });

            document.getElementById('window-container').appendChild(win);

            // Register window
            DESKTOP.windows[id] = {
                id: id,
                url: url,
                title: title,
                icon: icon || null,
                minimized: false,
                pinned: false,
                el: win
            };
            DESKTOP.windows[id]._tabStop = function() { stopTabObs(); };

            WM.focus(id);

            // Notify other subsystems
            // Open animation
            win.classList.add('anim-open');
            win.addEventListener('animationend', function() { win.classList.remove('anim-open'); }, {once: true});

            if (DESKTOP.emit) DESKTOP.emit('window-opened', {id: id, title: title, url: url});

            return id;
        },

        close: function(id) {
            var w = DESKTOP.windows[id];
            if (!w || w._closing) return;
            w._closing = true;
            if (w._tabStop) { try { w._tabStop(); } catch (e) {} }
            var done = false;
            var finish = function() {
                if (done) return;
                done = true;
                if (w.el && w.el.parentNode) {
                    w.el.parentNode.removeChild(w.el);
                }
                if (DESKTOP.activeWindowId === id) {
                    DESKTOP.activeWindowId = null;
                }
                delete DESKTOP.windows[id];
                if (DESKTOP.emit) DESKTOP.emit('window-closed', {id: id});
            };
            // Mobile (or already-hidden windows): close instantly — the
            // anim-close animation never runs on display:none elements, so
            // relying on animationend alone would leave the window behind.
            if (DESKTOP.isMobile() || w.el.style.display === 'none') {
                finish();
                return;
            }
            // Desktop: animate out, then remove
            w.el.classList.add('anim-close');
            w.el.addEventListener('animationend', finish, {once: true});
        },

        focus: function(id) {
            var w = DESKTOP.windows[id];
            if (!w) return;

            // Remove focused class from all windows
            Object.keys(DESKTOP.windows).forEach(function(wid) {
                var el = DESKTOP.windows[wid].el;
                if (el) el.classList.remove('focused');
            });

            w.el.classList.add('focused');
            // Pinned windows live in the high z-index band and always stay
            // above every normal window; normal windows keep ascending.
            w.el.style.zIndex = w.pinned ? (PIN_BASE + (++pinSeq)) : (DESKTOP.nextZIndex++);
            DESKTOP.activeWindowId = id;

            if (DESKTOP.emit) DESKTOP.emit('window-focused', {id: id});
        },

        // Pin / unpin a window: it stays on top of every other window and
        // its taskbar tab stays at the front of the taskbar.
        togglePin: function(id) {
            var w = DESKTOP.windows[id];
            if (!w) return;
            this.setPinned(id, !w.pinned);
        },

        setPinned: function(id, pinned) {
            var w = DESKTOP.windows[id];
            if (!w || !!w.pinned === !!pinned) return;
            w.pinned = !!pinned;
            if (w.el) {
                w.el.classList.toggle('pinned', w.pinned);
                var btn = w.el.querySelector('.btn-pin');
                if (btn) btn.classList.toggle('active', w.pinned);
            }
            this.focus(id);
            if (DESKTOP.emit) DESKTOP.emit('window-pinned', {id: id, pinned: w.pinned});
        },

        minimize: function(id) {
            var w = DESKTOP.windows[id];
            if (!w || w._minimizing) return;
            if (DESKTOP.isMobile()) {
                // Mobile: hide instantly (no taskbar to shrink to — the
                // app switcher restores the window)
                w.el.style.display = 'none';
                w.minimized = true;
                if (DESKTOP.activeWindowId === id) DESKTOP.activeWindowId = null;
                DESKTOP.emit('window-minimized', {id: id});
                return;
            }
            w._minimizing = true;
            w.el.classList.add('anim-minimize');
            w.el.addEventListener('animationend', function() {
                w.el.style.display = 'none';
                w.el.classList.remove('anim-minimize');
                w._minimizing = false;
                w.minimized = true;
                if (DESKTOP.activeWindowId === id) {
                    DESKTOP.activeWindowId = null;
                }
                if (DESKTOP.emit) DESKTOP.emit('window-minimized', {id: id});
            }, {once: true});
        },

        restore: function(id) {
            var w = DESKTOP.windows[id];
            if (!w) return;
            w.el.style.display = '';
            w.minimized = false;
            w.el.classList.add('anim-restore');
            w.el.addEventListener('animationend', function() { w.el.classList.remove('anim-restore'); }, {once: true});
            WM.focus(id);
            if (DESKTOP.emit) DESKTOP.emit('window-restored', {id: id});
        },

        toggleMaximize: function(id) {
            var w = DESKTOP.windows[id];
            if (!w) return;
            w.el.classList.toggle('maximized');
        },

        setTitle: function(id, title) {
            var w = DESKTOP.windows[id];
            if (!w) return;
            w.title = title;
            var titleEl = w.el.querySelector('.window-title');
            if (titleEl) {
                titleEl.textContent = title;
            }
            var addrEl = w.el.querySelector('.titlebar-addr-text');
            if (addrEl) {
                addrEl.textContent = title;
            }
            if (DESKTOP.emit) DESKTOP.emit('window-title-changed', {id: id, title: title});
        },

        getEmbedUrl: function(url) {
            // Same rules as IframeBridge.getEmbedUrl: rebuild the query so
            // embed=1 is a clean parameter, never duplicated or mangled.
            if (!url) return url;
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
                    if (key === 'embed') continue;
                    if (p.indexOf('?') !== -1) continue;
                    kept.push(p);
                }
            }
            return path + (kept.length ? '?' + kept.join('&') + '&embed=1' : '?embed=1');
        }
    };

    // ===== Drag/Resize (uses unified overlay from LuCIDesktop) =====

    // ===== Drag Implementation =====
    function startDrag(winId, clientX, clientY) {
        if (DESKTOP.isMobile()) return;   // mobile: fullscreen windows, no drag
        var w = DESKTOP.windows[winId];
        if (!w || w.el.classList.contains('maximized')) return;

        DESKTOP.dragging = {
            winId: winId,
            startX: clientX,
            startY: clientY,
            origLeft: parseInt(w.el.style.left) || 0,
            origTop: parseInt(w.el.style.top) || 0
        };
        w.el.style.cursor = 'grabbing';
        DESKTOP.showDragOverlay();
    }

    function handleMouseMove(e) {
        if (!DESKTOP.dragging && !DESKTOP.resizing) return;

        if (DESKTOP.dragging) {
            var d = DESKTOP.dragging;
            var w = DESKTOP.windows[d.winId];
            if (!w) return;
            var dx = e.clientX - d.startX;
            var dy = e.clientY - d.startY;
            w.el.style.left = (d.origLeft + dx) + 'px';
            w.el.style.top = DESKTOP.clamp(d.origTop + dy, 0, Infinity) + 'px';
        }

        if (DESKTOP.resizing) {
            handleResizeMove(e);
        }
    }

    function handleMouseUp(e) {
        DESKTOP.hideDragOverlay();
        if (DESKTOP.dragging) {
            var w = DESKTOP.windows[DESKTOP.dragging.winId];
            if (w) w.el.style.cursor = '';
            DESKTOP.dragging = null;
        }
        if (DESKTOP.resizing) {
            var rw = DESKTOP.windows[DESKTOP.resizing.winId];
            if (rw) rw.el.style.cursor = '';
            DESKTOP.resizing = null;
        }
    }

    // ===== Resize Implementation =====
    function startResize(winId, direction, clientX, clientY) {
        if (DESKTOP.isMobile()) return;   // mobile: fullscreen windows, no resize
        var w = DESKTOP.windows[winId];
        if (!w || w.el.classList.contains('maximized')) return;

        DESKTOP.resizing = {
            winId: winId,
            dir: direction,
            startX: clientX,
            startY: clientY,
            origLeft: parseInt(w.el.style.left) || 0,
            origTop: parseInt(w.el.style.top) || 0,
            origWidth: parseInt(w.el.style.width) || DEFAULT_WIDTH,
            origHeight: parseInt(w.el.style.height) || DEFAULT_HEIGHT
        };
        DESKTOP.showDragOverlay();
    }

    function handleResizeMove(e) {
        var r = DESKTOP.resizing;
        if (!r) return;
        var w = DESKTOP.windows[r.winId];
        if (!w) return;

        var dx = e.clientX - r.startX;
        var dy = e.clientY - r.startY;
        var dir = r.dir;

        var newLeft = r.origLeft;
        var newTop = r.origTop;
        var newWidth = r.origWidth;
        var newHeight = r.origHeight;

        if (dir.indexOf('e') !== -1) { newWidth = DESKTOP.clamp(r.origWidth + dx, MIN_WIDTH, Infinity); }
        if (dir.indexOf('w') !== -1) {
            newWidth = DESKTOP.clamp(r.origWidth - dx, MIN_WIDTH, Infinity);
            newLeft = r.origLeft + (r.origWidth - newWidth);
        }
        if (dir.indexOf('s') !== -1) { newHeight = DESKTOP.clamp(r.origHeight + dy, MIN_HEIGHT, maxWindowHeight(r.origTop)); }
        if (dir.indexOf('n') !== -1) {
            // Pulling the top edge up does not move the bottom edge, so the
            // window can't overflow the taskbar — only keep the titlebar on
            // screen (top >= 0).
            newHeight = DESKTOP.clamp(r.origHeight - dy, MIN_HEIGHT, Infinity);
            newTop = Math.max(0, r.origTop + (r.origHeight - newHeight));
        }

        w.el.style.left = newLeft + 'px';
        w.el.style.top = newTop + 'px';
        w.el.style.width = newWidth + 'px';
        w.el.style.height = newHeight + 'px';
    }

    // ===== Touch Support =====
    function handleTouchMove(e) {
        if (DESKTOP.dragging || DESKTOP.resizing) {
            e.preventDefault();
            var touch = e.touches[0];
            if (touch) {
                handleMouseMove({clientX: touch.clientX, clientY: touch.clientY});
            }
        }
    }

    function handleTouchEnd(e) {
        handleMouseUp({});
    }

    // ===== Helpers =====
    function escapeHTML(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // Register as subsystem and expose as global WM
    DESKTOP.register('wm', WM);
    window.WM = WM;
})();
