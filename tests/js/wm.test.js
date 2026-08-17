/* wm.test.js — Window Manager Unit Tests
 *
 * Run: open test-runner.html in a browser
 * Test order: RED (write test) → GREEN (make pass) → REFACTOR
 */

(function() {
'use strict';

// ===== Test Setup Helpers =====
function setupDOM() {
    // Create the minimal DOM skeleton that wm.js expects
    var container = document.getElementById('window-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'window-container';
        document.body.appendChild(container);
    }
    container.innerHTML = '';

    // Reset LuCIDesktop state
    LuCIDesktop.windows = {};
    LuCIDesktop.nextZIndex = 100;
    LuCIDesktop.nextWindowId = 1;
    LuCIDesktop.activeWindowId = null;
}

function createTestWindow(url, title) {
    return WM.open(url || '/test/page', title || 'Test Window');
}

// Manually complete CSS animations (headless browsers may not trigger animationend)
function finishAnimation(el) {
    if (el) el.dispatchEvent(new AnimationEvent('animationend', {bubbles: true}));
}

// ===== Test Suites =====

describe('WM.open(url, title)', function() {

    it('should create a .window element in #window-container', function() {
        setupDOM();
        var id = WM.open('/test/page', 'Test Window');
        var win = document.querySelector('.window');
        assert.ok(win, 'window element should exist');
        assert.equal(win.getAttribute('data-window-id'), id, 'data-window-id matches');
    });

    it('should generate unique window IDs', function() {
        setupDOM();
        var id1 = WM.open('/a', 'A');
        var id2 = WM.open('/b', 'B');
        assert.notEqual(id1, id2, 'window IDs should be unique');
        assert.contains(id1, 'win-', 'ID format: win-N');
    });

    it('should register window in LuCIDesktop.windows{}', function() {
        setupDOM();
        var id = WM.open('/test', 'Test');
        assert.ok(LuCIDesktop.windows[id], 'window registered in windows{}');
        assert.equal(LuCIDesktop.windows[id].title, 'Test', 'title stored correctly');
    });

    it('should create titlebar with specified title', function() {
        setupDOM();
        WM.open('/test', 'My Custom Title');
        var titleEl = document.querySelector('.window-title');
        assert.ok(titleEl, 'title element exists');
        assert.equal(titleEl.textContent, 'My Custom Title', 'title text matches');
    });

    it('should create an iframe inside the window body', function() {
        setupDOM();
        WM.open('/test/page', 'Test');
        var iframe = document.querySelector('.window-body iframe');
        assert.ok(iframe, 'iframe exists');
        // Check that the URL was stored (may differ from actual src due to test stub)
        var winId = Object.keys(LuCIDesktop.windows)[0];
        assert.contains(LuCIDesktop.windows[winId].url, '/test/page', 'url stored');
    });

    it('should return the windowId', function() {
        setupDOM();
        var id = WM.open('/a', 'B');
        assert.ok(typeof id === 'string' && id.length > 0, 'returns non-empty string');
    });
});

describe('WM.close(id)', function() {
    it('should remove window element from DOM', function() {
        setupDOM();
        var id = createTestWindow();
        var el = document.querySelector('.window');
        assert.ok(el, 'window exists before close');
        WM.close(id);
        finishAnimation(el);
        assert.isNull(document.querySelector('.window'), 'window removed from DOM');
    });

    it('should remove from LuCIDesktop.windows{}', function() {
        setupDOM();
        var id = createTestWindow();
        var el = document.querySelector('.window');
        WM.close(id);
        finishAnimation(el);
        assert.ok(!LuCIDesktop.windows[id], 'removed from windows{}');
    });

    it('should do nothing for non-existent window ID (no crash)', function() {
        setupDOM();
        var threw = false;
        try { WM.close('win-nonexistent'); } catch(e) { threw = true; }
        assert.ok(!threw, 'should not throw on non-existent window ID');
    });
});

describe('WM.focus(id)', function() {
    it('should set activeWindowId', function() {
        setupDOM();
        var id1 = createTestWindow();
        var id2 = createTestWindow();
        WM.focus(id1);
        assert.equal(LuCIDesktop.activeWindowId, id1, 'activeWindowId updated');
    });

    it('should bring focused window to highest z-index', function() {
        setupDOM();
        var id1 = createTestWindow();
        var id2 = createTestWindow();
        WM.focus(id1);
        var win1 = document.querySelector('[data-window-id="' + id1 + '"]');
        var win2 = document.querySelector('[data-window-id="' + id2 + '"]');
        var z1 = parseInt(win1.style.zIndex);
        var z2 = parseInt(win2.style.zIndex);
        assert.ok(z1 > z2, 'focused window has higher z-index (' + z1 + ' > ' + z2 + ')');
    });
});

describe('WM.minimize(id) / WM.restore(id)', function() {
    it('minimize should hide the window', function() {
        setupDOM();
        var id = createTestWindow();
        var win = document.querySelector('[data-window-id="' + id + '"]');
        WM.minimize(id);
        finishAnimation(win);
        assert.equal(win.style.display, 'none', 'window is display:none');
        assert.ok(LuCIDesktop.windows[id].minimized, 'minimized flag set');
    });

    it('restore should show the window again', function() {
        setupDOM();
        var id = createTestWindow();
        WM.minimize(id);
        WM.restore(id);
        var win = document.querySelector('[data-window-id="' + id + '"]');
        assert.notEqual(win.style.display, 'none', 'window is visible again');
        assert.ok(!LuCIDesktop.windows[id].minimized, 'minimized flag cleared');
    });
});

describe('WM.toggleMaximize(id)', function() {
    it('should toggle maximized class on the window', function() {
        setupDOM();
        var id = createTestWindow();
        var win = document.querySelector('[data-window-id="' + id + '"]');

        WM.toggleMaximize(id);
        assert.ok(win.classList.contains('maximized'), 'first toggle: maximized');

        WM.toggleMaximize(id);
        assert.ok(!win.classList.contains('maximized'), 'second toggle: restored');
    });
});

describe('WM.getEmbedUrl(url)', function() {
    it('should append ?embed=1 for clean URLs', function() {
        var result = WM.getEmbedUrl('/cgi-bin/luci/admin/status/overview');
        assert.equal(result, '/cgi-bin/luci/admin/status/overview?embed=1', 'appended ?embed=1');
    });

    it('should append &embed=1 for URLs with existing params', function() {
        var result = WM.getEmbedUrl('/cgi-bin/luci/admin/status/overview?status=1');
        assert.equal(result, '/cgi-bin/luci/admin/status/overview?status=1&embed=1', 'appended &embed=1');
    });
});

describe('Drag behavior', function() {
    it('mousedown on titlebar should start tracking', function() {
        setupDOM();
        var id = createTestWindow();
        var titlebar = document.querySelector('[data-window-id="' + id + '"] .window-titlebar');

        var mousedown = new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 50 });
        titlebar.dispatchEvent(mousedown);

        assert.ok(LuCIDesktop.dragging, 'dragging state active');
        assert.equal(LuCIDesktop.dragging.winId, id, 'dragging winId set');
    });

    it('mousemove should update window position', function() {
        setupDOM();
        var id = createTestWindow();
        var titlebar = document.querySelector('[data-window-id="' + id + '"] .window-titlebar');
        var win = document.querySelector('[data-window-id="' + id + '"]');

        // Simulate drag start
        titlebar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 50 }));

        // Simulate drag move
        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 80 }));

        var left = parseInt(win.style.left);
        var top = parseInt(win.style.top);
        assert.ok(!isNaN(left) && left > 0, 'left position updated');
        assert.ok(!isNaN(top) && top > 0, 'top position updated');
    });

    it('mouseup should stop tracking', function() {
        setupDOM();
        var id = createTestWindow();
        var titlebar = document.querySelector('[data-window-id="' + id + '"] .window-titlebar');

        titlebar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 50 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        assert.ok(!LuCIDesktop.dragging, 'dragging state cleared');
    });
});

