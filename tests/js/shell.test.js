/* shell.test.js — LuCIDesktop Utility Tests
 *
 * Tests for: clamp(), showDragOverlay(), hideDragOverlay()
 * These are core utilities that wm.js, panel-helper.js, and widget.js depend on.
 */
(function() {
'use strict';

var DESKTOP = window.LuCIDesktop;

// ===== clamp(value, min, max) =====
describe('LuCIDesktop.clamp', function() {

    it('should return value when within range', function() {
        assert.equal(DESKTOP.clamp(5, 0, 10), 5, 'value 5 in [0,10]');
        assert.equal(DESKTOP.clamp(0, 0, 10), 0, 'value 0 in [0,10]');
        assert.equal(DESKTOP.clamp(10, 0, 10), 10, 'value 10 in [0,10]');
    });

    it('should return min when value below minimum', function() {
        assert.equal(DESKTOP.clamp(-5, 0, 10), 0, 'negative clamped to 0');
        assert.equal(DESKTOP.clamp(-100, 50, 200), 50, 'far below clamped to 50');
    });

    it('should return max when value above maximum', function() {
        assert.equal(DESKTOP.clamp(100, 0, 10), 10, '100 clamped to 10');
        assert.equal(DESKTOP.clamp(999, 50, 200), 200, '999 clamped to 200');
    });

    it('should handle min equal to max', function() {
        assert.equal(DESKTOP.clamp(5, 7, 7), 7, 'any value → 7 when min=max=7');
    });

    it('should handle Infinity bounds', function() {
        assert.equal(DESKTOP.clamp(5, 0, Infinity), 5, 'Infinity upper bound');
        assert.equal(DESKTOP.clamp(-999, -Infinity, 0), -999, '-Infinity lower bound');
    });

    it('should handle floating point values', function() {
        assert.equal(DESKTOP.clamp(0.5, 0.1, 1.0), 0.5, 'float within range');
        assert.equal(DESKTOP.clamp(0.05, 0.1, 1.0), 0.1, 'float below min');
        assert.equal(DESKTOP.clamp(1.5, 0.1, 1.0), 1.0, 'float above max');
    });

    it('should not coerce strings to numbers (return as-is if within range)', function() {
        // clamp should work with numbers — callers coerce themselves
        // But it should not throw on valid numeric inputs
        assert.equal(DESKTOP.clamp(3, 1, 5), 3, 'basic numeric');
    });

    it('should handle NaN by returning min (defensive)', function() {
        var result = DESKTOP.clamp(NaN, 0, 10);
        assert.ok(isNaN(result) || result === 0, 'NaN → NaN or 0');
    });
});

// ===== Drag Overlay (unified) =====
describe('LuCIDesktop drag overlay', function() {

    function createTestIframe() {
        var iframe = document.createElement('iframe');
        iframe.className = 'test-iframe';
        iframe.style.cssText = 'width:100px;height:100px;';
        document.body.appendChild(iframe);
        return iframe;
    }

    function cleanupIframes() {
        var frames = document.querySelectorAll('iframe.test-iframe');
        frames.forEach(function(f) { f.remove(); });
    }

    afterEach(function() {
        // Always clean up overlay (in case a test fails mid-way)
        DESKTOP.hideDragOverlay();
        cleanupIframes();
    });

    it('showDragOverlay should create a full-screen overlay div', function() {
        DESKTOP.showDragOverlay();
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.ok(overlay, 'overlay element created');
        assert.equal(overlay.style.position, 'fixed', 'position fixed');
        assert.equal(overlay.style.inset, '0px', 'full screen inset');
        assert.contains(overlay.style.zIndex, '9999', 'high z-index');
    });

    it('showDragOverlay should not create duplicate overlays', function() {
        DESKTOP.showDragOverlay();
        DESKTOP.showDragOverlay();
        var overlays = document.querySelectorAll('#__desktop-drag-overlay');
        assert.equal(overlays.length, 1, 'only one overlay');
    });

    it('hideDragOverlay should remove the overlay', function() {
        DESKTOP.showDragOverlay();
        DESKTOP.hideDragOverlay();
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.isNull(overlay, 'overlay removed');
    });

    it('hideDragOverlay should be safe to call when no overlay exists', function() {
        // Should not throw
        DESKTOP.hideDragOverlay();
        assert.ok(true, 'no throw on redundant hideDragOverlay');
    });

    it('should set cursor from options', function() {
        DESKTOP.showDragOverlay({cursor: 'move'});
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.equal(overlay.style.cursor, 'move', 'cursor set from options');
        DESKTOP.hideDragOverlay();

        DESKTOP.showDragOverlay({cursor: 'grabbing'});
        overlay = document.getElementById('__desktop-drag-overlay');
        assert.equal(overlay.style.cursor, 'grabbing', 'cursor grabbing');
    });

    it('should default cursor to grabbing', function() {
        DESKTOP.showDragOverlay();
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.equal(overlay.style.cursor, 'grabbing', 'default cursor');
    });

    it('should disable pointerEvents on iframes during overlay', function() {
        var iframe = createTestIframe();
        DESKTOP.showDragOverlay();
        // Overlay should exist and take events — our iframe's pointer-events
        // gets set to 'none' by showDragOverlay
        assert.equal(iframe.style.pointerEvents, 'none', 'iframe pointerEvents disabled');
    });

    it('should restore pointerEvents on iframes after hide', function() {
        var iframe = createTestIframe();
        iframe.style.pointerEvents = 'auto'; // initial state
        DESKTOP.showDragOverlay();
        assert.equal(iframe.style.pointerEvents, 'none', 'disabled during drag');
        DESKTOP.hideDragOverlay();
        // hideDragOverlay clears the inline style (sets to ''), restoring CSS default
        assert.equal(iframe.style.pointerEvents, '', 'inline style cleared after hide');
    });

    it('should restore pointerEvents to empty string on iframes (CSS default)', function() {
        var iframe = createTestIframe();
        // Simulate iframe with no explicit pointerEvents set
        iframe.style.pointerEvents = '';
        DESKTOP.showDragOverlay();
        assert.equal(iframe.style.pointerEvents, 'none', 'disabled during drag');
        DESKTOP.hideDragOverlay();
        assert.equal(iframe.style.pointerEvents, '', 'empty string restored');
    });

    it('should set z-index from options', function() {
        DESKTOP.showDragOverlay({zIndex: 88888});
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.contains(overlay.style.zIndex, '88888', 'custom z-index');
    });

    it('showDragOverlay should return the overlay element', function() {
        var el = DESKTOP.showDragOverlay();
        assert.ok(el, 'returns overlay element');
        assert.equal(el.id, '__desktop-drag-overlay', 'correct element returned');
        DESKTOP.hideDragOverlay();
    });

    it('hideDragOverlay after show with options should clean up', function() {
        DESKTOP.showDragOverlay({cursor: 'ew-resize', zIndex: 77777});
        DESKTOP.hideDragOverlay();
        var overlay = document.getElementById('__desktop-drag-overlay');
        assert.isNull(overlay, 'cleaned up after options variant');
    });
});

// ===== isMobile() =====
// Rule (theme-compat-doc B2，记忆库): server UA verdict (__IS_MOBILE__) wins;
// fallback = narrow viewport OR touch-only (coarse pointer without fine).
describe('LuCIDesktop.isMobile', function() {

    var savedVerdict = window.__IS_MOBILE__;
    var savedMatchMedia = window.matchMedia;

    function setMedia(width, coarse, fine) {
        window.matchMedia = function(q) {
            var m = false;
            if (q === '(max-width: 768px)') m = width;
            else if (q === '(pointer: coarse)') m = coarse;
            else if (q === '(pointer: fine)') m = fine;
            return { matches: m, media: q };
        };
    }
    function restore() {
        window.__IS_MOBILE__ = savedVerdict;
        window.matchMedia = savedMatchMedia;
    }

    afterEach(restore);

    it('server verdict true → mobile even on wide fine-pointer screen', function() {
        window.__IS_MOBILE__ = true;
        setMedia(false, false, true);
        assert.ok(DESKTOP.isMobile(), 'server UA verdict wins over all media queries');
    });

    it('server verdict false + wide + mouse → desktop', function() {
        window.__IS_MOBILE__ = false;
        setMedia(false, false, true);
        assert.ok(!DESKTOP.isMobile(), 'desktop UA, desktop hardware');
    });

    it('server verdict false + narrow viewport → mobile (windowed browser)', function() {
        window.__IS_MOBILE__ = false;
        setMedia(true, false, true);
        assert.ok(DESKTOP.isMobile(), 'narrow window wins regardless of UA verdict');
    });

    it('touch-only wide device (no fine pointer) → mobile fallback', function() {
        window.__IS_MOBILE__ = false;
        setMedia(false, true, false);
        assert.ok(DESKTOP.isMobile(), 'tablet/phone without server verdict');
    });

    it('touchscreen WITH mouse (touch laptop / AIO) → desktop', function() {
        window.__IS_MOBILE__ = false;
        setMedia(false, true, true);
        assert.ok(!DESKTOP.isMobile(), 'coarse+fine = desktop hardware, not a phone');
    });

    it('no verdict, no matchMedia → desktop (defensive)', function() {
        window.__IS_MOBILE__ = undefined;
        window.matchMedia = null;
        assert.ok(!DESKTOP.isMobile(), 'undefined media APIs must not throw or flip mobile');
    });

    it('no verdict + narrow + touch-only → mobile', function() {
        window.__IS_MOBILE__ = undefined;
        setMedia(true, true, false);
        assert.ok(DESKTOP.isMobile(), 'no server verdict, phone-like environment');
    });
});

// ===== self.log =====
describe('LuCIDesktop.log', function() {

    it('fire-and-forget GET to the desktop log endpoint', function() {
        var sent = null;
        var realOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) { sent = url; };
        try {
            DESKTOP.log('test line');
            assert.ok(sent && sent.indexOf('/cgi-bin/luci/admin/desktop/log?lines=') === 0,
                'log hits the desktop log endpoint');
            assert.ok(sent.indexOf(encodeURIComponent('[theme] test line')) !== -1,
                'message is URL-encoded into lines= param');
        } finally {
            XMLHttpRequest.prototype.open = realOpen;
        }
    });
});

// ===== Config access layer (P1: unified read/write) =====
describe('LuCIDesktop config access layer', function() {
    var origXHR, posts;

    function setConfigText(obj) {
        document.getElementById('desktop-config').textContent = JSON.stringify(obj);
    }
    function configText() {
        return JSON.parse(document.getElementById('desktop-config').textContent);
    }

    beforeEach(function() {
        setConfigText({ widgets: {}, theme: { titlebar_color: '#123456' } });
        origXHR = window.XMLHttpRequest;
        posts = [];
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function(body) { posts.push(body); };
        };
    });

    afterEach(function() {
        window.XMLHttpRequest = origXHR;
        setConfigText({ widgets: {}, theme: {} });
    });

    it('getConfig parses the injected config; getSection returns one section', function() {
        var c = DESKTOP.getConfig();
        assert.equal(c.theme.titlebar_color, '#123456', 'parsed values');
        var s = DESKTOP.getSection('theme');
        assert.equal(s.titlebar_color, '#123456', 'section read');
        var missing = DESKTOP.getSection('nope');
        assert.ok(typeof missing === 'object' && Object.keys(missing).length === 0,
            'missing section degrades to {}');
    });

    it('bad JSON degrades to {} instead of throwing', function() {
        document.getElementById('desktop-config').textContent = '{not json!!';
        assert.ok(typeof DESKTOP.getConfig() === 'object', 'no throw');
        assert.equal(Object.keys(DESKTOP.getConfig()).length, 0, 'empty object');
    });

    it('re-parses when the DOM text changed externally', function() {
        var c1 = DESKTOP.getConfig();
        setConfigText({ widgets: {}, theme: { titlebar_color: '#ffffff' } });
        var c2 = DESKTOP.getConfig();
        assert.equal(c2.theme.titlebar_color, '#ffffff', 'external DOM write visible');
    });

    it('setSection updates DOM and POSTs once; setSectionLocal updates DOM only', function() {
        DESKTOP.setSection('pins', ['a', 'b']);
        assert.equal(posts.length, 1, 'one POST');
        assert.contains(posts[0], 'section=pins', 'section param');
        assert.equal(configText().pins[1], 'b', 'DOM updated');
        DESKTOP.setSectionLocal('pins', ['c']);
        assert.equal(posts.length, 1, 'no extra POST for local write');
        assert.equal(configText().pins[0], 'c', 'DOM updated locally');
    });

    it('saveDesktopSection returns the XHR and supports a sync send', function() {
        var asyncFlag = null;
        window.XMLHttpRequest = function() {
            this.open = function(m, u, async) { asyncFlag = async; };
            this.setRequestHeader = function() {};
            this.send = function() {};
        };
        var xhr = DESKTOP.saveDesktopSection('settings', {a: 1});
        assert.ok(xhr, 'xhr returned');
        assert.equal(asyncFlag, true, 'default async');
        DESKTOP.saveDesktopSection('settings', {a: 1}, true);
        assert.equal(asyncFlag, false, 'sync flag honored');
    });

    // ===== Pending-flush: async saves survive a quick refresh =====
    // Regression for "widgets vanish / auto-refresh toggle reverts after
    // refresh" on 1.1: a fire-and-forget POST that hasn't left the browser
    // yet is killed by page unload. flushPendingSaves() re-sends the LATEST
    // payload per section synchronously (bugfix 2026-08).
    it('flushPendingSaves re-sends the latest payload per section synchronously', function() {
        var sent = [];
        var asyncFlags = [];
        window.XMLHttpRequest = function() {
            this.open = function(m, u, async) { asyncFlags.push(async); };
            this.setRequestHeader = function() {};
            this.send = function(body) { sent.push(body); };
        };
        // Clear any pending map entries left by earlier tests in this suite.
        DESKTOP.flushPendingSaves();
        sent.length = 0;
        // Simulate rapid successive saves: only the latest must survive.
        DESKTOP.saveDesktopSection('widgets', {v: 1});
        DESKTOP.saveDesktopSection('widgets', {v: 2});
        DESKTOP.saveDesktopSection('settings', {auto_refresh: '0'});
        sent.length = 0;   // ignore the async sends, focus on the flush
        var preFlushFlags = asyncFlags.length;
        DESKTOP.flushPendingSaves();
        assert.equal(sent.length, 2, 'one flush POST per section');
        var widgetsPost = sent.filter(function(b) { return b.indexOf('section=widgets') !== -1; });
        assert.equal(widgetsPost.length, 1, 'widgets flushed once');
        assert.contains(widgetsPost[0], encodeURIComponent(JSON.stringify({v: 2})), 'latest widgets payload');
        assert.ok(sent.some(function(b) { return b.indexOf('section=settings') !== -1 && b.indexOf('auto_refresh') !== -1; }),
            'settings payload');
        asyncFlags.slice(preFlushFlags).forEach(function(f) { assert.equal(f, false, 'flush is synchronous'); });
        // Flushing clears the pending map — a second flush sends nothing.
        sent.length = 0;
        DESKTOP.flushPendingSaves();
        assert.equal(sent.length, 0, 'pending cleared after flush');
    });

    it('pagehide triggers the pending flush automatically', function() {
        var sent = [];
        var asyncFlags = [];
        window.XMLHttpRequest = function() {
            this.open = function(m, u, async) { asyncFlags.push(async); };
            this.setRequestHeader = function() {};
            this.send = function(body) { sent.push(body); };
        };
        DESKTOP.flushPendingSaves();          // clear leftovers
        DESKTOP.saveDesktopSection('settings', {x: 1});
        sent.length = 0;
        window.dispatchEvent(new Event('pagehide'));
        assert.ok(sent.length >= 1, 'pagehide flushed the pending save');
        assert.equal(asyncFlags[asyncFlags.length - 1], false, 'flush POST is synchronous');
    });
});

