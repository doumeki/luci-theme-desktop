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
            // Browser tab title = the app the user opened (argon parity:
            // tab shows the menu name, not LuCI's internal page title like
            // "概况"). Remember the shell's original title once so the last
            // window close can restore it (see close()).
            if (!document.querySelector('head title').__desktopTitle) {
                document.querySelector('head title').__desktopTitle = document.title;
            }
            document.title = title;
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
            titlebar.innerHTML =
                '<span class="window-title">' + escapeHTML(title) + '</span>' +
                '<div class="window-controls">' +
                '<button class="btn-minimize" title="' + _('Minimize') + '">&minus;</button>' +
                '<button class="btn-maximize" title="' + _('Maximize') + '">&#x25A1;</button>' +
                '<button class="btn-close" title="' + _('Close') + '">&#x2715;</button>' +
                '</div>';

            titlebar.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                startDrag(id, e.clientX, e.clientY);
            });

            // Double-click detection (manual — more reliable than dblclick event)
            var lastClickTime = 0;
            titlebar.addEventListener('mousedown', function(e) {
                if (e.target.closest('button')) return; // ignore control buttons
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
                if (loading && loading.parentNode) loading.remove();
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
                el: win
            };

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
                // Last window closed → restore the default shell tab title
                // (set by WM.open; header <title> is the LuCI page name).
                if (Object.keys(DESKTOP.windows).length === 0) {
                    var hdr = document.querySelector('head title');
                    if (hdr && hdr.__desktopTitle) document.title = hdr.__desktopTitle;
                }
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
            w.el.style.zIndex = DESKTOP.nextZIndex++;
            DESKTOP.activeWindowId = id;

            if (DESKTOP.emit) DESKTOP.emit('window-focused', {id: id});
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