describe('Window controls buttons', function() {
    it('close button should call WM.close', function() {
        setupDOM();
        var id = createTestWindow();
        var el = document.querySelector('.window');
        var closeBtn = el.querySelector('.btn-close');
        closeBtn.click();
        finishAnimation(el);
        assert.isNull(document.querySelector('.window'), 'window closed');
        assert.ok(!LuCIDesktop.windows[id], 'removed from registry');
    });

    it('minimize button should call WM.minimize', function() {
        setupDOM();
        var id = createTestWindow();
        var win = document.querySelector('[data-window-id="' + id + '"]');
        var minBtn = win.querySelector('.btn-minimize');
        minBtn.click();
        finishAnimation(win);
        assert.equal(win.style.display, 'none', 'window minimized');
    });

    it('maximize button should toggle maximize', function() {
        setupDOM();
        var id = createTestWindow();
        var maxBtn = document.querySelector('[data-window-id="' + id + '"] .btn-maximize');
        var win = document.querySelector('[data-window-id="' + id + '"]');

        maxBtn.click();
        assert.ok(win.classList.contains('maximized'), 'maximized after click');

        maxBtn.click();
        assert.ok(!win.classList.contains('maximized'), 'restored after second click');
    });
});

describe('Cascade positioning', function() {
    it('first window should have default position', function() {
        setupDOM();
        var id = createTestWindow();
        var win = document.querySelector('[data-window-id="' + id + '"]');
        assert.ok(win.style.left, 'has left position');
        assert.ok(win.style.top, 'has top position');
    });

    it('second window should have different position from first', function() {
        setupDOM();
        var id1 = createTestWindow();
        var id2 = createTestWindow();
        var win1 = document.querySelector('[data-window-id="' + id1 + '"]');
        var win2 = document.querySelector('[data-window-id="' + id2 + '"]');

        assert.ok(win1.style.left, 'win1 has left');
        assert.ok(win1.style.top, 'win1 has top');
        assert.ok(win2.style.left, 'win2 has left');
        assert.ok(win2.style.top, 'win2 has top');
        var l1=parseInt(win1.style.left)||0,t1=parseInt(win1.style.top)||0;
        var l2=parseInt(win2.style.left)||0,t2=parseInt(win2.style.top)||0;
        assert.ok(l1!==l2||t1!==t2, 'windows at different positions or same is ok');
    });
});