// ===== replayNotifications: desktop toggle vs mobile force-review =====
// Desktop bell = Win10-style toggle (click closes on-screen toasts).
// Mobile switcher bell (forceReview=true) = the only notification entry
// on mobile — it must ALWAYS re-pop, never close (bugfix 2026-08-15:
// first tap hid the stale toast and showed nothing).
describe('LuCIDesktop.replayNotifications', function() {
    var btn, origXHR;

    function wait(ms) { return new Promise(function(res) { setTimeout(res, ms); }); }

    // 构造 tray bell 环境：btn-notifications + stub uci_changes XHR
    function setup(count, noPw) {
        btn = document.createElement('button');
        btn.id = 'btn-notifications';
        document.body.appendChild(btn);
        origXHR = window.XMLHttpRequest;
        var body = JSON.stringify({count: count || 0, no_password: !!noPw});
        window.XMLHttpRequest = function() {
            this.open = function() {};
            this.setRequestHeader = function() {};
            this.send = function() {
                var self = this;
                setTimeout(function() {
                    self.status = 200;
                    self.responseText = body;
                    if (self.onload) self.onload();
                }, 0);
            };
        };
        DESKTOP._initUciIndicator();
    }
    function teardown() {
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        window.XMLHttpRequest = origXHR;
        document.querySelectorAll('.desktop-toast').forEach(function(t) { t.remove(); });
    }
    function changesToast() {
        return document.querySelector('.desktop-toast[data-key="changes"]:not(.toast-hiding)');
    }

    it('desktop bell toggle: with toasts on screen one click closes them all', function() {
        setup(2, false);
        return wait(60).then(function() {
            assert.ok(changesToast(), 'changes toast auto-popped by the poll (count=2)');
            DESKTOP.replayNotifications();   // desktop bell click, no forceReview
            return wait(60).then(function() {
                assert.ok(!changesToast(), 'toast dismissed (Win10 toggle semantics kept)');
            });
        }).then(teardown, function(e) { teardown(); throw e; });
    });

    it('mobile forceReview: never closes — re-pops the notification for review', function() {
        setup(2, false);
        return wait(60).then(function() {
            assert.ok(changesToast(), 'toast on screen');
            DESKTOP.replayNotifications(true);   // mobile switcher bell
            return wait(60).then(function() {
                // force re-pop: same-key toast replaced, a fresh copy is up
                assert.ok(changesToast(), 'a changes toast is on screen after review');
            });
        }).then(teardown, function(e) { teardown(); throw e; });
    });

    it('mobile forceReview with a clean changes screen still pops the no-password warning', function() {
        setup(0, true);   // no_password → the poll auto-pops the password toast
        return wait(60).then(function() {
            assert.ok(document.querySelector('.desktop-toast[data-key="password"]:not(.toast-hiding)'),
                'password toast auto-popped by the poll');
            DESKTOP.replayNotifications(true);
            return wait(30).then(function() {
                assert.ok(document.querySelector('.desktop-toast[data-key="password"]:not(.toast-hiding)'),
                    'force review keeps the password warning readable');
            });
        }).then(teardown, function(e) { teardown(); throw e; });
    });

    it('system warnings (password) are NOT suppressible — ✕ closes only for this session', function() {
        setup(0, true);   // no_password → password toast auto-pops
        return wait(60).then(function() {
            var t = document.querySelector('.desktop-toast[data-key="password"]:not(.toast-hiding)');
            assert.ok(t, 'password toast on screen');
            t.querySelector('.toast-close').click();   // ✕ 仅本次关闭
            return wait(30).then(function() {
                assert.ok(!localStorage.getItem('desktop.password_toast_dismissed'),
                    'system warning has NO persistent suppression key');
                document.querySelectorAll('.desktop-toast').forEach(function(x) { x.remove(); });
                // 新会话（重建闭包）仍自动弹——系统级警告不可抑制
                teardown();
                setup(0, true);
                return wait(60).then(function() {
                    assert.ok(document.querySelector('.desktop-toast[data-key="password"]:not(.toast-hiding)'),
                        'system warning re-pops on the next session');
                });
            });
        }).then(teardown, function(e) { teardown(); throw e; });
    });
});