// ===== Window height ceiling (0.1.0-69/86 regression) =====
// maxWindowHeight(top) = min(700, innerHeight - taskbar - 12, avail - top).
// A window's bottom edge must never cross the taskbar — even on small
// viewports (simulated here by a tall taskbar) or when opened low on
// screen (cascade slot y is accounted for).
describe('WM window height ceiling', function() {
    beforeEach(function() {
        // 清掉前面 suite 可能残留的窗口（cascade 计数基于可见窗口数）
        Object.keys(window.LuCIDesktop.windows).forEach(function(id) { WM.close(id); });
        document.querySelectorAll('.window').forEach(function(w) { w.remove(); });
        var tb = document.getElementById('taskbar');
        if (tb) { tb.style.display = ''; tb.style.height = ''; }
    });
    afterEach(function() {
        Object.keys(window.LuCIDesktop.windows).forEach(function(id) { WM.close(id); });
        document.querySelectorAll('.window').forEach(function(w) { w.remove(); });
        var tb = document.getElementById('taskbar');
        if (tb) { tb.style.display = ''; tb.style.height = ''; }
    });

    function winH(id) { return parseInt(window.LuCIDesktop.windows[id].el.style.height, 10); }

    it('tall viewport: window opens at min(700, viewport - taskbar - gap)', function() {
        var id = WM.open('/cgi-bin/luci/admin/status', 'H1');
        // 实际 taskbar 高度（runner 视口可能触发 mobile 样式）+ 第 1 窗 slotY=40
        var tb = document.getElementById('taskbar');
        var avail = Math.min(700, window.innerHeight - tb.offsetHeight - 12);
        assert.equal(winH(id), Math.min(avail, avail - 40), 'height: min(700, avail, avail-top)');
    });

    it('small viewport (tall taskbar): height capped by available space', function() {
        var tb = document.getElementById('taskbar');
        tb.style.display = 'block';
        tb.style.height = '300px';   // simulate little vertical room
        var id = WM.open('/cgi-bin/luci/admin/status', 'H2');
        var avail = Math.min(700, window.innerHeight - 300 - 12);
        assert.equal(winH(id), Math.min(avail, avail - 40), 'height: min(700, avail, avail-top=40)');
    });

    it('window opened lower on screen gets a smaller ceiling (cascade top accounted)', function() {
        var tb = document.getElementById('taskbar');
        tb.style.display = 'block';
        tb.style.height = '300px';
        var ids = [];
        for (var i = 0; i < 4; i++) ids.push(WM.open('/cgi-bin/luci/admin/status', 'S' + i));
        // 第 4 窗 level=3 → top = 40 + 3*30 = 130 → ceiling = avail - 130
        var avail = Math.min(700, window.innerHeight - 300 - 12);
        assert.equal(winH(ids[3]), Math.max(200, avail - 130), 'top offset reduces the ceiling (floored at MIN_HEIGHT)');
    });
});

// ===== Browser tab title follows the opened app (2026-08-16) =====
// User report: the browser tab shows LuCI's internal page title ("概况")
// instead of the app name the user opened (argon shows the menu name).
// WM.open must set document.title to the app title; closing the last
// window restores the default shell title.
describe('WM document.title', function() {
    var origTitle;

    beforeEach(function() {
        setupDOM();
        origTitle = document.title;
    });
    afterEach(function() {
        Object.keys(LuCIDesktop.windows || {}).forEach(function(id) { WM.close(id); });
        document.title = origTitle;
    });

    it('WM.open sets document.title to the app title', function() {
        WM.open('/cgi-bin/luci/admin/status', 'Status');
        assert.equal(document.title, 'Status', 'tab title = opened app name');
    });

    it('opening a second window updates the tab title to the focused app', function() {
        WM.open('/cgi-bin/luci/admin/status', 'Status');
        WM.open('/cgi-bin/luci/admin/system', 'System');
        assert.equal(document.title, 'System', 'tab title follows the newest/focused window');
    });

    it('closing the last window restores the default shell title', function() {
        var id = WM.open('/cgi-bin/luci/admin/status', 'Status');
        WM.close(id);
        // finish animation then check
        var w = document.querySelector('.window');
        if (w) finishAnimation(w);
        assert.ok(document.title !== 'Status', 'tab title no longer the closed app');
    });
});

})();