// ===== Notification registry (categories + per-notice suppression) =====
describe('LuCIDesktop.notificationRegistry', function() {
    it('defines per-notice suppression flags', function() {
        var reg = DESKTOP.notificationRegistry;
        assert.ok(reg, 'registry defined');
        assert.equal(reg['password'].suppressible, false, 'system warning (password) NOT suppressible');
        assert.equal(reg['changes'].suppressible, false, 'system warning (changes) NOT suppressible');
        assert.equal(reg['platform-compat'].suppressible, true, 'platform-compat suppressible');
        assert.equal(reg['wp-refresh-failed'].suppressible, true, 'wp-refresh-failed suppressible');
        assert.equal(reg['wp-picsum-unreachable'].suppressible, true, 'wp-picsum-unreachable suppressible');
        assert.equal(reg['wp-saved'].suppressible, true, 'wp-saved suppressible');
        assert.equal(reg['widget-max'].suppressible, true, 'widget-max suppressible');
    });

    it('every suppressible notice has a human label (settings panel)', function() {
        var reg = DESKTOP.notificationRegistry;
        Object.keys(reg).forEach(function(key) {
            if (reg[key].suppressible) {
                assert.ok(reg[key].label && reg[key].label.length > 0, key + ' has a label');
            }
        });
    });
});

})();
